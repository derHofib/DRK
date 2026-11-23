import {
  alleBausteine,
  type Baustein,
  type Bedingung,
  type FormularDefinition,
} from "@zimmerakte/shared";

/**
 * Hilfen fuer die Reiter „Aufbau“ und „Ansichten“ eines Formulars
 * (Rueckmeldung „Aufbau Formular“). Alles reine Funktionen ohne Zustand,
 * damit sie ohne Browser pruefbar sind.
 */

const OP_TEXT: Record<string, string> = {
  ist: "ist",
  ist_nicht: "ist nicht",
  eine_von: "ist eine von",
  enthaelt: "enthält",
  leer: "ist leer",
  nicht_leer: "ist ausgefüllt",
  groesser: "größer als",
  kleiner: "kleiner als",
  mindestens: "mindestens",
  hoechstens: "höchstens",
};

/** „Vorfall“ ist Ja -- als Satz, wie im Editor-Satzbaukasten. */
export function bedingungText(b: Bedingung, def: FormularDefinition): string {
  if ("alle" in b) return b.alle.map((x) => bedingungText(x, def)).join(" und ");
  if ("eine" in b) return b.eine.map((x) => bedingungText(x, def)).join(" oder ");
  const feld = alleBausteine(def).find((x) => x.schluessel === b.feld);
  const name = `„${feld?.beschriftung ?? b.feld}“`;
  if (b.op === "leer" || b.op === "nicht_leer") return `${name} ${OP_TEXT[b.op]}`;
  const wert = (w: unknown): string => {
    if (typeof w === "boolean") return w ? "Ja" : "Nein";
    if (feld && (feld.typ === "auswahl" || feld.typ === "mehrfachauswahl")) return feld.optionen.find((o) => o.wert === w)?.label ?? String(w);
    return String(w);
  };
  const w = Array.isArray(b.wert) ? b.wert.map(wert).join(", ") : wert(b.wert);
  return `${name} ${OP_TEXT[b.op] ?? b.op} ${w}`;
}

export type FeldStand = "neu" | "geaendert" | "gleich";

/**
 * Stand eines Bausteins gegenueber der Vorversion. Kinder eines Abschnitts
 * zaehlen nicht mit: ein geaenderter Abschnitt waere sonst immer „geändert“,
 * sobald sich nur ein Feld darin aendert -- das Feld ist ja selbst markiert.
 */
export function feldStaende(alt: FormularDefinition | null, neu: FormularDefinition): Map<string, FeldStand> {
  const ohneKinder = (b: Baustein) => JSON.stringify(b.typ === "abschnitt" ? { ...b, kinder: [] } : b);
  const vorher = new Map(alt ? alleBausteine(alt).map((b) => [b.schluessel, ohneKinder(b)]) : []);
  const out = new Map<string, FeldStand>();
  for (const b of alleBausteine(neu)) {
    const v = vorher.get(b.schluessel);
    out.set(b.schluessel, v === undefined ? "neu" : v === ohneKinder(b) ? "gleich" : "geaendert");
  }
  return out;
}

/** Bausteine, die es in der Vorversion gab und jetzt nicht mehr. */
export function entfernteFelder(alt: FormularDefinition | null, neu: FormularDefinition): Baustein[] {
  if (!alt) return [];
  const jetzt = new Set(alleBausteine(neu).map((b) => b.schluessel));
  return alleBausteine(alt).filter((b) => !jetzt.has(b.schluessel));
}

/** Breite Felder gehen im zweispaltigen Aufbau ueber die ganze Zeile. */
export function istBreit(b: Baustein): boolean {
  if (b.typ === "langtext" || b.typ === "mitarbeitende" || b.typ === "hinweis" || b.typ === "abschnitt" || b.typ === "unterschriften") return true;
  if ((b.typ === "auswahl" || b.typ === "mehrfachauswahl") && b.optionen.filter((o) => !o.ausgeblendet).length > 4) return true;
  return false;
}

// Beispieldaten liegen in packages/shared: die Vorschau der PDF-Exporte
// erzeugt sie auf dem Server mit denselben Regeln.
export { BEISPIEL_PERSON, beispielDaten } from "@zimmerakte/shared";
