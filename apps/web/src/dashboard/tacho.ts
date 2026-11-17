/**
 * Rechnung fuer die Auslastungs-Kachel (Tacho) auf Heute -- bewusst als
 * reine Funktionen ohne React, damit sich Prozent, Winkel und Farbton
 * ohne Browser pruefen lassen (scripts/tacho-pruefung.mjs).
 *
 * Gerechnet wird mit PLAETZEN (Summe der Zimmerkapazitaeten aus
 * GET /dashboard), nicht mit Zimmern: ein halb belegtes Doppelzimmer ist
 * fuer die Aufnahme ein freier Platz, kein volles Zimmer.
 */

export interface Auslastung {
  belegt: number;
  gesamt: number;
  /** 0..1, ungerundet -- fuer die Geometrie. */
  anteil: number;
  /** Ganze Prozent -- fuer Text und Screenreader. */
  prozent: number;
}

export function auslastungBerechnen(gesamt: number, frei: number): Auslastung {
  const g = Math.max(0, gesamt);
  // frei kann nie ueber gesamt liegen; falls doch (z. B. Kapazitaet gerade
  // gesenkt), lieber 0 % zeigen als einen negativen Bogen.
  const belegt = Math.min(g, Math.max(0, g - frei));
  // Ohne Plaetze gibt es nichts auszulasten: 0 statt NaN.
  const anteil = g === 0 ? 0 : belegt / g;
  return { belegt, gesamt: g, anteil, prozent: Math.round(anteil * 100) };
}

/**
 * Dreiviertelkreis wie bei einem Tacho: unten offen, damit 0 und 100 %
 * nicht am selben Punkt liegen. Winkel in Grad, im Uhrzeigersinn ab
 * 12 Uhr gemessen.
 */
export const TACHO_START_GRAD = -135;
export const TACHO_BOGEN_GRAD = 270;

export function tachoWinkel(anteil: number): number {
  const a = Math.min(1, Math.max(0, anteil));
  return TACHO_START_GRAD + a * TACHO_BOGEN_GRAD;
}

export function tachoPunkt(cx: number, cy: number, r: number, grad: number): { x: number; y: number } {
  const rad = (grad * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/** SVG-Pfad eines Kreisbogens von `vonGrad` bis `bisGrad` (im Uhrzeigersinn). */
export function bogenPfad(cx: number, cy: number, r: number, vonGrad: number, bisGrad: number): string {
  const a = tachoPunkt(cx, cy, r, vonGrad);
  const b = tachoPunkt(cx, cy, r, bisGrad);
  const gross = bisGrad - vonGrad > 180 ? 1 : 0;
  const f = (n: number) => Number(n.toFixed(3));
  return `M ${f(a.x)} ${f(a.y)} A ${r} ${r} 0 ${gross} 1 ${f(b.x)} ${f(b.y)}`;
}

/**
 * Farbton (OKLCH-Hue) an einer Stelle der Skala: Gruen bei 0 % (Platz
 * frei), Rot bei 100 % (Haus voll), dazwischen ueber Gelb/Orange.
 *
 * NUR der Farbton kommt aus dem JavaScript. Helligkeit und Buntheit stehen
 * fest im CSS (.zv-tacho-segment) -- dieselbe Aufteilung wie bei Akzent-
 * und Personenfarbe (CLAUDE.md, Regel 7), damit der Kontrast gegen die
 * Kachelflaeche bei jedem Wert konstruktiv haelt.
 */
export const TACHO_HUE_FREI = 145;
export const TACHO_HUE_VOLL = 25;

export function tachoFarbton(anteil: number): number {
  const a = Math.min(1, Math.max(0, anteil));
  return TACHO_HUE_FREI + (TACHO_HUE_VOLL - TACHO_HUE_FREI) * a;
}
