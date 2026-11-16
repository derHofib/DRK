/**
 * Erzeugt das Service-Token fuer die Hersteller-Schnittstelle
 * (/service/rueckmeldungen) und den passenden Hash.
 *
 *   pnpm --filter @zimmerakte/api rueckmeldung-token
 *
 * Der Hash kommt als RUECKMELDUNG_SERVICE_TOKEN_HASH in die .env des Servers,
 * das Klartext-Token NUR in die Secrets der Claude-Umgebung. Der Klartext wird
 * nirgends gespeichert -- wer ihn verliert, erzeugt einen neuen (Rotation =
 * neuer Hash, das alte Token ist sofort ungueltig).
 */
import { createHash, randomBytes } from "node:crypto";

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
console.log(`Token (nur jetzt sichtbar, in die Claude-Umgebung):\n  ${token}\n`);
console.log(`Hash (in die .env des Servers):\n  RUECKMELDUNG_SERVICE_TOKEN_HASH=${hash}`);
