/**
 * Die Hauptmenüpunkte und ihre Reihenfolge -- zentral hier statt in
 * Shell.tsx, weil sowohl Shell.tsx (rendert die Navigation) als auch
 * Einstellungen.tsx (rendert den Reihenfolge-Editor) dieselbe Quelle
 * brauchen.
 */
import {
  IAuszahlen,
  IKapazitaet,
  IAufgaben,
  IDashboard,
  IEinstellungen,
  IKassenbuch,
  IKalender,
  IKlienten,
  IMitarbeitende,
  INachrichten,
  IOrganigramm,
  IUebergabe,
  IStandort,
  ITagesberichte,
  IVertretung,
  type IconKomponente,
} from "./components/icons";

export type HauptReiter =
  | "dashboard"
  | "aufgaben"
  | "mitarbeitende"
  | "standorte"
  | "klienten"
  | "nachrichten"
  | "kalender"
  | "kassenbuch"
  | "tagesberichte"
  | "einstellungen";

/**
 * Seiten, die nicht als eigener Hauptpunkt in der Sidebar stehen, sondern
 * als Unterpunkt unter einem Hauptpunkt (siehe UNTERPUNKTE) -- so wie
 * Anwaerter/Archiv unter "Klienten". Eigene Tab-Werte, aber nicht Teil der
 * frei sortierbaren Hauptreihenfolge.
 */
export type UnterReiter =
  | "schichtuebergabe"
  | "vertretung"
  | "organigramm"
  | "hzl"
  // Raumplan/Zeitleiste EINES Standorts unter "Standorte". Welcher Standort,
  // wird ueber die Standort-Reiter unter dem Seitenkopf gewaehlt
  // (StandortReiter.tsx) und steht als Zustand in Shell.tsx, nicht im
  // Tab-Wert -- so bleibt der Unterpunkt in der Seitenleiste EIN Eintrag.
  | "belegung";

export type Tab = HauptReiter | UnterReiter;

export interface UnterpunktEintrag {
  wert: UnterReiter;
  label: string;
  icon: IconKomponente;
}

export const UNTERPUNKTE: Partial<Record<HauptReiter, UnterpunktEintrag[]>> = {
  standorte: [{ wert: "belegung", label: "Belegung", icon: IKapazitaet }],
  dashboard: [{ wert: "schichtuebergabe", label: "Schichtübergabe", icon: IUebergabe }],
  kassenbuch: [{ wert: "hzl", label: "HZL", icon: IAuszahlen }],
  mitarbeitende: [
    { wert: "vertretung", label: "Vertretung", icon: IVertretung },
    { wert: "organigramm", label: "Organigramm", icon: IOrganigramm },
  ],
};

/** Zu welchem Hauptpunkt eine Seite in der Navigation gehoert (Unterpunkt -> Elternpunkt). */
export function hauptreiterVon(tab: Tab): HauptReiter {
  for (const [haupt, unter] of Object.entries(UNTERPUNKTE)) {
    if (unter?.some((u) => u.wert === tab)) return haupt as HauptReiter;
  }
  return tab as HauptReiter;
}

export type KlientenAnsicht = "aktiv" | "archiv" | "anwaerter";

export interface ReiterEintrag {
  wert: HauptReiter;
  label: string;
  icon: IconKomponente;
}

/**
 * Die drei Menuegruppen der Seitenleiste. Die Gruppierung folgt der Frage,
 * mit der man ans Menue herangeht: "Was ist zu tun?" (ARBEIT), "Um wen geht
 * es?" (MENSCHEN), "Wo/womit?" (HAUS). Eine flache Liste aus neun Punkten
 * zwang dazu, jedes Mal alle zu lesen; mit Gruppenlabel sucht das Auge
 * zuerst die Gruppe. Einstellungen gehoert zu keiner Gruppe und steht
 * unten beim Benutzerblock.
 */
export type MenueGruppeId = "arbeit" | "menschen" | "haus";

export const MENUE_GRUPPEN: { id: MenueGruppeId; label: string; reiter: HauptReiter[] }[] = [
  { id: "arbeit", label: "Arbeit", reiter: ["dashboard", "nachrichten", "kalender", "aufgaben"] },
  { id: "menschen", label: "Menschen", reiter: ["klienten", "mitarbeitende"] },
  { id: "haus", label: "Haus", reiter: ["standorte", "tagesberichte", "kassenbuch"] },
];

/** In welcher Gruppe ein Hauptpunkt steht; Einstellungen: keine. */
export function gruppeVon(wert: HauptReiter): MenueGruppeId | null {
  return MENUE_GRUPPEN.find((g) => g.reiter.includes(wert))?.id ?? null;
}

