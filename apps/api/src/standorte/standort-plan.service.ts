import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { standortIstErlaubt } from "../common/standort-restriction";
import { RechteService } from "../rechte/rechte.service";
import { verkleinereBild } from "../common/bild";

export interface PlanPosition {
  x: number;
  y: number;
}

export interface RaumplanZimmer {
  id: string;
  nummer: string;
  kapazitaet: number;
  bewohner: { klientId: string; name: string; einzug: string; auszug: string | null }[];
  // Noch nicht begonnene Belegungen (vorausschauende Planung).
  geplanteEinzuege: { klientId: string; name: string; einzug: string }[];
  warteliste: { name: string; eingetragenAm: string }[];
  offeneAufgaben: { id: string; titel: string; prioritaet: "niedrig" | "normal" | "hoch"; faelligAm: string | null }[];
  kapazitaetsantrag: { alteKapazitaet: number; neueKapazitaet: number; beantragtVonName: string | null } | null;
  position: PlanPosition | null;
}

export interface RaumplanRaum {
  id: string;
  name: string;
  position: PlanPosition | null;
}

export interface RaumplanEtage {
  etage: string;
  hatGrundriss: boolean;
  zimmer: RaumplanZimmer[];
  raeume: RaumplanRaum[];
}

export interface RaumplanDto {
  standort: { id: string; name: string };
  darfBearbeiten: boolean;
  etagen: RaumplanEtage[];
}

export type PlanObjektArt = "zimmer" | "raum";

/**
 * Sortierschluessel fuer frei benannte Etagen ("Keller", "EG", "1. OG",
 * "Dachgeschoss"): von unten nach oben, soweit erkennbar. Unbekannte Namen
 * landen alphabetisch hinter den bekannten Stockwerken statt an einer
 * geratenen Stelle.
 */
export function etageSortSchluessel(etage: string): number {
  const e = etage.trim().toLowerCase();
  if (/^(keller|ug|untergeschoss|souterrain)/.test(e)) return -1;
  if (/^(eg|erdgeschoss|parterre)/.test(e)) return 0;
  if (/^(dg|dachgeschoss|dach)/.test(e)) return 1000;
  const zahl = e.match(/^(\d+)/);
  if (zahl) return /ug/.test(e) ? -Number(zahl[1]) : Number(zahl[1]);
  return 500;
}

export function vergleicheEtagen(a: string, b: string): number {
  return etageSortSchluessel(a) - etageSortSchluessel(b) || a.localeCompare(b, "de");
}

