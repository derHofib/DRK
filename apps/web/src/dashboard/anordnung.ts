import type { KachelPlatz } from "../components/KachelRaster";

/**
 * Die Standardanordnung von Heute -- was ein neues Konto sieht und was
 * "Anordnung zurücksetzen" wiederherstellt. Bewusst EINE Tabelle statt
 * verstreuter Zahlen an jeder Kachel: Wer eine Kachel verschiebt, sieht hier
 * sofort, was darunter und daneben liegt, und Luecken oder Ueberlappungen
 * fallen beim Lesen auf statt erst im Browser.
 *
 * Einheiten: x/w in Spalten (12), y/h in Rasterzeilen (40px + Luecke), halbe
 * Zeilen erlaubt (Abschnitte sind 1.5 hoch = halbe Kennzahl-Kachel).
 *
 * Aufbau von oben nach unten: Kennzahlen -- heutige Arbeit -- Belegung
 * (Listen) -- Kasse. Jede Reihe ist links und rechts buendig; zusammen
 * stehende Spalten enden auf derselben Hoehe.
 *
 * Ein Eintrag fuer eine Kachel, die es (noch) nicht gibt -- z. B.
 * "auslastung", solange sie nicht ausgeliefert ist, oder eine ausgeblendete
 * --, schadet nicht: Gelesen wird nur fuer vorhandene Kacheln, und das
 * Raster rueckt den Rest der Reihe nach links auf (KachelRaster,
 * linksBuendig).
 */
export const STANDARD_ANORDNUNG: Record<string, KachelPlatz> = {
  // Überblick: Auslastung als Blickfang links, daneben vier Kennzahlen.
  "abschnitt-ueberblick": { x: 0, y: 0, w: 12, h: 1.5 },
  auslastung: { x: 0, y: 1.5, w: 4, h: 4 },
  "lage-zimmer": { x: 4, y: 1.5, w: 2, h: 4 },
  "lage-hzl": { x: 6, y: 1.5, w: 2, h: 4 },
  "lage-rechnungen": { x: 8, y: 1.5, w: 2, h: 4 },
  "lage-storno": { x: 10, y: 1.5, w: 2, h: 4 },

  // Heute: die Arbeitsliste breit, rechts daneben Termine und Team.
  "abschnitt-heute": { x: 0, y: 5.5, w: 12, h: 1.5 },
  "zu-erledigen": { x: 0, y: 7, w: 8, h: 10 },
  termine: { x: 8, y: 7, w: 4, h: 7 },
  mitarbeitende: { x: 8, y: 14, w: 4, h: 3 },

  // Belegung: freie Plätze neben der Zimmerliste, Klient:innen darunter.
  "abschnitt-belegung": { x: 0, y: 17, w: 12, h: 1.5 },
  "freie-zimmer": { x: 0, y: 18.5, w: 4, h: 8 },
  zimmerliste: { x: 4, y: 18.5, w: 8, h: 8 },
  klientenliste: { x: 0, y: 26.5, w: 12, h: 8 },

  // Kasse: Saldo neben den letzten Buchungen.
  "abschnitt-kasse": { x: 0, y: 34.5, w: 12, h: 1.5 },
  hauskasse: { x: 0, y: 36, w: 4, h: 6 },
  "letzte-buchungen": { x: 4, y: 36, w: 8, h: 6 },
};

/** Standardplatz einer Kachel; ohne Eintrag ganz unten (das Raster zieht sie hoch). */
export function standardPlatz(id: string, ersatz: Omit<KachelPlatz, "x" | "y"> = { w: 4, h: 4 }): KachelPlatz {
  return STANDARD_ANORDNUNG[id] ?? { x: 0, y: 1000, ...ersatz };
}

/** Abschnittsueberschrift: halbe Hoehe der kleinsten normalen Kachel (Kennzahl, 3 Zeilen). */
export const ABSCHNITT_HOEHE = 1.5;

export interface Abschnitt {
  id: string;
  titel: string;
}

/** Passt zur Gruppierung von STANDARD_ANORDNUNG; die IDs muessen dort einen Platz haben. */
export const STANDARD_ABSCHNITTE: Abschnitt[] = [
  { id: "abschnitt-ueberblick", titel: "Überblick" },
  { id: "abschnitt-heute", titel: "Heute" },
  { id: "abschnitt-belegung", titel: "Belegung" },
  { id: "abschnitt-kasse", titel: "Kasse" },
];

/**
 * Abschnitte liegen wie das Layout im localStorage je Konto: reine
 * Darstellung ohne Personenbezug. Gespeichert wird die volle Liste, sobald
 * jemand etwas aendert; fehlt der Eintrag, gilt der Standard.
 */
export function abschnitteSchluessel(nutzerId: string) {
  return `zimmerakte_heute_abschnitte_${nutzerId}`;
}

export function ladeAbschnitte(nutzerId: string, nurAltesLayout: boolean): Abschnitt[] {
  try {
    const roh = localStorage.getItem(abschnitteSchluessel(nutzerId));
    if (roh) {
      const liste = JSON.parse(roh) as unknown;
      if (Array.isArray(liste)) {
        return liste.filter(
          (a): a is Abschnitt => !!a && typeof a.id === "string" && a.id.startsWith("abschnitt-") && typeof a.titel === "string",
        );
      }
    }
    // Wer Heute schon VOR den Abschnitten angeordnet hat, bekommt keine
    // Standard-Abschnitte untergeschoben: sie landeten unten angehaengt und
    // ohne Bezug zu seiner Ordnung. Einmal festgeschrieben, damit das auch
    // nach dem ersten Speichern im neuen Format so bleibt.
    if (nurAltesLayout) {
      localStorage.setItem(abschnitteSchluessel(nutzerId), "[]");
      return [];
    }
  } catch {
    // Kein Speicher oder kaputtes JSON: dann eben der Standard.
  }
  return STANDARD_ABSCHNITTE;
}

export function abschnitteSpeichern(nutzerId: string, liste: Abschnitt[] | null): void {
  try {
    if (liste === null) localStorage.removeItem(abschnitteSchluessel(nutzerId));
    else localStorage.setItem(abschnitteSchluessel(nutzerId), JSON.stringify(liste));
  } catch {
    // Ohne Speicher gelten die Abschnitte nur bis zum Neuladen.
  }
}

export function neueAbschnittId(): string {
  // crypto.randomUUID gibt es nur im sicheren Kontext; fuer eine
  // Darstellungs-ID reicht Zeit + Zufall.
  return `abschnitt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
