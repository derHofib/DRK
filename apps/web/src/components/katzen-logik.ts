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

/** Eine Oberflaeche, auf der die Katze stehen kann: Oberkante y von x1 bis x2 (Viewport-Koordinaten). */
export interface Plattform {
  x1: number;
  x2: number;
  y: number;
  /** null = Fensterboden. */
  el: Element | null;
}

export const GRAVITATION = 2200;
export const SPRUNG_REICHWEITE = 360;
export const SPRUNG_HOCH = 300;
export const SPRUNG_TIEF = 900;

export interface Sprung {
  /** Absprungpunkt auf der aktuellen Plattform. */
  start: number;
  ziel: Plattform;
  /** Landepunkt (x) auf dem Ziel. */
  landung: number;
}

/**
 * Anfangsgeschwindigkeit fuer eine Wurfparabel von (sx, sy) nach (lx, ly).
 * Die Flugzeit waechst, bis der Scheitel mindestens `bogen` px ueber dem
 * hoeheren Endpunkt liegt -- sonst wuerde sie wie auf Schienen gleiten statt
 * zu springen.
 */
export function sprungBahn(sx: number, sy: number, lx: number, ly: number, bogen = 22) {
  const dx = lx - sx;
  const dy = ly - sy; // positiv = Ziel liegt tiefer
  let T = Math.min(0.9, 0.42 + Math.abs(dx) / 800 + Math.max(0, -dy) / 900);
  for (; T < 1.6; T += 0.05) {
    const u = (0.5 * GRAVITATION * T * T - dy) / T; // Startgeschwindigkeit nach oben
    // u > 0: sie springt auch beim Hinabhuepfen erst ein Stueck nach oben, statt mit Wucht nach unten abzustossen.
    if (u > 0 && (u * u) / (2 * GRAVITATION) >= Math.max(0, -dy) + bogen) break;
  }
  return { T, vx: dx / T, vy: (dy - 0.5 * GRAVITATION * T * T) / T };
}

/**
 * Alle von `aktuell` aus erreichbaren Sprungziele, je Ziel hoechstens eines
 * pro Seite. Die Regel dahinter: Absprung und Landung liegen nie "durch" eine
 * der beiden Flaechen hindurch. Nach unten springt sie ueber die Kante und
 * landet neben der eigenen Plattform; nach oben springt sie von einem Punkt
 * neben dem Ziel und landet auf dessen naechster Kante. Sonst saehe es aus, als
 * liefe sie durch eine Kachel -- und die Landung wuerde sofort auf der
 * eigenen Plattform enden.
 */
export function sprungZiele(aktuell: Plattform, alle: Plattform[], tiefMax = SPRUNG_TIEF): Sprung[] {
  const rand = 14;
  const out: Sprung[] = [];
  for (const p of alle) {
    if (p.el === aktuell.el) continue;
    if (p.x2 - p.x1 < 2 * rand + 20) continue;
    const dy = p.y - aktuell.y;
    if (dy < -SPRUNG_HOCH || dy > tiefMax) continue;
    for (const s of [1, -1] as const) {
      const kante = s === 1 ? aktuell.x2 - rand : aktuell.x1 + rand;
      const nah = s === 1 ? p.x1 + rand : p.x2 - rand;
      let start = kante;
      let landung: number;
      if (dy < -5) {
        // Hinauf: neben dem Ziel abspringen (irgendwo auf der eigenen Plattform), auf dessen naechster Kante landen.
        const pKante = s === 1 ? p.x1 : p.x2;
        const ideal = pKante - s * 12;
        start = Math.min(Math.max(ideal, aktuell.x1 + rand), Math.max(aktuell.x1 + rand, aktuell.x2 - rand));
        if (s * (start - pKante) > -6) continue; // nur noch von innen erreichbar: ginge durch das Ziel hindurch
        landung = nah;
      } else {
        // Hinab oder gleiche Hoehe: ueber die Kante hinaus landen.
        landung = s === 1 ? Math.max(nah, kante + 10) : Math.min(nah, kante - 10);
      }
      if (landung < p.x1 + rand - 0.5 || landung > p.x2 - rand + 0.5) continue;
      if (Math.abs(landung - start) > SPRUNG_REICHWEITE) continue;
      // Kein Huepfen auf der Stelle (etwa auf ein Nachbarelement gleicher Oberkante): das sieht nach Zucken aus, nicht nach Springen.
      if (Math.abs(dy) < 40 && Math.abs(landung - start) < 60) continue;
      out.push({ start, ziel: p, landung });
    }
  }
  return out;
}

/** Ob die Katze beim Fallen/Springen auf einer Plattform aufsetzt (nur im Sinkflug). */
export function aufsetzer(fx: number, vorher: number, jetzt: number, alle: Plattform[]): Plattform | null {
  let best: Plattform | null = null;
  for (const p of alle) {
    if (fx < p.x1 || fx > p.x2) continue;
    if (p.y >= vorher - 0.5 && p.y <= jetzt + 0.5 && (best === null || p.y < best.y)) best = p;
  }
  return best;
}

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
