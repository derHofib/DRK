import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { isPgError } from "../common/pg-error";

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (kassenbuchung_typ_mandant_id_bezeichnung_key,
// siehe migrations/0035_kassenbuchung_typ.sql) -- kein geratener String,
// siehe https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

export interface KassenbuchungTypDto {
  id: string;
  bezeichnung: string;
  kommentarPflicht: boolean;
  istHzl: boolean;
  aktiv: boolean;
}

// Gleiches Rollenmuster wie ROLLEN_MIT_STANDORT_BEARBEITEN in
// standort.service.ts -- anders als eine neue Einrichtung ist ein neuer
// Kassenbuch-Typ keine traegerweite Grundsatzentscheidung, deshalb hier
// (anders als bei ROLLEN_MIT_STANDORT_ANLEGEN) keine Sonderrolle nur fuer
// die Bereichsleitung.
const ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

function zuDto(r: {
  id: string;
  bezeichnung: string;
  kommentar_pflicht: boolean;
  ist_hzl: boolean;
  aktiv: boolean;
}): KassenbuchungTypDto {
  return {
    id: r.id,
    bezeichnung: r.bezeichnung,
    kommentarPflicht: r.kommentar_pflicht,
    istHzl: r.ist_hzl,
    aktiv: r.aktiv,
  };
}

@Injectable()
export class KassenbuchungTypService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liefert bewusst auch deaktivierte Typen mit -- die Verwaltungsseite
   * (Einstellungen) muss sie zeigen koennen, um sie wieder zu aktivieren.
   * Wer nur die aktiven fuer die Typ-Auswahl beim Buchen braucht, filtert
   * das im Frontend auf "aktiv" (gleiches Muster wie bei Standorten).
   */
  async findeAlle(): Promise<KassenbuchungTypDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT id, bezeichnung, kommentar_pflicht, ist_hzl, aktiv
         FROM kassenbuchung_typ
         ORDER BY ist_hzl DESC, bezeichnung`
      );
      return rows.map(zuDto);
    });
  }

  async anlegen(input: { bezeichnung: string; kommentarPflicht: boolean }): Promise<KassenbuchungTypDto> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Kassenbuch-Typen anlegen.");
    }
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO kassenbuchung_typ (mandant_id, bezeichnung, kommentar_pflicht)
           VALUES ($1, $2, $3)
           RETURNING id, bezeichnung, kommentar_pflicht, ist_hzl, aktiv`,
          [ctx.mandantId, input.bezeichnung, input.kommentarPflicht]
        );
        return zuDto(rows[0]);
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Ein Kassenbuch-Typ mit dieser Bezeichnung existiert bereits.");
      }
      throw err;
    }
  }

  /**
   * "aktiv" faellt bewusst nicht weg, wenn der Typ bereits an bestehenden
   * Buchungen haengt -- Deaktivieren bedeutet nur "in der Auswahl beim
   * Anlegen einer neuen Buchung nicht mehr anbieten", bestehende Buchungen
   * mit diesem Typ bleiben unangetastet (kassenbuchung ist ohnehin
   * Append-only, siehe 0011_kassenbuchung.sql).
   *
   * Der HZL-Systemtyp (ist_hzl) ist ueber diesen Endpunkt weder umbenennbar
   * noch deaktivierbar -- daran haengt die Wochenuebersicht und die Sperre
   * gegen doppelte HZL-Auszahlung je Klient/Kalenderwoche (siehe
   * hzl_einmal_je_woche in migrations/0035_kassenbuchung_typ.sql).
   */
  async aktualisieren(
    id: string,
    input: { bezeichnung?: string; kommentarPflicht?: boolean; aktiv?: boolean }
  ): Promise<KassenbuchungTypDto> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Kassenbuch-Typen bearbeiten.");
    }
    return this.db.withTenant(async (client) => {
      const { rows: bestehend } = await client.query<{ ist_hzl: boolean }>(
        "SELECT ist_hzl FROM kassenbuchung_typ WHERE id = $1",
        [id]
      );
      if (bestehend.length === 0) throw new NotFoundException("Kassenbuch-Typ nicht gefunden.");
      if (bestehend[0].ist_hzl) {
        throw new BadRequestException("Der Systemtyp „HZL“ kann nicht bearbeitet oder deaktiviert werden.");
      }

      try {
        const { rows } = await client.query(
          `UPDATE kassenbuchung_typ
           SET bezeichnung = COALESCE($1, bezeichnung),
               kommentar_pflicht = COALESCE($2, kommentar_pflicht),
               aktiv = COALESCE($3, aktiv)
           WHERE id = $4
           RETURNING id, bezeichnung, kommentar_pflicht, ist_hzl, aktiv`,
          [input.bezeichnung ?? null, input.kommentarPflicht ?? null, input.aktiv ?? null, id]
        );
        return zuDto(rows[0]);
      } catch (err) {
        if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
          throw new ConflictException("Ein Kassenbuch-Typ mit dieser Bezeichnung existiert bereits.");
        }
        throw err;
      }
    });
  }
}
