import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { dateiAusBase64 } from "../common/datei";
import {
  ermittleErlaubteStandortIds,
  klientIstErlaubt,
  klientStandortBedingung,
  standortIdBedingung,
  standortIstErlaubt,
} from "../common/standort-restriction";
import { isPgError } from "../common/pg-error";

// SQLSTATE-Codes, kein geratener String -- siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

// Ein Storno macht eine Auszahlung/Einzahlung rueckwirkend ungueltig -- wer
// darueber selbst entscheiden (nicht nur beantragen) darf, entscheidet ueber
// die Kassenbuchfuehrung, nicht ueber einzelne Klientendaten. Ein Betreuer
// darf einen Storno-ANTRAG stellen (stornoBeantragen(), jede Rolle darf
// das), aber nicht selbst bewilligen -- das entscheidet stornoEntscheiden().
const ROLLEN_MIT_STORNO_ENTSCHEIDEN = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

export type KassenbuchungTyp = "hzl" | "einzahlung" | "sonstiges";

export interface OffenerStornoantragDto {
  id: string;
  grund: string;
  beantragtVonName: string;
  beantragtAm: string;
}

export interface KassenbuchungTeilnehmerDto {
  klientId: string | null;
  benutzerId: string | null;
  name: string;
}

export interface KassenbuchungDto {
  id: string;
  klientId: string | null;
  klientName: string | null;
  standortId: string | null;
  standortName: string | null;
  datum: string;
  betragCent: number;
  verwendungszweck: string;
  typ: KassenbuchungTyp;
  isoJahr: number | null;
  isoWoche: number | null;
  storniert: boolean;
  stornoGrund: string | null;
  hatUnterschrift: boolean;
  gebuchtVonName: string | null;
  teilnehmer: KassenbuchungTeilnehmerDto[];
  // Genau der eine noch unentschiedene Antrag, falls vorhanden -- eine
  // Buchung kann laut kassenbuchung_stornoantrag_offen_je_buchung nie mehr
  // als einen gleichzeitig haben.
  offenerStornoantrag: OffenerStornoantragDto | null;
}

export interface WochenuebersichtEintrag {
  klientId: string;
  klientName: string;
  bezahlt: boolean;
  buchungId: string | null;
  betragCent: number | null;
  datum: string | null;
}

// Wiederkehrender Teil der SELECT-Liste/JOINs fuer eine Buchung -- klient_id
// UND standort_id sind seit Migration 0030 beide nullable (siehe
// kassenbuchung_klient_xor_standort), daher LEFT statt INNER JOIN.
const BUCHUNG_SELECT = `
  SELECT b.id, b.klient_id, k.vorname, k.nachname, b.standort_id, s.name AS standort_name,
         b.datum, b.betrag_cent, b.verwendungszweck, b.typ, b.iso_jahr, b.iso_woche,
         b.storniert, b.storno_grund,
         (u.id IS NOT NULL) AS hat_unterschrift, mb.name AS gebucht_von_name,
         sa.id AS storno_antrag_id, sa.grund AS storno_antrag_grund,
         sab.name AS storno_beantragt_von_name, sa.beantragt_am AS storno_beantragt_am
  FROM kassenbuchung b
  LEFT JOIN klient k ON k.id = b.klient_id
  LEFT JOIN standort s ON s.id = b.standort_id
  LEFT JOIN unterschrift u ON u.kassenbuchung_id = b.id
  LEFT JOIN benutzer mb ON mb.id = b.gebucht_von
  LEFT JOIN kassenbuchung_stornoantrag sa ON sa.kassenbuchung_id = b.id AND sa.status = 'beantragt'
  LEFT JOIN benutzer sab ON sab.id = sa.beantragt_von
`;

