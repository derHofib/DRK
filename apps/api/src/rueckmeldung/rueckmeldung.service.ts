import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import sharp from "sharp";
import type {
  RueckmeldungArt,
  RueckmeldungBerechtigungDto,
  RueckmeldungDetailDto,
  RueckmeldungEntscheidung,
  RueckmeldungKontext,
  RueckmeldungListeDto,
  RueckmeldungMeineDto,
  RueckmeldungPrioritaet,
  RueckmeldungStatus,
} from "@zimmerakte/shared";
import { AuditService } from "../audit/audit.service";
import { requireTenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";

/** Obergrenze des Screenshots; die Tabelle prueft dieselben 2 MB als CHECK. */
export const MAX_SCREENSHOT_BYTES = 1_500_000;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Zweite Verteidigungslinie fuer die Seitenangabe: das Frontend ersetzt Ids
 * schon vor dem Senden, aber der Server verlaesst sich nicht darauf. Eine
 * Klienten-Id im Pfad waere ein Personenbezug im Kontext, der dann ohne Bild
 * und Text mit uebermittelt wuerde. Query und Fragment fallen weg (Suchbegriffe
 * sind oft Namen).
 */
export function bereinigeSeite(seite: string): string {
  return seite.split(/[?#]/)[0].replace(UUID, ":id").slice(0, 200);
}

export interface RueckmeldungEingabe {
  art: RueckmeldungArt;
  titel: string;
  beschreibung: string;
  erwartet?: string;
  prioritaet: RueckmeldungPrioritaet;
  kontext: RueckmeldungKontext;
}

const LISTE_SPALTEN = `r.id, r.art, r.titel, r.prioritaet, r.status, r.erstellt_am,
  bu.name AS erstellt_von_name,
  EXISTS (SELECT 1 FROM rueckmeldung_bild b WHERE b.rueckmeldung_id = r.id) AS hat_bild`;

function zuListe(r: any): RueckmeldungListeDto {
  return {
    id: r.id,
    art: r.art,
    titel: r.titel,
    prioritaet: r.prioritaet,
    status: r.status,
    erstelltAm: r.erstellt_am,
    erstelltVonName: r.erstellt_von_name,
    hatBild: r.hat_bild,
  };
}

/**
 * Rueckmeldungen aus der App (migrations/0073). Die Mandantentrennung leistet
 * RLS; hier steht deshalb kein WHERE mandant_id. Rechtepruefungen sitzen neben
 * dem SQL, das sie schuetzen.
 *
 * Melden darf jede angemeldete Person (der Controller laesst nur Benutzer-,
 * keine Klient-Tokens durch) -- ohne Recht, damit niemand eine Idee
 * zurueckhaelt, weil ihr Accounttyp das Recht nicht hat. Sichten und
 * Entscheiden ist `rueckmeldungen.verwalten`.
 */
@Injectable()
export class RueckmeldungService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
  ) {}

  private async pruefeVerwalten(): Promise<void> {
    if (!(await this.rechte.hatRecht("rueckmeldungen", "verwalten"))) {
      throw new ForbiddenException("Nur die Geschäftsführung darf Rückmeldungen sichten und freigeben.");
    }
  }

  async melden(eingabe: RueckmeldungEingabe): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const kontext: RueckmeldungKontext = { ...eingabe.kontext };
    if (kontext.seite !== undefined) kontext.seite = bereinigeSeite(kontext.seite);
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO rueckmeldung (mandant_id, erstellt_von, art, titel, beschreibung, erwartet, prioritaet, kontext)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [ctx.mandantId, ctx.benutzerId, eingabe.art, eingabe.titel, eingabe.beschreibung, eingabe.erwartet ?? null, eingabe.prioritaet, JSON.stringify(kontext)]
      );
      return { id: rows[0].id };
    });
  }

  /**
   * Das Bild gehoert zur meldenden Person und wird nur direkt nach dem Melden
   * angehaengt (Status neu, noch kein Bild) -- danach nur noch loeschen. Es
   * wird dekodiert: ein beliebiger Inhalt mit Dateiendung .png kommt nicht in
   * die Datenbank.
   */
  async screenshotAnhaengen(id: string, daten: Buffer): Promise<void> {
    const ctx = requireTenantContext();
    if (daten.length === 0) throw new BadRequestException("Der Screenshot ist leer.");
    let breite: number;
    let hoehe: number;
    try {
      const meta = await sharp(daten).metadata();
      if (meta.format !== "png" || !meta.width || !meta.height) throw new Error("kein PNG");
      breite = meta.width;
      hoehe = meta.height;
    } catch {
      throw new BadRequestException("Der Screenshot muss ein PNG-Bild sein.");
    }
    if (breite > 4000 || hoehe > 4000) throw new BadRequestException("Der Screenshot ist zu groß (höchstens 4000 Pixel je Kante).");

    await this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        "SELECT 1 FROM rueckmeldung WHERE id = $1 AND erstellt_von = $2 AND status = 'neu'",
        [id, ctx.benutzerId]
      );
      if (rows.length === 0) throw new NotFoundException("Rückmeldung nicht gefunden.");
      const eingefuegt = await client.query(
        `INSERT INTO rueckmeldung_bild (mandant_id, rueckmeldung_id, daten, breite, hoehe)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (rueckmeldung_id) DO NOTHING`,
        [ctx.mandantId, id, daten, breite, hoehe]
      );
      if (eingefuegt.rowCount === 0) throw new ConflictException("Zu dieser Rückmeldung gibt es schon einen Screenshot.");
    });
  }

  /** Eigene Meldungen: nur Status und Rueckmeldung der Leitung, nie Bild oder Kontext. */
  async meine(): Promise<RueckmeldungMeineDto[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT id, art, titel, status, erstellt_am, entscheidungsnotiz
         FROM rueckmeldung WHERE erstellt_von = $1 ORDER BY erstellt_am DESC LIMIT 50`,
        [ctx.benutzerId]
      );
      return rows.map((r) => ({
        id: r.id,
        art: r.art,
        titel: r.titel,
        status: r.status as RueckmeldungStatus,
        erstelltAm: r.erstellt_am,
        entscheidungsnotiz: r.entscheidungsnotiz,
      }));
    });
  }

  /** Fuer das Menue: ohne Recht keine Fehlermeldung, sondern schlicht "nein". */
  async berechtigung(): Promise<RueckmeldungBerechtigungDto> {
    if (!(await this.rechte.hatRecht("rueckmeldungen", "verwalten"))) return { verwalten: false, anzahlNeu: 0 };
    const anzahl = await this.db.withTenant(async (client) => {
      const { rows } = await client.query("SELECT count(*)::int AS n FROM rueckmeldung WHERE status = 'neu'");
      return rows[0].n as number;
    });
    return { verwalten: true, anzahlNeu: anzahl };
  }

  async liste(filter: { status?: RueckmeldungStatus; art?: RueckmeldungArt }): Promise<RueckmeldungListeDto[]> {
    await this.pruefeVerwalten();
    return this.db.withTenant(async (client) => {
      const werte: unknown[] = [];
      const bedingungen: string[] = [];
      if (filter.status) {
        werte.push(filter.status);
        bedingungen.push(`r.status = $${werte.length}`);
      }
      if (filter.art) {
        werte.push(filter.art);
        bedingungen.push(`r.art = $${werte.length}`);
      }
      const where = bedingungen.length ? `WHERE ${bedingungen.join(" AND ")}` : "";
      const { rows } = await client.query(
        `SELECT ${LISTE_SPALTEN} FROM rueckmeldung r JOIN benutzer bu ON bu.id = r.erstellt_von
         ${where} ORDER BY r.erstellt_am DESC LIMIT 200`,
        werte
      );
      return rows.map(zuListe);
    });
  }

  async detail(id: string): Promise<RueckmeldungDetailDto> {
    await this.pruefeVerwalten();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT ${LISTE_SPALTEN}, r.beschreibung, r.erwartet, r.kontext, r.freigegeben_am,
                fb.name AS freigegeben_von_name, r.entscheidungsnotiz, r.bearbeitungsnotiz, r.pr_url
         FROM rueckmeldung r
         JOIN benutzer bu ON bu.id = r.erstellt_von
         LEFT JOIN benutzer fb ON fb.id = r.freigegeben_von
         WHERE r.id = $1`,
        [id]
      );
      const r = rows[0];
      if (!r) throw new NotFoundException("Rückmeldung nicht gefunden.");
      return {
        ...zuListe(r),
        beschreibung: r.beschreibung,
        erwartet: r.erwartet,
        kontext: r.kontext,
        freigegebenAm: r.freigegeben_am,
        freigegebenVonName: r.freigegeben_von_name,
        entscheidungsnotiz: r.entscheidungsnotiz,
        bearbeitungsnotiz: r.bearbeitungsnotiz,
        prUrl: r.pr_url,
      };
    });
  }

  async bild(id: string): Promise<Buffer> {
    await this.pruefeVerwalten();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query("SELECT daten FROM rueckmeldung_bild WHERE rueckmeldung_id = $1", [id]);
      if (rows.length === 0) throw new NotFoundException("Kein Screenshot vorhanden.");
      return rows[0].daten as Buffer;
    });
  }

  /** Die Geschaeftsfuehrung kann ein Bild verwerfen, etwa weil doch ein Name zu lesen ist. */
  async bildLoeschen(id: string): Promise<void> {
    await this.pruefeVerwalten();
    await this.db.withTenant(async (client) => {
      const { rowCount } = await client.query("DELETE FROM rueckmeldung_bild WHERE rueckmeldung_id = $1", [id]);
      if (!rowCount) throw new NotFoundException("Kein Screenshot vorhanden.");
      await this.audit.protokollieren(client, { modul: "rueckmeldungen", aktion: "bild-verwerfen", objektTyp: "rueckmeldung", objektId: id });
    });
  }

  /**
   * Entscheidung der Geschaeftsfuehrung. Freigeben setzt freigegeben_am/-von;
   * jeder andere Status loescht sie wieder (der CHECK in 0073 verlangt beides
   * zusammen). in_arbeit/umgesetzt gibt es hier nicht: die setzt nur der
   * Hersteller-Zugang, und der Trigger lehnt sie fuer die App-Rolle ab.
   */
  async entscheiden(id: string, status: RueckmeldungEntscheidung, notiz?: string): Promise<RueckmeldungDetailDto> {
    await this.pruefeVerwalten();
    const ctx = requireTenantContext();
    if ((status === "rueckfrage" || status === "abgelehnt") && !notiz?.trim()) {
      throw new BadRequestException(status === "abgelehnt" ? "Bitte eine kurze Begründung angeben." : "Bitte die Rückfrage formulieren.");
    }
    await this.db.withTenant(async (client) => {
      const { rows } = await client.query("SELECT status FROM rueckmeldung WHERE id = $1 FOR UPDATE", [id]);
      if (rows.length === 0) throw new NotFoundException("Rückmeldung nicht gefunden.");
      const vorher = rows[0].status as RueckmeldungStatus;
      if (vorher === "umgesetzt") throw new ConflictException("Eine umgesetzte Rückmeldung ist abgeschlossen.");
      await client.query(
        `UPDATE rueckmeldung SET status = $2,
                entscheidungsnotiz = coalesce($3, entscheidungsnotiz),
                freigegeben_am  = CASE WHEN $2 = 'freigegeben' THEN coalesce(freigegeben_am, now()) END,
                freigegeben_von = CASE WHEN $2 = 'freigegeben' THEN coalesce(freigegeben_von, $4::uuid) END
         WHERE id = $1`,
        [id, status, notiz?.trim() || null, ctx.benutzerId]
      );
      await this.audit.protokollieren(client, {
        modul: "rueckmeldungen",
        aktion: "entscheiden",
        objektTyp: "rueckmeldung",
        objektId: id,
        vorher: { status: vorher },
        nachher: { status },
      });
    });
    return this.detail(id);
  }
}
