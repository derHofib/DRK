/**
 * Das heutige Datum als ISO-Tag in Europe/Berlin.
 *
 * Bewusst nicht `new Date().toISOString().slice(0, 10)`: das ist UTC, und
 * zwischen 0 und 1/2 Uhr deutscher Zeit wäre "heute" damit noch der Vortag --
 * ein Bericht für den laufenden Tag würde fälschlich abgelehnt.
 */
export function heuteBerlin(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}
