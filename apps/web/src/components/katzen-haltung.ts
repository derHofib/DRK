import { type GangArt, fussBahn } from "./katzen-gang";
import { type Haltung, mische } from "./katzen-rig";

/**
 * Die Haltungen der Katze als Zahlentabellen (siehe katzen-rig.ts fuer die
 * Bedeutung der Felder) und die Bewegungen, die darauf liegen: Gang, Atmen,
 * Putzen, Strecken. Alles reine Rechnung ohne DOM.
 *
 * Die Werte sind am Bild abgestimmt (Galerie aller Haltungen im Browser),
 * nicht aus einer Anatomietafel abgeleitet.
 */

const BASIS: Haltung = {
  hx: 46,
  hy: 58,
  sx: 97,
  sy: 59,
  bogen: -0.8,
  rund: 1,
  kx: 119,
  ky: 47,
  kw: 8,
  dreh: 0,
  fuss: [42, 96, 100, 96, 50, 96, 94, 96],
  ferse: [14, 14],
  bein: [1, 1],
  schwanz: [195, 168, 150, 158, 188],
  auge: 1,
  pupille: 0.2,
  ohr: 0,
  maul: 0,
  blickX: 0,
  blickY: 0,
};

function mit(a: Partial<Haltung>): Haltung {
  return { ...BASIS, ...a };
}

export type HaltungsName =
  | "stehen"
  | "sitzen"
  | "brotlaib"
  | "sphinx"
  | "eingerollt"
  | "lauern"
  | "strecken"
  | "nachstrecken"
  | "buckel"
  | "flugAuf"
  | "flugAb"
  | "putzen"
  | "waschen"
  | "schleichen";

export const HALTUNG: Record<HaltungsName, Haltung> = {
  stehen: BASIS,
  /** Aufrecht, Schwanz um die Pfoten gelegt, Blick zum Betrachter. */
  sitzen: mit({
    hx: 55,
    hy: 85,
    sx: 85,
    sy: 60,
    bogen: 3,
    kx: 94,
    ky: 36,
    kw: 0,
    dreh: 1,
    fuss: [69, 96, 93, 96, 73, 96, 98, 96],
    ferse: [88, 88],
    schwanz: [112, 45, 8, 0, -12],
  }),
  /** Brotlaib: Pfoten untergeschlagen, Kopf oben. */
  brotlaib: mit({
    hx: 52,
    hy: 84,
    sx: 87,
    sy: 81,
    bogen: 2.5,
    rund: 1.24,
    kx: 100,
    ky: 63,
    kw: 0,
    dreh: 1,
    fuss: [60, 96, 96, 96, 64, 96, 100, 96],
    ferse: [88, 88],
    bein: [0, 0],
    schwanz: [105, 40, 5, 0, -8],
    auge: 0.55,
  }),
  /** Liegt wach auf dem Bauch, Vorderbeine nach vorn. */
  sphinx: mit({
    hx: 46,
    hy: 86,
    sx: 88,
    sy: 83,
    bogen: 1,
    rund: 1.06,
    kx: 106,
    ky: 66,
    kw: 4,
    dreh: 0,
    fuss: [60, 96, 118, 96, 64, 96, 113, 96],
    ferse: [88, 88],
    bein: [0, 1],
    schwanz: [150, 170, 185, 175, 160],
  }),
  /** Zur Kugel gerollt, Nase am Schwanz. */
  eingerollt: mit({
    hx: 54,
    hy: 85,
    sx: 84,
    sy: 86,
    bogen: 5,
    rund: 1.22,
    kx: 100,
    ky: 86,
    kw: 24,
    dreh: 0,
    fuss: [60, 96, 96, 96, 64, 96, 100, 96],
    ferse: [88, 88],
    bein: [0, 0],
    schwanz: [105, 40, 4, -4, -22],
    auge: 0,
    ohr: 0.25,
  }),
  /** Geduckt vor dem Sprung: Brust tief, Blick fest, alles gespannt. */
  lauern: mit({
    hx: 44,
    hy: 73,
    sx: 92,
    sy: 78,
    kx: 114,
    ky: 71,
    kw: 2,
    fuss: [44, 96, 103, 96, 52, 96, 97, 96],
    ferse: [34, 34],
    schwanz: [172, 178, 184, 180, 172],
    pupille: 1,
    ohr: 0.1,
  }),
  /** Katzenbuckel andersherum: Brust am Boden, Hinterteil oben, Vorderpfoten weit vor. */
  strecken: mit({
    hx: 46,
    hy: 56,
    sx: 93,
    sy: 81,
    bogen: -3,
    kx: 113,
    ky: 77,
    kw: -14,
    fuss: [42, 96, 125, 96, 50, 96, 119, 96],
    schwanz: [232, 252, 268, 282, 300],
    auge: 0.25,
    ohr: 0.35,
  }),
  /** Zweiter Teil des Streckens: nach vorn gelehnt, ein Hinterbein lang nach hinten. */
  nachstrecken: mit({
    hx: 54,
    hy: 60,
    sx: 104,
    sy: 57,
    bogen: -2,
    kx: 126,
    ky: 44,
    kw: -4,
    fuss: [20, 95, 106, 96, 56, 96, 100, 96],
    ferse: [78, 10],
    schwanz: [215, 240, 262, 275, 290],
    auge: 0.5,
  }),
  /** Erschrocken: Buckel, hohe Beine, Ohren angelegt. */
  buckel: mit({
    hx: 54,
    hy: 59,
    sx: 89,
    sy: 60,
    bogen: 13,
    kx: 106,
    ky: 60,
    kw: 22,
    fuss: [55, 96, 90, 96, 61, 96, 85, 96],
    ferse: [4, 4],
    schwanz: [238, 262, 276, 282, 268],
    pupille: 1,
    ohr: 1,
  }),
  /** Absprung und Steigflug: lang gestreckt. */
  flugAuf: mit({
    hx: 42,
    hy: 63,
    sx: 95,
    sy: 55,
    kx: 118,
    ky: 45,
    kw: -4,
    fuss: [18, 82, 126, 60, 25, 85, 121, 66],
    ferse: [62, 62],
    schwanz: [182, 178, 174, 170, 164],
    pupille: 0.8,
  }),
  /** Sinkflug: Vorderpfoten suchen den Boden, Hinterbeine angezogen, Schwanz haelt die Balance. */
  flugAb: mit({
    hx: 44,
    hy: 55,
    sx: 95,
    sy: 63,
    kx: 115,
    ky: 60,
    kw: 16,
    fuss: [50, 84, 117, 91, 57, 86, 111, 93],
    ferse: [40, 40],
    schwanz: [212, 232, 250, 262, 268],
    pupille: 0.8,
  }),
  /** Sitzend die Pfote lecken. */
  putzen: mit({
    hx: 55,
    hy: 85,
    sx: 85,
    sy: 60,
    bogen: 3,
    kx: 97,
    ky: 42,
    kw: 30,
    dreh: 0,
    fuss: [73, 96, 104, 53, 77, 96, 98, 96],
    ferse: [88, 88],
    schwanz: [118, 55, 12, 0, -12],
    auge: 0.1,
  }),
  /** Mit der feuchten Pfote ueber Gesicht und Ohr. */
  waschen: mit({
    hx: 55,
    hy: 85,
    sx: 85,
    sy: 60,
    bogen: 3,
    kx: 96,
    ky: 40,
    kw: 18,
    dreh: 0,
    fuss: [73, 96, 103, 36, 77, 96, 98, 96],
    ferse: [88, 88],
    schwanz: [118, 55, 12, 0, -12],
    auge: 0,
    ohr: 0.5,
  }),
  /** Anschleichen: tief, lang, Kopf auf Rueckenhoehe. */
  schleichen: mit({
    hx: 45,
    hy: 67,
    sx: 95,
    sy: 69,
    kx: 118,
    ky: 62,
    kw: 4,
    schwanz: [176, 172, 168, 172, 180],
    pupille: 0.9,
  }),
};

