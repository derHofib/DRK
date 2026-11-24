/**
 * Baumoperationen des Formular-Editors (finden, einsetzen, verschieben,
 * Schlüssel umbenennen) und die Bausteinvorlagen. Ohne React, damit Editor,
 * Baumansicht und Eigenschaften dieselben Funktionen teilen.
 */

import {
  istEingabe,
  schluesselAusBeschriftung,
  type Ausdruck,
  type Baustein,
  type BausteinTyp,
  type Bedingung,
  type Datenquelle,
  type FormularDefinition,
} from "@zimmerakte/shared";

type Pfad = number[];

export const KASTEN: { titel: string; typen: BausteinTyp[] }[] = [
  { titel: "Aufbau", typen: ["abschnitt", "hinweis", "anzeige"] },
  { titel: "Eingaben", typen: ["kurztext", "langtext", "zahl", "datum", "uhrzeit", "ja_nein", "auswahl", "mehrfachauswahl", "skala", "mitarbeitende"] },
  { titel: "Rechnen", typen: ["berechnung"] },
  { titel: "Abschluss", typen: ["unterschriften"] },
];

/** Beispielwerte fuer "Ausprobieren": erfunden, damit nie echte Daten im Editor stehen. */
export const BEISPIEL: Record<Datenquelle, string> = {
  "klient.name": "Erika Beispiel",
  "klient.vorname": "Erika",
  "klient.nachname": "Beispiel",
  "klient.initialen": "E. B.",
  "klient.geburtsdatum": "1980-04-12",
  "klient.alter": "46",
  "klient.aktenzeichen": "AZ-0000",
  "klient.amt": "Beispielamt",
  "klient.bezugsbetreuung": "Max Muster",
  "belegung.standort": "Haus Beispiel",
  "belegung.zimmer": "Zimmer 1",
  "belegung.wohnung": "Haus Beispiel, Zimmer 1",
  "ausfuellende.name": "Sie selbst",
  "zeit.heute": new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()),
  "zeit.jetzt": new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date()),
};

// ---------------------------------------------------------------------------
// Baum-Hilfen
// ---------------------------------------------------------------------------

export function finde(liste: Baustein[], schluessel: string, pfad: Pfad = []): Pfad | null {
  for (let i = 0; i < liste.length; i++) {
    const b = liste[i];
    if (b.schluessel === schluessel) return [...pfad, i];
    if (b.typ === "abschnitt") {
      const t = finde(b.kinder, schluessel, [...pfad, i]);
      if (t) return t;
    }
  }
  return null;
}

export function holen(liste: Baustein[], pfad: Pfad): Baustein {
  const b = liste[pfad[0]];
  return pfad.length === 1 || b.typ !== "abschnitt" ? b : holen(b.kinder, pfad.slice(1));
}

export function mitKindern(liste: Baustein[], eltern: Pfad, fn: (kinder: Baustein[]) => Baustein[]): Baustein[] {
  if (eltern.length === 0) return fn(liste);
  const [i, ...rest] = eltern;
  return liste.map((b, j) => (j === i && b.typ === "abschnitt" ? { ...b, kinder: mitKindern(b.kinder, rest, fn) } : b));
}

// ---------------------------------------------------------------------------
// Ziehen am Griff (Rueckmeldung 41c5627f)
// ---------------------------------------------------------------------------

/**
 * Wohin ein gezogener Baustein faellt -- relativ zu einem anderen Baustein
 * statt als Pfad, weil sich die Pfade verschieben, sobald der gezogene
 * Baustein aus dem Baum genommen ist. "anfang" heisst: als erstes Kind in
 * den Abschnitt `bezug` hinein.
 */
export type Ziel = { bezug: string; lage: "vor" | "nach" | "anfang" };

/** Liefert null, wenn der Zug nichts aendert oder nicht erlaubt ist. */
export function einsetzen(liste: Baustein[], schluessel: string, ziel: Ziel): Baustein[] | null {
  if (ziel.bezug === schluessel) return null;
  const von = finde(liste, schluessel);
  if (!von) return null;
  const b = holen(liste, von);
  const ohne = mitKindern(liste, von.slice(0, -1), (k) => k.filter((_, x) => x !== von[von.length - 1]));
  // Liegt das Ziel im gezogenen Abschnitt selbst, ist es jetzt verschwunden.
  const z = finde(ohne, ziel.bezug);
  if (!z) return null;
  if (ziel.lage === "anfang") {
    if (b.typ === "abschnitt" || holen(ohne, z).typ !== "abschnitt") return null;
    return mitKindern(ohne, z, (k) => [b, ...k]);
  }
  const eltern = z.slice(0, -1);
  // Abschnitte liegen immer oben (wie beim Hinzufuegen), nie in einem anderen.
  if (b.typ === "abschnitt" && eltern.length) return null;
  const i = z[z.length - 1] + (ziel.lage === "nach" ? 1 : 0);
  return mitKindern(ohne, eltern, (k) => [...k.slice(0, i), b, ...k.slice(i)]);
}

