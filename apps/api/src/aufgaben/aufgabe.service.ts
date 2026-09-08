import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, TenantContext, requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";

export type AufgabePrioritaet = "niedrig" | "normal" | "hoch";

export interface AufgabeEintrag {
  id: string;
  titel: string;
  beschreibung: string | null;
  prioritaet: AufgabePrioritaet;
  faelligAm: string | null;
  zimmerId: string | null;
  zimmerNummer: string | null;
  standortName: string | null;
  zugewiesenAn: string | null;
  zugewiesenAnName: string | null;
  erstelltVon: string;
  erstelltVonName: string;
  erledigtAm: string | null;
  erledigtVonName: string | null;
  erstelltAm: string;
}

export interface AufgabenAnzahl {
  jeZimmer: Record<string, number>;
  eigene: number;
}

interface AufgabeFilter {
  id?: string;
  zimmerId?: string;
  zugewiesenAn?: string;
  nurEigene?: boolean;
  offen?: boolean;
  faelligBis?: string;
  prioritaet?: AufgabePrioritaet;
  sortierung?: "faelligkeit" | "prioritaet";
}

interface AufgabeRoh {
  erstelltVon: string;
  zugewiesenAn: string | null;
  zimmerId: string | null;
  erledigtAm: string | null;
}

// Wer eine fremde Zimmer-Aufgabe voll bearbeiten/loeschen/erledigen darf,
// ohne Ersteller oder zugewiesene Person zu sein -- Koordinationsfunktion,
// gleiches Rollenmuster wie ROLLEN_MIT_ZIMMER_STAMMDATEN in
// zimmer.service.ts. Anlegen selbst bleibt bewusst fuer JEDE Rolle offen
// (Aufgaben sind Tagesgeschaeft wie Tagesberichte, keine Stammdatenpflege).
const ROLLEN_MIT_AUFGABEN_KOORDINATION = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

@Injectable()
export class AufgabeService {
  constructor(private readonly db: DatabaseService) {}

  async findeAlle(filter: AufgabeFilter): Promise<AufgabeEintrag[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant((client) => this.ladeListe(client, ctx, filter));
  }

  async zaehleOffene(): Promise<AufgabenAnzahl> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const bedingungen = ["a.erledigt_am IS NULL", "a.zimmer_id IS NOT NULL"];
      const params: unknown[] = [];
      if (erlaubteStandorte) {
        params.push(erlaubteStandorte);
        bedingungen.push(`z.standort_id = ANY($${params.length})`);
      }
      const { rows: jeZimmerRows } = await client.query<{ zimmer_id: string; anzahl: number }>(
        `SELECT a.zimmer_id, count(*)::int AS anzahl
         FROM aufgabe a JOIN zimmer z ON z.id = a.zimmer_id
         WHERE ${bedingungen.join(" AND ")}
         GROUP BY a.zimmer_id`,
        params
      );
      const jeZimmer: Record<string, number> = {};
      for (const r of jeZimmerRows) jeZimmer[r.zimmer_id] = r.anzahl;