/** Ruhelage der vier Pfoten im Gang (x), Reihenfolge wie GangArt.versatz. */
const RUHE_X = [42, 100, 50, 94];

/**
 * Gang auf einer Grundhaltung (stehen, schleichen): Pfoten laufen ihre Bahn,
 * Becken und Brust wippen, der Kopf nickt mit etwas Nachlauf.
 * `blend` 0 = steht, 1 = voller Gang.
 */
export function gangHaltung(grund: Haltung, phase: number, blend: number, art: GangArt): Haltung {
  const h = { ...grund, fuss: grund.fuss.slice(), ferse: grund.ferse.slice() };
  const wipp = art.wippen * 0.5 * blend;
  // Becken und Brust heben sich je Seitenwechsel, die Brust eine Viertelphase voraus.
  h.hy += wipp * Math.cos(4 * Math.PI * phase + 0.6);
  h.sy += wipp * Math.cos(4 * Math.PI * phase + 0.6 + Math.PI / 2);
  h.ky += wipp * 0.8 * Math.cos(4 * Math.PI * phase - 0.3);
  h.kw += 2.2 * blend * Math.sin(4 * Math.PI * phase - 0.9);
  for (let i = 0; i < 4; i++) {
    const p = fussBahn(phase + art.versatz[i], art);
    h.fuss[i * 2] = RUHE_X[i] + (grund.fuss[i * 2] - BASIS.fuss[i * 2]) + p.dx * blend;
    h.fuss[i * 2 + 1] = 96 - p.hebung * blend;
    // In der Schwungphase klappt der Hinterfuss nach hinten weg, statt senkrecht zu schweben.
    if (i % 2 === 0) h.ferse[i / 2] = grund.ferse[i / 2] + (p.hebung / art.hub) * 34 * blend;
  }
  return h;
}

/** Weiches An- und Abschwellen 0..1..0 ueber t in 0..1. */
export function glocke(t: number): number {
  return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) ** 2;
}

export function weich(t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
}

