import "reflect-metadata";
import helmet from "helmet";
import { loadEnvFromRepoRoot } from "./load-env";

// Muss laufen, BEVOR irgendein Modul importiert wird, das beim Import
// (nicht erst bei der DI-Instanziierung) auf process.env zugreift --
// z.B. liest AuthModule sein JWT_SECRET direkt im Decorator-Ausdruck
// (JwtModule.register({...})), nicht lazy in einem Konstruktor wie
// DatabaseService. Ein statisches "import { AppModule } from './app.module'"
// waere von TypeScript vor diese Zeile gehoben worden (require() aus einem
// import-Statement laeuft immer vor jedem anderen Code im Modul) und haette
// process.env an der Stelle noch leer vorgefunden -- geprueft, das ist kein
// theoretisches Risiko: ohne diese Reihenfolge liest AuthModule JWT_SECRET
// IMMER als undefined, unabhaengig vom Inhalt der .env-Datei.
loadEnvFromRepoRoot();

/**
 * Im normalen Betrieb ruft der Browser die API NIE direkt cross-origin auf:
 * im Dev proxyt Vite /api an :3000 (vite.config.ts), im Produktivbetrieb
 * proxyt nginx /api/ an den api-Container (apps/web/nginx.conf) -- beides
 * bleibt aus Sicht des Browsers derselbe Origin. Ein uneingeschraenktes
 * app.enableCors() erlaubte trotzdem JEDER Website, direkt gegen die API zu
 * fahren -- unnoetige Angriffsflaeche ohne fachlichen Nutzen. Deshalb hier
 * eine explizite Allowlist statt des Wildcard-Standards, per CORS_ORIGIN
 * konfigurierbar (kommagetrennt) fuer Faelle, in denen Web und API doch
 * unter verschiedenen Origins laufen (z.B. eine separate Vorschau-Umgebung).
 */
function erlaubteCorsOrigins(): string[] {
  const wert = process.env.CORS_ORIGIN;
  if (!wert) return ["http://localhost:5173"];
  return wert.split(",").map((o) => o.trim()).filter(Boolean);
}

async function bootstrap() {
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: erlaubteCorsOrigins() });
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Zimmerakte API auf Port ${port}`);
}

bootstrap();
