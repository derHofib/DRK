/**
 * Was die Katze "sagt". Zwei Sorten, bewusst getrennt:
 *
 *  - Laute (Sprechblase): das, was eine Katze wirklich von sich gibt --
 *    Miau, Gurren, Schnurren, Fauchen, Schnattern. Sie sind die Regel.
 *  - Gedanken (Gedankenblase, kursiv): was man einer Katze in der Lage
 *    unterstellt. Sie sind die Ausnahme und nie eine Aussage ueber Inhalte
 *    der Anwendung -- die Katze liest keine Akten.
 *
 * Je Anlass gibt es einen Vorrat; gezogen wird zufaellig, aber nie der Text,
 * der fuer denselben Anlass zuletzt kam (sonst wirkt sie wie ein Automat).
 */

export type Anlass =
  | "auftritt"
  | "abgang"
  | "schnurren"
  | "genug"
  | "schreck"
  | "platzMachen"
  | "lauern"
  | "gefangen"
  | "verfehlt"
  | "gaehnen"
  | "aufwachen"
  | "traum"
  | "liegeplatz"
  | "gelandet"
  | "flitzen"
  | "langeweile"
  | "tippen"
  | "wolle"
  | "putzen";

interface Vorrat {
  laut: string[];
  gedanke: string[];
  /** Anteil der Gedanken, 0..1. */
  anteil: number;
}

const VORRAT: Record<Anlass, Vorrat> = {
  auftritt: {
    laut: ["Miau.", "Mau!", "Mrrau?", "Prrrt?", "Miiiau.", "Mrrp!"],
    gedanke: ["Ah. Mein Büro.", "Da bin ich. Bitte, gern geschehen.", "Wurde ich vermisst? Bestimmt."],
    anteil: 0.3,
  },
  abgang: {
    laut: ["Mau.", "Mrrp.", "Miau!"],
    gedanke: ["Ich muss dann mal.", "Draußen raschelt was.", "Bin gleich wieder da. Vielleicht."],
    anteil: 0.4,
  },
  schnurren: {
    laut: ["Schnurr …", "Prrrrr …", "Rrrrrr …", "Schnurrrr …", "Prrr … prrr …"],
    gedanke: ["Ja. Genau da.", "Etwas weiter links.", "Weitermachen.", "Das darf so bleiben."],
    anteil: 0.25,
  },
  genug: {
    laut: ["Mrrh.", "Mau.", "Mrrp."],
    gedanke: ["Das reicht für heute.", "Genug gekuschelt.", "Jetzt ist aber gut."],
    anteil: 0.5,
  },
  schreck: {
    laut: ["Ffft!", "Chhh!", "Mrrau!", "Fffch!"],
    gedanke: ["Huch!"],
    anteil: 0.1,
  },
  platzMachen: {
    laut: ["Mrrp.", "Hmpf.", "Mau."],
    gedanke: ["Na gut. Bitte sehr.", "Ich wollte sowieso gerade gehen.", "Da lag ich. Aber gut.", "Schon verstanden."],
    anteil: 0.45,
  },
  lauern: {
    laut: ["Mäk-äk-äk …", "Ek-ek-ek …", "…"],
    gedanke: ["Gleich. Gleich …", "Das Ding da bewegt sich.", "Nicht bewegen … nicht bewegen …", "Die krieg ich."],
    anteil: 0.5,
  },
  gefangen: {
    laut: ["Mau!", "Mrrau!", "Ha!"],
    gedanke: ["Hab dich.", "Meins.", "Erwischt.", "Und so macht man das."],
    anteil: 0.55,
  },
  verfehlt: {
    laut: ["Mrrh.", "Mau?", "…"],
    gedanke: ["Das war Absicht.", "Ich wollte gar nicht.", "Hat keiner gesehen.", "Entwischt."],
    anteil: 0.6,
  },
  gaehnen: {
    laut: ["Uaaah …", "Mmmjaaah …", "Haaach …"],
    gedanke: [],
    anteil: 0,
  },
  aufwachen: {
    laut: ["Mrrp?", "Mmrrh …", "Mau?"],
    gedanke: ["War was?", "Ich habe nicht geschlafen. Ich habe geruht.", "Wie spät ist es?"],
    anteil: 0.4,
  },
  traum: {
    laut: [],
    gedanke: ["… Thunfisch …", "… eine Maus … zwei Mäuse …", "… Sonnenfleck …", "… Karton …"],
    anteil: 1,
  },
  liegeplatz: {
    laut: ["Prrrt.", "Mrrp."],
    gedanke: ["Guter Platz.", "Hier liege ich. Das ist jetzt so.", "Passt. Ich bleibe.", "Schön warm hier."],
    anteil: 0.6,
  },
  gelandet: {
    laut: ["Mrrp.", "Prrt!"],
    gedanke: ["Elegant wie immer.", "Von hier oben sieht man mehr."],
    anteil: 0.5,
  },
  flitzen: {
    laut: ["Mrrrau!", "Prrrrt!"],
    gedanke: ["JETZT!", "Die fünf Minuten!", "Schnell schnell schnell!"],
    anteil: 0.6,
  },
  langeweile: {
    laut: ["Miau?", "Mau?", "Miiiau …", "Mrrau?"],
    gedanke: ["Niemand da?", "Hallo? Personal?", "Mir ist langweilig.", "Könnte mal jemand mit mir spielen?"],
    anteil: 0.4,
  },
  tippen: {
    laut: ["Mrrp?"],
    gedanke: ["Tipp, tipp, tipp …", "So viele Tasten.", "Ich passe auf, dass du arbeitest.", "Darf ich mich auf die Tastatur legen?"],
    anteil: 0.85,
  },
  wolle: {
    laut: ["Mau!", "Mrrau!", "Prrt!"],
    gedanke: ["Die Wolle hat angefangen.", "Meins!", "Halt still!"],
    anteil: 0.35,
  },
  putzen: {
    laut: [],
    gedanke: ["Erst mal Fellpflege.", "Ordnung muss sein.", "Wie sehe ich aus? Gut. Natürlich."],
    anteil: 1,
  },
};

