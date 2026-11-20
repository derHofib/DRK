import { loadEnvFromRepoRoot } from "../src/load-env";
import { urlFuerWorker } from "./support/worker-datenbank";

loadEnvFromRepoRoot();

// Parallellauf: auf die eigene Datenbank dieses Workers umbiegen (angelegt in
// global-setup.ts). Beide URLs, sonst sähe der Admin-Client der Specs eine
// andere Datenbank als die App.
if (process.env.ZIMMERAKTE_TEST_DB_JE_WORKER === "1" && process.env.JEST_WORKER_ID) {
  for (const key of ["APP_DATABASE_URL", "MIGRATIONS_DATABASE_URL"] as const) {
    const url = process.env[key];
    if (url) process.env[key] = urlFuerWorker(url, process.env.JEST_WORKER_ID);
  }
}
