import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, klientStandortBedingung } from "../common/standort-restriction";

// Ein anonymisierter Klient bleibt als Zeile (und damit als Ziel jeder
// Fremdschluessel-Kette aus Belegung/Kassenbuch/Rechnung) bestehen -- nur
// wer das darf, entscheidet ueber eine Aktion, die nicht rueckgaengig zu
// machen ist. Gleiches Rollenpaar wie bei Zimmer-/Standort-Stammdaten.
const ROLLEN_MIT_ANONYMISIERUNG = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

const ANONYM_PLATZHALTER = "Anonymisiert";

export interface KlientListEintrag {
  id: string;
  vorname: string;
  nachname: string;
  aktenzeichen: string;
  amt: string;
  hzlRhythmus: "monatlich" | "woechentlich";
  aktuellesZimmer: { id: string; nummer: string; standortName: string; belegungId: string } | null;
  anonymisiertAm: string | null;
}

export interface KlientDetail extends KlientListEintrag {
  geburtsdatum: string | null;
}

@Injectable()
export class KlientService {
  constructor(private readonly db: DatabaseService) {}

  async findeAlle(): Promise<KlientListEintrag[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const params: unknown[] = [];
      const bedingung = klientStandortBedingung(erlaubteStandorte, "k", params);

      const { rows } = await client.query(
        `
        SELECT
          k.id, k.vorname, k.nachname, k.aktenzeichen, k.amt, k.hzl_rhythmus, k.anonymisiert_am,
          z.id AS zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name, b.id AS belegung_id
        FROM klient k
        LEFT JOIN belegung b ON b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
        LEFT JOIN zimmer z ON z.id = b.zimmer_id
        LEFT JOIN standort s ON s.id = z.standort_id
        WHERE ${bedingung}
        ORDER BY k.nachname, k.vorname
        `,
        params
      );
      return rows.map(zuListEintrag);
    });
  }

  async anlegen(input: {
    vorname: string;
    nachname: string;
    geburtsdatum: string;
    aktenzeichen: string;
    amt: string;
    hzlRhythmus: "monatlich" | "woechentlich";
  }) {
    const { mandantId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus`,
        [mandantId, input.vorname, input.nachname, input.geburtsdatum, input.aktenzeichen, input.amt, input.hzlRhythmus]
      );
      return { ...rows[0], hzlRhythmus: rows[0].hzl_rhythmus, aktuellesZimmer: null, anonymisiertAm: null };
    });
  }

  async findeEinen(id: string): Promise<KlientDetail> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const detail = await this.holeDetail(client, ctx.benutzerId, id);
      if (!detail) throw new NotFoundException("Klient nicht gefunden.");
      return detail;
    });
  }

  /**
   * Recht auf Loeschung (Art. 17 DSGVO) -- kein Hard-Delete, siehe Kommentar
   * in migrations/0027_klient_anonymisierung.sql: Kassenbuchungen und
   * Rechnungen haengen per klient_id an dieser Zeile und muessen als Belege
   * gegenueber dem Amt erhalten bleiben. Ueberschrieben werden nur die
   * identifizierenden Felder (Name, Geburtsdatum); Aktenzeichen und Amt
   * bleiben, weil Kassenbuch/Rechnungen weiterhin darauf verweisen und beide
   * fuer sich genommen keine Person identifizieren.
   */
  async anonymisieren(id: string): Promise<KlientDetail> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_ANONYMISIERUNG.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen einen Klienten anonymisieren.");
    }
    return this.db.withTenant(async (client) => {
      const { rows: aktualisiert } = await client.query(
        `UPDATE klient
         SET vorname = $2, nachname = $3, geburtsdatum = NULL,
             anonymisiert_am = now(), anonymisiert_von = $4
         WHERE id = $1 AND anonymisiert_am IS NULL
         RETURNING id`,
        [id, ANONYM_PLATZHALTER, ANONYM_PLATZHALTER, ctx.benutzerId]
      );
      if (aktualisiert.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM klient WHERE id = $1", [id]);
        if (vorhanden.length === 0) throw new NotFoundException("Klient nicht gefunden.");
        throw new ConflictException("Klient ist bereits anonymisiert.");
      }

      const detail = await this.holeDetail(client, ctx.benutzerId, id);
      if (!detail) throw new NotFoundException("Klient nicht gefunden.");
      return detail;
    });
  }

  private async holeDetail(client: import("pg").PoolClient, benutzerId: string, id: string): Promise<KlientDetail | null> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
    const params: unknown[] = [id];
    const bedingung = klientStandortBedingung(erlaubteStandorte, "k", params);

    const { rows } = await client.query(
      `
      SELECT
        k.id, k.vorname, k.nachname, k.geburtsdatum, k.aktenzeichen, k.amt, k.hzl_rhythmus, k.anonymisiert_am,
        z.id AS zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name, b.id AS belegung_id
      FROM klient k
      LEFT JOIN belegung b ON b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
      LEFT JOIN zimmer z ON z.id = b.zimmer_id
      LEFT JOIN standort s ON s.id = z.standort_id
      WHERE k.id = $1 AND ${bedingung}
      `,
      params
    );
    if (rows.length === 0) return null;
    return { ...zuListEintrag(rows[0]), geburtsdatum: rows[0].geburtsdatum };
  }
}

function zuListEintrag(r: any): KlientListEintrag {
  return {
    id: r.id,
    vorname: r.vorname,
    nachname: r.nachname,
    aktenzeichen: r.aktenzeichen,
    amt: r.amt,
    hzlRhythmus: r.hzl_rhythmus,
    aktuellesZimmer: r.zimmer_id
      ? { id: r.zimmer_id, nummer: r.zimmer_nummer, standortName: r.standort_name, belegungId: r.belegung_id }
      : null,
    anonymisiertAm: r.anonymisiert_am,
  };
}
