import type { AbwesenheitArt, AbwesenheitDto, TerminArt, TerminDto } from "@zimmerakte/shared";
import { ABWESENHEIT_ART_LABEL, TERMIN_ART_LABEL } from "@zimmerakte/shared";

/**
 * Was eine Tageszelle des Kalenders "ist": Terminart, Abwesenheitsart oder
 * "abwesend" -- so sieht eine Abwesenheit fuer alle aus, die den Grund nicht
 * sehen duerfen (die API liefert dann art = null, migrations/0074).
 */
export type KalenderArt = TerminArt | AbwesenheitArt | "abwesend";

export const KALENDER_ART_LABEL: Record<KalenderArt, string> = {
  ...ABWESENHEIT_ART_LABEL,
  abwesend: "abwesend",
  ...TERMIN_ART_LABEL,
};

/**
 * Rangfolge fuer die Statusecke: treffen an einem Tag mehrere Arten
 * zusammen, zeigt die Ecke die wichtigste. "Wer fehlt" schlaegt "wer hat
 * einen Termin", und krank schlaegt alles -- das ist die Frage, mit der die
 * Leitung in den Jahreskalender schaut. Gleichzeitig die Reihenfolge in
 * Filter und Legende.
 */
export const KALENDER_ARTEN: KalenderArt[] = ["krank", "urlaub", "abwesend", "frei", "fortbildung", "klient", "besprechung", "termin"];

export const ABWESENHEIT_ARTEN: AbwesenheitArt[] = ["urlaub", "krank", "frei", "fortbildung"];

export function istAbwesenheitsArt(a: KalenderArt): boolean {
  return a === "abwesend" || (ABWESENHEIT_ARTEN as string[]).includes(a);
}

export function wichtigsteArt(arten: Iterable<KalenderArt>): KalenderArt | null {
  const menge = new Set(arten);
  return KALENDER_ARTEN.find((a) => menge.has(a)) ?? null;
}

export function abwesenheitArt(a: AbwesenheitDto): KalenderArt {
  return a.art ?? "abwesend";
}

/** Alle Tage einer Abwesenheit (von/bis inklusive, reine Datumsangaben). */
export function abwesenheitTage(a: AbwesenheitDto, addTage: (key: string, n: number) => string, max = 400): string[] {
  const tage: string[] = [];
  for (let k = a.von, i = 0; k <= a.bis && i < max; k = addTage(k, 1), i++) tage.push(k);
  return tage;
}

export interface KalenderFilter {
  /** Benutzer-IDs; leer = alle. */
  personen: string[];
  /** Leer = alle. */
  arten: KalenderArt[];
}

export const KEIN_FILTER: KalenderFilter = { personen: [], arten: [] };

export function filterAktiv(f: KalenderFilter): boolean {
  return f.personen.length > 0 || f.arten.length > 0;
}

/**
 * Personenfilter greift bei Terminen auf die Person, die ihn angelegt hat --
 * dieselbe Zuordnung wie die Personenfarbe. Von Klient:innen angelegte
 * Termine gehoeren keiner Mitarbeiter:in und fallen bei aktivem
 * Personenfilter deshalb heraus.
 */
export function terminPasst(t: TerminDto, f: KalenderFilter): boolean {
  if (f.arten.length > 0 && !f.arten.includes(t.art)) return false;
  if (f.personen.length > 0 && !(t.erstelltVon.art === "benutzer" && f.personen.includes(t.erstelltVon.id))) return false;
  return true;
}

export function abwesenheitPasst(a: AbwesenheitDto, f: KalenderFilter): boolean {
  if (f.arten.length > 0 && !f.arten.includes(abwesenheitArt(a))) return false;
  if (f.personen.length > 0 && !f.personen.includes(a.benutzer.id)) return false;
  return true;
}