      // "Eigene" richtet sich nach Zuweisung, nicht nach Standort -- eine
      // zugewiesene Aufgabe soll auch dann in der persoenlichen Badge
      // auftauchen, wenn sich die Standort-Zuordnung der Person spaeter
      // aendert. Umfasst Zimmer- UND persoenliche Aufgaben gleichermassen.
      const { rows: eigeneRows } = await client.query<{ anzahl: number }>(
        "SELECT count(*)::int AS anzahl FROM aufgabe WHERE erledigt_am IS NULL AND zugewiesen_an = $1",
        [ctx.benutzerId]
      );
      return { jeZimmer, eigene: eigeneRows[0].anzahl };
    });
  }

  async anlegen(input: {
    titel: string;
    beschreibung?: string;
    prioritaet?: AufgabePrioritaet;
    faelligAm?: string;
    zimmerId?: string;
    zugewiesenAn?: string;
  }): Promise<AufgabeEintrag> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (input.zimmerId) {
        await this.pruefeZimmerErlaubt(client, ctx, input.zimmerId);
      }
      if (input.zugewiesenAn) {
        await this.pruefeBenutzerErlaubt(client, input.zugewiesenAn);
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO aufgabe (mandant_id, titel, beschreibung, prioritaet, faellig_am, zimmer_id, zugewiesen_an, erstellt_von)
         VALUES ($1, $2, $3, COALESCE($4::aufgabe_prioritaet, 'normal'), $5, $6, $7, $8)
         RETURNING id`,
        [
          ctx.mandantId,
          input.titel,
          input.beschreibung ?? null,
          input.prioritaet ?? null,
          input.faelligAm ?? null,
          input.zimmerId ?? null,
          input.zugewiesenAn ?? null,
          ctx.benutzerId,
        ]
      );
      return this.findeEinzelne(client, ctx, rows[0].id);
    });
  }

  /**
   * Zuweisung ist die eine Ausnahme von "nur Ersteller/Zugewiesene:r/
   * Leitung darf schreiben": jede Person, die die Aufgabe ueberhaupt sehen
   * darf, kann sich SELBST zuweisen oder die eigene Zuweisung wieder
   * entfernen ("ich uebernehme das" / "ich schaffe es doch nicht") -- eine
   * offene Zimmer-Aufgabe ohne Zuweisung soll sich jede zustaendige Person
   * greifen koennen, ohne dass Ersteller oder Leitung erst eingreifen
   * muessen. Jede andere Aenderung (fremd zuweisen, Titel, Beschreibung,
   * Faelligkeit, Prioritaet) bleibt auf die drei Rollen unten beschraenkt.
   */
  async aktualisieren(
    id: string,
    input: {
      titel?: string;
      beschreibung?: string | null;
      faelligAm?: string | null;
      prioritaet?: AufgabePrioritaet;
      zugewiesenAn?: string | null;
    }
  ): Promise<AufgabeEintrag> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const roh = await this.ladeRohMitStandortpruefung(client, ctx, id);

      const nurEigeneZuweisungGeaendert =
        Object.keys(input).length === 1 &&
        "zugewiesenAn" in input &&
        (input.zugewiesenAn === ctx.benutzerId || (input.zugewiesenAn === null && roh.zugewiesenAn === ctx.benutzerId));

      if (!this.darfSchreiben(ctx, roh) && !nurEigeneZuweisungGeaendert) {
        throw new ForbiddenException(
          "Nur Ersteller:in, zugewiesene Person oder Leitung dürfen diese Aufgabe bearbeiten."
        );
      }

      if (input.zugewiesenAn) {
        await this.pruefeBenutzerErlaubt(client, input.zugewiesenAn);
      }

      const felder: string[] = [];
      const werte: unknown[] = [];
      const setze = (spalte: string, wert: unknown) => {
        werte.push(wert);
        felder.push(`${spalte} = $${werte.length}`);
      };
      if (input.titel !== undefined) setze("titel", input.titel);
      if ("beschreibung" in input) setze("beschreibung", input.beschreibung);
      if ("faelligAm" in input) setze("faellig_am", input.faelligAm);
      if (input.prioritaet !== undefined) setze("prioritaet", input.prioritaet);
      if ("zugewiesenAn" in input) setze("zugewiesen_an", input.zugewiesenAn);

      if (felder.length > 0) {
        werte.push(id);
        await client.query(`UPDATE aufgabe SET ${felder.join(", ")} WHERE id = $${werte.length}`, werte);
      }
      return this.findeEinzelne(client, ctx, id);
    });
  }

  /**
   * erledigt_am/erledigt_von werden ausschliesslich hier gesetzt, nie aus
   * einem Request-Body (der Controller liest fuer diesen Endpunkt bewusst
   * gar keinen Body). Das UPDATE traegt "WHERE erledigt_am IS NULL" selbst
   * und wertet die betroffene Zeilenzahl aus, statt sich auf eine vorherige
   * SELECT-Pruefung zu verlassen -- zwei gleichzeitige Aufrufe koennten
   * sonst beide den Nullwert lesen, bevor einer von ihnen schreibt (gleiches
   * Race-Condition-Prinzip wie beim Kapazitaets-Trigger in 0032, hier reicht
   * aber ein einzelnes atomares UPDATE ohne expliziten Zeilenlock).
   */
  async erledigen(id: string): Promise<AufgabeEintrag> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const roh = await this.ladeRohMitStandortpruefung(client, ctx, id);
      if (!this.darfSchreiben(ctx, roh)) {
        throw new ForbiddenException("Nur Ersteller:in, zugewiesene Person oder Leitung dürfen diese Aufgabe erledigen.");
      }
      const { rowCount } = await client.query(
        "UPDATE aufgabe SET erledigt_am = now(), erledigt_von = $1 WHERE id = $2 AND erledigt_am IS NULL",
        [ctx.benutzerId, id]
      );
      if (rowCount === 0) {
        throw new ConflictException("Diese Aufgabe wurde bereits erledigt.");
      }
      return this.findeEinzelne(client, ctx, id);
    });
  }

  async loeschen(id: string): Promise<void> {
    const ctx = requireTenantContext();
    await this.db.withTenant(async (client) => {
      const roh = await this.ladeRohMitStandortpruefung(client, ctx, id);
      if (!this.darfSchreiben(ctx, roh)) {
        throw new ForbiddenException("Nur Ersteller:in, zugewiesene Person oder Leitung dürfen diese Aufgabe löschen.");
      }
      await client.query("DELETE FROM aufgabe WHERE id = $1", [id]);
    });
  }

  private darfSchreiben(ctx: TenantContext, roh: AufgabeRoh): boolean {
    return (
      ROLLEN_MIT_AUFGABEN_KOORDINATION.has(ctx.rolle) ||
      roh.erstelltVon === ctx.benutzerId ||
      roh.zugewiesenAn === ctx.benutzerId
    );
  }

  private async pruefeZimmerErlaubt(client: PoolClient, ctx: TenantContext, zimmerId: string): Promise<void> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
    const { rows } = await client.query<{ standort_id: string }>("SELECT standort_id FROM zimmer WHERE id = $1", [
      zimmerId,
    ]);
    if (rows.length === 0 || (erlaubteStandorte && !erlaubteStandorte.includes(rows[0].standort_id))) {
      throw new NotFoundException("Zimmer nicht gefunden.");
    }
  }

  /**
   * "SELECT 1 FROM benutzer" statt einer ungeprueften Weitergabe der ID an
   * das INSERT/UPDATE: RLS auf benutzer filtert automatisch auf den
   * eigenen Mandanten (0004_benutzer.sql), ein Treffer bedeutet also nicht
   * nur "existiert", sondern "gehoert zu diesem Mandanten" -- exakt das
   * Muster von standortIstErlaubt() in common/standort-restriction.ts.
   */
  private async pruefeBenutzerErlaubt(client: PoolClient, benutzerId: string): Promise<void> {
    const { rows } = await client.query("SELECT 1 FROM benutzer WHERE id = $1", [benutzerId]);
    if (rows.length === 0) throw new NotFoundException("Benutzer nicht gefunden.");
  }

  private async ladeRohMitStandortpruefung(client: PoolClient, ctx: TenantContext, id: string): Promise<AufgabeRoh> {
    const { rows } = await client.query<{
      erstellt_von: string;
      zugewiesen_an: string | null;
      zimmer_id: string | null;
      erledigt_am: string | null;
      standort_id: string | null;
    }>(
      `SELECT a.erstellt_von, a.zugewiesen_an, a.zimmer_id, a.erledigt_am, z.standort_id
       FROM aufgabe a LEFT JOIN zimmer z ON z.id = a.zimmer_id
       WHERE a.id = $1`,
      [id]
    );
    // RLS hat mandant-/personenfremde Zeilen schon herausgefiltert -- kein
    // Treffer heisst hier "existiert nicht oder nicht sichtbar", beides
    // faellt zu Recht auf denselben 404.
    if (rows.length === 0) throw new NotFoundException("Aufgabe nicht gefunden.");
    const r = rows[0];
    if (r.standort_id) {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      if (erlaubteStandorte && !erlaubteStandorte.includes(r.standort_id)) {
        throw new NotFoundException("Aufgabe nicht gefunden.");
      }
    }
    return { erstelltVon: r.erstellt_von, zugewiesenAn: r.zugewiesen_an, zimmerId: r.zimmer_id, erledigtAm: r.erledigt_am };
  }

  private async findeEinzelne(client: PoolClient, ctx: TenantContext, id: string): Promise<AufgabeEintrag> {
    const liste = await this.ladeListe(client, ctx, { id });
    if (liste.length === 0) throw new NotFoundException("Aufgabe nicht gefunden.");
    return liste[0];
  }

  /**
   * Gemeinsamer Kern von findeAlle() und den Rueckgabewerten der
   * schreibenden Methoden -- gleiches Muster wie ladeZimmerListe() in
   * zimmer.service.ts. RLS (0033_aufgabe.sql) erledigt Mandant (Ebene 1)
   * und Person (Ebene 3, nur fuer persoenliche Aufgaben) bereits auf
   * Datenbankebene; die Standort-Einschraenkung (Ebene 2) fuer
   * Zimmer-Aufgaben kommt hier dazu, weil sie einen Join ueber
   * benutzer_standort/zimmer braucht (siehe Kommentar in 0033_aufgabe.sql).
   */
  private async ladeListe(client: PoolClient, ctx: TenantContext, filter: AufgabeFilter): Promise<AufgabeEintrag[]> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);

    const bedingungen: string[] = [];
    const params: unknown[] = [];
    const param = (wert: unknown) => {
      params.push(wert);
      return `$${params.length}`;
    };

    if (erlaubteStandorte) {
      bedingungen.push(`(a.zimmer_id IS NULL OR z.standort_id = ANY(${param(erlaubteStandorte)}))`);
    }
    if (filter.id) bedingungen.push(`a.id = ${param(filter.id)}`);
    if (filter.zimmerId) bedingungen.push(`a.zimmer_id = ${param(filter.zimmerId)}`);
    if (filter.zugewiesenAn) bedingungen.push(`a.zugewiesen_an = ${param(filter.zugewiesenAn)}`);
    if (filter.nurEigene) {
      const p = param(ctx.benutzerId);
      bedingungen.push(`(a.erstellt_von = ${p} OR a.zugewiesen_an = ${p})`);
    }
    if (filter.offen === true) bedingungen.push("a.erledigt_am IS NULL");
    if (filter.offen === false) bedingungen.push("a.erledigt_am IS NOT NULL");
    if (filter.faelligBis) bedingungen.push(`a.faellig_am <= ${param(filter.faelligBis)}`);
    if (filter.prioritaet) bedingungen.push(`a.prioritaet = ${param(filter.prioritaet)}`);

    const where = bedingungen.length > 0 ? `WHERE ${bedingungen.join(" AND ")}` : "";
    // Faelligkeitslose Aufgaben landen bei beiden Sortierungen am Ende,
    // nicht am Anfang -- NULLS LAST ist bei ASC nicht der SQL-Standard.
    const orderBy =
      filter.sortierung === "prioritaet"
        ? "ORDER BY CASE a.prioritaet WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, a.faellig_am ASC NULLS LAST"
        : "ORDER BY a.faellig_am ASC NULLS LAST, CASE a.prioritaet WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END";

    const { rows } = await client.query(
      `
      SELECT
        a.id, a.titel, a.beschreibung, a.prioritaet, a.faellig_am,
        a.zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name,
        a.zugewiesen_an, zb.name AS zugewiesen_an_name,
        a.erstellt_von, eb.name AS erstellt_von_name,
        a.erledigt_am, ab.name AS erledigt_von_name,
        a.erstellt_am
      FROM aufgabe a
      LEFT JOIN zimmer z ON z.id = a.zimmer_id
      LEFT JOIN standort s ON s.id = z.standort_id
      LEFT JOIN benutzer zb ON zb.id = a.zugewiesen_an
      JOIN benutzer eb ON eb.id = a.erstellt_von
      LEFT JOIN benutzer ab ON ab.id = a.erledigt_von
      ${where}
      ${orderBy}
      `,
      params
    );
    return rows.map(zuEintrag);
  }
}

function zuEintrag(r: any): AufgabeEintrag {
  return {
    id: r.id,
    titel: r.titel,
    beschreibung: r.beschreibung,
    prioritaet: r.prioritaet,
    faelligAm: r.faellig_am,
    zimmerId: r.zimmer_id,
    zimmerNummer: r.zimmer_nummer,
    standortName: r.standort_name,
    zugewiesenAn: r.zugewiesen_an,
    zugewiesenAnName: r.zugewiesen_an_name,
    erstelltVon: r.erstellt_von,
    erstelltVonName: r.erstellt_von_name,
    erledigtAm: r.erledigt_am,
    erledigtVonName: r.erledigt_von_name,
    erstelltAm: r.erstellt_am,
  };
}
