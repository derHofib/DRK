export function datenbankNameFuerWorker(vorlage: string, workerId: string): string {
  return `${vorlage}_test_w${workerId}`;
}

/** Ersetzt nur den Datenbanknamen; Rolle, Passwort und Host bleiben. */
export function urlFuerWorker(url: string, workerId: string): string {
  const u = new URL(url);
  u.pathname = "/" + datenbankNameFuerWorker(u.pathname.slice(1), workerId);
  return u.toString();
}
