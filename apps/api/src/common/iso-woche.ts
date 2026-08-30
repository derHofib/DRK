/**
 * ISO-8601-Kalenderwoche fuer ein Datum -- exakter Algorithmus wie in
 * apps/web/src/pages/Kassenbuch.tsx::isoWocheVon(). Bewusst dupliziert statt
 * ueber ein gemeinsames Paket geteilt: eine einzige, in sich geschlossene
 * Funktion ohne weitere Abhaengigkeiten, fuer die eine Paketgrenze mehr
 * Aufwand waere als der Nutzen.
 */
export function isoWoche(datum: Date): { jahr: number; woche: number } {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()));
  const tagNr = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - tagNr + 3);
  const ersterDonnerstag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ersterTagNr = (ersterDonnerstag.getUTCDay() + 6) % 7;
  ersterDonnerstag.setUTCDate(ersterDonnerstag.getUTCDate() - ersterTagNr + 3);
  const woche = 1 + Math.round((d.getTime() - ersterDonnerstag.getTime()) / (7 * 24 * 3600 * 1000));
  return { jahr: d.getUTCFullYear(), woche };
}
