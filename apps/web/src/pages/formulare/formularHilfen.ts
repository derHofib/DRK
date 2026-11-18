import {
  alleBausteine,
  DATENQUELLEN,
  istEingabe,
  type Baustein,
  type Bedingung,
  type FeldWert,
  type FeldWerte,
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
  if (b.typ === "langtext" || b.typ === "mitarbeitende" || b.typ === "hinweis" || b.typ === "abschnitt") return true;
  if ((b.typ === "auswahl" || b.typ === "mehrfachauswahl") && b.optionen.filter((o) => !o.ausgeblendet).length > 4) return true;
  return false;
}

export const BEISPIEL_PERSON = { id: "00000000-0000-4000-8000-00000000beef", name: "A. Beispiel" };

const BEISPIEL_ANZEIGE: Record<keyof typeof DATENQUELLEN, string> = {
  "klient.name": "Mira Beispiel",
  "klient.vorname": "Mira",
  "klient.nachname": "Beispiel",
  "klient.initialen": "M. B.",
  "klient.geburtsdatum": "2004-05-06",
  "klient.alter": "22",
  "klient.aktenzeichen": "AZ-0000",
  "klient.amt": "Jugendamt",
  "klient.bezugsbetreuung": "A. Beispiel",
  "belegung.standort": "Haus Beispiel",
  "belegung.zimmer": "4",
  "belegung.wohnung": "Haus Beispiel, Zimmer 4",
  "ausfuellende.name": "A. Beispiel",
  "zeit.heute": "",
  "zeit.jetzt": "",
};

function heute(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Beispieldaten aus den Feldtypen, fuer die Vorschau in „Ansichten“. Ja/Nein
 * steht auf Ja, damit bedingte Abschnitte (meist „wenn Vorfall = Ja“) sichtbar
 * werden -- die Vorschau soll moeglichst viel vom Formular zeigen. Gespeichert
 * wird nichts davon.
 */
export function beispielDaten(def: FormularDefinition): {
  werte: FeldWerte;
  anzeige: Record<string, string | null>;
  personen: Record<string, string>;
} {
  const werte: FeldWerte = {};
  const anzeige: Record<string, string | null> = {};
  for (const b of alleBausteine(def)) {
    if (b.typ === "anzeige") {
      anzeige[b.schluessel] = b.quelle === "zeit.heute" ? heute() : b.quelle === "zeit.jetzt" ? "06:00" : BEISPIEL_ANZEIGE[b.quelle];
      continue;
    }
    if (!istEingabe(b)) continue;
    let w: FeldWert | null = null;
    switch (b.typ) {
      case "kurztext":
        w = "Beispiel";
        break;
      case "langtext":
        w = "Beispieltext: so sieht eine längere Angabe aus.";
        break;
      case "zahl": {
        const min = b.min ?? 0;
        const max = b.max ?? Math.max(min + 10, 10);
        w = Math.round((min + max) / 2);
        break;
      }
      case "datum":
        w = heute();
        break;
      case "uhrzeit":
        w = "06:00";
        break;
      case "ja_nein":
        w = true;
        break;
      case "auswahl": {
        const o = b.optionen.find((x) => !x.ausgeblendet);
        w = o ? o.wert : null;
        break;
      }
      case "mehrfachauswahl":
        w = b.optionen.filter((x) => !x.ausgeblendet).slice(0, 2).map((x) => x.wert);
        break;
      case "skala":
        w = Math.round((b.min + b.max) / 2);
        break;
      case "mitarbeitende":
        w = [BEISPIEL_PERSON.id];
        break;
    }
    if (w !== null) werte[b.schluessel] = w;
  }
  return { werte, anzeige, personen: { [BEISPIEL_PERSON.id]: BEISPIEL_PERSON.name } };
}
