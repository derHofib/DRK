import { ik2 } from "./katzen-gang";

/**
 * Das Skelett der Katze: aus einer Haltung (`Haltung`, reine Zahlen) wird in
 * jedem Frame die ganze Figur gerechnet und direkt in die SVG-Elemente
 * geschrieben (KatzenFigur.tsx liefert nur die leeren Huellen).
 *
 * Warum ein Skelett statt fertig gezeichneter Posen: zwischen zwei Zeichnungen
 * laesst sich nur ueberblenden -- die Katze "springt" dann vom Sitzen ins
 * Liegen. Zwischen zwei Haltungen laesst sich rechnen: sie SETZT sich, legt
 * sich, rollt sich ein. Und alles, was lebt (Atmen, Blick, Ohren, Schwanz),
 * ist dieselbe Zahlentabelle mit etwas Bewegung darauf.
 *
 * Einheiten: viewBox 160 x 100, die Katze blickt nach rechts, Boden auf y = 96.
 * Winkel in Grad im Bildschirmsinn: 0 = nach rechts, 90 = nach unten,
 * 180 = nach hinten, 270 = nach oben.
 */

export const BODEN = 96;

export interface Haltung {
  /** Becken und Brustkorb (Mittelpunkte). */
  hx: number;
  hy: number;
  sx: number;
  sy: number;
  /** Woelbung des Rueckens in der Mitte (+ = Buckel, - = Hohlkreuz). */
  bogen: number;
  /** Fuelle: 1 = stehend schlank, groesser = zusammengesunken (liegend). */
  rund: number;
  /** Kopf: Mitte und Neigung (Grad, + = Nase nach unten). */
  kx: number;
  ky: number;
  kw: number;
  /** 0 = Kopf im Profil, 1 = zum Betrachter gedreht. */
  dreh: number;
  /** Pfotenziele x,y: hinten nah, vorn nah, hinten fern, vorn fern. */
  fuss: number[];
  /** Mittelfuss hinten nah/fern: 0 = steht senkrecht, 90 = liegt flach nach hinten (Sitzen). */
  ferse: number[];
  /** Sichtbarkeit der Beine hinten/vorn (untergeschlagen = 0). */
  bein: number[];
  /** Fuenf Glieder des Schwanzes, absolute Winkel. */
  schwanz: number[];
  /** 0 = zu, 1 = offen. */
  auge: number;
  /** 0 = Schlitz, 1 = rund (Jagd, Schreck). */
  pupille: number;
  /** 0 = aufgestellt, 1 = angelegt. */
  ohr: number;
  /** 0 = zu, 1 = Gaehnen. */
  maul: number;
  /** Blickrichtung der Pupillen, je -1..1. */
  blickX: number;
  blickY: number;
}

export function mische(a: Haltung, b: Haltung, t: number): Haltung {
  const m = (x: number, y: number) => x + (y - x) * t;
  const ml = (x: number[], y: number[]) => x.map((v, i) => m(v, y[i]));
  return {
    hx: m(a.hx, b.hx),
    hy: m(a.hy, b.hy),
    sx: m(a.sx, b.sx),
    sy: m(a.sy, b.sy),
    bogen: m(a.bogen, b.bogen),
    rund: m(a.rund, b.rund),
    kx: m(a.kx, b.kx),
    ky: m(a.ky, b.ky),
    kw: m(a.kw, b.kw),
    dreh: m(a.dreh, b.dreh),
    fuss: ml(a.fuss, b.fuss),
    ferse: ml(a.ferse, b.ferse),
    bein: ml(a.bein, b.bein),
    schwanz: ml(a.schwanz, b.schwanz),
    auge: m(a.auge, b.auge),
    pupille: m(a.pupille, b.pupille),
    ohr: m(a.ohr, b.ohr),
    maul: m(a.maul, b.maul),
    blickX: m(a.blickX, b.blickX),
    blickY: m(a.blickY, b.blickY),
  };
}

type P = [number, number];

const f1 = (v: number) => v.toFixed(1);