@Injectable()
export class KassenbuchungService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Die Unterschriftspflicht fuer Auszahlungen ist eine
   * Mehrzeilen-Transaktions-Invariante (Buchung + Unterschrift zusammen
   * oder gar nicht) -- das laesst sich nicht als Constraint auf einer
   * einzelnen Tabelle ausdruecken, deshalb hier im Service, nicht in der
   * Datenbank. Alles, was sich als Ein-Tabellen-Constraint ausdruecken
   * liess (Ueberlappung, Eindeutigkeit, Aenderungsschutz), sitzt bewusst
   * in der Migration, nicht hier.
   *
   * Genau EINS von klientId/standortId muss gesetzt sein -- eine
   * Standort-Buchung (Spassgeld/Freizeitveranstaltung) gehoert dem ganzen
   * Haus, nicht einem einzelnen Klienten (siehe Migration 0030). Die
   * optionalen Teilnehmer (Klienten UND Mitarbeitende) sind rein
   * dokumentarisch -- wer teilgenommen hat, aendert nichts am Betrag.
   */
  async anlegen(input: {
    klientId?: string;
    standortId?: string;
    datum: string;
    betragCent: number;
    verwendungszweck: string;
    typ: KassenbuchungTyp;
    isoJahr?: number;
    isoWoche?: number;
    unterschriftBase64?: string;
    teilnehmerKlientIds?: string[];
    teilnehmerBenutzerIds?: string[];
  }): Promise<KassenbuchungDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    const istAuszahlung = input.betragCent < 0;

    if (istAuszahlung && !input.unterschriftBase64) {
      throw new BadRequestException("Auszahlungen müssen mit einer Unterschrift bestätigt werden.");
    }
    if (Boolean(input.klientId) === Boolean(input.standortId)) {
      throw new BadRequestException("Entweder klientId oder standortId angeben, nicht beides und nicht keins.");
    }
    if (input.typ === "hzl" && !input.klientId) {
      throw new BadRequestException("HZL ist ausschließlich für einen einzelnen Klienten möglich.");
    }

    const teilnehmerKlientIds = [...new Set(input.teilnehmerKlientIds ?? [])];
    const teilnehmerBenutzerIds = [...new Set(input.teilnehmerBenutzerIds ?? [])];

    try {
      return await this.db.withTenant(async (client) => {
        if (input.klientId) {
          if (!(await klientIstErlaubt(client, benutzerId, input.klientId))) {
            throw new NotFoundException("Klient nicht gefunden.");
          }
        } else {
          if (!(await standortIstErlaubt(client, benutzerId, input.standortId!))) {
            throw new NotFoundException("Standort nicht gefunden.");
          }
        }

        if (teilnehmerKlientIds.length > 0) {
          const { rows } = await client.query("SELECT id FROM klient WHERE id = ANY($1)", [teilnehmerKlientIds]);
          if (rows.length !== teilnehmerKlientIds.length) {
            throw new NotFoundException("Mindestens ein ausgewählter Teilnehmer (Klient) wurde nicht gefunden.");
          }
        }
        if (teilnehmerBenutzerIds.length > 0) {
          const { rows } = await client.query("SELECT id FROM benutzer WHERE id = ANY($1)", [teilnehmerBenutzerIds]);
          if (rows.length !== teilnehmerBenutzerIds.length) {
            throw new NotFoundException("Mindestens ein ausgewählter Teilnehmer (Mitarbeiter) wurde nicht gefunden.");
          }
        }

        const { rows } = await client.query(
          `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, typ, iso_jahr, iso_woche, gebucht_von)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            mandantId,
            input.klientId ?? null,
            input.standortId ?? null,
            input.datum,
            input.betragCent,
            input.verwendungszweck,
            input.typ,
            input.isoJahr ?? null,
            input.isoWoche ?? null,
            benutzerId,
          ]
        );
        const buchungId = rows[0].id;

        for (const teilnehmerKlientId of teilnehmerKlientIds) {
          await client.query(
            "INSERT INTO kassenbuchung_teilnehmer (mandant_id, kassenbuchung_id, klient_id) VALUES ($1, $2, $3)",
            [mandantId, buchungId, teilnehmerKlientId]
          );
        }
        for (const teilnehmerBenutzerId of teilnehmerBenutzerIds) {
          await client.query(
            "INSERT INTO kassenbuchung_teilnehmer (mandant_id, kassenbuchung_id, benutzer_id) VALUES ($1, $2, $3)",
            [mandantId, buchungId, teilnehmerBenutzerId]
          );
        }

        if (input.unterschriftBase64) {
          const bild = dateiAusBase64(input.unterschriftBase64);
          const bildHash = createHash("sha256").update(bild).digest("hex");
          await client.query(
            "INSERT INTO unterschrift (mandant_id, kassenbuchung_id, bild, bild_hash) VALUES ($1, $2, $3, $4)",
            [mandantId, buchungId, bild, bildHash]
          );
        }

        return this.findeEineIntern(client, buchungId);
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Für diese Kalenderwoche wurde für diesen Klienten bereits eine HZL-Zahlung erfasst.");
      }
      throw err;
    }
  }

  /**
   * Stellt einen Storno-Antrag. Jede Rolle darf das (auch ein Betreuer, der
   * die Buchung nicht mehr selbst rueckgaengig machen kann) -- ob er sofort
   * wirksam wird, entscheidet allein die Rolle der antragstellenden Person:
   * Bereichs-/Einrichtungsleitung bewilligen sich damit im selben Zug
   * selbst (kein Sinn, auf die eigene Bewilligung zu warten), ein Betreuer
   * stellt nur den Antrag und muss auf stornoEntscheiden() warten.
   */
  async stornoBeantragen(kassenbuchungId: string, grund: string): Promise<KassenbuchungDto> {
    const ctx = requireTenantContext();
    const { benutzerId } = ctx;
    return this.db.withTenant(async (client) => {
      const { rows: buchungRows } = await client.query(
        "SELECT klient_id, standort_id, storniert FROM kassenbuchung WHERE id = $1",
        [kassenbuchungId]
      );
      if (buchungRows.length === 0) {
        throw new NotFoundException("Buchung nicht gefunden.");
      }
      const { klient_id, standort_id, storniert } = buchungRows[0];
      if (storniert) {
        throw new ConflictException("Diese Buchung ist bereits storniert.");
      }
      const erlaubt = klient_id
        ? await klientIstErlaubt(client, benutzerId, klient_id)
        : await standortIstErlaubt(client, benutzerId, standort_id);
      if (!erlaubt) {
        throw new NotFoundException("Buchung nicht gefunden.");
      }

      let antragQuery;
      try {
        antragQuery = await client.query<{ id: string }>(
          `INSERT INTO kassenbuchung_stornoantrag (mandant_id, kassenbuchung_id, grund, beantragt_von)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [ctx.mandantId, kassenbuchungId, grund, benutzerId]
        );
      } catch (err) {
        if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
          throw new ConflictException("Für diese Buchung liegt bereits ein offener Storno-Antrag vor.");
        }
        throw err;
      }

      if (ROLLEN_MIT_STORNO_ENTSCHEIDEN.has(ctx.rolle)) {
        await this.bewilligeAntrag(client, antragQuery.rows[0].id, kassenbuchungId, grund, benutzerId);
      }
      return this.findeEineIntern(client, kassenbuchungId);
    });
  }

  /**
   * Bewilligt oder lehnt einen fremden (typischerweise: von einem Betreuer
   * gestellten) Storno-Antrag ab. Die Standort-Sichtbarkeitspruefung ist
   * dieselbe wie beim frueheren Direkt-Storno: eine Einrichtungsleitung
   * darf nur ueber Antraege ihres eigenen Standorts entscheiden, die
   * Bereichsleitung standortuebergreifend (weil ermittleErlaubteStandortIds
   * fuer sie null liefert, siehe common/standort-restriction.ts).
   */
  async stornoEntscheiden(antragId: string, entscheidung: "genehmigt" | "abgelehnt", ablehnungGrund?: string): Promise<KassenbuchungDto> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_STORNO_ENTSCHEIDEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen über Storno-Anträge entscheiden.");
    }
    if (entscheidung === "abgelehnt" && !ablehnungGrund) {
      throw new BadRequestException("Für eine Ablehnung ist ein Grund erforderlich.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT sa.grund, b.id AS kassenbuchung_id, b.klient_id, b.standort_id
         FROM kassenbuchung_stornoantrag sa
         JOIN kassenbuchung b ON b.id = sa.kassenbuchung_id
         WHERE sa.id = $1 AND sa.status = 'beantragt'`,
        [antragId]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Storno-Antrag nicht gefunden oder bereits entschieden.");
      }
      const { grund, kassenbuchung_id, klient_id, standort_id } = rows[0];
      const erlaubt = klient_id
        ? await klientIstErlaubt(client, ctx.benutzerId, klient_id)
        : await standortIstErlaubt(client, ctx.benutzerId, standort_id);
      if (!erlaubt) {
        throw new NotFoundException("Storno-Antrag nicht gefunden oder bereits entschieden.");
      }

      if (entscheidung === "genehmigt") {
        await this.bewilligeAntrag(client, antragId, kassenbuchung_id, grund, ctx.benutzerId);
      } else {
        const { rowCount } = await client.query(
          `UPDATE kassenbuchung_stornoantrag
           SET status = 'abgelehnt', ablehnung_grund = $1, entschieden_von = $2, entschieden_am = now()
           WHERE id = $3 AND status = 'beantragt'`,
          [ablehnungGrund, ctx.benutzerId, antragId]
        );
        if (rowCount === 0) {
          throw new NotFoundException("Storno-Antrag nicht gefunden oder bereits entschieden.");
        }
      }
      return this.findeEineIntern(client, kassenbuchung_id);
    });
  }

  /**
   * Gemeinsamer Kern von Sofort-Bewilligung (stornoBeantragen() bei
   * Leitung) und Fremd-Bewilligung (stornoEntscheiden()): markiert den
   * Antrag als genehmigt und fuehrt den eigentlichen Storno aus (dieselbe
   * Spalten-UPDATE wie das frueheren Direkt-Storno). "WHERE status =
   * 'beantragt'"/"WHERE NOT storniert" schuetzen beide gegen ein doppeltes
   * Ausfuehren, falls zwei Anfragen sich ueberschneiden.
   */
  private async bewilligeAntrag(
    client: PoolClient,
    antragId: string,
    kassenbuchungId: string,
    grund: string,
    entschiedenVon: string
  ): Promise<void> {
    await client.query(
      `UPDATE kassenbuchung_stornoantrag
       SET status = 'genehmigt', entschieden_von = $1, entschieden_am = now()
       WHERE id = $2 AND status = 'beantragt'`,
      [entschiedenVon, antragId]
    );
    await client.query(
      `UPDATE kassenbuchung
       SET storniert = true, storno_grund = $1, storniert_von = $2, storniert_am = now()
       WHERE id = $3 AND NOT storniert`,
      [grund, entschiedenVon, kassenbuchungId]
    );
  }

  async findeAlle(filter?: { klientId?: string }): Promise<KassenbuchungDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [];
      // Eine Buchung ist sichtbar, wenn ENTWEDER ihr Klient ueber eine
      // offene Belegung in einem erlaubten Standort wohnt, ODER sie direkt
      // einem erlaubten Standort zugeordnet ist -- die beiden Faelle
      // schliessen sich per kassenbuchung_klient_xor_standort gegenseitig aus.
      const klientBed = klientStandortBedingung(erlaubteStandorte, "k", params);
      const standortBed = standortIdBedingung(erlaubteStandorte, "b.standort_id", params);
      const bedingungen = [`((b.klient_id IS NOT NULL AND ${klientBed}) OR (b.standort_id IS NOT NULL AND ${standortBed}))`];
      if (filter?.klientId) {
        params.push(filter.klientId);
        bedingungen.push(`b.klient_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `${BUCHUNG_SELECT}
         WHERE ${bedingungen.join(" AND ")}
         ORDER BY b.datum DESC, b.erstellt_am DESC`,
        params
      );
      const teilnehmerNachBuchung = await holeTeilnehmer(client, rows.map((r) => r.id));
      return rows.map((r) => zuDto(r, teilnehmerNachBuchung.get(r.id) ?? []));
    });
  }

  async wochenuebersicht(isoJahr: number, isoWoche: number): Promise<WochenuebersichtEintrag[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [isoJahr, isoWoche];
      const standortBedingung = klientStandortBedingung(erlaubteStandorte, "k", params);

      const { rows } = await client.query(
        `
        SELECT k.id AS klient_id, k.vorname, k.nachname,
               b.id AS buchung_id, b.betrag_cent, b.datum
        FROM klient k
        LEFT JOIN kassenbuchung b
          ON b.klient_id = k.id AND b.typ = 'hzl' AND b.iso_jahr = $1 AND b.iso_woche = $2 AND NOT b.storniert
        WHERE k.hzl_rhythmus = 'woechentlich' AND ${standortBedingung}
        ORDER BY k.nachname, k.vorname
        `,
        params
      );
      return rows.map((r) => ({
        klientId: r.klient_id,
        klientName: `${r.vorname} ${r.nachname}`,
        bezahlt: r.buchung_id !== null,
        buchungId: r.buchung_id,
        betragCent: r.betrag_cent,
        datum: r.datum,
      }));
    });
  }

  async unterschriftBild(kassenbuchungId: string): Promise<{ bild: Buffer; hash: string } | null> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ bild: Buffer; bild_hash: string; klient_id: string | null; standort_id: string | null }>(
        `SELECT u.bild, u.bild_hash, b.klient_id, b.standort_id
         FROM unterschrift u
         JOIN kassenbuchung b ON b.id = u.kassenbuchung_id
         WHERE u.kassenbuchung_id = $1`,
        [kassenbuchungId]
      );
      if (rows.length === 0) return null;
      const { klient_id, standort_id } = rows[0];
      const erlaubt = klient_id
        ? await klientIstErlaubt(client, benutzerId, klient_id)
        : await standortIstErlaubt(client, benutzerId, standort_id!);
      if (!erlaubt) return null;
      return { bild: rows[0].bild, hash: rows[0].bild_hash };
    });
  }

  private async findeEineIntern(client: PoolClient, id: string): Promise<KassenbuchungDto> {
    const { rows } = await client.query(`${BUCHUNG_SELECT} WHERE b.id = $1`, [id]);
    const teilnehmer = await holeTeilnehmer(client, [id]);
    return zuDto(rows[0], teilnehmer.get(id) ?? []);
  }
}

