import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";
import { isPgError } from "../common/pg-error";

// Postgres-Fehlercode fuer eine verletzte EXCLUDE-Constraint. Kein String,
// der irgendwo geraten ist -- offizieller SQLSTATE-Code, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
// Nach Migration 0032 nur noch fuer belegung_klient_ohne_ueberlappung
// zustaendig -- die Zimmer-Ueberlappung ist kein EXCLUDE-Constraint mehr,
// sondern der Trigger belegung_kapazitaet_pruefen() (naechste Konstante).
const EXCLUSION_VIOLATION = "23P01";

// Custom-SQLSTATE aus belegung_kapazitaet_pruefen() (migrations/0032),
// kein Standard-Code -- siehe dort.
const KAPAZITAET_UEBERSCHRITTEN = "ZA001";

export interface BelegungDto {
  id: string;
  zimmerId: string;
  klientId: string;
  einzug: string;
  auszug: string | null;
}

@Injectable()
export class BelegungService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Kein Kapazitaets-/Ueberlappungs-Check im Anwendungscode -- der waere
   * unter gleichzeitigen Anfragen eine Race Condition (zwei Requests lesen
   * "noch ein Platz frei", bevor einer schreibt). Die Datenbank lehnt
   * stattdessen ab: der Trigger belegung_kapazitaet_pruefen() fuer die
   * Zimmerkapazitaet, der EXCLUDE-Constraint belegung_klient_ohne_
   * ueberlappung fuer die zweite Garantie (siehe migrations/0010 und
   * 0032). Dieser Code uebersetzt genau diese zwei Fehlercodes in ein 409
   * -- alles andere laeuft als 500 durch, wie es sich fuer einen
   * unerwarteten Fehler gehoert.
   */
  async einziehen(input: { zimmerId: string; klientId: string; einzug: string }): Promise<BelegungDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
        if (erlaubteStandorte) {
          const { rows: zimmerRows } = await client.query("SELECT standort_id FROM zimmer WHERE id = $1", [
            input.zimmerId,
          ]);
          if (zimmerRows.length === 0 || !erlaubteStandorte.includes(zimmerRows[0].standort_id)) {
            throw new NotFoundException("Zimmer nicht gefunden.");
          }
        }

        const { rows } = await client.query(
          `INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, gebucht_von)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, zimmer_id, klient_id, einzug, auszug`,
          [mandantId, input.zimmerId, input.klientId, input.einzug, benutzerId]
        );
        return zuDto(rows[0]);
      });
    } catch (err) {
      if (isPgError(err) && err.code === KAPAZITAET_UEBERSCHRITTEN) {
        throw new ConflictException("Dieses Zimmer hat im gewählten Zeitraum keine freien Plätze mehr.");
      }
      if (isPgError(err) && err.code === EXCLUSION_VIOLATION) {
        throw new ConflictException("Dieser Klient ist im gewählten Zeitraum bereits einem anderen Zimmer zugeordnet.");
      }
      throw err;
    }
  }

  async ausziehen(id: string, auszug: string): Promise<BelegungDto> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      if (erlaubteStandorte) {
        const { rows: bRows } = await client.query(
          "SELECT z.standort_id FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id WHERE b.id = $1",
          [id]
        );
        if (bRows.length === 0 || !erlaubteStandorte.includes(bRows[0].standort_id)) {
          throw new NotFoundException("Keine offene Belegung mit dieser ID gefunden.");
        }
      }

      const { rows } = await client.query(
        `UPDATE belegung SET auszug = $1
         WHERE id = $2 AND auszug IS NULL
         RETURNING id, zimmer_id, klient_id, einzug, auszug`,
        [auszug, id]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Keine offene Belegung mit dieser ID gefunden.");
      }
      return zuDto(rows[0]);
    });
  }
}

function zuDto(r: any): BelegungDto {
  return { id: r.id, zimmerId: r.zimmer_id, klientId: r.klient_id, einzug: r.einzug, auszug: r.auszug };
}