@Injectable()
export class StandortPlanService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  /**
   * Sichtbar ist der Raumplan fuer jeden, der den Standort sehen darf (wie
   * Zimmer und Klienten) -- standortIstErlaubt() deckt "existiert nicht",
   * "anderer Mandant (RLS)" und "nicht zugeordnet" mit einem 404 ab.
   * Aendern darf nur, wer standorte.bearbeiten hat (siehe pruefeBearbeiten).
   */
  async raumplan(standortId: string): Promise<RaumplanDto> {
    const { benutzerId } = requireTenantContext();
    const darfBearbeiten = await this.rechte.hatRecht("standorte", "bearbeiten");
    return this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, benutzerId, standortId);
      const { rows: standortRows } = await client.query("SELECT id, name FROM standort WHERE id = $1", [standortId]);

      const { rows: zimmerRows } = await client.query(
        "SELECT id, nummer, etage, kapazitaet FROM zimmer WHERE standort_id = $1 AND aktiv ORDER BY nummer",
        [standortId]
      );
      const { rows: raumRows } = await client.query(
        "SELECT id, name, etage FROM standort_raum WHERE standort_id = $1 AND aktiv ORDER BY name",
        [standortId]
      );
      const { rows: bewohnerRows } = await client.query(
        `SELECT b.zimmer_id, b.einzug, b.auszug, k.id AS klient_id, k.vorname, k.nachname
         FROM belegung b
         JOIN zimmer z ON z.id = b.zimmer_id
         JOIN klient k ON k.id = b.klient_id
         WHERE z.standort_id = $1 AND b.einzug <= CURRENT_DATE AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
         ORDER BY b.einzug`,
        [standortId]
      );
      const { rows: geplantRows } = await client.query(
        `SELECT b.zimmer_id, b.einzug, k.id AS klient_id, k.vorname, k.nachname
         FROM belegung b
         JOIN zimmer z ON z.id = b.zimmer_id
         JOIN klient k ON k.id = b.klient_id
         WHERE z.standort_id = $1 AND b.einzug > CURRENT_DATE
         ORDER BY b.einzug`,
        [standortId]
      );
      const { rows: wartelisteRows } = await client.query(
        `SELECT w.zimmer_id, w.eingetragen_am, k.vorname, k.nachname
         FROM zimmer_warteliste w
         JOIN zimmer z ON z.id = w.zimmer_id
         JOIN klient k ON k.id = w.klient_id
         WHERE z.standort_id = $1
         ORDER BY w.eingetragen_am`,
        [standortId]
      );
      // Zimmer-Aufgaben sind standortgebunden sichtbar (siehe Dashboard);
      // persoenliche Aufgaben ohne Zimmer tauchen hier nie auf.
      const { rows: aufgabeRows } = await client.query(
        `SELECT a.id, a.zimmer_id, a.titel, a.prioritaet, a.faellig_am
         FROM aufgabe a
         JOIN zimmer z ON z.id = a.zimmer_id
         WHERE z.standort_id = $1 AND a.erledigt_am IS NULL
         ORDER BY a.faellig_am ASC NULLS LAST, a.titel`,
        [standortId]
      );
      const { rows: antragRows } = await client.query(
        `SELECT ka.zimmer_id, ka.alte_kapazitaet, ka.neue_kapazitaet, u.name AS beantragt_von_name
         FROM zimmer_kapazitaetsantrag ka
         JOIN zimmer z ON z.id = ka.zimmer_id
         LEFT JOIN benutzer u ON u.id = ka.beantragt_von
         WHERE z.standort_id = $1 AND ka.status = 'beantragt'`,
        [standortId]
      );
      const { rows: positionRows } = await client.query(
        "SELECT etage, zimmer_id, raum_id, x_prozent, y_prozent FROM standort_plan_position WHERE standort_id = $1",
        [standortId]
      );
      const { rows: grundrissRows } = await client.query(
        "SELECT etage FROM standort_grundriss WHERE standort_id = $1",
        [standortId]
      );

      // Eine gespeicherte Position gilt nur, solange das Objekt noch auf der
      // Etage steht, fuer die sie gesetzt wurde (siehe Migration 0051).
      const positionJeZimmer = new Map<string, { etage: string; position: PlanPosition }>();
      const positionJeRaum = new Map<string, { etage: string; position: PlanPosition }>();
      for (const p of positionRows) {
        const eintrag = { etage: p.etage as string, position: { x: Number(p.x_prozent), y: Number(p.y_prozent) } };
        if (p.zimmer_id) positionJeZimmer.set(p.zimmer_id, eintrag);
        if (p.raum_id) positionJeRaum.set(p.raum_id, eintrag);
      }
      const gruppiere = <T,>(rows: { zimmer_id: string }[], abbilden: (r: any) => T) => {
        const map = new Map<string, T[]>();
        for (const r of rows) {
          const liste = map.get(r.zimmer_id) ?? [];
          liste.push(abbilden(r));
          map.set(r.zimmer_id, liste);
        }
        return map;
      };
      const bewohnerJeZimmer = gruppiere(bewohnerRows, (r) => ({
        klientId: r.klient_id as string,
        name: `${r.vorname} ${r.nachname}`,
        einzug: r.einzug as string,
        auszug: (r.auszug as string | null) ?? null,
      }));
      const geplantJeZimmer = gruppiere(geplantRows, (r) => ({
        klientId: r.klient_id as string,
        name: `${r.vorname} ${r.nachname}`,
        einzug: r.einzug as string,
      }));
      const wartelisteJeZimmer = gruppiere(wartelisteRows, (r) => ({
        name: `${r.vorname} ${r.nachname}`,
        eingetragenAm: new Date(r.eingetragen_am).toISOString().slice(0, 10),
      }));
      const aufgabenJeZimmer = gruppiere(aufgabeRows, (r) => ({
        id: r.id as string,
        titel: r.titel as string,
        prioritaet: r.prioritaet as "niedrig" | "normal" | "hoch",
        faelligAm: (r.faellig_am as string | null) ?? null,
      }));
      const antragJeZimmer = new Map(
        antragRows.map((r) => [
          r.zimmer_id as string,
          {
            alteKapazitaet: Number(r.alte_kapazitaet),
            neueKapazitaet: Number(r.neue_kapazitaet),
            beantragtVonName: (r.beantragt_von_name as string | null) ?? null,
          },
        ])
      );

      const etagen = new Map<string, RaumplanEtage>();
      const etageHolen = (name: string) => {
        let e = etagen.get(name);
        if (!e) {
          e = { etage: name, hatGrundriss: false, zimmer: [], raeume: [] };
          etagen.set(name, e);
        }
        return e;
      };
      for (const z of zimmerRows) {
        const pos = positionJeZimmer.get(z.id);
        etageHolen(z.etage).zimmer.push({
          id: z.id,
          nummer: z.nummer,
          kapazitaet: Number(z.kapazitaet),
          bewohner: bewohnerJeZimmer.get(z.id) ?? [],
          geplanteEinzuege: geplantJeZimmer.get(z.id) ?? [],
          warteliste: wartelisteJeZimmer.get(z.id) ?? [],
          offeneAufgaben: aufgabenJeZimmer.get(z.id) ?? [],
          kapazitaetsantrag: antragJeZimmer.get(z.id) ?? null,
          position: pos && pos.etage === z.etage ? pos.position : null,
        });
      }
      for (const r of raumRows) {
        const pos = positionJeRaum.get(r.id);
        etageHolen(r.etage).raeume.push({
          id: r.id,
          name: r.name,
          position: pos && pos.etage === r.etage ? pos.position : null,
        });
      }
      for (const g of grundrissRows) etageHolen(g.etage).hatGrundriss = true;

      return {
        standort: standortRows[0],
        darfBearbeiten,
        etagen: [...etagen.values()].sort((a, b) => vergleicheEtagen(a.etage, b.etage)),
      };
    });
  }

  async raumAnlegen(standortId: string, input: { name: string; etage: string }): Promise<{ id: string; name: string; etage: string }> {
    const ctx = requireTenantContext();
    await this.pruefeBearbeiten();
    return this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, ctx.benutzerId, standortId);
      const { rows } = await client.query(
        "INSERT INTO standort_raum (mandant_id, standort_id, name, etage) VALUES ($1, $2, $3, $4) RETURNING id, name, etage",
        [ctx.mandantId, standortId, input.name, input.etage]
      );
      return rows[0];
    });
  }

  async raumAktualisieren(
    standortId: string,
    raumId: string,
    input: { name?: string; etage?: string; aktiv?: boolean }
  ): Promise<{ id: string; name: string; etage: string; aktiv: boolean }> {
    const ctx = requireTenantContext();
    await this.pruefeBearbeiten();
    return this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, ctx.benutzerId, standortId);
      const { rows } = await client.query(
        `UPDATE standort_raum
         SET name = COALESCE($1, name), etage = COALESCE($2, etage), aktiv = COALESCE($3, aktiv)
         WHERE id = $4 AND standort_id = $5
         RETURNING id, name, etage, aktiv`,
        [input.name ?? null, input.etage ?? null, input.aktiv ?? null, raumId, standortId]
      );
      if (rows.length === 0) throw new NotFoundException("Raum nicht gefunden.");
      return rows[0];
    });
  }

  /**
   * Speichert den ganzen Plan EINER Etage neu (loeschen + einfuegen in einer
   * Transaktion): der Client schickt immer den kompletten Stand, nie einzelne
   * Verschiebungen -- so kann keine Zeile uebrig bleiben, die der Nutzer
   * entfernt hat. Jede referenzierte Karte muss zu diesem Standort UND dieser
   * Etage gehoeren, sonst 400: der Plan darf keine fremden Objekte anheften.
   */
  async positionenSetzen(
    standortId: string,
    etage: string,
    positionen: { art: PlanObjektArt; id: string; x: number; y: number }[]
  ): Promise<void> {
    const ctx = requireTenantContext();
    await this.pruefeBearbeiten();
    const schluessel = positionen.map((p) => `${p.art}:${p.id}`);
    if (new Set(schluessel).size !== schluessel.length) {
      throw new BadRequestException("Eine Karte darf nur einmal auf dem Plan stehen.");
    }
    await this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, ctx.benutzerId, standortId);
      const zimmerIds = positionen.filter((p) => p.art === "zimmer").map((p) => p.id);
      const raumIds = positionen.filter((p) => p.art === "raum").map((p) => p.id);

      const { rows: zimmerOk } = await client.query(
        "SELECT id FROM zimmer WHERE id = ANY($1) AND standort_id = $2 AND etage = $3 AND aktiv",
        [zimmerIds, standortId, etage]
      );
      const { rows: raumOk } = await client.query(
        "SELECT id FROM standort_raum WHERE id = ANY($1) AND standort_id = $2 AND etage = $3 AND aktiv",
        [raumIds, standortId, etage]
      );
      if (zimmerOk.length !== zimmerIds.length || raumOk.length !== raumIds.length) {
        throw new BadRequestException("Mindestens eine Karte gehört nicht zu diesem Standort und dieser Etage.");
      }

      // Auch veraltete Positionen derselben Objekte von einer frueheren Etage
      // entfernen -- sonst stoesst der Unique-Index (ein Objekt, eine Position).
      await client.query(
        `DELETE FROM standort_plan_position
         WHERE (standort_id = $1 AND etage = $2) OR zimmer_id = ANY($3) OR raum_id = ANY($4)`,
        [standortId, etage, zimmerIds, raumIds]
      );
      for (const p of positionen) {
        await client.query(
          `INSERT INTO standort_plan_position (mandant_id, standort_id, etage, zimmer_id, raum_id, x_prozent, y_prozent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ctx.mandantId, standortId, etage, p.art === "zimmer" ? p.id : null, p.art === "raum" ? p.id : null, p.x, p.y]
        );
      }
    });
  }

  async grundrissSetzen(
    standortId: string,
    etage: string,
    bild: { inhalt: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp"; dateiname: string }
  ): Promise<{ verkleinert: boolean }> {
    const ctx = requireTenantContext();
    await this.pruefeBearbeiten();
    // Vor der Transaktion: das Verkleinern kann Sekunden dauern, in der Zeit
    // soll keine Datenbankverbindung gehalten werden. Der Hash gehoert zu den
    // tatsaechlich gespeicherten Bytes, nicht zum Original.
    const { inhalt, verkleinert } = await verkleinereBild(bild.inhalt, bild.mimeType);
    const hash = createHash("sha256").update(inhalt).digest("hex");
    await this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, ctx.benutzerId, standortId);
      await client.query("DELETE FROM standort_grundriss WHERE standort_id = $1 AND etage = $2", [standortId, etage]);
      await client.query(
        `INSERT INTO standort_grundriss
           (mandant_id, standort_id, etage, dateiname, mime_type, inhalt, inhalt_hash, hochgeladen_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.mandantId, standortId, etage, bild.dateiname, bild.mimeType, inhalt, hash, ctx.benutzerId]
      );
    });
    return { verkleinert };
  }

  async grundrissBild(
    standortId: string,
    etage: string
  ): Promise<{ inhalt: Buffer; mimeType: string; dateiname: string; hash: string } | null> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, benutzerId, standortId);
      const { rows } = await client.query(
        "SELECT inhalt, mime_type, dateiname, inhalt_hash FROM standort_grundriss WHERE standort_id = $1 AND etage = $2",
        [standortId, etage]
      );
      if (rows.length === 0) return null;
      return { inhalt: rows[0].inhalt, mimeType: rows[0].mime_type, dateiname: rows[0].dateiname, hash: rows[0].inhalt_hash };
    });
  }

  async grundrissLoeschen(standortId: string, etage: string): Promise<void> {
    const { benutzerId } = requireTenantContext();
    await this.pruefeBearbeiten();
    await this.db.withTenant(async (client) => {
      await this.pruefeSichtbar(client, benutzerId, standortId);
      const { rowCount } = await client.query("DELETE FROM standort_grundriss WHERE standort_id = $1 AND etage = $2", [
        standortId,
        etage,
      ]);
      if (rowCount === 0) throw new NotFoundException("Für diese Etage ist kein Grundriss hinterlegt.");
    });
  }

  private async pruefeSichtbar(client: PoolClient, benutzerId: string, standortId: string): Promise<void> {
    if (!(await standortIstErlaubt(client, benutzerId, standortId))) {
      throw new NotFoundException("Standort nicht gefunden.");
    }
  }

  private async pruefeBearbeiten(): Promise<void> {
    if (!(await this.rechte.hatRecht("standorte", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen den Raumplan bearbeiten.");
    }
  }
}

