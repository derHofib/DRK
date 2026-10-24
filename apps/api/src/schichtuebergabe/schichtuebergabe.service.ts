import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  DIENST_LABEL,
  Dienst,
  SchichtuebergabeDto,
  SchichtuebergabePunktDto,
} from "@zimmerakte/shared";
import { KlientNamen } from "../common/klient-namen";
import {
  ermittleErlaubteStandortIds,
  klientIstErlaubt,
  standortIstErlaubt,
} from "../common/standort-restriction";
import { aktuellerTeilnehmer, requireTenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { AufgabeService } from "../aufgaben/aufgabe.service";
import { RechteService } from "../rechte/rechte.service";

interface PunktEingabe {
  text: string;
  klientId?: string;
  zimmerId?: string;
}

/**
 * Ungelesen zaehlt nur eine Uebergabe der letzten Tage: wer aus dem Urlaub
 * kommt, soll nicht mit einem Berg alter Karten begruesst werden -- den
 * Verlauf gibt es in der Liste.
 */
const UNGELESEN_TAGE = 3;
const UNGELESEN_MAX = 3;
const LISTE_MAX = 30;

@Injectable()
export class SchichtuebergabeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly aufgaben: AufgabeService
  ) {}

  private async verlangen(aktion: "ansehen" | "schreiben"): Promise<void> {
    if (!(await this.rechte.hatRecht("schichtuebergabe", aktion))) {
      throw new ForbiddenException(
        aktion === "ansehen" ? "Für Schichtübergaben fehlt die Berechtigung." : "Zum Schreiben von Schichtübergaben fehlt die Berechtigung."
      );
    }
  }

  async anlegen(input: { standortId: string; dienst: Dienst; punkte: PunktEingabe[] }): Promise<SchichtuebergabeDto> {
    await this.verlangen("schreiben");
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await standortIstErlaubt(client, ctx.benutzerId, input.standortId))) {
        throw new NotFoundException("Standort nicht gefunden.");
      }
      for (const p of input.punkte) await this.pruefePunkt(client, ctx.benutzerId, input.standortId, p);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO schichtuebergabe (mandant_id, standort_id, dienst, verfasst_von)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [ctx.mandantId, input.standortId, input.dienst, ctx.benutzerId]
      );
      const id = rows[0].id;
      for (const [i, p] of input.punkte.entries()) {
        await client.query(
          `INSERT INTO schichtuebergabe_punkt (mandant_id, uebergabe_id, position, text, klient_id, zimmer_id, erstellt_von)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ctx.mandantId, id, i + 1, p.text, p.klientId ?? null, p.zimmerId ?? null, ctx.benutzerId]
        );
      }
      return (await this.lade(client, { id }))[0];
    });
  }

  async liste(standortId?: string): Promise<SchichtuebergabeDto[]> {
    await this.verlangen("ansehen");
    return this.db.withTenant((client) => this.lade(client, { standortId, limit: LISTE_MAX }));
  }

  async ungelesen(): Promise<SchichtuebergabeDto[]> {
    await this.verlangen("ansehen");
    return this.db.withTenant((client) => this.lade(client, { nurUngelesen: true, limit: UNGELESEN_MAX }));
  }

  async gelesenMarkieren(id: string): Promise<{ ok: true }> {
    await this.verlangen("ansehen");
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      // lade() wendet die Standort-Beschraenkung an: wer die Uebergabe nicht
      // sehen darf, kann sie auch nicht quittieren.
      if ((await this.lade(client, { id })).length === 0) throw new NotFoundException("Übergabe nicht gefunden.");
      await client.query(
        `INSERT INTO schichtuebergabe_gelesen (uebergabe_id, benutzer_id, mandant_id) VALUES ($1, $2, $3)
         ON CONFLICT (uebergabe_id, benutzer_id) DO NOTHING`,
        [id, ctx.benutzerId, ctx.mandantId]
      );
      return { ok: true as const };
    });
  }

  async nachtragAnlegen(id: string, punkt: PunktEingabe): Promise<SchichtuebergabeDto> {
    await this.verlangen("schreiben");
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const uebergabe = (await this.lade(client, { id }))[0];
      if (!uebergabe) throw new NotFoundException("Übergabe nicht gefunden.");
      await this.pruefePunkt(client, ctx.benutzerId, uebergabe.standortId, punkt);
      // Zwei gleichzeitige Nachtraege kollidieren am UNIQUE (uebergabe_id,
      // position); der zweite scheitert dann sichtbar statt still zu ueberschreiben.
      const { rows } = await client.query<{ n: number }>(
        "SELECT COALESCE(max(position), 0) + 1 AS n FROM schichtuebergabe_punkt WHERE uebergabe_id = $1",
        [id]
      );
      await client.query(
        `INSERT INTO schichtuebergabe_punkt (mandant_id, uebergabe_id, position, text, klient_id, zimmer_id, nachtrag, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
        [ctx.mandantId, id, rows[0].n, punkt.text, punkt.klientId ?? null, punkt.zimmerId ?? null, ctx.benutzerId]
      );
      return (await this.lade(client, { id }))[0];
    });
  }

  /**
   * Aus einem Punkt wird eine normale Aufgabe (AufgabeService), die Zimmer
   * und Klient:in mitbringt. Hat der Punkt nur eine Klient:in, nehmen wir
   * deren aktuelles Zimmer -- eine Aufgabe ohne Zimmer sieht RLS nur
   * Ersteller:in und Zugewiesenen (0033), sie waere fuer das Team unsichtbar.
   * Gibt es auch dann kein Zimmer, wird sie der anlegenden Person
   * zugewiesen, damit sie nicht ins Leere faellt.
   */
  async aufgabeAnlegen(punktId: string, zugewiesenAn?: string) {
    await this.verlangen("schreiben");
    const ctx = requireTenantContext();
    const vorbereitet = await this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT p.id, p.text, p.klient_id, p.zimmer_id, u.id AS uebergabe_id, u.dienst, u.gesendet_am
         FROM schichtuebergabe_punkt p JOIN schichtuebergabe u ON u.id = p.uebergabe_id
         WHERE p.id = $1`,
        [punktId]
      );
      if (rows.length === 0 || (await this.lade(client, { id: rows[0].uebergabe_id })).length === 0) {
        throw new NotFoundException("Punkt nicht gefunden.");
      }
      const vorhanden = await client.query("SELECT 1 FROM aufgabe WHERE schichtuebergabe_punkt_id = $1", [punktId]);
      if (vorhanden.rows.length > 0) throw new ConflictException("Für diesen Punkt gibt es bereits eine Aufgabe.");
      let zimmerId: string | null = rows[0].zimmer_id;
      if (!zimmerId && rows[0].klient_id) {
        const z = await client.query(
          `SELECT zimmer_id FROM belegung WHERE klient_id = $1 AND einzug <= CURRENT_DATE AND (auszug IS NULL OR auszug > CURRENT_DATE) LIMIT 1`,
          [rows[0].klient_id]
        );
        zimmerId = z.rows[0]?.zimmer_id ?? null;
      }
      return { punkt: rows[0], zimmerId };
    });
    const { punkt, zimmerId } = vorbereitet;
    const datum = new Date(punkt.gesendet_am).toLocaleDateString("de-DE");
    return this.aufgaben.anlegen({
      titel: String(punkt.text).slice(0, 120),
      beschreibung: `${punkt.text}\n\nAus der Schichtübergabe (${DIENST_LABEL[punkt.dienst as Dienst]}, ${datum}).`,
      zimmerId: zimmerId ?? undefined,
      klientId: punkt.klient_id ?? undefined,
      zugewiesenAn: zugewiesenAn ?? (zimmerId ? undefined : ctx.benutzerId),
      schichtuebergabePunktId: punktId,
    });
  }

  private async pruefePunkt(client: PoolClient, benutzerId: string, standortId: string, p: PunktEingabe) {
    if (p.zimmerId) {
      const { rows } = await client.query("SELECT 1 FROM zimmer WHERE id = $1 AND standort_id = $2", [p.zimmerId, standortId]);
      if (rows.length === 0) throw new NotFoundException("Zimmer nicht gefunden.");
    }
    if (p.klientId && !(await klientIstErlaubt(client, benutzerId, p.klientId))) {
      throw new NotFoundException("Klient:in nicht gefunden.");
    }
  }

  private async lade(
    client: PoolClient,
    filter: { id?: string; standortId?: string; nurUngelesen?: boolean; limit?: number }
  ): Promise<SchichtuebergabeDto[]> {
    const ctx = requireTenantContext();
    const erlaubt = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
    const params: unknown[] = [ctx.benutzerId];
    const bedingungen: string[] = [];
    const param = (w: unknown) => {
      params.push(w);
      return `$${params.length}`;
    };
    if (erlaubt) bedingungen.push(`u.standort_id = ANY(${param(erlaubt)})`);
    if (filter.id) bedingungen.push(`u.id = ${param(filter.id)}`);
    if (filter.standortId) bedingungen.push(`u.standort_id = ${param(filter.standortId)}`);
    if (filter.nurUngelesen) {
      bedingungen.push(
        `NOT EXISTS (SELECT 1 FROM schichtuebergabe_gelesen g WHERE g.uebergabe_id = u.id AND g.benutzer_id = $1)`,
        "u.verfasst_von <> $1",
        `u.gesendet_am > now() - interval '${UNGELESEN_TAGE} days'`
      );
    }
    const { rows } = await client.query(
      `SELECT u.id, u.standort_id, s.name AS standort_name, u.dienst, vb.name AS verfasst_von_name, u.gesendet_am, (u.verfasst_von = $1) AS eigene,
              EXISTS (SELECT 1 FROM schichtuebergabe_gelesen g WHERE g.uebergabe_id = u.id AND g.benutzer_id = $1) AS gelesen,
              (SELECT count(*)::int FROM schichtuebergabe_gelesen g WHERE g.uebergabe_id = u.id) AS gelesen_anzahl
       FROM schichtuebergabe u
       JOIN standort s ON s.id = u.standort_id
       JOIN benutzer vb ON vb.id = u.verfasst_von
       ${bedingungen.length ? "WHERE " + bedingungen.join(" AND ") : ""}
       ORDER BY u.gesendet_am DESC
       LIMIT ${filter.limit ?? 1}`,
      params
    );
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const { rows: punktRows } = await client.query(
      `SELECT p.id, p.uebergabe_id, p.position, p.text, p.klient_id, k.vorname, k.nachname,
              p.zimmer_id, z.nummer AS zimmer_nummer, p.nachtrag, eb.name AS erstellt_von_name, p.erstellt_am
       FROM schichtuebergabe_punkt p
       LEFT JOIN klient k ON k.id = p.klient_id
       LEFT JOIN zimmer z ON z.id = p.zimmer_id
       JOIN benutzer eb ON eb.id = p.erstellt_von
       WHERE p.uebergabe_id = ANY($1)
       ORDER BY p.uebergabe_id, p.position`,
      [ids]
    );
    // Aufgaben unterliegen ihrer eigenen RLS -- sichtbar ist nur, was die Person auch sonst sieht.
    const { rows: aufgabeRows } = await client.query(
      `SELECT id, titel, schichtuebergabe_punkt_id, (erledigt_am IS NOT NULL) AS erledigt
       FROM aufgabe WHERE schichtuebergabe_punkt_id = ANY($1)`,
      [punktRows.map((p) => p.id)]
    );

    const namen = new KlientNamen(client, aktuellerTeilnehmer());
    const punkteJe = new Map<string, SchichtuebergabePunktDto[]>();
    for (const p of punktRows) {
      const dto: SchichtuebergabePunktDto = {
        id: p.id,
        position: p.position,
        text: p.text,
        klientId: p.klient_id,
        klientName: p.klient_id ? await namen.name(p.klient_id, p.vorname, p.nachname) : null,
        zimmerId: p.zimmer_id,
        zimmerNummer: p.zimmer_nummer,
        nachtrag: p.nachtrag,
        erstelltVonName: p.erstellt_von_name,
        erstelltAm: p.erstellt_am,
        aufgaben: aufgabeRows
          .filter((a) => a.schichtuebergabe_punkt_id === p.id)
          .map((a) => ({ id: a.id, titel: a.titel, erledigt: a.erledigt })),
      };
      punkteJe.set(p.uebergabe_id, [...(punkteJe.get(p.uebergabe_id) ?? []), dto]);
    }
    return rows.map((r) => ({
      id: r.id,
      standortId: r.standort_id,
      standortName: r.standort_name,
      dienst: r.dienst,
      verfasstVonName: r.verfasst_von_name,
      gesendetAm: r.gesendet_am,
      gelesen: r.gelesen,
      gelesenAnzahl: r.gelesen_anzahl,
      eigene: r.eigene,
      punkte: punkteJe.get(r.id) ?? [],
    }));
  }
}
