/**
 * Minimalistischer Migrations-Runner: kein ORM, reines SQL.
 *
 * Ein ORM-Migrationsgenerator kennt weder RLS-Policies noch
 * Exclusion-Constraints als Konzept -- er wuerde sie beim naechsten
 * "diff generieren" stillschweigend loeschen wollen. Deshalb: Dateien in
 * migrations/, alphabetisch sortiert, einmal ausgefuehrt, in einer
 * Tracking-Tabelle vermerkt. Kein Rollback-Mechanismus -- eine fehlerhafte
 * Migration wird durch eine neue, korrigierende Migration behoben, nicht
 * rueckgaengig gemacht (dieselbe Denkweise wie beim Kassenbuch-Storno).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { loadEnvFromRepoRoot } from "../src/load-env";

async function main() {
  loadEnvFromRepoRoot();
  const connectionString = process.env.MIGRATIONS_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATIONS_DATABASE_URL ist nicht gesetzt (siehe .env.example).");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        dateiname     text PRIMARY KEY,
        angewendet_am timestamptz NOT NULL DEFAULT now()
      );
    `);

    const migrationsDir = join(__dirname, "..", "migrations");
    const dateien = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query<{ dateiname: string }>("SELECT dateiname FROM _migrations");
    const bereitsAngewendet = new Set(rows.map((r) => r.dateiname));

    let anzahlNeu = 0;
    for (const dateiname of dateien) {
      if (bereitsAngewendet.has(dateiname)) continue;

      const sql = readFileSync(join(migrationsDir, dateiname), "utf8");
      console.log(`-> wende an: ${dateiname}`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (dateiname) VALUES ($1)", [dateiname]);
        await client.query("COMMIT");
        anzahlNeu++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`Migration ${dateiname} fehlgeschlagen -- Transaktion zurueckgerollt.`);
        throw err;
      }
    }

    console.log(
      anzahlNeu === 0
        ? "Keine neuen Migrationen. Schema ist aktuell."
        : `${anzahlNeu} Migration(en) angewendet.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
