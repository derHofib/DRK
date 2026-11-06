import { type GangArt, fussBahn, ik2 } from "./katzen-gang";

/**
 * Schreibt die Gelenkstellung der gehenden Katze direkt in die SVG-Elemente
 * (PoseGehen in KatzenPosen.tsx). Direkt statt ueber React, weil sich jedes
 * Bein in jedem Frame aendert.
 */

export interface RigEingabe {
  phase: number;
  /** 0 = steht, 1 = voller Gang: blendet die Fuesse in die Standposition. */
  blend: number;
  art: GangArt;
  /** Zusatzdrehung des Kopfes (Grad). */
  kopf: number;
  /** Schwanzwinkel (Grad). */
  schwanz: number;
  /** 0..1 waehrend eines Patschers, sonst null. */
  patsch: number | null;
}

interface Bein {
  oben: SVGPathElement;
  unten: SVGPathElement;
  socke: SVGPathElement;
  pfote: SVGEllipseElement;
}
interface Teile {
  beine: Bein[];
  koerper: SVGGElement;
  kopf: SVGGElement;
  schwanz: SVGGElement;
}

const cache = new WeakMap<Element, Teile>();

// Reihenfolge wie GangArt.versatz: hinten links, vorne links, hinten rechts, vorne rechts (links = nah).
const HUEFTE_X = [44, 104, 44, 104];
const RUHE_X = [44, 106, 54, 98];
const HUEFTE_Y = 58;
const BODEN = 95;
const L = 23;

function teile(root: Element): Teile | null {
  let t = cache.get(root);
  if (t) return t;
  const beine: Bein[] = [];
  for (let i = 0; i < 4; i++) {
    const g = root.querySelector(`.k-g-b${i}`);
    if (!g) return null;
    beine.push({
      oben: g.querySelector(".k-g-oben") as SVGPathElement,
      unten: g.querySelector(".k-g-unten") as SVGPathElement,
      socke: g.querySelector(".k-g-socke") as SVGPathElement,
      pfote: g.querySelector(".k-g-pfote") as SVGEllipseElement,
    });
  }
  const koerper = root.querySelector(".k-g-koerper") as SVGGElement | null;
  const kopf = root.querySelector(".k-g-kopf") as SVGGElement | null;
  const schwanz = root.querySelector(".k-g-schwanz") as SVGGElement | null;
  if (!koerper || !kopf || !schwanz) return null;
  t = { beine, koerper, kopf, schwanz };
  cache.set(root, t);
  return t;
}

export function rigAktualisieren(root: Element, e: RigEingabe) {
  const t = teile(root);
  if (!t) return;
  const bob = e.art.wippen * 0.5 * Math.cos(4 * Math.PI * e.phase + 0.6) * e.blend;
  const nick = 1.4 * Math.sin(2 * Math.PI * e.phase + 0.3) * e.blend;
  t.koerper.setAttribute("transform", `translate(0 ${bob.toFixed(2)}) rotate(${nick.toFixed(2)} 70 56)`);
  t.kopf.setAttribute(
    "transform",
    `translate(124 45) rotate(${(8 + e.kopf + 3 * Math.sin(4 * Math.PI * e.phase - 0.9) * e.blend).toFixed(2)}) scale(.95)`,
  );
  t.schwanz.setAttribute("transform", `rotate(${e.schwanz.toFixed(2)} 32 52)`);

  for (let i = 0; i < 4; i++) {
    const p = fussBahn(e.phase + e.art.versatz[i], e.art);
    let fx = RUHE_X[i] + p.dx * e.blend;
    let fy = BODEN - p.hebung * e.blend;
    if (i === 1 && e.patsch !== null) {
      const s = Math.sin(Math.PI * e.patsch);
      fx = RUHE_X[1] + 14 * s;
      fy = BODEN - 30 * s;
    }
    const hy = HUEFTE_Y + bob;
    const k = ik2(HUEFTE_X[i], hy, fx, fy, L, L, i % 2 === 0 ? -1 : 1);
    const b = t.beine[i];
    b.oben.setAttribute("d", `M${HUEFTE_X[i]} ${hy.toFixed(1)} L${k.kx.toFixed(1)} ${k.ky.toFixed(1)}`);
    b.unten.setAttribute("d", `M${k.kx.toFixed(1)} ${k.ky.toFixed(1)} L${k.fx.toFixed(1)} ${k.fy.toFixed(1)}`);
    const sx = k.kx + (k.fx - k.kx) * 0.5;
    const sy = k.ky + (k.fy - k.ky) * 0.5;
    b.socke.setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)} L${k.fx.toFixed(1)} ${k.fy.toFixed(1)}`);
    b.pfote.setAttribute("cx", (k.fx + 2).toFixed(1));
    b.pfote.setAttribute("cy", (k.fy + 0.5).toFixed(1));
  }
}
