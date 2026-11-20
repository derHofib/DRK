/**
 * Jeder Jest-Worker bekommt eine eigene Datenbank, damit die Suite parallel
 * laufen kann. Gemeinsam in EINER Datenbank ginge das nicht sicher: die
 * Löschfrist-Läufe (chat_loeschfrist_anwenden() & Co.) arbeiten bewusst über
 * alle Mandanten, und einige Specs zählen oder räumen tabellenweit auf —
 * parallel würden sie sich gegenseitig die Daten wegziehen.
 *
 * Die Kopien entstehen per CREATE DATABASE … TEMPLATE aus der migrierten
 * Datenbank: das kopiert Dateien statt 80 Migrationen erneut auszuführen
 * (Millisekunden statt Sekunden) und garantiert dasselbe Schema samt
 * Policies, GRANTs und FORCE ROW LEVEL SECURITY. Rollen sind clusterweit,
 * zimmerakte_app ist also in jeder Kopie dieselbe Rolle ohne BYPASSRLS.
 *
 * Mit --runInBand (ein Worker) bleibt alles wie bisher: kein Klonen, die
 * Specs laufen direkt gegen die Datenbank aus .env.
 */
import { Client } from "pg";
import { loadEnvFromRepoRoot } from "../src/load-env";
import { datenbankNameFuerWorker } from "./support/worker-datenbank";

export default async function globalSetup(globalConfig: { maxWorkers: number }): Promise<void> {
  loadEnvFromRepoRoot();
  const worker = globalConfig.maxWorkers;
  if (worker <= 1) return;

  const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!adminUrl) throw new Error("MIGRATIONS_DATABASE_URL ist nicht gesetzt (siehe .env.example).");
  const wartungsUrl = new URL(adminUrl);
  const vorlage = wartungsUrl.pathname.slice(1);
  // Eine Datenbank kann nicht als Vorlage dienen, solange jemand mit ihr
  // verbunden ist — also über die Wartungsdatenbank "postgres" anlegen.
  wartungsUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: wartungsUrl.toString() });
  await admin.connect();
  try {
    for (let i = 1; i <= worker; i++) {
      const name = datenbankNameFuerWorker(vorlage, String(i));
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${vorlage}"`);
    }
  } finally {
    await admin.end();
  }
  // Wird an die danach gestarteten Worker-Prozesse vererbt, siehe setup-env.ts.
  process.env.ZIMMERAKTE_TEST_DB_JE_WORKER = "1";
}
