/**
 * Absichtlich keine dotenv-Abhaengigkeit fuer so wenig Funktionsumfang.
 *
 * Sucht ab __dirname aufwaerts nach der Repo-Wurzel (erkannt an
 * pnpm-workspace.yaml) und laedt deren .env, statt eine feste Anzahl "../"
 * anzunehmen -- die waere zwischen "tsx laeuft src/*.ts direkt aus" (dev)
 * und "node laeuft dist/src/*.js aus" (Produktion/Build) unterschiedlich
 * tief und bricht bei jeder Verschiebung still.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findeRepoWurzel(startVerzeichnis: string): string | null {
  let aktuell = startVerzeichnis;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(aktuell, "pnpm-workspace.yaml"))) return aktuell;
    const eltern = dirname(aktuell);
    if (eltern === aktuell) return null; // Dateisystemwurzel erreicht
    aktuell = eltern;
  }
  return null;
}

export function loadEnvFromRepoRoot() {
  const repoWurzel = findeRepoWurzel(__dirname);
  if (!repoWurzel) return;

  const envPath = join(repoWurzel, ".env");
  if (!existsSync(envPath)) return;

  for (const zeile of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = zeile.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const gleichheitszeichen = trimmed.indexOf("=");
    if (gleichheitszeichen === -1) continue;
    const key = trimmed.slice(0, gleichheitszeichen).trim();
    const value = trimmed.slice(gleichheitszeichen + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