async function holeTeilnehmer(client: PoolClient, buchungIds: string[]): Promise<Map<string, KassenbuchungTeilnehmerDto[]>> {
  const map = new Map<string, KassenbuchungTeilnehmerDto[]>();
  if (buchungIds.length === 0) return map;
  const { rows } = await client.query(
    `SELECT t.kassenbuchung_id, t.klient_id, t.benutzer_id,
            COALESCE(k.vorname || ' ' || k.nachname, mb.name) AS name
     FROM kassenbuchung_teilnehmer t
     LEFT JOIN klient k ON k.id = t.klient_id
     LEFT JOIN benutzer mb ON mb.id = t.benutzer_id
     WHERE t.kassenbuchung_id = ANY($1)
     ORDER BY name`,
    [buchungIds]
  );
  for (const r of rows) {
    const liste = map.get(r.kassenbuchung_id) ?? [];
    liste.push({ klientId: r.klient_id, benutzerId: r.benutzer_id, name: r.name });
    map.set(r.kassenbuchung_id, liste);
  }
  return map;
}

function zuDto(r: any, teilnehmer: KassenbuchungTeilnehmerDto[]): KassenbuchungDto {
  return {
    id: r.id,
    klientId: r.klient_id,
    klientName: r.klient_id ? `${r.vorname} ${r.nachname}` : null,
    standortId: r.standort_id,
    standortName: r.standort_name,
    datum: r.datum,
    betragCent: r.betrag_cent,
    verwendungszweck: r.verwendungszweck,
    typ: r.typ,
    isoJahr: r.iso_jahr,
    isoWoche: r.iso_woche,
    storniert: r.storniert,
    stornoGrund: r.storno_grund,
    hatUnterschrift: r.hat_unterschrift,
    gebuchtVonName: r.gebucht_von_name,
    teilnehmer,
    offenerStornoantrag: r.storno_antrag_id
      ? {
          id: r.storno_antrag_id,
          grund: r.storno_antrag_grund,
          beantragtVonName: r.storno_beantragt_von_name,
          beantragtAm: r.storno_beantragt_am,
        }
      : null,
  };
}
