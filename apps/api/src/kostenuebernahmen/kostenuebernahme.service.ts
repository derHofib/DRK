import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { klientIstErlaubt } from "../common/standort-restriction";
import { isPgError } from "../common/pg-error";

// SQLSTATE fuer eine verletzte EXCLUDE-Constraint, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const EXCLUSION_VIOLATION = "23P01";

export interface KostenuebernahmeDto {
  id: string;
  klientId: string;
  amt: string;
  von: string;
  bis: string | null;
}

@Injectable()
export class KostenuebernahmeService {
  constructor(private readonly db: DatabaseService) {}

  async findeAlleFuerKlient(klientId: string): Promise<KostenuebernahmeDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) return [];
      const { rows } = await client.query(
        `SELECT id, klient_id, amt, von, bis FROM kostenuebernahme WHERE klient_id = $1 ORDER BY von DESC`,
        [klientId]
      );
      return rows.map(zuDto);
    });
  }

  /**
   * Kein Ueberlappungs-Check im Anwendungscode -- gleiches Prinzip wie bei
   * belegung.service.ts: die EXCLUDE-Constraint auf kostenuebernahme
   * (migrations/0013) ist race-condition-sicher, eine Pruefung hier vorher
   * waere es nicht.
   */
  async anlegen(input: { klientId: string; amt: string; von: string }): Promise<KostenuebernahmeDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        if (!(await klientIstErlaubt(client, benutzerId, input.klientId))) {
          throw new NotFoundException("Klient nicht gefunden.");
        }
        const { rows } = await client.query(
          `INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, erstellt_von)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, klient_id, amt, von, bis`,
          [mandantId, input.klientId, input.amt, input.von, benutzerId]
        );
        return zuDto(rows[0]);
      });
    } catch (err) {
      if (isPgError(err) && err.code === EXCLUSION_VIOLATION) {
        throw new ConflictException(
          "Dieser Zeitraum überschneidet sich mit einer bestehenden Kostenübernahme desselben Klienten."
        );
      }
      throw err;
    }
  }

  async beenden(id: string, bis: string): Promise<KostenuebernahmeDto> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows: bestehend } = await client.query("SELECT klient_id FROM kostenuebernahme WHERE id = $1", [id]);
      if (bestehend.length === 0 || !(await klientIstErlaubt(client, benutzerId, bestehend[0].klient_id))) {
        throw new NotFoundException("Keine offene Kostenübernahme mit dieser ID gefunden.");
      }

      const { rows } = await client.query(
        `UPDATE kostenuebernahme SET bis = $1 WHERE id = $2 AND bis IS NULL
         RETURNING id, klient_id, amt, von, bis`,
        [bis, id]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Keine offene Kostenübernahme mit dieser ID gefunden.");
      }
      return zuDto(rows[0]);
    });
  }
}

function zuDto(r: any): KostenuebernahmeDto {
  return { id: r.id, klientId: r.klient_id, amt: r.amt, von: r.von, bis: r.bis };
}
