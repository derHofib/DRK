/**
 * Reine Rechenfunktionen der Begleit-Katze -- ohne DOM, damit die
 * Entscheidungen (wann geht sie weg, wohin, wie rollt das Spielzeug) an
 * einer Stelle stehen und die Komponente nur noch zeichnet.
 */

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  drehung: number;
  gezogen: boolean;
}

/** Abstand (px) vom Zeiger zur Katze, ab dem sie aufsteht und geht. */
export const FLUCHT_RADIUS = 110;

/** Abstand des Zeigers zum Rechteck der Katze (Fusspunkt am unteren Rand). */
export function zeigerAbstand(
  zeiger: { x: number; y: number },
  katzeX: number,
  breite: number,
  hoehe: number,
  vh: number,
): number {
  const dx = Math.max(katzeX - zeiger.x, 0, zeiger.x - (katzeX + breite));
  const dy = Math.max(vh - hoehe - zeiger.y, 0, zeiger.y - vh);
  return Math.hypot(dx, dy);
}

/**
 * Wohin die Katze vor dem Zeiger ausweicht: auf die Seite, die mehr Platz
 * bietet, mit deutlichem Abstand -- sonst steht sie beim naechsten
 * Mausruck wieder im Radius und laeuft im Kreis.
 */
export function fluchtziel(zeigerX: number, vw: number, breite: number): number {
  const rand = breite / 2 + 16;
  const abstand = 340;
  const ziel = zeigerX < vw / 2 ? zeigerX + abstand : zeigerX - abstand;
  return Math.min(Math.max(ziel, rand), vw - rand);
}

/** Zufallsziel mit Mindestweg, damit ein Spaziergang auch einer ist. */
export function spazierziel(mitte: number, vw: number, breite: number): number {
  const rand = breite / 2 + 20;
  for (let i = 0; i < 6; i++) {
    const z = rand + Math.random() * Math.max(vw - 2 * rand, 0);
    if (Math.abs(z - mitte) > 150) return z;
  }
  return Math.min(Math.max(mitte > vw / 2 ? rand : vw - rand, rand), vw - rand);
}

/** Ein Physikschritt: Schwerkraft, Abprall an Boden und Waenden, Rollreibung. */
export function ballSchritt(b: Ball, dt: number, vw: number, boden: number, r: number): void {
  b.vy += 1500 * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < r) {
    b.x = r;
    b.vx = Math.abs(b.vx) * 0.6;
  } else if (b.x > vw - r) {
    b.x = vw - r;
    b.vx = -Math.abs(b.vx) * 0.6;
  }
  if (b.y >= boden) {
    b.y = boden;
    b.vy = Math.abs(b.vy) > 120 ? -b.vy * 0.5 : 0;
    b.vx *= Math.pow(0.35, dt);
    if (Math.abs(b.vx) < 4) b.vx = 0;
  }
  b.drehung += ((b.vx * dt) / r) * (180 / Math.PI);
}