/**
 * Standard-/Ausgangsreihenfolge, falls (noch) keine eigene Reihenfolge
 * gespeichert ist, und Grundlage fuer "Standardreihenfolge
 * wiederherstellen" in den Einstellungen. Heute zuerst: der erste Blick nach
 * dem Einloggen ("Was muss ich jetzt tun?"). Die Reihenfolge gilt seit dem
 * Redesign INNERHALB der Gruppen (siehe reiterDerGruppe); die Liste bleibt
 * flach, damit das gespeicherte Format unveraendert bleibt.
 */
export const STANDARD_REITER: ReiterEintrag[] = [
  { wert: "dashboard", label: "Heute", icon: IDashboard },
  { wert: "nachrichten", label: "Nachrichten", icon: INachrichten },
  { wert: "kalender", label: "Kalender", icon: IKalender },
  { wert: "aufgaben", label: "Aufgaben", icon: IAufgaben },
  { wert: "klienten", label: "Klienten", icon: IKlienten },
  { wert: "mitarbeitende", label: "Mitarbeitende", icon: IMitarbeitende },
  { wert: "standorte", label: "Standorte", icon: IStandort },
  { wert: "tagesberichte", label: "Tagesberichte", icon: ITagesberichte },
  { wert: "kassenbuch", label: "Kassenbuch", icon: IKassenbuch },
  { wert: "einstellungen", label: "Einstellungen", icon: IEinstellungen },
];

const REIHENFOLGE_SPEICHER = "zimmerakte_menu_reihenfolge";

/**
 * Reine Anzeigepraeferenz dieses Geraets -- wie Theme und
 * Menueband-Einklappen (siehe Shell.tsx) gehoert das bewusst nicht in die
 * Datenbank und ist nach TTDSG §25 Abs. 2 einwilligungsfrei.
 */
export function ladeMenuReihenfolge(): HauptReiter[] {
  const alle = STANDARD_REITER.map((r) => r.wert);
  try {
    const roh = localStorage.getItem(REIHENFOLGE_SPEICHER);
    if (!roh) return alle;
    const gespeichert = JSON.parse(roh) as unknown;
    if (!Array.isArray(gespeichert)) return alle;
    const bekannt = new Set(alle);
    const bereinigt = gespeichert.filter(
      (w): w is HauptReiter => typeof w === "string" && bekannt.has(w as HauptReiter)
    );
    // Neu hinzugekommene Hauptpunkte (z.B. "Aufgaben" als eigener Punkt seit
    // dem Redesign), die in der gespeicherten Reihenfolge noch fehlen, haengen
    // ans Ende -- sonst waeren sie fuer alle mit bereits gespeicherter
    // Reihenfolge unsichtbar. Das ist zugleich die ganze Migration der alten
    // flachen Reihenfolge: jede Gruppe nimmt daraus nur ihre eigenen Punkte
    // in deren gespeicherter relativer Reihenfolge (reiterDerGruppe); wer
    // vorher "Kassenbuch vor Klienten" eingestellt hatte, behaelt das
    // innerhalb seiner jeweiligen Gruppe, was nicht mehr zusammenpasst,
    // faellt nicht auf, sondern ergibt schlicht die Gruppenreihenfolge.
    const fehlend = alle.filter((w) => !bereinigt.includes(w));
    return [...bereinigt, ...fehlend];
  } catch {
    return alle;
  }
}

export function speichereMenuReihenfolge(reihenfolge: HauptReiter[]) {
  try {
    localStorage.setItem(REIHENFOLGE_SPEICHER, JSON.stringify(reihenfolge));
  } catch {
    // Privatmodus ohne localStorage: Praeferenz gilt dann nur fuer diese Sitzung.
  }
}

export function reiterNachReihenfolge(reihenfolge: HauptReiter[]): ReiterEintrag[] {
  const nachWert = new Map(STANDARD_REITER.map((r) => [r.wert, r]));
  return reihenfolge.map((w) => nachWert.get(w)).filter((r): r is ReiterEintrag => r !== undefined);
}

/** Die Punkte EINER Gruppe in der gespeicherten Reihenfolge des Geraets. */
export function reiterDerGruppe(reihenfolge: HauptReiter[], gruppe: MenueGruppeId): ReiterEintrag[] {
  const mitglieder = MENUE_GRUPPEN.find((g) => g.id === gruppe)?.reiter ?? [];
  return reiterNachReihenfolge(reihenfolge.filter((w) => mitglieder.includes(w)));
}

/**
 * Ordnet innerhalb EINER Gruppe um, ohne die anderen Gruppen zu beruehren.
 * Die flache Liste behaelt dabei jeden Punkt an der Stelle seiner Gruppe.
 */
export function gruppeNeuOrdnen(
  reihenfolge: HauptReiter[],
  gruppe: MenueGruppeId,
  neueReihenfolgeDerGruppe: HauptReiter[]
): HauptReiter[] {
  const mitglieder = new Set(MENUE_GRUPPEN.find((g) => g.id === gruppe)?.reiter ?? []);
  const rest = [...neueReihenfolgeDerGruppe];
  return reihenfolge.map((w) => (mitglieder.has(w) ? (rest.shift() ?? w) : w));
}
