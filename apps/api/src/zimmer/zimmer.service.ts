import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";
import { initialen } from "../common/anonymisierung";

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (zimmer_standort_id_nummer_key,
// siehe migrations/0009_zimmer.sql), kein geratener String -- siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export type Zimmerstatus = "vergeben" | "zugeordnet";

export interface ZimmerListEintrag {
  id: string;
  nummer: string;
  standortId: string;
  standortName: string;
  status: Zimmerstatus;
  aktuellerKlient: { id: string; name: string; einzug: string } | null;
}

export interface BelegungsverlaufEintrag {
  id: string;
  klientId: string | null; // null fuer anonymisierte Vergangenheit -- kein Nachschlagen ohne Berechtigung moeglich
  name: string;
  einzug: string;
  auszug: string | null;
  istAktuell: boolean;
}

// Wer den vollen Namen ehemaliger Bewohner:innen sehen darf (z.B. für
// Amtsnachfragen), statt nur der Initialen -- siehe Bauplan Punkt 03: "die
// API entscheidet anhand der Rolle". Der aktuelle Bewohner wird immer mit
// vollem Namen angezeigt, unabhängig von der Rolle -- operativ braucht das
// jede Mitarbeiterin, die vor der Tür steht.
const ROLLEN_MIT_VOLLEM_VERLAUF = new Set(["leitung", "verwaltung"]);

@Injectable()
export class ZimmerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Kein "status"-Feld wird hier gelesen -- es gibt keins. Der LEFT JOIN auf
   * eine aktuell offene Belegung (auszug IS NULL, einzug bereits erreicht)
   * IST die Ableitung. Genau das lässt sich am Antwortkörper prüfen, ohne
   * eine Oberfläche zu brauchen.
   */
  async findeAlle(): Promise<ZimmerListEintrag[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);

      // Deaktivierte Zimmer verschwinden aus der Liste -- "deaktivieren" waere
      // sonst folgenlos. Ihre Belegungshistorie bleibt in der Datenbank
      // unangetastet, nur dieser eine Blick darauf zeigt sie nicht mehr.
      const bedingungen = ["z.aktiv"];
      const params: unknown[] = [];
      if (erlaubteStandorte) {
        params.push(erlaubteStandorte);
        bedingungen.push(`z.standort_id = ANY($${params.length})`);
      }

      const { rows } = await client.query(
        `
        SELECT
          z.id, z.nummer, z.standort_id, s.name AS standort_name,
          b.id AS belegung_id, b.klient_id, b.einzug, k.vorname, k.nachname
        FROM zimmer z
        JOIN standort s ON s.id = z.standort_id
        LEFT JOIN belegung b
          ON b.zimmer_id = z.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
        LEFT JOIN klient k ON k.id = b.klient_id
        WHERE ${bedingungen.join(" AND ")}
        ORDER BY s.name, z.nummer
        `,
        params
      );

      return rows.map((r) => ({
        id: r.id,
        nummer: r.nummer,
        standortId: r.standort_id,
        standortName: r.standort_name,
        status: (r.belegung_id ? "vergeben" : "zugeordnet") as Zimmerstatus,
        aktuellerKlient: r.belegung_id
          ? { id: r.klient_id, name: `${r.vorname} ${r.nachname}`, einzug: r.einzug }
          : null,
      }));
    });
  }

  async anlegen(input: { standortId: string; nummer: string }) {
    const { mandantId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id, nummer, standort_id",
          [mandantId, input.standortId, input.nummer]
        );
        return rows[0];
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Diese Zimmernummer gibt es in diesem Standort bereits.");
      }
      throw err;
    }
  }

  /**
   * Standort-Einschraenkung hier von Hand statt ueber
   * klientStandortBedingung(): ein Zimmer haengt direkt an standort_id, es
   * braucht keinen Umweg ueber eine aktuelle Belegung wie bei klient.
   */
  private async standortDesZimmersErlaubt(
    client: import("pg").PoolClient,
    benutzerId: string,
    zimmerId: string
  ): Promise<string | null> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
    const { rows } = await client.query<{ standort_id: string }>(
      "SELECT standort_id FROM zimmer WHERE id = $1",
      [zimmerId]
    );
    if (rows.length === 0) return null;
    if (erlaubteStandorte && !erlaubteStandorte.includes(rows[0].standort_id)) return null;
    return rows[0].standort_id;
  }

  async aktualisieren(id: string, input: { nummer: string }) {
    const { benutzerId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        if (!(await this.standortDesZimmersErlaubt(client, benutzerId, id))) {
          throw new NotFoundException("Zimmer nicht gefunden.");
        }
        const { rows } = await client.query(
          "UPDATE zimmer SET nummer = $1 WHERE id = $2 RETURNING id, nummer, standort_id",
          [input.nummer, id]
        );
        return rows[0];
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Diese Zimmernummer gibt es in diesem Standort bereits.");
      }
      throw err;
    }
  }

  /**
   * Bewusst kein DELETE: belegung.zimmer_id verweist ohne ON DELETE CASCADE
   * auf zimmer (siehe migrations/0010), ein geloeschtes Zimmer risse damit
   * entweder die Belegungshistorie mit oder scheiterte an der
   * Fremdschluessel-Constraint -- beides falsch fuer Daten, die fuer
   * Amtsnachfragen erhalten bleiben muessen. "Entfernen" heisst hier
   * deshalb wie bei mandant/standort: aktiv = false, die Historie bleibt.
   */
  async deaktivieren(id: string) {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const standortId = await this.standortDesZimmersErlaubt(client, benutzerId, id);
      if (!standortId) throw new NotFoundException("Zimmer nicht gefunden.");

      const { rows: offene } = await client.query(
        "SELECT 1 FROM belegung WHERE zimmer_id = $1 AND auszug IS NULL",
        [id]
      );
      if (offene.length > 0) {
        throw new ConflictException(
          "Dieses Zimmer ist aktuell belegt und kann nicht deaktiviert werden. Erst den Auszug eintragen."
        );
      }

      const { rows } = await client.query(
        "UPDATE zimmer SET aktiv = false WHERE id = $1 RETURNING id, nummer, standort_id",
        [id]
      );
      return rows[0];
    });
  }

  async belegungsverlauf(zimmerId: string): Promise<BelegungsverlaufEintrag[]> {
    const ctx = requireTenantContext();
    const vollerName = ROLLEN_MIT_VOLLEM_VERLAUF.has(ctx.rolle);

    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const bedingungen = ["b.zimmer_id = $1"];
      const params: unknown[] = [zimmerId];
      if (erlaubteStandorte) {
        params.push(erlaubteStandorte);
        bedingungen.push(`z.standort_id = ANY($${params.length})`);
      }

      const { rows } = await client.query(
        `
        SELECT b.id, b.klient_id, b.einzug, b.auszug, k.vorname, k.nachname
        FROM belegung b
        JOIN klient k ON k.id = b.klient_id
        JOIN zimmer z ON z.id = b.zimmer_id
        WHERE ${bedingungen.join(" AND ")}
        ORDER BY b.einzug DESC
        `,
        params
      );

      return rows.map((r) => {
        const istAktuell = r.auszug === null;
        const zeigeVollenNamen = istAktuell || vollerName;
        return {
          id: r.id,
          klientId: zeigeVollenNamen ? r.klient_id : null,
          name: zeigeVollenNamen ? `${r.vorname} ${r.nachname}` : initialen(r.vorname, r.nachname),
          einzug: r.einzug,
          auszug: r.auszug,
          istAktuell,
        };
      });
    });
  }
}