/** Catmull-Rom zwischen p1 und p2. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

/** Glatte Kurve durch die Punkte (Catmull-Rom als kubische Bezier-Stuecke). */
function glatt(pts: P[], geschlossen: boolean): string {
  const n = pts.length;
  const at = (i: number): P => (geschlossen ? pts[((i % n) + n) % n] : pts[Math.min(Math.max(i, 0), n - 1)]);
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  const ende = geschlossen ? n : n - 1;
  for (let i = 0; i < ende; i++) {
    const a = at(i - 1);
    const b = at(i);
    const c = at(i + 1);
    const e = at(i + 2);
    d += `C${f1(b[0] + (c[0] - a[0]) / 6)} ${f1(b[1] + (c[1] - a[1]) / 6)} ${f1(c[0] - (e[0] - b[0]) / 6)} ${f1(c[1] - (e[1] - b[1]) / 6)} ${f1(c[0])} ${f1(c[1])}`;
  }
  return geschlossen ? d + "Z" : d;
}

/** Sich verjuengendes Glied zwischen zwei Gelenken (Kreis r1 um a, Kreis r2 um b). */
function glied(ax: number, ay: number, r1: number, bx: number, by: number, r2: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy) || 0.001;
  const nx = -dy / d;
  const ny = dx / d;
  return (
    `M${f1(ax + nx * r1)} ${f1(ay + ny * r1)}L${f1(bx + nx * r2)} ${f1(by + ny * r2)}` +
    `A${f1(r2)} ${f1(r2)} 0 0 0 ${f1(bx - nx * r2)} ${f1(by - ny * r2)}` +
    `L${f1(ax - nx * r1)} ${f1(ay - ny * r1)}A${f1(r1)} ${f1(r1)} 0 0 0 ${f1(ax + nx * r1)} ${f1(ay + ny * r1)}Z`
  );
}

// Stuetzstellen der Wirbelsaeule: Kruppe, Becken, Mitte, Brust, Hals, Kopfansatz.
// Radien getrennt fuer Ruecken (oben) und Bauch/Kehle (unten): die Brust ist tief, die Flanke zieht sich hoch.
const R_OBEN = [4.2, 9.6, 9.2, 9.8, 6.4, 5];
const R_UNTEN = [5, 10.4, 9.6, 11.6, 7.2, 5];
const JE_STUECK = 4;
const PROBEN = 5 * JE_STUECK + 1;

// Gliedlaengen (SVG-Einheiten)
const OBERSCHENKEL = 15;
const UNTERSCHENKEL = 16;
const MITTELFUSS = 10.5;
const OBERARM = 12;
const UNTERARM = 21;
const SCHWANZGLIED = 11;

interface BeinTeile {
  g: SVGGElement;
  oben: SVGPathElement;
  mitte: SVGPathElement;
  unten: SVGPathElement;
  socke: SVGPathElement;
  pfote: SVGEllipseElement;
}
interface Teile {
  koerper: SVGPathElement;
  clip: SVGPathElement;
  bauch: SVGPathElement;
  fleck: SVGEllipseElement;
  streifen: SVGPathElement[];
  beine: BeinTeile[];
  schwanz: SVGPathElement[];
  profil: SVGGElement;
  vorn: SVGGElement;
  ohren: SVGGElement[];
  augen: SVGGElement[];
  pupillen: SVGEllipseElement[];
  kiefer: SVGGElement;
  rachen: SVGElement[];
}

const cache = new WeakMap<Element, Teile>();

function teile(root: Element): Teile | null {
  let t = cache.get(root);
  if (t) return t;
  const q = <T extends Element>(s: string) => root.querySelector(s) as T | null;
  const alle = <T extends Element>(s: string) => [...root.querySelectorAll(s)] as T[];
  const beine: BeinTeile[] = [];
  for (let i = 0; i < 4; i++) {
    const g = q<SVGGElement>(`.k-b${i}`);
    if (!g) return null;
    beine.push({
      g,
      oben: g.querySelector(".k-b-oben") as SVGPathElement,
      mitte: g.querySelector(".k-b-mitte") as SVGPathElement,
      unten: g.querySelector(".k-b-unten") as SVGPathElement,
      socke: g.querySelector(".k-b-socke") as SVGPathElement,
      pfote: g.querySelector(".k-g-pfote") as SVGEllipseElement,
    });
  }
  const koerper = q<SVGPathElement>(".k-koerper");
  const clip = q<SVGPathElement>(".k-clip");
  const bauch = q<SVGPathElement>(".k-bauch");
  const fleck = q<SVGEllipseElement>(".k-fleck");
  const profil = q<SVGGElement>(".k-kopf-profil");
  const vorn = q<SVGGElement>(".k-kopf-vorn");
  const kiefer = q<SVGGElement>(".k-kiefer");
  if (!koerper || !clip || !bauch || !fleck || !profil || !vorn || !kiefer) return null;
  t = {
    koerper,
    clip,
    bauch,
    fleck,
    streifen: alle<SVGPathElement>(".k-streif"),
    beine,
    schwanz: alle<SVGPathElement>(".k-schwanz-teil"),
    profil,
    vorn,
    ohren: alle<SVGGElement>(".k-ohr-g"),
    augen: alle<SVGGElement>(".k-auge-g"),
    pupillen: alle<SVGEllipseElement>(".k-pupille"),
    kiefer,
    rachen: alle<SVGElement>(".k-rachen"),
  };
  cache.set(root, t);
  return t;
}