/** Zur Tageszeit passende Gedanken; kommen selten statt "langeweile". */
export function tageszeitGedanken(stunde: number, wochentag: number): string[] {
  const liste: string[] = [];
  if (stunde < 8) liste.push("So früh schon?", "Erst Frühstück.");
  if (stunde >= 11 && stunde < 14) liste.push("Mittagessen?", "Gibt es bald Futter?");
  if (stunde >= 14 && stunde < 16) liste.push("Zeit für ein Nickerchen.");
  if (stunde >= 17) liste.push("Feierabend?", "Du bist ja immer noch da.");
  if (stunde >= 20) liste.push("Geh ins Bett. Ich übernehme.");
  if (wochentag === 5 && stunde >= 13) liste.push("Freitag. Ich merke das.");
  if (wochentag === 1 && stunde < 12) liste.push("Montag. Mir egal, ich bin eine Katze.");
  return liste;
}

export interface BlasenText {
  t: string;
  gedanke: boolean;
}

const zuletzt = new Map<string, string>();

function ziehe(liste: string[], schluessel: string, zufall: () => number): string {
  const vorher = zuletzt.get(schluessel);
  const wahl = liste.length > 1 ? liste.filter((t) => t !== vorher) : liste;
  const t = wahl[Math.floor(zufall() * wahl.length)];
  zuletzt.set(schluessel, t);
  return t;
}

export function blasenText(anlass: Anlass, zufall: () => number = Math.random, jetzt: Date = new Date()): BlasenText {
  const v = VORRAT[anlass];
  if (anlass === "langeweile" && zufall() < 0.3) {
    const zeit = tageszeitGedanken(jetzt.getHours(), jetzt.getDay());
    if (zeit.length > 0) return { t: ziehe(zeit, "tageszeit", zufall), gedanke: true };
  }
  const gedanke = v.laut.length === 0 || (v.gedanke.length > 0 && zufall() < v.anteil);
  return { t: ziehe(gedanke ? v.gedanke : v.laut, `${anlass}:${gedanke ? "g" : "l"}`, zufall), gedanke };
}

/** Lesedauer einer Blase in Sekunden: kurze Laute kurz, ein Satz laenger. */
export function blasenDauer(text: string): number {
  return Math.min(4.2, 1.6 + text.length * 0.055);
}

export const ALLE_ANLAESSE = Object.keys(VORRAT) as Anlass[];
