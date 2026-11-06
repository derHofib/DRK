import type { Plattform } from "./katzen-logik";

/**
 * Was die Katze von der Seite "sieht": die Oberkanten echter Elemente.
 * Bewusst eine Liste benannter Klassen statt "alles mit Rahmen": so bleibt
 * nachvollziehbar, worauf sie steigt, und ein neuer Seitenaufbau macht aus
 * Textzeilen keine Plattformen.
 */
const SELEKTOR = [
  ".zv-card",
  ".zv-kachel-karte",
  ".zv-kachel-stat",
  ".zv-info-karte",
  ".zv-karten-liste",
  ".zv-filterleiste",
  ".zv-seiten-kopf",
  ".zv-table",
  ".zv-liste-kopf",
  ".zv-etagen-kopf",
  ".zv-einstellungen-abschnitt",
  ".zv-uebergabe-block",
  ".zv-segmented",
  ".zv-btn",
  ".zv-field",
  ".zv-tabbar",
  ".zv-sidebar-inner a",
  ".zv-sidebar-inner button",
].join(",");

const MIN_BREITE = 110;
/** Die Katze ist ca. 77 px hoch: darunter ragt sie oben aus dem Fenster. */
const MIN_OBEN = 64;
const MIN_ABSTAND_BODEN = 40;

/** Hoehe (Viewport-y), auf der ihre Fuesse am Boden stehen: Fensterrand oder Oberkante der mobilen Tabbar. */
export function bodenY(vh: number): number {
  const tab = document.querySelector(".zv-tabbar");
  if (tab) {
    const r = tab.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.top > vh * 0.5 && r.top < vh) return r.top;
  }
  return vh - 6;
}

export function plattformGueltig(r: DOMRect, vh: number, boden: number): boolean {
  return r.width >= MIN_BREITE && r.top >= MIN_OBEN && r.top <= Math.min(vh - MIN_ABSTAND_BODEN, boden - 20);
}

export function plattformenSammeln(vw: number, vh: number): Plattform[] {
  const boden = bodenY(vh);
  const liste: Plattform[] = [{ x1: 0, x2: vw, y: boden, el: null }];
  // Offener Dialog: nur dessen Flaechen, sonst steht die Katze auf Dingen hinter dem Abdunkler.
  const wurzel = document.querySelector('[role="dialog"]') ?? document;
  for (const el of wurzel.querySelectorAll(SELEKTOR)) {
    if (el.closest(".zv-katze")) continue;
    const r = el.getBoundingClientRect();
    if (!plattformGueltig(r, vh, boden)) continue;
    liste.push({ x1: Math.max(r.left, 0), x2: Math.min(r.right, vw), y: r.top, el });
  }
  return liste;
}
