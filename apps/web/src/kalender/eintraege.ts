import type { AbwesenheitArt, AbwesenheitDto, TerminDto, TerminTypKurzDto } from "@zimmerakte/shared";
import { ABWESENHEIT_ART_LABEL } from "@zimmerakte/shared";

/** Abwesenheitsart oder "abwesend" -- so sieht eine Abwesenheit fuer alle aus, die den Grund nicht sehen duerfen. */
export type AbwesenheitsArt = AbwesenheitArt | "abwesend";

/**
 * Was eine Tageszelle des Kalenders "ist": eine Abwesenheitsart oder ein
 * Termintyp. Termintypen sind seit migrations/0085 je Traeger frei
 * angelegt; der Praefix "typ:" haelt sie von den festen Abwesenheitsarten
 * getrennt, auch wenn jemand einen Typ "Urlaub" nennt.
 */
export type KalenderArt = AbwesenheitsArt | `typ:${string}`;

export const ABWESENHEIT_LABEL: Record<AbwesenheitsArt, string> = {
  ...ABWESENHEIT_ART_LABEL,
  abwesend: "abwesend",
};

/**
 * Rangfolge fuer die Statusecke: treffen an einem Tag mehrere Arten
 * zusammen, zeigt die Ecke die wichtigste. "Wer fehlt" schlaegt "wer hat
 * einen Termin", und krank schlaegt alles -- das ist die Frage, mit der die
 * Leitung in den Jahreskalender schaut. Danach kommen die Termintypen in
 * der Reihenfolge, die der Traeger unter "Typen & Listen" festlegt.
 * Gleichzeitig die Reihenfolge in Filter und Legende.
 */
const ABWESENHEIT_RANG: AbwesenheitsArt[] = ["krank", "urlaub", "abwesend", "frei", "fortbildung"];

export const ABWESENHEIT_ARTEN: AbwesenheitArt[] = ["urlaub", "krank", "frei", "fortbildung"];

export function istAbwesenheitsArt(a: KalenderArt): a is AbwesenheitsArt {
  return !a.startsWith("typ:");
}

export function terminArt(t: TerminDto): KalenderArt {
  return `typ:${t.typ.id}`;
}

export function abwesenheitArt(a: AbwesenheitDto): AbwesenheitsArt {
  return a.art ?? "abwesend";
}

/** Farbklasse: Abwesenheiten .zv-art-<art>, Termintypen .zv-typ-<farbe> (beide setzen nur Farbton/Buntheit, app.css). */
export interface KalenderArten {
  /** Rangfolge: Abwesenheiten, dann Termintypen in Traeger-Reihenfolge. */
  liste: KalenderArt[];
  label: (a: KalenderArt) => string;
  klasse: (a: KalenderArt) => string;
  wichtigste: (arten: Iterable<KalenderArt>) => KalenderArt | null;
}

/**
 * typen: die Typliste des Traegers (Reihenfolge) plus die Typen, die an
 * geladenen Terminen haengen -- Klient:innen laden keine Typliste, und ein
 * Termin kann einen Typ tragen, den die Liste (noch) nicht kennt.
 */
export function kalenderArten(typen: TerminTypKurzDto[]): KalenderArten {
  const nachId = new Map<string, TerminTypKurzDto>();
  for (const t of typen) if (!nachId.has(t.id)) nachId.set(t.id, t);
  const liste: KalenderArt[] = [...ABWESENHEIT_RANG, ...[...nachId.keys()].map((id) => `typ:${id}` as const)];
  const typVon = (a: KalenderArt) => (istAbwesenheitsArt(a) ? undefined : nachId.get(a.slice(4)));
  return {
    liste,
    label: (a) => (istAbwesenheitsArt(a) ? ABWESENHEIT_LABEL[a] : (typVon(a)?.bezeichnung ?? "Termin")),
    klasse: (a) => (istAbwesenheitsArt(a) ? `zv-art-${a}` : `zv-typ-${typVon(a)?.farbe ?? "grau"}`),
    wichtigste: (arten) => {
      const menge = new Set(arten);
      return liste.find((a) => menge.has(a)) ?? null;
    },
  };
}

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
  if (f.arten.length > 0 && !f.arten.includes(terminArt(t))) return false;
  if (f.personen.length > 0 && !(t.erstelltVon.art === "benutzer" && f.personen.includes(t.erstelltVon.id))) return false;
  return true;
}

export function abwesenheitPasst(a: AbwesenheitDto, f: KalenderFilter): boolean {
  if (f.arten.length > 0 && !f.arten.includes(abwesenheitArt(a))) return false;
  if (f.personen.length > 0 && !f.personen.includes(a.benutzer.id)) return false;
  return true;
}
