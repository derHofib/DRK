/**
 * Welche Dashboard-Kacheln angezeigt werden -- eine reine
 * Anzeigepraeferenz dieses Geraets, genau wie Theme und Menueband
 * (siehe theme/theme.ts, Shell.tsx). Deshalb im localStorage, nicht in
 * der Datenbank.
 *
 * Bewusst KEINE eigene Reihenfolge (kein Drag&Drop): die Reihenfolge ist
 * fest (WIDGET_REIHENFOLGE), nur Ein-/Ausblenden ist einstellbar. Fuer den
 * Anfang ist das die einfachere, robustere Loesung -- Drag&Drop bringt
 * eigene Barrierefreiheits- und Zustandsfragen mit, deren Nutzen hier noch
 * unbewiesen ist.
 */
export type WidgetId =
  | "zimmer"
  | "hzl"
  | "rechnungen"
  | "stornoantraege"
  | "mitarbeitende"
  | "kostenuebernahmen"
  | "tagesberichte";

export const WIDGET_REIHENFOLGE: WidgetId[] = [
  "zimmer",
  "hzl",
  "rechnungen",
  "stornoantraege",
  "mitarbeitende",
  "kostenuebernahmen",
  "tagesberichte",
];

export const WIDGET_LABEL: Record<WidgetId, string> = {
  zimmer: "Zimmer frei",
  hzl: "HZL diese Woche",
  rechnungen: "Offene Rechnungen",
  stornoantraege: "Offene Storno-Anträge",
  mitarbeitende: "Mitarbeitende",
  kostenuebernahmen: "Kostenübernahmen laufen bald aus",
  tagesberichte: "Klienten ohne aktuellen Tagesbericht",
};

/**
 * Nur diese sind fuer die Basisrolle standardmaessig ausgeblendet -- und das
 * ist eine Relevanz-Vorbelegung, keine Rechtesperre:
 * - "rechnungen" traegt eine ECHTE Serverrolle (PATCH /rechnungen/:id/status
 *   ist auf Bereichs-/Einrichtungsleitung beschraenkt, siehe
 *   rechnung.service.ts), das Betrachten der Zahl selbst aber nicht.
 * - "stornoantraege" traegt ebenfalls eine ECHTE Serverrolle (nur Bereichs-/
 *   Einrichtungsleitung entscheiden ueber einen Antrag, siehe
 *   ROLLEN_MIT_STORNO_ENTSCHEIDEN in kassenbuchung.service.ts) -- ein
 *   Betreuer sieht den Status seines eigenen Antrags ohnehin direkt in der
 *   Kassenbuch-Liste, diese Kachel ist die Bewilligungs-Uebersicht der
 *   Leitung.
 * - "mitarbeitende" hat ueberhaupt keine Sperre (GET /benutzer kennt keine
 *   Rollenpruefung) -- es ist nur fuer den Alltag eines Betreuers selten
 *   relevant.
 * Alle drei lassen sich ueber "Anpassen" jederzeit einblenden.
 */
const NUR_LEITUNG: WidgetId[] = ["rechnungen", "stornoantraege", "mitarbeitende"];

const SICHTBARKEIT_KEY = "zimmerakte_dashboard_sichtbarkeit";

export function standardSichtbarkeit(istLeitung: boolean): Record<WidgetId, boolean> {
  const eintraege = WIDGET_REIHENFOLGE.map((id) => [id, istLeitung || !NUR_LEITUNG.includes(id)] as const);
  return Object.fromEntries(eintraege) as Record<WidgetId, boolean>;
}

export function geleseneSichtbarkeit(istLeitung: boolean): Record<WidgetId, boolean> {
  const standard = standardSichtbarkeit(istLeitung);
  try {
    const roh = localStorage.getItem(SICHTBARKEIT_KEY);
    if (!roh) return standard;
    return { ...standard, ...JSON.parse(roh) };
  } catch {
    // Privatmodus ohne localStorage, oder kaputtes JSON: dann eben die Vorbelegung.
    return standard;
  }
}

/**
 * Gespeichert wird bewusst nur die ABWEICHUNG von der Rollen-Vorbelegung,
 * nicht der volle Zustand: dasselbe Geraet kann von Personen mit
 * unterschiedlicher Rolle genutzt werden (siehe Dateikopf), und ein voller
 * Schnappschuss wuerde beim naechsten Login mit einer anderen Rolle auch
 * die Werte der NICHT bewusst geaenderten Kacheln festschreiben -- z.B.
 * "mitarbeitende" faelschlich sichtbar fuer eine Person, deren
 * Rollen-Vorbelegung es eigentlich ausblendet.
 */
export function sichtbarkeitSpeichern(sichtbarkeit: Record<WidgetId, boolean>, istLeitung: boolean): void {
  const standard = standardSichtbarkeit(istLeitung);
  const abweichungen = Object.fromEntries(
    WIDGET_REIHENFOLGE.filter((id) => sichtbarkeit[id] !== standard[id]).map((id) => [id, sichtbarkeit[id]]),
  );
  try {
    if (Object.keys(abweichungen).length === 0) {
      localStorage.removeItem(SICHTBARKEIT_KEY);
    } else {
      localStorage.setItem(SICHTBARKEIT_KEY, JSON.stringify(abweichungen));
    }
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern --
    // die Auswahl gilt dann nur fuer diese Sitzung.
  }
}

export function sichtbarkeitZuruecksetzen(): void {
  try {
    localStorage.removeItem(SICHTBARKEIT_KEY);
  } catch {
    /* siehe oben */
  }
}