/**
 * Ziel unter dem Zeiger, gemessen an den echten Zeilen im DOM. Bewusst nur
 * die Hoehe: die Liste ist einspaltig, und wer seitlich danebenzieht, meint
 * trotzdem die Zeile auf derselben Hoehe.
 */
export function zielBei(baum: HTMLElement, y: number, gezogenIstAbschnitt: boolean): Ziel | null {
  const oben = [...baum.querySelectorAll<HTMLElement>(":scope > li[data-fe-knoten]")];
  if (oben.length === 0) return null;
  const s = (el: Element) => (el as HTMLElement).dataset.feKnoten!;
  const mitte = (r: DOMRect) => r.top + r.height / 2;
  const erster = oben[0].getBoundingClientRect();
  const letzter = oben[oben.length - 1].getBoundingClientRect();
  if (y < erster.top) return { bezug: s(oben[0]), lage: "vor" };
  if (y > letzter.bottom) return { bezug: s(oben[oben.length - 1]), lage: "nach" };

  if (gezogenIstAbschnitt) {
    for (const li of oben) if (y < mitte(li.getBoundingClientRect())) return { bezug: s(li), lage: "vor" };
    return { bezug: s(oben[oben.length - 1]), lage: "nach" };
  }

  const zeilen = [...baum.querySelectorAll<HTMLElement>("[data-fe-zeile]")];
  const treffer = zeilen.find((z) => {
    const r = z.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });
  const fuerZeile = (z: HTMLElement): Ziel => {
    const unten = y >= mitte(z.getBoundingClientRect());
    const bezug = z.dataset.feZeile!;
    if (z.dataset.feAbschnitt) return { bezug, lage: unten ? "anfang" : "vor" };
    return { bezug, lage: unten ? "nach" : "vor" };
  };
  if (treffer) return fuerZeile(treffer);

  // Im Rahmen eines Abschnitts, aber auf keiner Zeile: unten im Rahmen heisst
  // "ans Ende dieses Abschnitts", sonst gleich unter die Ueberschrift.
  const rahmen = oben.find((li) => {
    const r = li.getBoundingClientRect();
    return li.dataset.feAbschnitt && y >= r.top && y <= r.bottom;
  });
  if (rahmen) {
    const kinder = [...rahmen.querySelectorAll<HTMLElement>(":scope > ul > li[data-fe-knoten]")];
    const letztesKind = kinder[kinder.length - 1];
    if (letztesKind && y > letztesKind.getBoundingClientRect().bottom) return { bezug: s(letztesKind), lage: "nach" };
    return { bezug: s(rahmen), lage: "anfang" };
  }

  // In einer Luecke zwischen zwei Zeilen: die naechstgelegene gilt.
  let naechste: HTMLElement | null = null;
  let abstand = Infinity;
  for (const z of zeilen) {
    const r = z.getBoundingClientRect();
    const d = Math.min(Math.abs(y - r.top), Math.abs(y - r.bottom));
    if (d < abstand) [naechste, abstand] = [z, d];
  }
  return naechste ? fuerZeile(naechste) : null;
}

export function scrollbarerVorfahr(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Ein Feldschluessel kommt ausser am Baustein selbst in Bedingungen,
 * Formeln, Vergleichen und im Bezugsdatum vor. Beim Umbenennen muessen alle
 * mit -- sonst zeigte eine Bedingung danach ins Leere.
 */
export function verweiseUmbenennen(def: FormularDefinition, alt: string, neu: string): FormularDefinition {
  const lauf = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(lauf);
    if (!x || typeof x !== "object") return x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      out[k] = (k === "feld" || k === "von" || k === "bis") && v === alt ? neu : k === "kinder" ? (v as Baustein[]).map(bausteinLauf) : lauf(v);
    }
    return out;
  };
  const bausteinLauf = (b: Baustein): Baustein => {
    const c = { ...b } as Record<string, unknown>;
    for (const k of ["sichtbarWenn", "pflicht", "ausdruck", "pruefungen"]) if (c[k] !== undefined) c[k] = lauf(c[k]);
    if (b.typ === "abschnitt") c.kinder = b.kinder.map(bausteinLauf);
    return c as unknown as Baustein;
  };
  return {
    ...def,
    bausteine: def.bausteine.map(bausteinLauf),
    bezugsdatumFeld: def.bezugsdatumFeld === alt ? neu : def.bezugsdatumFeld,
  };
}

