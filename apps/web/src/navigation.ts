/**
 * Die Hauptmenüpunkte und ihre Reihenfolge -- zentral hier statt in
 * Shell.tsx, weil sowohl Shell.tsx (rendert die Navigation) als auch
 * Einstellungen.tsx (rendert den Reihenfolge-Editor) dieselbe Quelle
 * brauchen.
 */
import {
  IAufgaben,
  IDashboard,
  IEinstellungen,
  IKassenbuch,
  IKlienten,
  IMitarbeitende,
  ITagesberichte,
  IZimmer,
  type IconKomponente,
} from "./components/icons";

export type HauptReiter =
  | "dashboard"
  | "mitarbeitende"
  | "zimmer"
  | "klienten"
  | "kassenbuch"
  | "tagesberichte"
  | "aufgaben"
  | "einstellungen";

export type KlientenAnsicht = "aktiv" | "archiv" | "anwaerter";

export interface ReiterEintrag {
  wert: HauptReiter;
  label: string;
  icon: IconKomponente;
}

/**
 * Standard-/Ausgangsreihenfolge, falls (noch) keine eigene Reihenfolge
 * gespeichert ist, und Grundlage fuer "Standardreihenfolge
 * wiederherstellen" in den Einstellungen. Dashboard zuerst: der erste
 * Blick nach dem Einloggen, unabhaengig von der Aufrufhaeufigkeit im
 * Tagesbetrieb -- wer eine andere Reihenfolge will, stellt sie jetzt
 * selbst ein (Einstellungen > Darstellung).
 */
export const STANDARD_REITER: ReiterEintrag[] = [
  { wert: "dashboard", label: "Dashboard", icon: IDashboard },
  { wert: "klienten", label: "Klienten", icon: IKlienten },
  { wert: "tagesberichte", label: "Tagesberichte", icon: ITagesberichte },
  { wert: "kassenbuch", label: "Kassenbuch", icon: IKassenbuch },
  { wert: "aufgaben", label: "Aufgaben", icon: IAufgaben },
  { wert: "zimmer", label: "Zimmer", icon: IZimmer },
  { wert: "mitarbeitende", label: "Mitarbeitende", icon: IMitarbeitende },
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
    // Neu hinzugekommene Hauptpunkte (z.B. nach einem Update), die in der
    // gespeicherten Reihenfolge noch fehlen, haengen ans Ende -- sonst
    // waeren sie fuer alle mit bereits gespeicherter Reihenfolge unsichtbar.
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
