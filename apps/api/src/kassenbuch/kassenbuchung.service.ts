import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";

// SQLSTATE-Codes, kein geratener String -- siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

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
}

export interface WochenuebersichtEintrag {
  klientId: string;
  klientName: string;
  bezahlt: boolean;
  buchungId: string | null;
  betragCent: number | null;
  datum: string | null;
}

function bildAusBase64(input: string): Buffer {
  // Nimmt sowohl rohes Base64 als auch canvas.toDataURL()-Ausgaben
  // ("data:image/png;base64,...") entgegen -- das Frontend soll sich nicht
  // um das Prefix kuemmern muessen.
  const kommaIndex = input.indexOf(",");
  const reinesBase64 = input.startsWith("data:") && kommaIndex !== -1 ? input.slice(kommaIndex + 1) : input;
  return Buffer.from(reinesBase64, "base64");
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
          const bild = bildAusBase64(input.unterschriftBase64);
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
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
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
    return this.db.withTenant(async (client) => {
      const bedingungen = ["1=1"];
      const params: unknown[] = [];
      if (filter?.klientId) {
        params.push(filter.klientId);
        bedingungen.push(`b.klient_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `
        SELECT b.id, b.klient_id, k.vorname, k.nachname, b.datum, b.betrag_cent, b.verwendungszweck,
               b.typ, b.iso_jahr, b.iso_woche, b.storniert, b.storno_grund,
               (u.id IS NOT NULL) AS hat_unterschrift
        FROM kassenbuchung b
        JOIN klient k ON k.id = b.klient_id
        LEFT JOIN unterschrift u ON u.kassenbuchung_id = b.id
        WHERE ${bedingungen.join(" AND ")}
        ORDER BY b.datum DESC, b.erstellt_am DESC
        `,
        params
      );
      return rows.map(zuDto);
    });
  }

  async wochenuebersicht(isoJahr: number, isoWoche: number): Promise<WochenuebersichtEintrag[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `
        SELECT k.id AS klient_id, k.vorname, k.nachname,
               b.id AS buchung_id, b.betrag_cent, b.datum
        FROM klient k
        LEFT JOIN kassenbuchung b
          ON b.klient_id = k.id AND b.typ = 'hzl' AND b.iso_jahr = $1 AND b.iso_woche = $2 AND NOT b.storniert
        WHERE k.hzl_rhythmus = 'woechentlich'
        ORDER BY k.nachname, k.vorname
        `,
        [isoJahr, isoWoche]
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
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ bild: Buffer; bild_hash: string }>(
        "SELECT bild, bild_hash FROM unterschrift WHERE kassenbuchung_id = $1",
        [kassenbuchungId]
      );
      if (rows.length === 0) return null;
      return { bild: rows[0].bild, hash: rows[0].bild_hash };
    });
  }

  private async findeEineIntern(client: import("pg").PoolClient, id: string): Promise<KassenbuchungDto> {
    const { rows } = await client.query(
      `
      SELECT b.id, b.klient_id, k.vorname, k.nachname, b.datum, b.betrag_cent, b.verwendungszweck,
             b.typ, b.iso_jahr, b.iso_woche, b.storniert, b.storno_grund,
             (u.id IS NOT NULL) AS hat_unterschrift
      FROM kassenbuchung b
      JOIN klient k ON k.id = b.klient_id
      LEFT JOIN unterschrift u ON u.kassenbuchung_id = b.id
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
  };
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
