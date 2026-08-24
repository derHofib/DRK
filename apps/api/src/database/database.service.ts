import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { requireTenantContext } from "../common/tenant-context";

/**
 * Der einzige Ort, an dem die App-Rolle mit der Datenbank spricht.
 *
 * Zwei Betriebsarten:
 *  - withTenant(fn): oeffnet eine Transaktion, setzt SET LOCAL app.mandant_id
 *    / app.benutzer_id / app.rolle aus dem AsyncLocalStorage-Kontext, fuehrt
 *    fn aus, committet. RLS greift automatisch -- niemand kann diesen Pfad
 *    aus Versehen ohne Tenant-Kontext benutzen, requireTenantContext() wirft
 *    sonst.
 *  - withoutTenant(fn): fuer die eine dokumentierte Ausnahme vor dem Login,
 *    wenn app.mandant_id noch nicht bekannt ist (siehe auth.service.ts).
 *    Bewusst ein eigener, auffaelliger Methodenname statt eines optionalen
 *    Parameters -- damit niemand ihn versehentlich "mal eben" fuer eine
 *    normale Abfrage benutzt.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.APP_DATABASE_URL;
    if (!connectionString) {
      throw new Error("APP_DATABASE_URL ist nicht gesetzt (siehe .env.example).");
    }
    this.pool = new Pool({ connectionString });
  }

  async withTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const ctx = requireTenantContext();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.mandant_id', $1, true)", [ctx.mandantId]);
      await client.query("SELECT set_config('app.benutzer_id', $1, true)", [ctx.benutzerId]);
      await client.query("SELECT set_config('app.rolle', $1, true)", [ctx.rolle]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async withoutTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