/** Stueckweise weiche Folge von Haltungen: [Zeitpunkt, Haltung] aufsteigend. */
function spur(t: number, folge: [number, Haltung][]): Haltung {
  if (t <= folge[0][0]) return folge[0][1];
  for (let i = 1; i < folge.length; i++) {
    if (t < folge[i][0]) {
      const [t0, a] = folge[i - 1];
      const [t1, b] = folge[i];
      return mische(a, b, weich((t - t0) / (t1 - t0)));
    }
  }
  return folge[folge.length - 1][1];
}

/**
 * Aufwachen, wie Katzen es tun: Kopf heben, aufstehen, erst vorn tief
 * strecken, dann nach vorn lehnen und ein Hinterbein lang machen.
 */
export const AUFWACH_DAUER = 5.6;
export function aufwachHaltung(t: number): Haltung {
  return spur(t, [
    [0, HALTUNG.eingerollt],
    [0.8, HALTUNG.sphinx],
    [1.5, HALTUNG.sphinx],
    [2.2, HALTUNG.stehen],
    [2.8, HALTUNG.strecken],
    [3.7, HALTUNG.strecken],
    [4.3, HALTUNG.nachstrecken],
    [4.9, HALTUNG.nachstrecken],
    [AUFWACH_DAUER, HALTUNG.stehen],
  ]);
}

/** Nur das Strecken (nach laengerem Sitzen oder Liegen). */
export const STRECK_DAUER = 3.2;
export function streckHaltung(t: number): Haltung {
  return spur(t, [
    [0, HALTUNG.stehen],
    [0.6, HALTUNG.strecken],
    [1.6, HALTUNG.strecken],
    [2.1, HALTUNG.nachstrecken],
    [2.7, HALTUNG.nachstrecken],
    [STRECK_DAUER, HALTUNG.stehen],
  ]);
}

/**
 * Putzen in zwei Teilen, die sich abwechseln: Pfote lecken (kurze Serien mit
 * Pausen), dann mit der Pfote ueber Gesicht und Ohr.
 */
const PUTZ_RUNDE = 6.4;
export function putzHaltung(t: number): Haltung {
  const u = t % PUTZ_RUNDE;
  const waschAnteil = weich((u - 3.4) / 0.4) * (1 - weich((u - 6.0) / 0.4));
  const lecken = mit({ ...HALTUNG.putzen, fuss: HALTUNG.putzen.fuss.slice() });
  // Serien: 1,1 s lecken, 0,5 s Pause
  const serie = (u % 1.6) / 1.6;
  const aktiv = serie < 0.7 ? Math.sin((serie / 0.7) * Math.PI) : 0;
  const zunge = Math.sin(u * 2 * Math.PI * 3.1) * aktiv;
  lecken.ky += zunge * 1.3;
  lecken.kw += zunge * 4;
  lecken.fuss[3] -= zunge * 1.2;
  if (waschAnteil <= 0) return lecken;
  const wisch = mit({ ...HALTUNG.waschen, fuss: HALTUNG.waschen.fuss.slice() });
  // Die Pfote faehrt von hinter dem Ohr nach vorn unten ueber das Gesicht.
  const zug = (Math.sin((u - 3.4) * 2 * Math.PI * 1.25 - Math.PI / 2) + 1) / 2;
  wisch.fuss[2] += zug * 3;
  wisch.fuss[3] += zug * 13;
  wisch.kw += zug * 8;
  wisch.ohr = 0.6 - zug * 0.4;
  return mische(lecken, wisch, waschAnteil);
}

/** Treteln (Milchtritt) vor dem Hinlegen: geduckt, die Vorderpfoten treten abwechselnd. */
export function tretelHaltung(t: number): Haltung {
  const h = mische(HALTUNG.stehen, HALTUNG.lauern, 0.45);
  const tritt = Math.sin(t * 2 * Math.PI * 1.5);
  h.fuss[3] = 96 - 4.5 * Math.max(0, tritt);
  h.fuss[7] = 96 - 4.5 * Math.max(0, -tritt);
  h.sy += 0.8 * Math.abs(tritt);
  h.ky += 5;
  h.kw = 20;
  h.auge = 0.35;
  h.pupille = 0.2;
  h.schwanz = HALTUNG.stehen.schwanz.slice();
  return h;
}

/** Geduckt vor dem Sprung; `wackeln` 0..1 ist das beruehmte Hinterteil-Wackeln kurz vor dem Absprung. */
export function lauerHaltung(t: number, wackeln: number): Haltung {
  if (wackeln <= 0) return HALTUNG.lauern;
  const h = { ...HALTUNG.lauern };
  h.hx += wackeln * 1.5 * Math.sin(t * 36);
  h.hy -= wackeln * 0.8 * Math.abs(Math.sin(t * 36));
  return h;
}

/** Ein Pfotenhieb der nahen Vorderpfote zum Ziel (tx, ty in Figur-Einheiten); p laeuft 0..1. */
export function mitPfotenhieb(grund: Haltung, p: number, tx: number, ty: number): Haltung {
  const s = Math.sin(Math.PI * Math.min(Math.max(p, 0), 1));
  const h = { ...grund, fuss: grund.fuss.slice() };
  h.fuss[2] += (tx - h.fuss[2]) * s;
  h.fuss[3] += (ty - h.fuss[3]) * s;
  h.kw += 6 * s;
  return h;
}