/** Optionswert in Bedingungen nachziehen, die sich auf dieses Feld beziehen. */
export function optionsverweiseUmbenennen(def: FormularDefinition, feld: string, alt: string, neu: string): FormularDefinition {
  const bed = (b: Bedingung): Bedingung => {
    if ("alle" in b) return { alle: b.alle.map(bed) };
    if ("eine" in b) return { eine: b.eine.map(bed) };
    if (b.feld !== feld) return b;
    if (b.wert === alt) return { ...b, wert: neu };
    if (Array.isArray(b.wert)) return { ...b, wert: b.wert.map((w) => (w === alt ? neu : w)) };
    return b;
  };
  const aus = (a: Ausdruck): Ausdruck => {
    if (typeof a === "number" || "feld" in a) return a;
    if ("op" in a) return { ...a, a: aus(a.a), b: aus(a.b) };
    if ("wenn" in a) return { wenn: bed(a.wenn), dann: aus(a.dann), sonst: aus(a.sonst) };
    if (a.fn === "dauer_minuten" || a.fn === "tage_zwischen") return a;
    return { ...a, args: a.args.map(aus) };
  };
  const lauf = (b: Baustein): Baustein => {
    const c = { ...b } as Baustein;
    if (c.sichtbarWenn) c.sichtbarWenn = bed(c.sichtbarWenn);
    if (istEingabe(c) && c.pflicht && typeof c.pflicht === "object") c.pflicht = bed(c.pflicht);
    if (c.typ === "berechnung") c.ausdruck = aus(c.ausdruck);
    if (c.typ === "abschnitt") c.kinder = c.kinder.map(lauf);
    return c;
  };
  return { ...def, bausteine: def.bausteine.map(lauf) };
}

export function neuerBaustein(typ: BausteinTyp, vorhanden: Set<string>): Baustein {
  const beschriftung =
    typ === "abschnitt"
      ? "Neuer Abschnitt"
      : typ === "hinweis"
        ? "Hinweistext"
        : typ === "anzeige"
          ? "Name"
          : typ === "berechnung"
            ? "Ergebnis"
            : typ === "unterschriften"
              ? "Unterschriften"
              : "Neue Frage";
  const schluessel = schluesselAusBeschriftung(beschriftung, vorhanden);
  switch (typ) {
    case "abschnitt":
      return { typ, schluessel, beschriftung, kinder: [] };
    case "hinweis":
      return { typ, schluessel, beschriftung, ton: "info" };
    case "anzeige":
      return { typ, schluessel, beschriftung, quelle: "klient.name" };
    case "auswahl":
    case "mehrfachauswahl":
      return {
        typ,
        schluessel,
        beschriftung,
        optionen: [
          { wert: "option_1", label: "Option 1" },
          { wert: "option_2", label: "Option 2" },
        ],
      };
    case "skala":
      return { typ, schluessel, beschriftung, min: 1, max: 5 };
    case "berechnung":
      return { typ, schluessel, beschriftung, ausdruck: { fn: "summe", args: [] } };
    case "unterschriften":
      // Die vier Rollen aus der Rueckmeldung als Vorschlag: zwei nebeneinander,
      // Klient:in und Mitarbeiter:in oben, die Leitungen darunter.
      return {
        typ,
        schluessel,
        beschriftung,
        spalten: 2,
        plaetze: [
          { id: "p1", rolle: "klient", beschriftung: "" },
          { id: "p2", rolle: "mitarbeiter", beschriftung: "" },
          { id: "p3", rolle: "einrichtungsleitung", beschriftung: "" },
          { id: "p4", rolle: "bereichsleitung", beschriftung: "" },
        ],
      };
    default:
      return { typ, schluessel, beschriftung } as Baustein;
  }
}
