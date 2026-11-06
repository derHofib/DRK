import { useEffect, useRef, useState } from "react";
import {
  type Ball,
  type Plattform,
  type Sprung,
  FLUCHT_RADIUS,
  GRAVITATION,
  aufsetzer,
  ballSchritt,
  sprungBahn,
  sprungZiele,
  zeigerAbstand,
} from "./katzen-logik";
import { SCHRITT, TRAB, feder } from "./katzen-gang";
import { rigAktualisieren } from "./katzen-rig";
import { bodenY, plattformGueltig, plattformenSammeln } from "./katzen-umwelt";
import { type MutableRefObject } from "react";
import { PoseBrotlaib, PoseGehen, PoseHocke, PosePutzen, PoseRuecken, PoseSchlafen, PoseSitzen, PoseSprung, Wollknaeuel } from "./KatzenPosen";

/**
 * Easter Eggs: eine Begleit-Katze, die auf der Seite herumklettert, und ein Wollknaeuel.
 *
 *   Alt+Umschalt+K   Katze erscheint / geht wieder
 *   Alt+Umschalt+S   Wollknaeuel (Spielzeug) erscheint / verschwindet
 *
 * Spezifikation: /mnt/project-files/katze/spezifikation-katze.md (Dennis, Fotos seiner Katze).
 *
 * Bewusste Entscheidungen:
 *  - Die Seite ist ihr Kletterbaum: Oberkanten echter Elemente (Karten,
 *    Kacheln, Filterleiste, Tabbar ...) sind Plattformen (katzen-umwelt.ts).
 *    Zwischen Plattformen laeuft sie nie, sie springt -- Gehen gibt es nur
 *    auf einer Plattform. Verschwindet oder scrollt die Plattform weg, faellt
 *    sie auf die naechste darunter; beim Scrollen faehrt sie auf ihrer
 *    Kachel mit (die Kante wird jeden Frame neu gelesen).
 *  - Tasten ueber `event.code`: auf dem Mac erzeugt Option ein Sonderzeichen,
 *    `event.key` waere dort nicht "k". In Eingabefeldern passiert nie etwas.
 *  - Kommt der Mauszeiger in ihre Naehe, steht sie auf und weicht auf eine
 *    entfernte Plattform aus -- sie soll nie etwas verdecken, das man gerade
 *    bedienen will. Haelt man das Spielzeug in der Hand, bleibt sie.
 *  - Die Schleife schreibt Positionen direkt ins DOM; React rendert nur bei
 *    Wechsel der Pose.
 *  - Kein Fremd-Asset, kein Ton. `pointer-events: none` ausser auf dem
 *    Wollknaeuel; `aria-hidden`.
 *  - prefers-reduced-motion: die Katze sitzt still am Boden und weicht dem
 *    Zeiger per Sprung-Schnitt aus; das Spielzeug folgt nur der Hand.
 *  - Der Zustand lebt in sessionStorage: ein Neuladen im selben Tab behaelt
 *    die Katze, ein neuer Tab beginnt ohne sie.
 */

const KW = 128; // Anzeigebreite der Katze (px)
const FUSS = 77; // Abstand Oberkante Katze -> Fusslinie (96 % von 80 px)
const BALL_R = 16;
const RAND = 14;

type Pose =
  | "gehen"
  | "laufen"
  | "sitzen"
  | "putzen"
  | "brotlaib"
  | "schlafen"
  | "ruecken"
  | "hocke"
  | "sprung"
  | "patschen";
type Modus =
  | "idle"
  | "gehen"
  | "anlauf"
  | "hocke"
  | "flug"
  | "landen"
  | "aufstehen"
  | "flucht"
  | "ruhen"
  | "jagen"
  | "patschen";

interface KatzenZustand {
  fx: number; // Fussmitte (Viewport-x)
  fy: number; // Fusslinie (Viewport-y)
  richtung: 1 | -1;
  pose: Pose;
  modus: Modus;
  timer: number;
  plat: Plattform;
  ziel: number;
  v: number; // aktuelle Gehgeschwindigkeit (weich anfahren und abbremsen)
  vx: number;
  vy: number;
  plan: Sprung | null;
  hockeZeit: number;
  anlaufTempo: number;
  liegenGeplant: boolean;
  abkuehlung: number;
  patschPause: number;
  gekickt: boolean;
  spielzeit: number;
  uninteressiert: number;
  neigung: number;
  phase: number; // Gangphase, waechst mit dem Weg (siehe katzen-gang.ts)
  blend: number; // 0 steht .. 1 voller Gang
  bewegt: boolean;
  zeit: number;
  sicht: number; // sichtbare Blickrichtung, dreht weich von -1 nach 1
  sx: number;
  sy: number;
  vsx: number;
  vsy: number;
  tailKick: number;
}

