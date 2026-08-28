// PostgreSQL-Fehler haben zur Laufzeit ein "code"-Feld (SQLSTATE), aber der
// `pg`-Treiber typisiert Errors nicht darauf. Dieser Guard war bislang in
// sechs Services identisch dupliziert (zimmer, benutzer, rechnung, kassenbuch,
// kostenuebernahme, belegung) -- ein Ort statt sechs.
export function isPgError(err: unknown): err is { code: string; message?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
