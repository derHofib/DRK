/**
 * Gang der Katze als reine Rechnung (kein DOM): Fussbahnen und Zwei-Knochen-IK.
 * Konzept und Begruendung: /mnt/project-files/katze/bewegungskonzept.md
 *
 * Kern ist, dass die Phase mit dem zurueckgelegten WEG waechst, nicht mit
 * der Zeit. Ein Fuss in der Standphase wandert relativ zum Koerper genau so
 * schnell nach hinten, wie der Koerper vorankommt -- in der Welt steht er still.
 * Eine Beinschleife nach Uhr dagegen rutscht bei jeder Geschwindigkeit, die
 * nicht zufaellig passt (Eislauf-Effekt).
 */

export interface GangArt {
  /** Strecke (SVG-Einheiten) je voller Beinschleife. */
  schritt: number;
  /** Anteil der Schleife, in dem ein Fuss am Boden steht. */
  anteil: number;
  /** Hubhoehe der Pfote in der Schwungphase. */
  hub: number;
  /** Phasenversatz: hinten links, vorne links, hinten rechts, vorne rechts. */
  versatz: [number, number, number, number];
  /** Hoehe von Brust/Becken-Wippen je Schritt. */
  wippen: number;
}

/** Schritt: Reihenfolge hinten links, vorne links, hinten rechts, vorne rechts; immer 2-3 Pfoten am Boden. */
export const SCHRITT: GangArt = { schritt: 48, anteil: 0.65, hub: 7, versatz: [0, 0.25, 0.5, 0.75], wippen: 1.1 };
/** Trab: Diagonalpaare gemeinsam, kuerzere Standphase, deutlicheres Wippen. */
export const TRAB: GangArt = { schritt: 70, anteil: 0.45, hub: 9, versatz: [0, 0.5, 0.5, 0], wippen: 2.4 };

/** Fussversatz zur Ruhelage (dx) und Hubhoehe zu einer Phase 0..1. */
export function fussBahn(phase: number, g: GangArt): { dx: number; hebung: number } {
  const t = ((phase % 1) + 1) % 1;
  const stand = g.schritt * g.anteil;
  if (t < g.anteil) return { dx: stand / 2 - stand * (t / g.anteil), hebung: 0 };
  const s = (t - g.anteil) / (1 - g.anteil);
  const e = s * s * (3 - 2 * s);
  return { dx: -stand / 2 + stand * e, hebung: g.hub * Math.sin(Math.PI * s) };
}

/**
 * Zwei-Knochen-IK von der Huefte/Schulter (hx, hy) zum Fuss (fx, fy).
 * `knick` = +1: Knie zeigt nach hinten (Ellbogen vorne), -1: nach vorn (Knie hinten),
 * bezogen auf eine nach rechts blickende Katze.
 */
export function ik2(hx: number, hy: number, fx: number, fy: number, l1: number, l2: number, knick: 1 | -1) {
  let dx = fx - hx;
  let dy = fy - hy;
  let d = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2 - 0.01;
  if (d > max) {
    // Zu weit gestreckt: Fuss wird herangezogen statt das Bein zu verbiegen.
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const ux = dx / d;
  const uy = dy / d;
  return {
    kx: hx + a * ux + knick * h * -uy,
    ky: hy + a * uy + knick * h * ux,
    fx: hx + dx,
    fy: hy + dy,
  };
}

/** Gedaempfte Feder (Stauchen/Strecken): ein Schritt, gibt neue Position und Geschwindigkeit. */
export function feder(pos: number, vel: number, ziel: number, dt: number, steif = 240, daempfung = 16): [number, number] {
  const a = steif * (ziel - pos) - daempfung * vel;
  const v = vel + a * dt;
  return [pos + v * dt, v];
}