function inEingabefeld(ziel: EventTarget | null): boolean {
  if (!(ziel instanceof HTMLElement)) return false;
  return ziel.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(ziel.tagName);
}

function reduziert(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function lesen(schluessel: string): boolean {
  try {
    return sessionStorage.getItem(schluessel) === "1";
  } catch {
    return false;
  }
}

function merken(schluessel: string, an: boolean) {
  try {
    if (an) sessionStorage.setItem(schluessel, "1");
    else sessionStorage.removeItem(schluessel);
  } catch {
    // egal
  }
}

function zufall(von: number, bis: number): number {
  return von + Math.random() * (bis - von);
}

function begrenzt(v: number, a: number, b: number): number {
  return Math.min(Math.max(v, a), Math.max(a, b));
}

/** Posen, die ineinander nicht ueberblendet werden muessen (gleiche Zeichnung). */
function familie(p: Pose): string {
  return p === "gehen" || p === "laufen" || p === "patschen" ? "gang" : p;
}

function PoseBild({ pose, rigRef }: { pose: Pose; rigRef: MutableRefObject<SVGGElement | null> }) {
  switch (pose) {
    case "gehen":
    case "laufen":
    case "patschen":
      return <PoseGehen rigRef={rigRef} />;
    case "sitzen":
      return <PoseSitzen />;
    case "putzen":
      return <PosePutzen />;
    case "brotlaib":
      return <PoseBrotlaib />;
    case "schlafen":
      return <PoseSchlafen />;
    case "ruecken":
      return <PoseRuecken />;
    case "hocke":
      return <PoseHocke />;
    case "sprung":
      return <PoseSprung />;
  }
}

export function KatzenEasterEgg() {
  const [katze, setKatze] = useState(() => lesen("zv-katze"));
  const [spielzeug, setSpielzeug] = useState(() => lesen("zv-spielzeug"));
  const [pose, setPoseState] = useState<Pose>("sitzen");
  const [blase, setBlase] = useState<{ t: string; n: number } | null>(null);

  const katzeRef = useRef<HTMLDivElement>(null);
  const dreherRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const zeiger = useRef<{ x: number; y: number } | null>(null);
  const plattformen = useRef<Plattform[]>([]);
  const schmutzig = useRef(true);
  const z = useRef<KatzenZustand>({
    fx: -KW,
    fy: 0,
    richtung: 1,
    pose: "sitzen",
    modus: "idle",
    timer: 0,
    plat: { x1: 0, x2: 0, y: 0, el: null },
    ziel: 0,
    v: 0,
    vx: 0,
    vy: 0,
    plan: null,
    hockeZeit: 0.35,
    anlaufTempo: 70,
    liegenGeplant: false,
    abkuehlung: 0,
    patschPause: 0,
    gekickt: false,
    spielzeit: 0,
    uninteressiert: 0,
    neigung: 0,
    phase: 0,
    blend: 0,
    bewegt: false,
    zeit: 0,
    sicht: 1,
    sx: 1,
    sy: 1,
    vsx: 0,
    vsy: 0,
    tailKick: 0,
  });
  const rigRef = useRef<SVGGElement | null>(null);
  const ungenutzt = useRef<SVGGElement | null>(null); // die ausblendende Vorgaengerpose braucht kein Rig
  const vorigePose = useRef<Pose>("sitzen");
  const [vorige, setVorige] = useState<Pose | null>(null);
  const ball = useRef<Ball & { lastX: number; lastY: number; lastT: number; offX: number; offY: number }>({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    drehung: 0,
    gezogen: false,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    offX: 0,
    offY: 0,
  });
  // Die Tastenbehandlung braucht die aktuellen Werte, ohne bei jeder Aenderung neu zu registrieren.
  const katzeAn = useRef(katze);
  katzeAn.current = katze;
  const spielzeugAn = useRef(spielzeug);
  spielzeugAn.current = spielzeug;

  useEffect(() => {
    function taste(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.code !== "KeyK" && e.code !== "KeyS") return;
      if (inEingabefeld(e.target)) return;
      e.preventDefault();
      if (e.code === "KeyK") {
        const wirdAn = !katzeAn.current;
        merken("zv-katze", wirdAn);
        setKatze(wirdAn);
      } else {
        const wirdAn = !spielzeugAn.current;
        merken("zv-spielzeug", wirdAn);
        setSpielzeug(wirdAn);
        // Ein Spielzeug ohne Katze waere nur ein Ball: sie kommt dazu -- aber nur beim Einblenden, nicht beim Wegraeumen.
        if (wirdAn && !katzeAn.current) {
          merken("zv-katze", true);
          setKatze(true);
        }
      }
    }
    document.addEventListener("keydown", taste);
    return () => document.removeEventListener("keydown", taste);
  }, []);

  useEffect(() => {
    if (!blase) return;
    const t = window.setTimeout(() => setBlase(null), 1800);
    return () => window.clearTimeout(t);
  }, [blase]);

  // Posenwechsel kurz ueberblenden statt hart zu schneiden (Sitzen -> Gehen, Liegen -> Sitzen ...).
  useEffect(() => {
    const alt = vorigePose.current;
    vorigePose.current = pose;
    if (familie(alt) === familie(pose)) return;
    setVorige(alt);
    const t = window.setTimeout(() => setVorige(null), 200);
    return () => window.clearTimeout(t);
  }, [pose]);

  // Zeigerposition nur von der Maus: ein Finger auf dem Wollknaeuel soll die Katze nicht verscheuchen.
  useEffect(() => {
    if (!katze) return;
    const bewegt = (e: PointerEvent) => {
      if (e.pointerType === "mouse") zeiger.current = { x: e.clientX, y: e.clientY };
    };
    const raus = (e: MouseEvent) => {
      if (!e.relatedTarget) zeiger.current = null;
    };
    // Layout hat sich geaendert: Plattformen beim naechsten Frame neu lesen (capture: auch innere Scrollcontainer).
    const neu = () => {
      schmutzig.current = true;
    };
    document.addEventListener("pointermove", bewegt);
    document.addEventListener("mouseout", raus);
    document.addEventListener("scroll", neu, true);
    window.addEventListener("resize", neu);
    return () => {
      document.removeEventListener("pointermove", bewegt);
      document.removeEventListener("mouseout", raus);
      document.removeEventListener("scroll", neu, true);
      window.removeEventListener("resize", neu);
      zeiger.current = null;
    };
  }, [katze]);

  // Auftritt der Katze
  useEffect(() => {
    if (!katze) return;
    const k = z.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const boden = bodenY(vh);
    k.plat = { x1: 0, x2: vw, y: boden, el: null };
    k.fy = boden;
    k.abkuehlung = 0;
    k.uninteressiert = 0;
    k.spielzeit = 0;
    k.liegenGeplant = false;
    k.plan = null;
    k.v = 0;
    k.neigung = 0;
    k.phase = 0;
    k.blend = 0;
    k.sx = k.sy = 1;
    k.vsx = k.vsy = 0;
    k.tailKick = 0;
    k.sicht = 1;
    if (reduziert()) {
      k.fx = vw - KW / 2 - 16;
      k.modus = "idle";
      k.richtung = -1;
      k.pose = "sitzen";
      setPoseState("sitzen");
    } else {
      k.fx = -KW / 2;
      k.richtung = 1;
      k.modus = "gehen";
      k.ziel = vw * zufall(0.2, 0.4);
      k.pose = "gehen";
      setPoseState("gehen");
    }
    setBlase({ t: "Miau!", n: Date.now() });
  }, [katze]);

  // Auftritt des Wollknaeuels: faellt von oben herab (bei reduzierter Bewegung liegt er gleich da)
  useEffect(() => {
    if (!spielzeug) return;
    const b = ball.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    b.gezogen = false;
    b.vx = 0;
    b.vy = 0;
    b.x = vw * zufall(0.4, 0.7);
    b.y = reduziert() ? bodenY(vh) - 2 - BALL_R : -BALL_R;
  }, [spielzeug]);

  useEffect(() => {
    if (!katze && !spielzeug) return;
    const k = z.current;
    const b = ball.current;
    let raf = 0;
    let zuletzt = performance.now();
    let platZeit = 0;

    function setzePose(p: Pose) {
      if (k.pose !== p) {
        k.pose = p;
        setPoseState(p);
      }
    }
    function sitzen(sekunden: number) {
      k.modus = "idle";
      k.v = 0;
      setzePose("sitzen");
      k.timer = sekunden;
    }
    /** Eine Bewegung um dx px: die Gangphase folgt dem Weg, nicht der Uhr. */
    function bewege(dx: number) {
      k.fx += dx;
      k.bewegt = true;
      const art = k.pose === "laufen" ? TRAB : SCHRITT;
      k.phase += Math.abs(dx) / (art.schritt * 0.8); // 0,8 = Anzeigemassstab (128 px / 160 Einheiten)
    }
    /**
     * Auf der Plattform gehen: weich anfahren, vor dem Ziel abbremsen, nie ueber den Rand.
     * Wechselt die Richtung, bremst sie ab und dreht sich erst, dann geht sie los.
     */
    function gehe(dt: number, tempo: number, fertig: () => void) {
      const p = k.plat;
      const ziel = begrenzt(k.ziel, p.x1 + RAND, p.x2 - RAND);
      const dx = ziel - k.fx;
      if (Math.abs(dx) < 2) {
        fertig();
        return;
      }
      const wunsch = dx > 0 ? 1 : -1;
      if (wunsch !== k.richtung) {
        k.richtung = wunsch;
        k.v = 0;
      }
      if (Math.abs(k.sicht - k.richtung) > 0.3) return; // dreht sich noch
      const soll = Math.min(tempo, 25 + Math.abs(dx) * 3);
      k.v += (soll - k.v) * Math.min(1, dt * 5);
      bewege(k.richtung * Math.min(Math.abs(dx), k.v * dt));
    }
    function ruhen() {
      const r = Math.random();
      k.modus = "ruhen";
      k.v = 0;
      if (r < 0.5) {
        setzePose("brotlaib");
        k.timer = zufall(8, 16);
      } else if (r < 0.9) {
        setzePose("schlafen");
        k.timer = zufall(20, 50);
      } else {
        setzePose("ruecken");
        k.timer = zufall(6, 10);
      }
    }
    function planeSprung(s: Sprung, tempo: number, hocke: number) {
      k.plan = s;
      k.ziel = s.start;
      k.hockeZeit = hocke;
      k.modus = "anlauf";
      setzePose(tempo > 120 ? "laufen" : "gehen");
      k.anlaufTempo = tempo;
    }
    function starteFall() {
      k.modus = "flug";
      k.plan = null;
      k.vx = 0;
      k.vy = 0;
      k.v = 0;
      setzePose("sprung");
    }
    function lande(p: Plattform) {
      k.plat = p;
      k.fy = p.y;
      k.vx = 0;
      k.vy = 0;
      k.plan = null;
      k.modus = "landen";
      k.timer = 0.28;
      k.neigung = 0;
      // Aufprall: einfedern und mit gedaempfter Feder zurueckschwingen; der Schwanz schlaegt nach.
      k.sx = 1.1;
      k.sy = 0.86;
      k.vsx = 0;
      k.vsy = 0;
      k.tailKick = 22;
      setzePose("hocke");
    }
    function bodenPlattform(vw: number, vh: number): Plattform {
      return { x1: 0, x2: vw, y: bodenY(vh), el: null };
    }

    function katzeSchritt(dt: number, vw: number, vh: number) {
      k.timer -= dt;
      k.abkuehlung -= dt;
      k.patschPause -= dt;
      k.uninteressiert -= dt;
      const zg = zeiger.current;
      const boden = bodenY(vh);

      if (reduziert()) {
        k.fy = boden;
        // Kein Laufen: bei Annaeherung springt sie auf die andere Seite.
        const naeher = zg !== null && !b.gezogen && zeigerAbstand(zg, k.fx - KW / 2, KW, 80, k.fy + 3) < FLUCHT_RADIUS;
        if (naeher) k.fx = zg!.x < vw / 2 ? vw - KW / 2 - 16 : KW / 2 + 16;
        return;
      }

      // Plattformen auffrischen (halbsekuendlich und nach Scroll/Resize)
      platZeit -= dt;
      if (platZeit <= 0 || schmutzig.current) {
        plattformen.current = plattformenSammeln(vw, vh);
        platZeit = 0.5;
        schmutzig.current = false;
      }
      const alle = plattformen.current;

      // Der Boden unter ihr: Live-Kante lesen; Plattform weg -> fallen.
      if (k.modus !== "flug") {
        const p = k.plat;
        if (p.el) {
          const r = p.el.getBoundingClientRect();
          if (!p.el.isConnected || !plattformGueltig(r, vh, boden) || k.fx < r.left - 4 || k.fx > r.right + 4) {
            if (k.fy > vh) {
              // Plattform nach unten aus dem Bild gescrollt: nicht aus dem Nichts fallen, sondern am Boden weitermachen.
              k.plat = bodenPlattform(vw, vh);
              k.fy = k.plat.y;
              sitzen(1);
            } else {
              starteFall();
            }
          } else {
            p.x1 = r.left;
            p.x2 = r.right;
            p.y = r.top;
            k.fy = r.top;
          }
        } else {
          p.x2 = vw;
          p.y = boden;
          k.fy = boden;
        }
      }

      const mitte = k.fx;
      const nah =
        zg !== null && !b.gezogen && zeigerAbstand(zg, k.fx - KW / 2, KW, 80, k.fy + 3) < FLUCHT_RADIUS;
      const amBoden = k.modus !== "flug" && k.modus !== "landen" && k.modus !== "hocke" && k.modus !== "anlauf";
      if (nah && amBoden && k.modus !== "flucht" && k.modus !== "aufstehen" && k.abkuehlung <= 0) {
        k.modus = "aufstehen";
        k.timer = k.pose === "schlafen" || k.pose === "ruecken" ? 0.6 : 0.15;
        k.v = 0;
        setzePose("sitzen");
      }

      switch (k.modus) {
        case "aufstehen":
          if (k.timer <= 0) {
            setBlase({ t: "Hmpf!", n: Date.now() });
            weiche(zg, alle, vw);
          }
          break;
        case "flucht":
          gehe(dt, 150, () => {
            sitzen(zufall(1.5, 3));
            k.abkuehlung = 0.8;
          });
          break;
        case "gehen":
          gehe(dt, 48, () => {
            if (k.liegenGeplant) {
              k.liegenGeplant = false;
              ruhen();
            } else {
              sitzen(zufall(3, 6));
            }
          });
          break;
        case "anlauf":
          gehe(dt, k.anlaufTempo, () => {
            // Ziel anvisieren, dann Hocke: erst gucken, dann springen.
            const s = k.plan;
            if (!s) {
              sitzen(1);
              return;
            }
            if (Math.abs(s.landung - k.fx) > 10) k.richtung = s.landung > k.fx ? 1 : -1;
            k.modus = "hocke";
            k.timer = k.hockeZeit;
            k.v = 0;
            setzePose("hocke");
          });
          break;
        case "hocke": {
          const s = k.plan;
          if (!s) {
            sitzen(1);
            break;
          }
          if (k.timer > 0) break;
          // Zielkante live lesen: seit dem Planen kann gescrollt worden sein.
          let ly = s.ziel.y;
          if (s.ziel.el) {
            const r = s.ziel.el.getBoundingClientRect();
            if (!s.ziel.el.isConnected || !plattformGueltig(r, vh, boden)) {
              sitzen(1);
              break;
            }
            ly = r.top;
          } else {
            ly = boden;
          }
          const bahn = sprungBahn(k.fx, k.fy, s.landung, ly);
          k.vx = bahn.vx;
          k.vy = bahn.vy;
          if (Math.abs(bahn.vx) > 20) k.richtung = bahn.vx > 0 ? 1 : -1;
          k.modus = "flug";
          // Abdruck: der Koerper streckt sich entlang der Flugrichtung, die Feder zieht ihn dann zurueck.
          k.sx = 0.92;
          k.sy = 1.14;
          k.vsx = 0;
          k.vsy = 0;
          setzePose("sprung");
          break;
        }
        case "flug": {
          const vorher = k.fy;
          k.vy += GRAVITATION * dt;
          k.fx = begrenzt(k.fx + k.vx * dt, 20, vw - 20);
          k.fy += k.vy * dt;
          k.neigung = Math.max(-40, Math.min(40, Math.atan2(k.vy, Math.max(Math.abs(k.vx), 80)) * (180 / Math.PI) * 0.55));
          if (k.vy > 0) {
            const p = aufsetzer(k.fx, vorher, k.fy, alle.concat(bodenPlattform(vw, vh)));
            if (p) {
              // Live-Kante der Zielplattform nehmen, falls sie sich bewegt hat; ist sie inzwischen weg, weiterfallen.
              let gueltig = true;
              if (p.el) {
                const r = p.el.getBoundingClientRect();
                gueltig = p.el.isConnected && plattformGueltig(r, vh, bodenY(vh));
                p.y = r.top;
              }
              if (gueltig) lande(p);
            }
          }
          break;
        }
        case "landen":
          if (k.timer <= 0) sitzen(zufall(0.6, 1.2));
          break;
        case "ruhen":
          if (k.timer <= 0) {
            if (k.pose === "brotlaib" && Math.random() < 0.6) {
              setzePose("schlafen");
              k.timer = zufall(20, 50);
            } else {
              sitzen(zufall(1.5, 3));
            }
          }
          break;
        case "idle":
          if (spielzeug && k.uninteressiert <= 0) {
            k.modus = "jagen";
            k.spielzeit = 0;
            setzePose("gehen");
            break;
          }
          if (k.timer > 0) break;
          if (k.pose === "sitzen") naechsteAktivitaet(alle, vw);
          else sitzen(zufall(3, 6));
          break;
        case "jagen": {
          if (!spielzeug || k.uninteressiert > 0) {
            sitzen(2);
            break;
          }
          k.spielzeit += dt;
          if (k.spielzeit > 25) {
            // Irgendwann ist auch eine Katze muede vom Spielen.
            k.uninteressiert = 15;
            sitzen(1);
            break;
          }
          const bodenPl = bodenPlattform(vw, vh);
          if (k.plat.el !== null) {
            // Das Knaeuel liegt unten: erst von der Seite herunterspringen, auf der es naeher liegt.
            const wege = sprungZiele(k.plat, [bodenPl], Infinity);
            if (wege.length === 0) {
              k.uninteressiert = 15;
              sitzen(1);
              break;
            }
            wege.sort((u, w) => Math.abs(u.landung - b.x) - Math.abs(w.landung - b.x));
            planeSprung(wege[0], 110, 0.3);
            break;
          }
          const dx = b.x - mitte;
          const abstand = Math.abs(dx);
          if (abstand > 8) k.richtung = dx > 0 ? 1 : -1;
          if (abstand > 85) {
            setzePose(abstand > 220 ? "laufen" : "gehen");
            k.v += ((abstand > 220 ? 190 : 120) - k.v) * Math.min(1, dt * 5);
            bewege(k.richtung * Math.min(abstand - 85, k.v * dt));
          } else {
            k.v = 0;
            const hoch = b.y < boden - 70;
            if (hoch || b.gezogen) {
              setzePose("sitzen");
            } else if (k.patschPause <= 0 && Math.abs(b.vx) < 250 && abstand > 25) {
              k.modus = "patschen";
              k.timer = 0.4;
              k.gekickt = false;
              setzePose("patschen");
            } else {
              setzePose("sitzen");
            }
          }
          break;
        }
        case "patschen":
          if (!k.gekickt && k.timer <= 0.2) {
            k.gekickt = true;
            b.vx = k.richtung * zufall(240, 440);
            b.vy = -zufall(160, 320);
            if (Math.random() < 0.25) setBlase({ t: "Mau!", n: Date.now() });
          }
          if (k.timer <= 0) {
            k.modus = "jagen";
            k.patschPause = 0.5;
            setzePose("gehen");
          }
          break;
      }
    }

    /** Vor dem Zeiger ausweichen: weit weg springen, sonst ans andere Ende der Plattform, sonst bleiben. */
    function weiche(zg: { x: number; y: number } | null, alle: Plattform[], vw: number) {
      const px = zg?.x ?? k.fx;
      const py = zg?.y ?? k.fy;
      const abst = (x: number, y: number) => Math.hypot(x - px, y - py);
      const ziele = sprungZiele(k.plat, alle);
      let bester: Sprung | null = null;
      let besteWeite = 0;
      for (const s of ziele) {
        const w = abst(s.landung, s.ziel.y);
        if (w > besteWeite) {
          besteWeite = w;
          bester = s;
        }
      }
      const endeX = px < (k.plat.x1 + k.plat.x2) / 2 ? k.plat.x2 - RAND : k.plat.x1 + RAND;
      const endeWeite = abst(endeX, k.fy);
      if (bester && besteWeite >= 260) {
        planeSprung(bester, 170, 0.18);
      } else if (endeWeite > abst(k.fx, k.fy) + 120) {
        k.ziel = endeX;
        k.modus = "flucht";
        setzePose("laufen");
      } else if (bester) {
        planeSprung(bester, 170, 0.18);
      } else {
        sitzen(1.5);
        k.abkuehlung = 1.5;
      }
      void vw;
    }

    function naechsteAktivitaet(alle: Plattform[], vw: number) {
      const r = Math.random();
      const p = k.plat;
      const breit = p.x2 - p.x1 >= 150;
      if (r < 0.2) {
        setzePose("putzen");
        k.modus = "idle";
        k.timer = zufall(3.5, 5.5);
        return;
      }
      const ziele = sprungZiele(p, alle);
      if (r < 0.55) {
        // Liegeplatz suchen: breite, flache Flaechen bevorzugt; bleibt sie, laeuft sie erst ein paar Schritte.
        if (ziele.length > 0 && (!breit || Math.random() < 0.55)) {
          let best: Sprung | null = null;
          let punkte = -1;
          for (const s of ziele) {
            const w = Math.min(s.ziel.x2 - s.ziel.x1, 500) / 100 + Math.random() * 2.5;
            if (w > punkte) {
              punkte = w;
              best = s;
            }
          }
          if (best) {
            k.liegenGeplant = true;
            planeSprung(best, 70, 0.4);
            return;
          }
        }
        if (breit) {
          k.liegenGeplant = true;
          k.ziel = zufall(p.x1 + RAND + 20, p.x2 - RAND - 20);
          k.modus = "gehen";
          setzePose("gehen");
          return;
        }
      }
      // Ortswechsel: bevorzugt springen, wenn etwas erreichbar ist.
      if (ziele.length > 0 && Math.random() < 0.75) {
        planeSprung(ziele[Math.floor(Math.random() * ziele.length)], 70, 0.4);
      } else {
        k.ziel = zufall(p.x1 + RAND, p.x2 - RAND);
        if (Math.abs(k.ziel - k.fx) < 60) k.ziel = k.fx < (p.x1 + p.x2) / 2 ? p.x2 - RAND : p.x1 + RAND;
        k.modus = "gehen";
        setzePose("gehen");
      }
      void vw;
    }

    function schritt(dt: number) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ballBoden = bodenY(vh) - 2 - BALL_R;
      if (spielzeug) {
        if (!b.gezogen && !reduziert()) ballSchritt(b, dt, vw, ballBoden, BALL_R);
        if (!b.gezogen && b.y > ballBoden) b.y = ballBoden;
        const el = ballRef.current;
        if (el) el.style.transform = `translate3d(${b.x - BALL_R}px, ${b.y - BALL_R}px, 0) rotate(${b.drehung}deg)`;
      }
      if (katze) {
        k.bewegt = false;
        k.zeit += dt;
        katzeSchritt(dt, vw, vh);
        // Gangblende: die Fuesse gehen in die Standposition, wenn sie nicht laeuft.
        // Beim Losgehen schnell (sonst rutschen die ersten Schritte), beim Anhalten weicher.
        k.blend += ((k.bewegt ? 1 : 0) - k.blend) * Math.min(1, dt * (k.bewegt ? 20 : 8));
        // Blickrichtung dreht weich (ca. 0,2 s), nicht per Spiegeln.
        const dR = k.richtung - k.sicht;
        k.sicht += Math.max(-dt * 10, Math.min(dt * 10, dR));
        // Stauchen/Strecken als gedaempfte Feder; Ziel hangt von der Phase des Sprungs ab.
        let zx = 1;
        let zy = 1;
        if (k.modus === "hocke") {
          zx = 1.06;
          zy = 0.9;
        } else if (k.modus === "flug") {
          zx = k.vy < 0 ? 0.95 : 0.97;
          zy = k.vy < 0 ? 1.07 : 1.04;
        }
        [k.sx, k.vsx] = feder(k.sx, k.vsx, zx, dt);
        [k.sy, k.vsy] = feder(k.sy, k.vsy, zy, dt);
        k.tailKick *= Math.exp(-dt * 5);
        const gang = k.pose === "gehen" || k.pose === "laufen" || k.pose === "patschen";
        if (gang && rigRef.current) {
          const art = k.pose === "laufen" ? TRAB : SCHRITT;
          const amp = k.pose === "laufen" ? 4 : 9;
          const schwanz =
            -4 * k.blend + amp * Math.sin(Math.PI * k.phase - 0.8) * k.blend + 5 * Math.sin(k.zeit * 1.7) + k.tailKick;
          rigAktualisieren(rigRef.current, {
            phase: k.phase,
            blend: k.blend,
            art,
            kopf: 0,
            schwanz,
            patsch: k.modus === "patschen" ? Math.min(1, Math.max(0, 1 - k.timer / 0.4)) : null,
          });
        }
        if (katzeRef.current) katzeRef.current.style.transform = `translate3d(${k.fx - KW / 2}px, ${k.fy - FUSS}px, 0)`;
        // Beim Drehen nie ganz flach: eine Katze im Profil hat keine Vorderansicht, also bleibt sie schmal sichtbar.
        const breite = 0.4 + 0.6 * Math.abs(k.sicht);
        const sx = (k.sicht >= 0 ? 1 : -1) * breite;
        if (dreherRef.current)
          dreherRef.current.style.transform = `scaleX(${sx.toFixed(3)}) rotate(${k.neigung.toFixed(1)}deg) scale(${k.sx.toFixed(3)}, ${k.sy.toFixed(3)})`;
      }
    }

    const tick = (jetzt: number) => {
      const dt = Math.min(0.05, (jetzt - zuletzt) / 1000);
      zuletzt = jetzt;
      schritt(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [katze, spielzeug]);

  function ballGreifen(e: React.PointerEvent<HTMLDivElement>) {
    const b = ball.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    b.gezogen = true;
    b.vx = 0;
    b.vy = 0;
    b.offX = b.x - e.clientX;
    b.offY = b.y - e.clientY;
    b.lastX = e.clientX;
    b.lastY = e.clientY;
    b.lastT = performance.now();
  }
  function ballZiehen(e: React.PointerEvent<HTMLDivElement>) {
    const b = ball.current;
    if (!b.gezogen) return;
    const jetzt = performance.now();
    const dt = Math.max(0.008, (jetzt - b.lastT) / 1000);
    // Geglaettet, sonst entscheidet das letzte Pixel ueber die Wurfgeschwindigkeit.
    b.vx = b.vx * 0.5 + ((e.clientX - b.lastX) / dt) * 0.5;
    b.vy = b.vy * 0.5 + ((e.clientY - b.lastY) / dt) * 0.5;
    b.lastX = e.clientX;
    b.lastY = e.clientY;
    b.lastT = jetzt;
    b.x = Math.min(Math.max(e.clientX + b.offX, BALL_R), window.innerWidth - BALL_R);
    b.y = Math.min(Math.max(e.clientY + b.offY, BALL_R), bodenY(window.innerHeight) - 2 - BALL_R);
  }
  function ballLoslassen() {
    const b = ball.current;
    if (!b.gezogen) return;
    b.gezogen = false;
    // Wer nach dem Anhalten loslaesst, wirft nicht: veraltete Geschwindigkeit verwerfen.
    const alt = performance.now() - b.lastT > 80;
    const grenze = 1400;
    b.vx = alt || reduziert() ? 0 : Math.max(-grenze, Math.min(grenze, b.vx));
    b.vy = alt || reduziert() ? 0 : Math.max(-grenze, Math.min(grenze, b.vy));
  }

  if (!katze && !spielzeug) return null;
  const still = reduziert();
  return (
    <>
      {katze && (
        <div className={`zv-katze pose-${pose}${still ? " zv-katze--ruhig" : ""}`} ref={katzeRef} aria-hidden="true">
          {blase && (
            <span className="zv-katze__blase" key={blase.n}>
              {blase.t}
            </span>
          )}
          <div className="zv-katze__dreher" ref={dreherRef}>
            <svg viewBox="0 0 160 100" width={KW} height={80} className="zv-katze__svg">
              {vorige && (
                <g className="k-aus" key={`v-${familie(vorige)}`}>
                  <PoseBild pose={vorige} rigRef={ungenutzt} />
                </g>
              )}
              <g className={vorige ? "k-ein" : undefined} key={familie(pose)}>
                <PoseBild pose={pose} rigRef={rigRef} />
              </g>
            </svg>
          </div>
        </div>
      )}
      {spielzeug && (
        <div
          className="zv-wolle"
          ref={ballRef}
          aria-hidden="true"
          onPointerDown={ballGreifen}
          onPointerMove={ballZiehen}
          onPointerUp={ballLoslassen}
          onPointerCancel={ballLoslassen}
        >
          <Wollknaeuel />
        </div>
      )}
    </>
  );
}