export function rigZeichnen(root: Element, h: Haltung) {
  const t = teile(root);
  if (!t) return;

  // --- Wirbelsaeule -------------------------------------------------------
  let ux = h.sx - h.hx;
  let uy = h.sy - h.hy;
  const laenge = Math.hypot(ux, uy) || 1;
  ux /= laenge;
  uy /= laenge;
  // "oben" bezogen auf den Rumpf
  const ox = uy;
  const oy = -ux;
  const stuetz: P[] = [
    [h.hx - ux * 8 - ox * 1.5, h.hy - uy * 8 - oy * 1.5],
    [h.hx, h.hy],
    [(h.hx + h.sx) / 2 + ox * h.bogen, (h.hy + h.sy) / 2 + oy * h.bogen],
    [h.sx, h.sy],
    [h.sx + (h.kx - h.sx) * 0.55, h.sy + (h.ky - h.sy) * 0.55],
    [h.kx, h.ky],
  ];
  const at = (i: number) => stuetz[Math.min(Math.max(i, 0), 5)];
  const rad = (r: number[], i: number) => r[Math.min(Math.max(i, 0), 5)];
  const px: number[] = [];
  const py: number[] = [];
  const ro: number[] = [];
  const ru: number[] = [];
  for (let i = 0; i < PROBEN; i++) {
    const s = Math.min(Math.floor(i / JE_STUECK), 4);
    const u = (i - s * JE_STUECK) / JE_STUECK;
    px.push(cr(at(s - 1)[0], at(s)[0], at(s + 1)[0], at(s + 2)[0], u));
    py.push(cr(at(s - 1)[1], at(s)[1], at(s + 1)[1], at(s + 2)[1], u));
    // Die Fuelle wirkt auf den Rumpf, nicht auf den Hals.
    const fuelle = i <= 3 * JE_STUECK ? h.rund : 1 + (h.rund - 1) * 0.4;
    ro.push(cr(rad(R_OBEN, s - 1), rad(R_OBEN, s), rad(R_OBEN, s + 1), rad(R_OBEN, s + 2), u) * fuelle);
    ru.push(cr(rad(R_UNTEN, s - 1), rad(R_UNTEN, s), rad(R_UNTEN, s + 1), rad(R_UNTEN, s + 2), u) * fuelle);
  }
  const grund = BODEN - 0.4;
  const oben: P[] = [];
  const unten: P[] = [];
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < PROBEN; i++) {
    const a = Math.max(i - 1, 0);
    const b = Math.min(i + 1, PROBEN - 1);
    let tx = px[b] - px[a];
    let ty = py[b] - py[a];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    nx.push(ty);
    ny.push(-tx);
    oben.push([px[i] + ty * ro[i], Math.min(py[i] - tx * ro[i], grund)]);
    // Was unter den Boden ragte, liegt auf: so wird aus dem Rumpf beim Sitzen und Liegen eine flache Unterseite.
    unten.push([px[i] - ty * ru[i], Math.min(py[i] + tx * ru[i], grund)]);
  }
  // In einer Biegung (Hals beim Sitzen und Liegen) kreuzen sich die Randpunkte der Innenseite.
  // Ein Randpunkt gilt deshalb nur, wenn er nicht im Kreis einer anderen Stuetzstelle liegt.
  const frei = (q: P, i: number): boolean => {
    for (let j = 0; j < PROBEN; j++) {
      if (Math.abs(j - i) < 2) continue;
      const r = Math.min(ro[j], ru[j]) * 0.96;
      const ex = q[0] - px[j];
      const ey = q[1] - py[j];
      if (ex * ex + ey * ey < r * r) return false;
    }
    return true;
  };
  const umriss: P[] = [];
  for (let i = 0; i < PROBEN; i++) if (frei(oben[i], i)) umriss.push(oben[i]);
  for (let i = PROBEN - 1; i >= 0; i--) if (frei(unten[i], i)) umriss.push(unten[i]);
  // Runde Kruppe: ohne diesen Punkt endet der Rumpf hinten wie abgeschnitten.
  umriss.push([px[0] + ny[0] * ro[0] * 1.1, Math.min(py[0] - nx[0] * ro[0] * 1.1 + 0.6, grund)]);
  const d = glatt(umriss, true);
  t.koerper.setAttribute("d", d);
  t.clip.setAttribute("d", d);

  // --- Weiss an Bauch, Brust und Kehle -------------------------------------
  // Tiefe des Weiss je Probe: 0 = nur die Unterkante, 1 = bis zur Wirbelsaeule, >1 darueber hinaus.
  const a0 = JE_STUECK; // ab dem Becken
  const innen: P[] = [];
  const rand: P[] = [];
  for (let i = a0; i < PROBEN; i++) {
    const u = (i - a0) / (PROBEN - 1 - a0);
    const tiefe = u < 0.5 ? 0.12 + 0.5 * Math.sin(Math.PI * u) : 0.62 + 0.75 * (u - 0.5) * 2;
    rand.push([unten[i][0] - nx[i] * 2, Math.min(unten[i][1] - ny[i] * 2 + 2, BODEN + 2)]);
    innen.push([px[i] - nx[i] * ru[i] * (1 - tiefe), Math.min(py[i] - ny[i] * ru[i] * (1 - tiefe), grund)]);
  }
  t.bauch.setAttribute("d", glatt(rand.concat(innen.reverse()), true));
  // Der weisse Fleck an der Schulter
  const fi = 2 * JE_STUECK + 2;
  t.fleck.setAttribute("cx", f1(px[fi] + nx[fi] * ro[fi] * 0.25));
  t.fleck.setAttribute("cy", f1(py[fi] + ny[fi] * ro[fi] * 0.25));
  t.fleck.setAttribute("transform", `rotate(${f1((Math.atan2(uy, ux) * 180) / Math.PI)} ${f1(px[fi])} ${f1(py[fi])})`);

  // --- Tigerstreifen: vom Ruecken herab, folgen jeder Biegung -------------
  for (let j = 0; j < t.streifen.length; j++) {
    const i = Math.min(2 + Math.round(j * 1.7), PROBEN - 6);
    const tief = 0.15 + 0.3 * ((j * 7) % 3) * 0.5;
    const ax = oben[i][0];
    const ay = oben[i][1];
    const bx = px[i] - nx[i] * ru[i] * tief;
    const by = py[i] - ny[i] * ru[i] * tief;
    // Leicht nach hinten gebogen, wie das Fell faellt.
    const cx = (ax + bx) / 2 - ny[i] * -2.4;
    const cy = (ay + by) / 2 + nx[i] * -2.4;
    t.streifen[j].setAttribute("d", `M${f1(ax)} ${f1(ay)}Q${f1(cx)} ${f1(cy)} ${f1(bx)} ${f1(Math.min(by, grund))}`);
  }

  // --- Beine ---------------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const hinten = i % 2 === 0;
    const fern = i >= 2;
    const b = t.beine[i];
    const sicht = h.bein[hinten ? 0 : 1];
    b.g.style.opacity = sicht >= 0.99 ? "" : sicht.toFixed(2);
    if (sicht < 0.02) continue;
    const tx = h.fuss[i * 2];
    const ty = h.fuss[i * 2 + 1];
    const v = fern ? 3 : 0;
    if (hinten) {
      const gx = h.hx - ux * 1 - ox * 3 + v;
      const gy = h.hy - uy * 1 - oy * 3 - (fern ? 1 : 0);
      const w = (h.ferse[fern ? 1 : 0] * Math.PI) / 180;
      const fx = tx - Math.sin(w) * MITTELFUSS;
      const fy = Math.min(ty - Math.cos(w) * MITTELFUSS, BODEN - 2.4);
      const k = ik2(gx, gy, fx, fy, OBERSCHENKEL, UNTERSCHENKEL, -1);
      b.oben.setAttribute("d", glied(gx, gy, 7.4, k.kx, k.ky, 4.3));
      b.mitte.setAttribute("d", glied(k.kx, k.ky, 4.3, k.fx, k.fy, 2.8));
      // Der Fuss folgt dem (ggf. herangezogenen) Sprunggelenk, damit das Bein nie abreisst.
      const zx = k.fx + Math.sin(w) * MITTELFUSS;
      const zy = k.fy + Math.cos(w) * MITTELFUSS;
      b.unten.setAttribute("d", glied(k.fx, k.fy, 2.8, zx, zy - 1.6, 2.4));
      b.socke.setAttribute("d", glied((k.fx + zx) / 2, (k.fy + zy - 1.6) / 2, 2.7, zx, zy - 1.6, 2.5));
      b.pfote.setAttribute("cx", f1(zx + 2.2));
      b.pfote.setAttribute("cy", f1(zy - 2));
    } else {
      const gx = h.sx + ux * 2 - ox * 1.5 + v * -1;
      const gy = h.sy + uy * 2 - oy * 1.5 - (fern ? 1 : 0);
      const k = ik2(gx, gy, tx - 1.2, ty - 3.4, OBERARM, UNTERARM, 1);
      b.oben.setAttribute("d", glied(gx, gy, 6.2, k.kx, k.ky, 3.8));
      b.mitte.setAttribute("d", "");
      b.unten.setAttribute("d", glied(k.kx, k.ky, 3.8, k.fx, k.fy, 2.5));
      const mx = k.kx + (k.fx - k.kx) * 0.6;
      const my = k.ky + (k.fy - k.ky) * 0.6;
      b.socke.setAttribute("d", glied(mx, my, 3.05, k.fx, k.fy, 2.6));
      b.pfote.setAttribute("cx", f1(k.fx + 2.6));
      b.pfote.setAttribute("cy", f1(k.fy + 1.4));
    }
  }

  // --- Schwanz -------------------------------------------------------------
  const sp: P[] = [[stuetz[0][0] + ox * 2.5, stuetz[0][1] + oy * 2.5]];
  for (let i = 0; i < 5; i++) {
    const w = (h.schwanz[i] * Math.PI) / 180;
    const vor = sp[i];
    sp.push([vor[0] + Math.cos(w) * SCHWANZGLIED, Math.min(vor[1] + Math.sin(w) * SCHWANZGLIED, BODEN - 2.8)]);
  }
  const sd = glatt(sp, false);
  for (const e of t.schwanz) e.setAttribute("d", sd);

  // --- Kopf ----------------------------------------------------------------
  const lage = `translate(${f1(h.kx)} ${f1(h.ky)}) rotate(${f1(h.kw)}) scale(1.08)`;
  t.profil.setAttribute("transform", lage);
  t.vorn.setAttribute("transform", `translate(${f1(h.kx - 1.5 * h.dreh)} ${f1(h.ky)}) rotate(${f1(h.kw * 0.5)}) scale(1.08)`);
  t.profil.style.opacity = h.dreh < 0.01 ? "" : (1 - h.dreh).toFixed(2);
  t.vorn.style.opacity = h.dreh.toFixed(2);
  t.vorn.style.visibility = h.dreh < 0.01 ? "hidden" : "";
  t.profil.style.visibility = h.dreh > 0.99 ? "hidden" : "";
  for (const o of t.ohren) {
    const s = Number(o.dataset.seite ?? "1");
    o.setAttribute("transform", `rotate(${f1(-h.ohr * 38 * s)} ${o.dataset.x} ${o.dataset.y})`);
  }
  const lid = Math.max(h.auge, 0.07);
  for (const a of t.augen) a.setAttribute("transform", `translate(${a.dataset.x} ${a.dataset.y}) scale(1 ${lid.toFixed(2)})`);
  for (const p of t.pupillen) {
    p.setAttribute("rx", (0.55 + 1.15 * h.pupille).toFixed(2));
    p.setAttribute("cx", (h.blickX * 0.7).toFixed(2));
    p.setAttribute("cy", (h.blickY * 0.4).toFixed(2));
  }
  t.kiefer.setAttribute("transform", `rotate(${f1(h.maul * 30)} 3.5 5.5)`);
  for (const r of t.rachen) {
    r.style.opacity = h.maul < 0.05 ? "0" : "1";
    if (r instanceof SVGEllipseElement) r.setAttribute("ry", (0.3 + 3.2 * h.maul).toFixed(2));
  }
}
