import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { dateiAusBase64 } from "../common/datei";
import { ermittleErlaubteStandortIds, klientIstErlaubt, klientStandortBedingung } from "../common/standort-restriction";
import { isPgError } from "../common/pg-error";

// SQLSTATE-Codes, kein geratener String -- siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

// Ein Storno macht eine Auszahlung/Einzahlung rueckwirkend ungueltig -- wer
// das darf, entscheidet ueber die Kassenbuchfuehrung, nicht ueber einzelne
// Klientendaten. Betreuer legen Buchungen an, duerfen sie aber nicht im
// Nachhinein aus der Kasse entfernen.
const ROLLEN_MIT_STORNO = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

export type KassenbuchungTyp = "hzl" | "einzahlung" | "sonstiges";

export interface KassenbuchungDto {
  id: string;
  klientId: string;
  klientName: string;
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
}

export interface WochenuebersichtEintrag {
  klientId: string;
  klientName: string;
  bezahlt: boolean;
  buchungId: string | null;
  betragCent: number | null;
  datum: string | null;
}

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
   */
  async anlegen(input: {
    klientId: string;
    datum: string;
    betragCent: number;
    verwendungszweck: string;
    typ: KassenbuchungTyp;
    isoJahr?: number;
    isoWoche?: number;
    unterschriftBase64?: string;
  }): Promise<KassenbuchungDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    const istAuszahlung = input.betragCent < 0;

    if (istAuszahlung && !input.unterschriftBase64) {
      throw new BadRequestException("Auszahlungen müssen mit einer Unterschrift bestätigt werden.");
    }

    try {
      return await this.db.withTenant(async (client) => {
        if (!(await klientIstErlaubt(client, benutzerId, input.klientId))) {
          throw new NotFoundException("Klient nicht gefunden.");
        }

        const { rows } = await client.query(
          `INSERT INTO kassenbuchung (mandant_id, klient_id, datum, betrag_cent, verwendungszweck, typ, iso_jahr, iso_woche, gebucht_von)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            mandantId,
            input.klientId,
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

  async stornieren(id: string, grund: string): Promise<KassenbuchungDto> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_STORNO.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Buchungen stornieren.");
    }
    const { benutzerId } = ctx;
    return this.db.withTenant(async (client) => {
      const { rows: buchungRows } = await client.query("SELECT klient_id FROM kassenbuchung WHERE id = $1", [id]);
      if (buchungRows.length === 0 || !(await klientIstErlaubt(client, benutzerId, buchungRows[0].klient_id))) {
        throw new NotFoundException("Buchung nicht gefunden oder bereits storniert.");
      }

      const { rowCount } = await client.query(
        `UPDATE kassenbuchung
         SET storniert = true, storno_grund = $1, storniert_von = $2, storniert_am = now()
         WHERE id = $3 AND NOT storniert`,
        [grund, benutzerId, id]
      );
      if (rowCount === 0) {
        throw new NotFoundException("Buchung nicht gefunden oder bereits storniert.");
      }
      return this.findeEineIntern(client, id);
    });
  }

  async findeAlle(filter?: { klientId?: string }): Promise<KassenbuchungDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [];
      const bedingungen = [klientStandortBedingung(erlaubteStandorte, "k", params)];
      if (filter?.klientId) {
        params.push(filter.klientId);
        bedingungen.push(`b.klient_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `
        SELECT b.id, b.klient_id, k.vorname, k.nachname, b.datum, b.betrag_cent, b.verwendungszweck,
               b.typ, b.iso_jahr, b.iso_woche, b.storniert, b.storno_grund,
               (u.id IS NOT NULL) AS hat_unterschrift, mb.name AS gebucht_von_name
        FROM kassenbuchung b
        JOIN klient k ON k.id = b.klient_id
        LEFT JOIN unterschrift u ON u.kassenbuchung_id = b.id
        LEFT JOIN benutzer mb ON mb.id = b.gebucht_von
        WHERE ${bedingungen.join(" AND ")}
        ORDER BY b.datum DESC, b.erstellt_am DESC
        `,
        params
      );
      return rows.map(zuDto);
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
      const { rows } = await client.query<{ bild: Buffer; bild_hash: string; klient_id: string }>(
        `SELECT u.bild, u.bild_hash, b.klient_id
         FROM unterschrift u
         JOIN kassenbuchung b ON b.id = u.kassenbuchung_id
         WHERE u.kassenbuchung_id = $1`,
        [kassenbuchungId]
      );
      if (rows.length === 0) return null;
      if (!(await klientIstErlaubt(client, benutzerId, rows[0].klient_id))) return null;
      return { bild: rows[0].bild, hash: rows[0].bild_hash };
    });
  }

  private async findeEineIntern(client: import("pg").PoolClient, id: string): Promise<KassenbuchungDto> {
    const { rows } = await client.query(
      `
      SELECT b.id, b.klient_id, k.vorname, k.nachname, b.datum, b.betrag_cent, b.verwendungszweck,
             b.typ, b.iso_jahr, b.iso_woche, b.storniert, b.storno_grund,
             (u.id IS NOT NULL) AS hat_unterschrift, mb.name AS gebucht_von_name
      FROM kassenbuchung b
      JOIN klient k ON k.id = b.klient_id
      LEFT JOIN unterschrift u ON u.kassenbuchung_id = b.id
      LEFT JOIN benutzer mb ON mb.id = b.gebucht_von
      WHERE b.id = $1
      `,
      [id]
    );
    return zuDto(rows[0]);
  }
}

function zuDto(r: any): KassenbuchungDto {
  return {
    id: r.id,
    klientId: r.klient_id,
    klientName: `${r.vorname} ${r.nachname}`,
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
  };
}
