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
import {
  AUFWACH_DAUER,
  HALTUNG,
  STRECK_DAUER,
  aufwachHaltung,
  gangHaltung,
  glocke,
  lauerHaltung,
  mitPfotenhieb,
  putzHaltung,
  streckHaltung,
  tretelHaltung,
  weich,
} from "./katzen-haltung";
import { type Haltung, mische, rigZeichnen } from "./katzen-rig";
import { type Anlass, blasenDauer, blasenText } from "./katzen-texte";
import { bodenY, plattformGueltig, plattformenSammeln, platzFrei } from "./katzen-umwelt";
import { KatzenFigur, Wollknaeuel } from "./KatzenFigur";

/**
 * Easter Eggs: eine Begleit-Katze, die auf der Seite lebt, und ein Wollknaeuel.
 *
 *   Alt+Umschalt+K   Katze kommt / geht wieder (nochmal druecken: sofort weg)
 *   Alt+Umschalt+S   Wollknaeuel (Spielzeug) erscheint / verschwindet
 *
 * Unterlagen: /mnt/project-files/katze/ (Spezifikation nach Fotos von Dennis'
 * Katze, Bewegungskonzept).
 *
 * Was sie tut, folgt dem Tageslauf einer Buerokatze, nicht dem Zufall:
 *  - Sie hat ENERGIE. Herumlaufen, Springen und Jagen kosten welche, Schlafen
 *    fuellt sie auf. Ist sie muede, sucht sie einen breiten Platz, tretelt,
 *    legt sich hin, rollt sich ein. Nach dem Aufwachen streckt sie sich,
 *    gaehnt und putzt sich. Deshalb schlaeft sie viel -- wie eine Katze.
 *  - Sie stoert nicht. Solange getippt oder geklickt wird, bleibt sie ruhig
 *    (kein Springen, kein Flitzen, keine Jagd). Wer in ihrer Naehe arbeitet
 *    (Zeiger bleibt bei ihr, Klick auf sie, Tippen in einem Feld unter ihr),
 *    dem macht sie Platz. Sie nimmt nie Klicks an (`pointer-events: none`).
 *  - Sie reagiert auf den Mauszeiger wie auf ein Lebewesen: ruhiger Zeiger
 *    AUF ihr ist Streicheln (sie schnurrt, irgendwann reicht es ihr); ein
 *    Zeiger, der in Sichtweite herumzappelt, wird belauert und angesprungen;
 *    ein Zeiger, der auf sie zuschiesst, erschreckt sie.
 *  - Die Seite ist ihr Kletterbaum: Oberkanten echter Elemente sind
 *    Plattformen (katzen-umwelt.ts). Zwischen Plattformen springt sie.
 *    Verschwindet oder scrollt die Plattform weg, faellt sie auf die naechste
 *    darunter; beim Scrollen faehrt sie mit.
 *
 * Technik:
 *  - Eine requestAnimationFrame-Schleife. Sie schreibt Position und Figur
 *    direkt ins DOM (katzen-rig.ts); React rendert nur Blase und "z".
 *  - Jede Haltung ist eine Zahlentabelle (katzen-haltung.ts); beim Wechsel
 *    wird gerechnet statt ueberblendet -- sie setzt und legt sich wirklich.
 *  - Tasten ueber `event.code`: auf dem Mac erzeugt Option ein Sonderzeichen,
 *    `event.key` waere dort nicht "k". In Eingabefeldern passiert nie etwas.
 *  - Kein Fremd-Asset, kein Ton, `aria-hidden`.
 *  - prefers-reduced-motion: die Katze sitzt still am Boden und weicht per
 *    Schnitt aus; das Spielzeug folgt nur der Hand.
 *  - Der Zustand lebt in sessionStorage: ein Neuladen im selben Tab behaelt
 *    die Katze, ein neuer Tab beginnt ohne sie.
 */

const KW = 128; // Anzeigebreite der Katze (px)
const MASS = 0.8; // px je Figur-Einheit (128 px / 160)
const FUSS = 77; // Abstand Oberkante Katze -> Fusslinie (96 Einheiten)
const BALL_R = 16;
const RAND = 14;
const TEMPO_SCHLEICHEN = 26;
const TEMPO_GEHEN = 48;
const TEMPO_TRAB = 160;

type Modus =
  | "sitzen"
  | "gehen"
  | "anlauf"
  | "hocke"
  | "flug"
  | "landen"
  | "putzen"
  | "treteln"
  | "liegen"
  | "schlafen"
  | "aufwachen"
  | "strecken"
  | "lauern"
  | "fangen"
  | "geniessen"
  | "schreck"
  | "weichen"
  | "spielen"
  | "patschen"
  | "abgang";

/** In diesen Zustaenden darf der Zeiger sie umstimmen (streicheln, verscheuchen, zur Jagd reizen). */
const ANSPRECHBAR = new Set<Modus>(["sitzen", "putzen", "liegen", "treteln", "schlafen", "geniessen", "strecken", "aufwachen"]);
const WACH_UND_RUHIG = new Set<Modus>(["sitzen", "putzen", "liegen", "geniessen"]);

interface KatzenZustand {
  fx: number; // Fussmitte (Viewport-x)
  fy: number; // Fusslinie (Viewport-y)
  richtung: 1 | -1;
  sicht: number; // sichtbare Blickrichtung, dreht weich von -1 nach 1
  modus: Modus;
  modusZeit: number;
  timer: number;
  zeit: number;
  plat: Plattform;
  // Gehen
  ziel: number;
  v: number;
  tempo: number;
  /** Laufendes Gehen laesst sich nicht unterbrechen (Flucht, Flitzen). */
  fest: boolean;
  danach: (() => void) | null;
  phase: number; // Gangphase, waechst mit dem Weg (siehe katzen-gang.ts)
  blend: number; // 0 steht .. 1 voller Gang
  bewegt: boolean;
  // Springen
  vx: number;
  vy: number;
  plan: Sprung | null;
  hockeZeit: number;
  nachLandung: (() => void) | null;
  neigung: number;
  sx: number;
  sy: number;
  vsx: number;
  vsy: number;
  // Innenleben
  energie: number;
  liegeArt: "brotlaib" | "sphinx";
  unterlage: "sitzen" | "brotlaib" | "sphinx";
  schlafGeplant: boolean;
  liegenGeplant: boolean;
  abkuehlung: number;
  naheZeit: number;
  streichelZeit: number;
  streichelPause: number;
  jagdReiz: number;
  jagdPause: number;
  hiebe: number;
  hiebZiel: [number, number];
  flitzRunden: number;
  flitzPause: number;
  gelangweilt: boolean;
  tippPause: number;
  schreckPause: number;
  // Wollknaeuel
  patschPause: number;
  gekickt: boolean;
  spielzeit: number;
  uninteressiert: number;
  // Anzeige
  art: string;
  von: Haltung;
  gezeigt: Haltung;
  wechsel: number;
  wechselDauer: number;
  dreh: number;
  drehZiel: number;
  umsehen: number;
  hinterIhr: number;
  blinzelIn: number;
  blinzelT: number;
  ohrIn: number;
  ohrT: number;
  gaehnT: number;
  schwanzPhase: number;
  schwanzAmp: number;
  schwanzKick: number;
  blasePause: number;
  zeichnePause: number;
}

interface Zeiger {
  x: number;
  y: number;
  /** Geglaettete Geschwindigkeit (px/s). */
  v: number;
  /** Zeitpunkt der letzten Bewegung (performance.now). */
  t: number;
  /** Richtung der letzten Bewegung in x (-1, 0, 1). */
  rx: number;
  /** Steht ueber etwas Bedienbarem: dann wird nicht gejagt. */
  bedienung: boolean;
}

interface Blase {
  t: string;
  gedanke: boolean;
  n: number;
  dauer: number;
  seitlich: boolean;
  links: boolean;
  versatz: number;
  kopfX: number;
  hoehe: number;
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

/** Welche Haltungsfamilie ein Zustand zeigt; wechselt sie, wird in die neue Haltung hineingerechnet. */
function artVon(k: KatzenZustand): string {
  switch (k.modus) {
    case "gehen":
    case "anlauf":
    case "abgang":
    case "spielen":
      return k.tempo <= TEMPO_SCHLEICHEN ? "gang:tief" : "gang";
    case "weichen":
      return "sitzen";
    case "liegen":
      return `liegen:${k.liegeArt}`;
    case "geniessen":
      return k.unterlage === "sitzen" ? "geniessen" : `geniessen:${k.unterlage}`;
    case "hocke":
      return "lauern";
    default:
      return k.modus;
  }
}

function wechselDauer(von: string, nach: string): number {
  if (nach === "schreck") return 0.1;
  if (nach === "flug") return 0.14;
  if (nach === "landen") return 0.08;
  if (nach === "patschen" || nach === "fangen" || von === "patschen" || von === "fangen") return 0.14;
  if (nach === "aufwachen" || nach === "strecken") return 0.25;
  if (von === "schlafen" || nach === "schlafen") return 0.9;
  if (von.startsWith("liegen") || nach.startsWith("liegen")) return 0.7;
  if (nach === "lauern") return 0.3;
  if (von.startsWith("gang") && nach.startsWith("gang")) return 0.3;
  return 0.42;
}

/** Hoehe der Figur ueber der Fusslinie (px), fuer "Zeiger liegt auf ihr". */
function koerperHoehe(art: string): number {
  if (art === "schlafen") return 30;
  if (art.includes("brotlaib") || art.includes("sphinx")) return 40;
  if (art === "sitzen" || art === "geniessen" || art === "putzen") return 64;
  return 48;
}

function neuerZustand(): KatzenZustand {
  return {
    fx: -KW,
    fy: 0,
    richtung: 1,
    sicht: 1,
    modus: "sitzen",
    modusZeit: 0,
    timer: 0,
    zeit: 0,
    plat: { x1: 0, x2: 0, y: 0, el: null },
    ziel: 0,
    v: 0,
    tempo: TEMPO_GEHEN,
    fest: false,
    danach: null,
    phase: 0,
    blend: 0,
    bewegt: false,
    vx: 0,
    vy: 0,
    plan: null,
    hockeZeit: 0.35,
    nachLandung: null,
    neigung: 0,
    sx: 1,
    sy: 1,
    vsx: 0,
    vsy: 0,
    energie: 0.7,
    liegeArt: "brotlaib",
    unterlage: "sitzen",
    schlafGeplant: false,
    liegenGeplant: false,
    abkuehlung: 0,
    naheZeit: 0,
    streichelZeit: 0,
    streichelPause: 0,
    jagdReiz: 0,
    jagdPause: 8,
    hiebe: 0,
    hiebZiel: [110, 80],
    flitzRunden: 0,
    flitzPause: 90,
    gelangweilt: false,
    tippPause: 20,
    schreckPause: 0,
    patschPause: 0,
    gekickt: false,
    spielzeit: 0,
    uninteressiert: 0,
    art: "sitzen",
    von: HALTUNG.sitzen,
    gezeigt: HALTUNG.sitzen,
    wechsel: 1,
    wechselDauer: 0.4,
    dreh: 1,
    drehZiel: 1,
    umsehen: 3,
    hinterIhr: 0,
    blinzelIn: 2,
    blinzelT: -1,
    ohrIn: 4,
    ohrT: -1,
    gaehnT: -1,
    schwanzPhase: 0,
    schwanzAmp: 0,
    schwanzKick: 0,
    blasePause: 0,
    zeichnePause: 0,
  };
}

export function KatzenEasterEgg() {
  const [katze, setKatze] = useState(() => lesen("zv-katze"));
  const [spielzeug, setSpielzeug] = useState(() => lesen("zv-spielzeug"));
  const [blase, setBlase] = useState<Blase | null>(null);
  const [schlaeft, setSchlaeft] = useState(false);

  const katzeRef = useRef<HTMLDivElement>(null);
  const dreherRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<SVGGElement | null>(null);
  const zeiger = useRef<Zeiger | null>(null);
  const plattformen = useRef<Plattform[]>([]);
  const schmutzig = useRef(true);
  const z = useRef<KatzenZustand>(neuerZustand());
  /** Letzte Eingaben des Menschen (performance.now): daran merkt sie, ob gearbeitet wird. */
  const eingabe = useRef({ taste: -1e9, klick: -1e9, irgendwas: 0 });
  /** Ein Klick auf sie oder Tippen in einem Feld unter ihr: sie soll Platz machen. */
  const platzBitte = useRef(false);
  const gehtWeg = useRef(false);
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
        if (!katzeAn.current) {
          merken("zv-katze", true);
          gehtWeg.current = false;
          setKatze(true);
        } else if (gehtWeg.current || reduziert()) {
          // Zweiter Druck (oder reduzierte Bewegung): ohne Abgang sofort weg -- abschalten muss immer gehen.
          merken("zv-katze", false);
          gehtWeg.current = false;
          setKatze(false);
          setBlase(null);
        } else {
          merken("zv-katze", false);
          gehtWeg.current = true;
        }
      } else {
        const wirdAn = !spielzeugAn.current;
        merken("zv-spielzeug", wirdAn);
        setSpielzeug(wirdAn);
        // Ein Spielzeug ohne Katze waere nur ein Ball: sie kommt dazu -- aber nur beim Einblenden, nicht beim Wegraeumen.
        if (wirdAn && (!katzeAn.current || gehtWeg.current)) {
          merken("zv-katze", true);
          gehtWeg.current = false;
          setKatze(true);
        }
      }
    }
    document.addEventListener("keydown", taste);
    return () => document.removeEventListener("keydown", taste);
  }, []);

  useEffect(() => {
    if (!blase) return;
    const t = window.setTimeout(() => setBlase(null), blase.dauer * 1000);
    return () => window.clearTimeout(t);
  }, [blase]);

  // Was der Mensch gerade tut. Zeigerposition nur von der Maus: ein Finger auf dem
  // Wollknaeuel soll die Katze weder verscheuchen noch zur Jagd reizen.
  useEffect(() => {
    if (!katze) return;
    const bewegt = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const jetzt = performance.now();
      const alt = zeiger.current;
      let v = 0;
      if (alt) {
        const dt = Math.max(0.008, (jetzt - alt.t) / 1000);
        // Nach einer Pause zaehlt nur die neue Bewegung, sonst wirkt ein Sprung des Zeigers wie ein Schuss.
        const roh = dt > 0.25 ? 0 : Math.hypot(e.clientX - alt.x, e.clientY - alt.y) / dt;
        v = alt.v * 0.6 + roh * 0.4;
      }
      const ziel = e.target instanceof Element ? e.target : null;
      zeiger.current = {
        x: e.clientX,
        y: e.clientY,
        v,
        rx: alt ? Math.sign(e.clientX - alt.x) : 0,
        t: jetzt,
        bedienung: !!ziel?.closest("a,button,input,select,textarea,label,summary,[role=button],[role=tab],[role=menuitem],[role=option]"),
      };
      eingabe.current.irgendwas = jetzt;
    };
    const raus = (e: MouseEvent) => {
      if (!e.relatedTarget) zeiger.current = null;
    };
    const klick = (e: PointerEvent) => {
      const jetzt = performance.now();
      eingabe.current.klick = jetzt;
      eingabe.current.irgendwas = jetzt;
      // Ein Klick dort, wo sie sitzt, gilt dem, was unter ihr liegt.
      const k = z.current;
      if ((e.target as Element | null)?.closest?.(".zv-wolle")) return;
      if (zeigerAbstand({ x: e.clientX, y: e.clientY }, k.fx - KW / 2, KW, 80, k.fy + 3) < 24) platzBitte.current = true;
    };
    const getippt = (e: KeyboardEvent) => {
      const jetzt = performance.now();
      eingabe.current.irgendwas = jetzt;
      if (!inEingabefeld(e.target)) return;
      eingabe.current.taste = jetzt;
      // Sitzt sie auf oder ueber dem Feld, in dem gerade geschrieben wird, raeumt sie es.
      const r = (e.target as HTMLElement).getBoundingClientRect();
      const k = z.current;
      const links = k.fx - KW / 2 - 8;
      const oben = k.fy - FUSS - 8;
      if (r.right > links && r.left < links + KW + 16 && r.bottom > oben && r.top < k.fy + 8) platzBitte.current = true;
    };
    // Layout hat sich geaendert: Plattformen beim naechsten Frame neu lesen (capture: auch innere Scrollcontainer).
    const neu = () => {
      schmutzig.current = true;
    };
    document.addEventListener("pointermove", bewegt);
    document.addEventListener("pointerdown", klick, true);
    document.addEventListener("keydown", getippt, true);
    document.addEventListener("mouseout", raus);
    document.addEventListener("scroll", neu, true);
    window.addEventListener("resize", neu);
    return () => {
      document.removeEventListener("pointermove", bewegt);
      document.removeEventListener("pointerdown", klick, true);
      document.removeEventListener("keydown", getippt, true);
      document.removeEventListener("mouseout", raus);
      document.removeEventListener("scroll", neu, true);
      window.removeEventListener("resize", neu);
      zeiger.current = null;
    };
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

  // Auftritt der Katze: jedes Mal ein frischer Zustand.
  useEffect(() => {
    if (!katze) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const k = neuerZustand();
    z.current = k;
    const boden = bodenY(vh);
    k.plat = { x1: 0, x2: vw, y: boden, el: null };
    k.fy = boden;
    platzBitte.current = false;
    eingabe.current.irgendwas = performance.now();
    setSchlaeft(false);
    setBlase(null);
    if (reduziert()) {
      k.fx = vw - KW / 2 - 16;
      k.richtung = -1;
      k.sicht = -1;
    } else {
      // Sie kommt von links hereinspaziert, Schwanz oben, und setzt sich.
      k.fx = -KW / 2;
      k.modus = "gehen";
      k.art = "gang";
      k.von = k.gezeigt = HALTUNG.stehen;
      k.dreh = 0;
      k.ziel = vw * zufall(0.2, 0.4);
      k.tempo = 70;
    }
  }, [katze]);

  useEffect(() => {
    if (!katze && !spielzeug) return;
    const b = ball.current;
    let raf = 0;
    let zuletzt = performance.now();
    let platZeit = 0;
    let gegruesst = false;
    let stillGezeichnet = false;

    function sag(k: KatzenZustand, anlass: Anlass, chance = 1, dringend = false) {
      if (Math.random() > chance) return;
      if (!dringend && k.blasePause > 0) return;
      const text = blasenText(anlass);
      const dauer = blasenDauer(text.t);
      // Katzen sind meist still: nach jeder Blase eine Weile Ruhe.
      k.blasePause = dauer + zufall(5, 11);
      const vw = window.innerWidth;
      const seite = k.sicht >= 0 ? 1 : -1;
      const kopfX = (k.gezeigt.kx - 80) * MASS * seite;
      const mitte = k.fx + kopfX;
      const halb = 104;
      setBlase({
        t: text.t,
        gedanke: text.gedanke,
        n: Date.now(),
        dauer,
        seitlich: k.fy - (96 - k.gezeigt.ky) * MASS - 60 < 0,
        links: k.fx > vw / 2,
        versatz: vw > 2 * halb ? begrenzt(mitte, halb, vw - halb) - mitte : 0,
        kopfX,
        hoehe: (96 - k.gezeigt.ky) * MASS + 18,
      });
    }

    function setzeModus(k: KatzenZustand, m: Modus) {
      if (k.modus === m) return;
      if (m === "schlafen") setSchlaeft(true);
      else if (k.modus === "schlafen") setSchlaeft(false);
      k.modus = m;
      k.modusZeit = 0;
    }
    function sitzen(k: KatzenZustand, sekunden: number) {
      setzeModus(k, "sitzen");
      k.v = 0;
      k.fest = false;
      k.danach = null;
      k.timer = sekunden;
    }
    function geheZu(k: KatzenZustand, ziel: number, tempo: number, danach: (() => void) | null, fest = false) {
      k.ziel = ziel;
      k.tempo = tempo;
      k.danach = danach;
      k.fest = fest;
      setzeModus(k, "gehen");
    }
    /** Eine Bewegung um dx px: die Gangphase folgt dem Weg, nicht der Uhr. */
    function bewege(k: KatzenZustand, dx: number) {
      k.fx += dx;
      k.bewegt = true;
      const art = k.tempo > 120 ? TRAB : SCHRITT;
      k.phase += Math.abs(dx) / (art.schritt * MASS);
    }
    /**
     * Auf der Plattform gehen: erst aufstehen, weich anfahren, vor dem Ziel abbremsen, nie ueber den Rand.
     * Wechselt die Richtung, bremst sie ab und dreht sich erst, dann geht sie los.
     */
    function gehe(k: KatzenZustand, dt: number, fertig: () => void) {
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
      if (!k.art.startsWith("gang") || k.wechsel < 0.75) return; // steht noch auf
      const soll = Math.min(k.tempo, 25 + Math.abs(dx) * 3);
      k.v += (soll - k.v) * Math.min(1, dt * 5);
      bewege(k, k.richtung * Math.min(Math.abs(dx), k.v * dt));
      k.energie -= dt * (k.tempo > 120 ? 0.012 : 0.004);
    }
    function planeSprung(k: KatzenZustand, s: Sprung, tempo: number, hocke: number, nach: (() => void) | null = null) {
      k.plan = s;
      k.ziel = s.start;
      k.hockeZeit = hocke;
      k.tempo = tempo;
      k.nachLandung = nach;
      k.fest = true;
      setzeModus(k, "anlauf");
    }
    function abheben(k: KatzenZustand, vx: number, vy: number) {
      k.vx = vx;
      k.vy = vy;
      if (Math.abs(vx) > 20) k.richtung = vx > 0 ? 1 : -1;
      // Abdruck: der Koerper streckt sich entlang der Flugrichtung, die Feder zieht ihn dann zurueck.
      k.sx = 0.94;
      k.sy = 1.1;
      k.vsx = 0;
      k.vsy = 0;
      k.energie -= 0.03;
      setzeModus(k, "flug");
    }
    function starteFall(k: KatzenZustand) {
      k.plan = null;
      k.vx = 0;
      k.vy = 0;
      k.v = 0;
      k.nachLandung = null;
      setzeModus(k, "flug");
    }
    function lande(k: KatzenZustand, p: Plattform) {
      k.plat = p;
      k.fy = p.y;
      k.vx = 0;
      k.vy = 0;
      k.v = 0;
      k.plan = null;
      k.timer = 0.3;
      k.neigung = 0;
      // Aufprall: einfedern und mit gedaempfter Feder zurueckschwingen; der Schwanz schlaegt nach.
      k.sx = 1.08;
      k.sy = 0.88;
      k.vsx = 0;
      k.vsy = 0;
      k.schwanzKick = 26;
      setzeModus(k, "landen");
    }
    function bodenPlattform(vw: number, vh: number): Plattform {
      return { x1: 0, x2: vw, y: bodenY(vh), el: null };
    }
    function arbeitet(jetzt: number): boolean {
      return jetzt - eingabe.current.taste < 10000 || jetzt - eingabe.current.klick < 4000;
    }

    function hinlegen(k: KatzenZustand, zumSchlafen: boolean) {
      k.schlafGeplant = zumSchlafen;
      k.liegeArt = zumSchlafen || Math.random() < 0.6 ? "brotlaib" : "sphinx";
      setzeModus(k, "liegen");
      k.timer = zumSchlafen ? zufall(5, 10) : zufall(10, 24);
    }
    function treteln(k: KatzenZustand) {
      setzeModus(k, "treteln");
      k.v = 0;
      k.timer = zufall(2.2, 3.6);
    }
    function einschlafen(k: KatzenZustand) {
      setzeModus(k, "schlafen");
      k.timer = zufall(35, 70);
    }

    /** Auf dem Platz, auf dem sie steht, einen Liegeplatz einrichten: ein paar Schritte, treteln, hinlegen. */
    function liegeplatzHier(k: KatzenZustand) {
      const p = k.plat;
      const breit = p.x2 - p.x1 >= 150;
      const los = () => treteln(k);
      const ziel = breit ? freierPunkt(k, k.fx - 70, k.fx + 70) : null;
      if (ziel !== null) {
        geheZu(k, ziel, TEMPO_SCHLEICHEN + 8, los);
      } else {
        los();
      }
    }

    /** Vor dem Zeiger ausweichen: weit weg springen, sonst ans andere Ende der Plattform, sonst bleiben. */
    function weiche(k: KatzenZustand, zg: Zeiger | null, alle: Plattform[]) {
      const px = zg?.x ?? k.fx;
      const py = zg?.y ?? k.fy;
      const abst = (x: number, y: number) => Math.hypot(x - px, y - py);
      const ziele = guteZiele(k, alle);
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
      const angekommen = () => {
        sitzen(k, zufall(1.5, 3));
        k.abkuehlung = 0.8;
      };
      k.naheZeit = 0;
      if (bester && besteWeite >= 260) {
        planeSprung(k, bester, TEMPO_TRAB, 0.18);
      } else if (endeWeite > abst(k.fx, k.fy) + 120) {
        geheZu(k, endeX, TEMPO_TRAB, angekommen, true);
      } else if (bester) {
        planeSprung(k, bester, TEMPO_TRAB, 0.18);
      } else {
        sitzen(k, 1.5);
        k.abkuehlung = 1.5;
      }
    }

    /** Eine Plattform, auf oder in der gerade geschrieben wird: dort hat sie nichts zu suchen. */
    function istInArbeit(p: Plattform): boolean {
      const aktiv = document.activeElement;
      if (!p.el || !aktiv || aktiv === document.body) return false;
      return inEingabefeld(aktiv) && (p.el === aktiv || p.el.contains(aktiv));
    }
    /** Sprungziele, an denen sie niemanden stoert: nicht im Feld, in dem geschrieben wird, nicht vor Knoepfen und Feldern. */
    function guteZiele(k: KatzenZustand, alle: Plattform[]): Sprung[] {
      return sprungZiele(k.plat, alle).filter((s) => !istInArbeit(s.ziel) && platzFrei(s.landung, s.ziel.y));
    }
    /** Ein Punkt auf der eigenen Flaeche, an dem sie nichts Bedienbares verdeckt; null, wenn es keinen gibt. */
    function freierPunkt(k: KatzenZustand, von: number, bis: number): number | null {
      const p = k.plat;
      const a = Math.max(von, p.x1 + RAND);
      const e = Math.min(bis, p.x2 - RAND);
      for (let i = 0; i < 6; i++) {
        const x = zufall(a, Math.max(a, e));
        if (platzFrei(x, k.fy)) return x;
      }
      return null;
    }

    function naechsteAktivitaet(k: KatzenZustand, alle: Plattform[], jetzt: number) {
      const p = k.plat;
      const beschaeftigt = arbeitet(jetzt);
      const ziele = beschaeftigt ? [] : guteZiele(k, alle);
      const bummeln = () => {
        // Nicht quer durchs Fenster wandern, waehrend jemand arbeitet.
        const ziel = beschaeftigt ? freierPunkt(k, k.fx - 120, k.fx + 120) : freierPunkt(k, p.x1, p.x2);
        if (ziel === null || Math.abs(ziel - k.fx) < 30) sitzen(k, zufall(3, 6));
        else geheZu(k, ziel, TEMPO_GEHEN, null);
      };

      // Sitzt sie (nach einem Sturz, nach einem Umbau der Seite) vor etwas Bedienbarem, raeumt sie den Platz zuerst.
      if (!platzFrei(k.fx, k.fy)) {
        if (ziele.length > 0) planeSprung(k, ziele[Math.floor(Math.random() * ziele.length)], 70, 0.3);
        else bummeln();
        return;
      }

      // Lange nichts passiert: sie meldet sich einmal, dann doest sie.
      if (!k.gelangweilt && jetzt - eingabe.current.irgendwas > 120000) {
        k.gelangweilt = true;
        sag(k, "langeweile", 0.8);
        sitzen(k, zufall(3, 5));
        return;
      }

      // Muede: einen guten Platz suchen (breit und flach), sonst gleich hier.
      if (k.energie < 0.3) {
        if (ziele.length > 0 && p.x2 - p.x1 < 150) {
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
            planeSprung(k, best, 70, 0.4);
            return;
          }
        }
        k.schlafGeplant = true;
        liegeplatzHier(k);
        return;
      }

      const r = Math.random();
      if (r < 0.2) {
        setzeModus(k, "putzen");
        k.timer = zufall(5, 11);
        sag(k, "putzen", 0.12);
        return;
      }
      if (r < 0.32) {
        k.schlafGeplant = false;
        if (Math.random() < 0.5) liegeplatzHier(k);
        else hinlegen(k, false);
        return;
      }
      if (r < 0.58) {
        // Einfach sitzen und schauen -- das tun Katzen die meiste wache Zeit.
        if (beschaeftigt && k.tippPause <= 0) {
          k.tippPause = 90;
          sag(k, "tippen", 0.5);
        }
        sitzen(k, zufall(4, 9));
        return;
      }
      if (beschaeftigt) {
        if (r < 0.72) bummeln();
        else sitzen(k, zufall(4, 9));
        return;
      }
      // Die beruehmten fuenf Minuten: selten, nur ausgeruht und nur auf breiter Flaeche.
      if (r < 0.62 && k.energie > 0.6 && k.flitzPause <= 0 && p.x2 - p.x1 > 420) {
        k.flitzRunden = Math.floor(zufall(2, 5));
        k.flitzPause = zufall(150, 300);
        sag(k, "flitzen", 0.7);
        flitze(k);
        return;
      }
      if (r < 0.8 || ziele.length === 0) {
        bummeln();
        return;
      }
      planeSprung(k, ziele[Math.floor(Math.random() * ziele.length)], 70, 0.4, () => {
        sag(k, "gelandet", 0.1);
        sitzen(k, zufall(1.5, 4));
      });
    }

    function flitze(k: KatzenZustand) {
      const p = k.plat;
      const ziel = k.fx < (p.x1 + p.x2) / 2 ? p.x2 - RAND - zufall(0, 60) : p.x1 + RAND + zufall(0, 60);
      geheZu(
        k,
        ziel,
        300,
        () => {
          k.flitzRunden -= 1;
          if (k.flitzRunden > 0) flitze(k);
          else sitzen(k, zufall(2, 4));
        },
        true,
      );
    }

    /** Kopfmitte auf dem Bildschirm. */
    function kopfOrt(k: KatzenZustand): [number, number] {
      const seite = k.sicht >= 0 ? 1 : -1;
      return [k.fx + (k.gezeigt.kx - 80) * MASS * seite, k.fy - (96 - k.gezeigt.ky) * MASS];
    }

    /** Taugt der Zeiger gerade als Beute? In Sichtweite, auf ihrer Hoehe, nicht ueber Bedienelementen. */
    function beuteInSicht(k: KatzenZustand, zg: Zeiger | null, jetzt: number, weit = 420): zg is Zeiger {
      if (!zg || zg.bedienung || jetzt - zg.t > 2500) return false;
      const dx = Math.abs(zg.x - k.fx);
      return dx > 50 && dx < weit && zg.y > k.fy - 150 && zg.y < k.fy + 40;
    }

    function katzeSchritt(k: KatzenZustand, dt: number, vw: number, vh: number, jetzt: number) {
      k.timer -= dt;
      k.modusZeit += dt;
      k.abkuehlung -= dt;
      k.patschPause -= dt;
      k.uninteressiert -= dt;
      k.jagdPause -= dt;
      k.flitzPause -= dt;
      k.streichelPause -= dt;
      k.tippPause -= dt;
      k.schreckPause -= dt;
      k.blasePause -= dt;
      const zg = zeiger.current;
      const boden = bodenY(vh);

      if (reduziert()) {
        k.fy = boden;
        setzeModus(k, "sitzen");
        // Kein Laufen: bei Annaeherung oder Klick wechselt sie per Schnitt die Seite.
        const nah = zg !== null && !b.gezogen && zeigerAbstand(zg, k.fx - KW / 2, KW, 80, k.fy + 3) < FLUCHT_RADIUS;
        if (nah || platzBitte.current) {
          const links = (zg?.x ?? k.fx) >= vw / 2;
          k.fx = links ? KW / 2 + 16 : vw - KW / 2 - 16;
          k.richtung = links ? 1 : -1;
          k.sicht = k.richtung;
        }
        platzBitte.current = false;
        if (!gegruesst) {
          gegruesst = true;
          sag(k, "auftritt", 1, true);
        }
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
              sitzen(k, 1);
            } else {
              starteFall(k);
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

      // --- Abgang: sie geht, statt zu verschwinden --------------------------
      if (gehtWeg.current && k.modus !== "abgang") {
        const amBoden = k.modus !== "flug" && k.modus !== "landen" && k.modus !== "hocke" && k.modus !== "anlauf";
        if (amBoden) {
          if (k.plat.el !== null) {
            const wege = sprungZiele(k.plat, [bodenPlattform(vw, vh)], Infinity);
            if (wege.length > 0) planeSprung(k, wege[0], TEMPO_TRAB, 0.2);
            else {
              k.plat = bodenPlattform(vw, vh);
              starteFall(k);
            }
          } else {
            sag(k, "abgang", 0.7, true);
            k.richtung = k.fx < vw / 2 ? -1 : 1;
            k.tempo = TEMPO_TRAB;
            k.timer = 9;
            setzeModus(k, "abgang");
          }
        }
      }

      // --- Der Zeiger -------------------------------------------------------
      const frei = !b.gezogen && !gehtWeg.current;
      const abstand = zg && frei ? zeigerAbstand(zg, k.fx - KW / 2, KW, 80, k.fy + 3) : Infinity;
      const zeigerRuht = !zg || jetzt - zg.t > 140;
      const tempoZeiger = zeigerRuht ? 0 : zg.v;
      const aufIhr =
        !!zg && frei && Math.abs(zg.x - k.fx) < 42 && zg.y < k.fy + 4 && zg.y > k.fy - koerperHoehe(k.art);
      const ansprechbar = ANSPRECHBAR.has(k.modus) || (k.modus === "gehen" && !k.fest);

      if (platzBitte.current) {
        platzBitte.current = false;
        if (frei && (ansprechbar || k.modus === "lauern" || k.modus === "fangen")) {
          const tief = k.modus === "schlafen" ? 0.8 : k.modus === "liegen" ? 0.5 : 0.2;
          setzeModus(k, "weichen");
          k.timer = tief;
          k.v = 0;
        }
      } else if (ansprechbar && frei && k.abkuehlung <= 0) {
        if (k.modus !== "schlafen" && k.schreckPause <= 0 && abstand < 70 && tempoZeiger > 2600 && (aufIhr || (k.fx - zg!.x) * zg!.rx > 0)) {
          // Etwas schiesst genau auf sie zu: Buckel, dann weg. Ein Zeiger, der nur zuegig vorbeizieht, zaehlt nicht.
          k.schreckPause = 25;
          setzeModus(k, "schreck");
          k.timer = 0.55;
          k.v = 0;
          k.schwanzKick = 30;
          sag(k, "schreck", 0.8, true);
        } else if (aufIhr && tempoZeiger < 260) {
          k.streichelZeit += dt;
          k.naheZeit = 0;
          if (k.streichelZeit > 0.45 && k.modus !== "geniessen" && k.streichelPause <= 0) {
            if (k.modus === "schlafen") {
              // Im Schlaf gestreichelt: sie schnurrt, wacht aber nicht auf.
              if (k.ohrT < 0) k.ohrT = 0;
              sag(k, "schnurren", 0.5);
              k.streichelZeit = 0;
            } else if (WACH_UND_RUHIG.has(k.modus)) {
              k.unterlage = k.modus === "liegen" ? k.liegeArt : "sitzen";
              setzeModus(k, "geniessen");
              k.timer = zufall(8, 14);
              sag(k, "schnurren", 1, true);
            }
          }
        } else {
          k.streichelZeit = Math.max(0, k.streichelZeit - dt * 2);
          // Der Zeiger arbeitet neben ihr (nah UND in Bewegung): erst zuckt der Schwanz, dann macht sie Platz.
          if (abstand < FLUCHT_RADIUS && jetzt - (zg?.t ?? 0) < 1000 && k.modus !== "geniessen") k.naheZeit += dt;
          else k.naheZeit = Math.max(0, k.naheZeit - dt * 0.7);
          const geduld = k.modus === "schlafen" ? 3.2 : 1.5;
          if (k.naheZeit > geduld) {
            const tief = k.modus === "schlafen" ? 0.8 : k.modus === "liegen" ? 0.5 : 0.2;
            setzeModus(k, "weichen");
            k.timer = tief;
            k.v = 0;
          }
        }
      }

      // Jagdtrieb: ein Zeiger, der in Sichtweite zappelt, waehrend niemand arbeitet.
      const jagdbereit =
        (k.modus === "sitzen" || (k.modus === "liegen" && k.liegeArt === "sphinx") || (k.modus === "gehen" && !k.fest)) &&
        frei &&
        !spielzeug &&
        k.jagdPause <= 0 &&
        k.energie > 0.35 &&
        !arbeitet(jetzt);
      if (jagdbereit && beuteInSicht(k, zg, jetzt) && tempoZeiger > 70 && tempoZeiger < 1300) k.jagdReiz += dt;
      else k.jagdReiz = Math.max(0, k.jagdReiz - dt * 1.5);
      if (jagdbereit && k.jagdReiz > 0.8 && zg) {
        k.jagdReiz = 0;
        k.richtung = zg.x > k.fx ? 1 : -1;
        k.v = 0;
        setzeModus(k, "lauern");
        k.timer = zufall(1.3, 2.2);
        sag(k, "lauern", 0.45);
      }

      switch (k.modus) {
        case "sitzen": {
          if (!gegruesst) {
            gegruesst = true;
            sag(k, "auftritt", 1, true);
          }
          if (spielzeug && k.uninteressiert <= 0) {
            k.spielzeit = 0;
            k.tempo = 120;
            setzeModus(k, "spielen");
            break;
          }
          k.energie -= dt * 0.0025;
          if (k.timer > 0) break;
          naechsteAktivitaet(k, alle, jetzt);
          break;
        }
        case "gehen":
          gehe(k, dt, () => {
            const d = k.danach;
            k.danach = null;
            k.fest = false;
            k.v = 0;
            if (d) d();
            else if (k.liegenGeplant) {
              k.liegenGeplant = false;
              k.schlafGeplant = true;
              treteln(k);
            } else sitzen(k, zufall(3, 7));
          });
          break;
        case "weichen":
          if (k.timer <= 0) {
            sag(k, "platzMachen", 0.5);
            weiche(k, zg, alle);
          }
          break;
        case "schreck":
          if (k.timer <= 0) weiche(k, zg, alle);
          break;
        case "anlauf":
          gehe(k, dt, () => {
            // Ziel anvisieren, dann Hocke: erst gucken, dann springen.
            const s = k.plan;
            if (!s) {
              sitzen(k, 1);
              return;
            }
            if (Math.abs(s.landung - k.fx) > 10) k.richtung = s.landung > k.fx ? 1 : -1;
            setzeModus(k, "hocke");
            k.timer = k.hockeZeit;
            k.v = 0;
          });
          break;
        case "hocke": {
          const s = k.plan;
          if (!s) {
            sitzen(k, 1);
            break;
          }
          if (k.timer > 0) break;
          // Zielkante live lesen: seit dem Planen kann gescrollt worden sein.
          let ly = s.ziel.y;
          if (s.ziel.el) {
            const r = s.ziel.el.getBoundingClientRect();
            if (!s.ziel.el.isConnected || !plattformGueltig(r, vh, boden)) {
              sitzen(k, 1);
              break;
            }
            ly = r.top;
          } else {
            ly = boden;
          }
          const bahn = sprungBahn(k.fx, k.fy, s.landung, ly);
          abheben(k, bahn.vx, bahn.vy);
          break;
        }
        case "flug": {
          const vorher = k.fy;
          k.vy += GRAVITATION * dt;
          k.fx = begrenzt(k.fx + k.vx * dt, 20, vw - 20);
          k.fy += k.vy * dt;
          k.neigung = Math.max(-34, Math.min(34, Math.atan2(k.vy, Math.max(Math.abs(k.vx), 80)) * (180 / Math.PI) * 0.5));
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
              if (gueltig) lande(k, p);
            }
          }
          break;
        }
        case "landen":
          if (k.timer <= 0) {
            const nach = k.nachLandung;
            k.nachLandung = null;
            k.fest = false;
            if (nach) nach();
            else if (k.liegenGeplant) {
              k.liegenGeplant = false;
              k.schlafGeplant = true;
              sag(k, "liegeplatz", 0.35);
              liegeplatzHier(k);
            } else sitzen(k, zufall(0.8, 2));
          }
          break;
        case "putzen":
          if (k.timer <= 0) sitzen(k, zufall(2, 5));
          break;
        case "treteln":
          if (k.timer <= 0) hinlegen(k, k.schlafGeplant);
          break;
        case "liegen":
          k.energie += dt * 0.003;
          if (k.timer > 0) break;
          if (k.schlafGeplant || k.energie < 0.5 || Math.random() < 0.15) {
            k.schlafGeplant = false;
            einschlafen(k);
          } else if (Math.random() < 0.5) {
            setzeModus(k, "strecken");
          } else {
            sitzen(k, zufall(2, 5));
          }
          break;
        case "schlafen":
          k.energie = Math.min(1, k.energie + dt * 0.012);
          if (Math.random() < dt / 40) sag(k, "traum", 1);
          if (k.timer <= 0 && k.energie >= 0.9) {
            setzeModus(k, "aufwachen");
            sag(k, "aufwachen", 0.4);
          }
          break;
        case "aufwachen":
          // Erst der Kopf hoch, dann ein grosses Gaehnen, dann das Strecken.
          if (k.gaehnT < 0 && k.modusZeit > 0.9 && k.modusZeit < 1.0) {
            k.gaehnT = 0;
            sag(k, "gaehnen", 0.5);
          }
          if (k.modusZeit >= AUFWACH_DAUER) sitzen(k, zufall(2, 4));
          break;
        case "strecken":
          if (k.modusZeit >= STRECK_DAUER) sitzen(k, zufall(2, 4));
          break;
        case "geniessen": {
          // Solange der Zeiger auf ihr ruht, bleibt sie. Geht er, schaut sie ihm kurz nach.
          if (!aufIhr) {
            if (k.streichelZeit <= 0) sitzenOderLiegen(k);
            break;
          }
          if (Math.random() < dt / 5) sag(k, "schnurren", 1);
          if (k.timer <= 0) {
            // Irgendwann reicht es -- von einem Moment auf den anderen.
            k.streichelPause = zufall(12, 25);
            k.streichelZeit = 0;
            sag(k, "genug", 0.8, true);
            setzeModus(k, "weichen");
            k.timer = 0.5;
          }
          break;
        }
        case "lauern": {
          k.energie -= dt * 0.01;
          // Bricht ab, wenn die Beute weg ist oder jemand zu arbeiten beginnt.
          if (!beuteInSicht(k, zg, jetzt, 480) || arbeitet(jetzt)) {
            if (k.modusZeit > 0.5 || !zg) {
              k.jagdPause = zufall(10, 20);
              sitzen(k, zufall(2, 4));
            }
            break;
          }
          if (Math.abs(zg.x - k.fx) > 14) k.richtung = zg.x > k.fx ? 1 : -1;
          if (k.timer > 0) break;
          // Sprung auf die Beute -- nur auf der eigenen Flaeche, nie blind ueber die Kante.
          const ziel = begrenzt(zg.x - k.richtung * 16, k.plat.x1 + RAND, k.plat.x2 - RAND);
          k.jagdPause = zufall(30, 60);
          k.energie -= 0.08;
          k.hiebe = Math.random() < 0.5 ? 2 : 1;
          if (Math.abs(ziel - k.fx) < 40) {
            beginneFangen(k);
            break;
          }
          const bahn = sprungBahn(k.fx, k.fy, ziel, k.fy, 26);
          k.nachLandung = () => beginneFangen(k);
          abheben(k, bahn.vx, bahn.vy);
          break;
        }
        case "fangen": {
          if (k.timer > 0) break;
          k.hiebe -= 1;
          if (k.hiebe > 0) {
            k.timer = 0.36;
            k.modusZeit = 0;
            break;
          }
          const erwischt = !!zg && Math.abs(zg.x - k.fx) < 95 && zg.y > k.fy - 110;
          sag(k, erwischt ? "gefangen" : "verfehlt", 0.75, true);
          k.naheZeit = -1.5; // sie darf kurz stolz neben ihrer Beute sitzen, bevor sie Platz macht
          if (erwischt) sitzen(k, zufall(2, 3.5));
          else {
            // Uebersprungshandlung: nach dem Fehlgriff putzt sie sich, als waere nichts gewesen.
            setzeModus(k, "putzen");
            k.timer = zufall(3, 5);
          }
          break;
        }
        case "abgang": {
          if (k.plat.el !== null) {
            sitzen(k, 0.2);
            break;
          }
          if (Math.abs(k.sicht - k.richtung) < 0.3 && k.art.startsWith("gang") && k.wechsel > 0.75) {
            k.v += (k.tempo - k.v) * Math.min(1, dt * 4);
            bewege(k, k.richtung * k.v * dt);
          }
          if (k.fx < -KW || k.fx > vw + KW || k.timer <= 0) {
            gehtWeg.current = false;
            setKatze(false);
            setBlase(null);
          }
          break;
        }
        case "spielen": {
          if (!spielzeug || k.uninteressiert > 0) {
            sitzen(k, 2);
            break;
          }
          k.spielzeit += dt;
          if (k.spielzeit > 25) {
            // Irgendwann ist auch eine Katze muede vom Spielen.
            k.uninteressiert = 15;
            sitzen(k, 1);
            break;
          }
          const bodenPl = bodenPlattform(vw, vh);
          if (k.plat.el !== null) {
            // Das Knaeuel liegt unten: erst von der Seite herunterspringen, auf der es naeher liegt.
            const wege = sprungZiele(k.plat, [bodenPl], Infinity);
            if (wege.length === 0) {
              k.uninteressiert = 15;
              sitzen(k, 1);
              break;
            }
            wege.sort((u, w) => Math.abs(u.landung - b.x) - Math.abs(w.landung - b.x));
            planeSprung(k, wege[0], 110, 0.3);
            break;
          }
          const dx = b.x - k.fx;
          const weite = Math.abs(dx);
          if (weite > 8) k.richtung = dx > 0 ? 1 : -1;
          if (weite > 85) {
            k.tempo = weite > 220 ? 190 : 110;
            if (Math.abs(k.sicht - k.richtung) < 0.3 && k.wechsel > 0.75) {
              k.v += (k.tempo - k.v) * Math.min(1, dt * 5);
              bewege(k, k.richtung * Math.min(weite - 85, k.v * dt));
              k.energie -= dt * 0.006;
            }
          } else {
            k.v = 0;
            const hoch = b.y < boden - 70;
            if (!hoch && !b.gezogen && k.patschPause <= 0 && Math.abs(b.vx) < 250 && weite > 25) {
              setzeModus(k, "patschen");
              k.timer = 0.4;
              k.gekickt = false;
              k.hiebZiel = [116, 78];
            }
          }
          break;
        }
        case "patschen":
          if (!k.gekickt && k.timer <= 0.2) {
            k.gekickt = true;
            b.vx = k.richtung * zufall(240, 440);
            b.vy = -zufall(160, 320);
            sag(k, "wolle", 0.2);
          }
          if (k.timer <= 0) {
            k.patschPause = 0.5;
            setzeModus(k, "spielen");
          }
          break;
      }
    }

    function sitzenOderLiegen(k: KatzenZustand) {
      if (k.unterlage === "sitzen") sitzen(k, zufall(2, 5));
      else {
        k.liegeArt = k.unterlage;
        setzeModus(k, "liegen");
        k.timer = zufall(6, 14);
      }
    }

    function beginneFangen(k: KatzenZustand) {
      const zg = zeiger.current;
      // Die Pfote schlaegt dorthin, wo der Zeiger ist -- soweit das Bein reicht.
      if (zg) {
        const seite = k.richtung;
        const lx = 80 + ((zg.x - k.fx) * seite) / MASS;
        const ly = 96 - (k.fy - zg.y) / MASS;
        k.hiebZiel = [begrenzt(lx, 104, 128), begrenzt(ly, 58, 94)];
      } else {
        k.hiebZiel = [118, 80];
      }
      setzeModus(k, "fangen");
      k.timer = 0.36;
      k.v = 0;
    }

    /** Die Haltung, die der Zustand verlangt (ohne Uebergang und ohne "Leben"). */
    function sollHaltung(k: KatzenZustand): Haltung {
      switch (k.modus) {
        case "sitzen":
        case "weichen":
          return HALTUNG.sitzen;
        case "geniessen": {
          const g = HALTUNG[k.unterlage];
          return { ...g, auge: 0.04, ohr: 0.2, kw: g.kw - 9, ky: g.ky - 1.5, kx: g.kx + 1.3 * Math.sin(k.zeit * 2.1) };
        }
        case "putzen":
          return putzHaltung(k.modusZeit);
        case "treteln":
          return tretelHaltung(k.modusZeit);
        case "liegen":
          return HALTUNG[k.liegeArt];
        case "schlafen":
          return HALTUNG.eingerollt;
        case "aufwachen":
          return aufwachHaltung(k.modusZeit);
        case "strecken":
          return streckHaltung(k.modusZeit);
        case "lauern":
          return lauerHaltung(k.zeit, k.timer < 0.55 ? 1 : 0);
        case "hocke":
          return lauerHaltung(k.zeit, k.timer < 0.25 ? 1 : 0);
        case "flug":
          return mische(HALTUNG.flugAuf, HALTUNG.flugAb, weich((k.vy + 260) / 520));
        case "landen":
          return mische(HALTUNG.lauern, HALTUNG.stehen, weich(1 - k.timer / 0.3));
        case "schreck":
          return HALTUNG.buckel;
        case "fangen":
          return mitPfotenhieb(mische(HALTUNG.stehen, HALTUNG.lauern, 0.55), 1 - k.timer / 0.36, k.hiebZiel[0], k.hiebZiel[1]);
        case "patschen":
          return mitPfotenhieb(HALTUNG.stehen, 1 - k.timer / 0.4, k.hiebZiel[0], k.hiebZiel[1]);
        default: {
          const tief = k.tempo <= TEMPO_SCHLEICHEN;
          return gangHaltung(tief ? HALTUNG.schleichen : HALTUNG.stehen, k.phase, k.blend, k.tempo > 120 ? TRAB : SCHRITT);
        }
      }
    }

    /**
     * Was eine Katze nie abstellt: Atmen, Blinzeln, Ohrenspiel, der Blick, der
     * dem Zeiger folgt, und der Schwanz, der ihre Stimmung verraet.
     */
    function beleben(k: KatzenZustand, h: Haltung, dt: number, jetzt: number): Haltung {
      const o = { ...h, schwanz: h.schwanz.slice() };
      const zg = zeiger.current;
      const ruht = k.modus === "schlafen" || k.modus === "liegen" || k.modus === "sitzen" || k.modus === "geniessen";

      // Atmen: im Schlaf langsam und tief.
      if (ruht || k.modus === "putzen" || k.modus === "lauern") {
        const atem = Math.sin((k.zeit * 2 * Math.PI) / (k.modus === "schlafen" ? 4.2 : 3));
        o.rund *= 1 + 0.016 * atem;
        o.sy -= 0.35 * atem;
      }

      // Blinzeln und Ohrenzucken kommen unregelmaessig.
      k.blinzelIn -= dt;
      if (k.blinzelIn <= 0) {
        k.blinzelIn = zufall(2.2, 7);
        k.blinzelT = 0;
      }
      if (k.blinzelT >= 0) {
        k.blinzelT += dt / 0.17;
        o.auge *= 1 - glocke(k.blinzelT);
        if (k.blinzelT >= 1) k.blinzelT = -1;
      }
      k.ohrIn -= dt;
      if (k.ohrIn <= 0) {
        k.ohrIn = zufall(3, 9);
        k.ohrT = 0;
      }
      if (k.ohrT >= 0) {
        k.ohrT += dt / 0.28;
        o.ohr += 0.45 * glocke(k.ohrT);
        if (k.ohrT >= 1) k.ohrT = -1;
      }
      if (k.gaehnT >= 0) {
        k.gaehnT += dt / 1.7;
        const g = glocke(k.gaehnT);
        o.maul = g;
        o.auge *= 1 - 0.95 * g;
        o.kw -= 12 * g;
        o.ohr += 0.3 * g;
        if (k.gaehnT >= 1) k.gaehnT = -1;
      }

      // Blick: die Pupillen folgen dem Zeiger, der Kopf neigt sich mit.
      const wach = o.auge > 0.3;
      if (zg && wach && jetzt - zg.t < 4000) {
        const [kx, ky] = kopfOrt(k);
        const seite = k.sicht >= 0 ? 1 : -1;
        const lx = (zg.x - kx) * seite;
        const ly = zg.y - ky;
        o.blickX = begrenzt(lx / 140, -1, 1);
        o.blickY = begrenzt(ly / 140, -1, 1);
        if (o.dreh < 0.5 && lx > 0) o.kw += begrenzt((Math.atan2(ly, lx) * 180) / Math.PI, -16, 20) * 0.45 * (1 - o.dreh);
        // Bewegt sich etwas, werden die Pupillen gross.
        if (jetzt - zg.t < 600 && zg.v > 60) o.pupille = Math.max(o.pupille, 0.45 + 0.4 * Math.min(k.jagdReiz, 1));
      }

      // Schwanz: ruhiges Pendeln der Spitze; genervt schlaegt er, auf der Lauer zuckt nur die Spitze.
      let amp = 0;
      let hz = 0.35;
      let gewicht = [0, 0, 0.2, 0.6, 1];
      if (k.modus === "lauern" || k.modus === "hocke") {
        amp = 15;
        hz = 3;
        gewicht = [0, 0, 0, 0.4, 1];
      } else if (k.naheZeit > 0.35 && ANSPRECHBAR.has(k.modus) && k.modus !== "schlafen") {
        amp = 24;
        hz = 1.5;
      } else if (k.art.startsWith("gang")) {
        amp = 6 + 4 * k.blend;
        hz = 0.5 + k.blend * 0.6;
        gewicht = [0.25, 0.45, 0.65, 0.85, 1];
      } else if (k.modus === "sitzen" || k.modus === "liegen" || k.modus === "putzen") {
        amp = 9;
      } else if (k.modus === "geniessen") {
        amp = 6;
        hz = 0.25;
      } else if (k.modus === "schreck") {
        amp = 4;
        hz = 6;
      }
      k.schwanzAmp += (amp - k.schwanzAmp) * Math.min(1, dt * 4);
      k.schwanzPhase += dt * hz * 2 * Math.PI;
      k.schwanzKick *= Math.exp(-dt * 5);
      for (let i = 0; i < 5; i++) {
        // Nachlauf: jedes Glied haengt dem davor etwas hinterher.
        o.schwanz[i] += k.schwanzAmp * gewicht[i] * Math.sin(k.schwanzPhase - i * 0.55) + k.schwanzKick * gewicht[i];
      }
      return o;
    }

    /** Wohin der Kopf beim Sitzen und Liegen gedreht ist: zum Betrachter, oder dem nach, was sich bewegt. */
    function kopfDrehen(k: KatzenZustand, h: Haltung, dt: number, jetzt: number): Haltung {
      const zg = zeiger.current;
      const schaut = k.art === "sitzen" || k.art === "liegen:brotlaib" || k.art.startsWith("geniessen");
      if (!schaut) {
        // Sonst gibt die Haltung den Kopf vor; gemerkt wird er, damit das Schauen danach dort ansetzt.
        k.dreh = h.dreh;
        k.hinterIhr = 0;
        return h;
      }
      if (k.modus === "geniessen") {
        k.drehZiel = 1;
      } else if (zg && jetzt - zg.t < 2500) {
        const [kx] = kopfOrt(k);
        const lx = (zg.x - kx) * (k.sicht >= 0 ? 1 : -1);
        k.drehZiel = lx > 90 ? 0 : 1;
        // Tut sich hinter ihr dauernd etwas, dreht sie sich um.
        k.hinterIhr = lx < -110 && zg.v > 40 ? k.hinterIhr + dt : 0;
        if (k.hinterIhr > 1.6 && k.modus === "sitzen") {
          k.hinterIhr = 0;
          k.richtung = k.richtung === 1 ? -1 : 1;
        }
      } else {
        k.umsehen -= dt;
        if (k.umsehen <= 0) {
          k.umsehen = zufall(3, 8);
          k.drehZiel = Math.random() < 0.65 ? 1 : 0;
        }
      }
      k.dreh += (k.drehZiel - k.dreh) * Math.min(1, dt * 5);
      // Waehrend sie sich erst hinsetzt, fuehrt noch der Uebergang.
      return { ...h, dreh: h.dreh + (k.dreh - h.dreh) * k.wechsel };
    }

    function zeichne(k: KatzenZustand, dt: number, jetzt: number) {
      const art = artVon(k);
      if (art !== k.art) {
        k.von = k.gezeigt;
        k.wechsel = 0;
        k.wechselDauer = wechselDauer(k.art, art);
        k.art = art;
      }
      let h = sollHaltung(k);
      if (k.wechsel < 1) {
        k.wechsel = Math.min(1, k.wechsel + dt / k.wechselDauer);
        h = mische(k.von, h, weich(k.wechsel));
      }
      h = kopfDrehen(k, h, dt, jetzt);
      k.gezeigt = h;
      // Ruhende Katze: die Figur muss nicht 60-mal je Sekunde neu gerechnet werden.
      k.zeichnePause -= dt;
      const ruhig = k.wechsel >= 1 && (k.modus === "schlafen" || k.modus === "liegen" || k.modus === "sitzen");
      if (ruhig && k.zeichnePause > 0) return;
      k.zeichnePause = k.modus === "schlafen" ? 1 / 15 : 1 / 30;
      const lebendig = beleben(k, h, ruhig ? Math.max(dt, k.modus === "schlafen" ? 1 / 15 : 1 / 30) : dt, jetzt);
      if (rigRef.current) rigZeichnen(rigRef.current, lebendig);
    }

    function schritt(dt: number, jetzt: number) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ballBoden = bodenY(vh) - 2 - BALL_R;
      if (spielzeug) {
        if (!b.gezogen && !reduziert()) ballSchritt(b, dt, vw, ballBoden, BALL_R);
        if (!b.gezogen && b.y > ballBoden) b.y = ballBoden;
        const el = ballRef.current;
        if (el) el.style.transform = `translate3d(${b.x - BALL_R}px, ${b.y - BALL_R}px, 0) rotate(${b.drehung}deg)`;
      }
      if (!katze) return;
      const k = z.current;
      k.bewegt = false;
      k.zeit += dt;
      katzeSchritt(k, dt, vw, vh, jetzt);
      const el = katzeRef.current;
      if (el && el.dataset.modus !== k.modus) el.dataset.modus = k.modus;
      if (el) el.style.transform = `translate3d(${k.fx - KW / 2}px, ${k.fy - FUSS}px, 0)`;

      if (reduziert()) {
        // Still: einmal zeichnen, danach nur noch die Position (Schnitt beim Ausweichen).
        if (!stillGezeichnet && rigRef.current) {
          rigZeichnen(rigRef.current, HALTUNG.sitzen);
          k.gezeigt = HALTUNG.sitzen;
          stillGezeichnet = true;
        }
        if (dreherRef.current) dreherRef.current.style.transform = `scaleX(${k.richtung})`;
        return;
      }
      stillGezeichnet = false;

      // Gangblende: die Fuesse gehen in die Standposition, wenn sie nicht laeuft.
      // Beim Losgehen schnell (sonst rutschen die ersten Schritte), beim Anhalten weicher.
      k.blend += ((k.bewegt ? 1 : 0) - k.blend) * Math.min(1, dt * (k.bewegt ? 20 : 8));
      // Blickrichtung dreht weich (ca. 0,2 s), nicht per Spiegeln.
      const dR = k.richtung - k.sicht;
      k.sicht += Math.max(-dt * 10, Math.min(dt * 10, dR));
      // Stauchen/Strecken als gedaempfte Feder; Ziel haengt von der Phase des Sprungs ab.
      let zx = 1;
      let zy = 1;
      if (k.modus === "flug") {
        zx = k.vy < 0 ? 0.96 : 0.98;
        zy = k.vy < 0 ? 1.05 : 1.03;
      } else {
        k.neigung *= Math.exp(-dt * 14);
      }
      [k.sx, k.vsx] = feder(k.sx, k.vsx, zx, dt);
      [k.sy, k.vsy] = feder(k.sy, k.vsy, zy, dt);
      zeichne(k, dt, jetzt);
      // Beim Drehen nie ganz flach: eine Katze im Profil hat keine Vorderansicht, also bleibt sie schmal sichtbar.
      const breite = 0.4 + 0.6 * Math.abs(k.sicht);
      const sx = (k.sicht >= 0 ? 1 : -1) * breite;
      if (dreherRef.current)
        dreherRef.current.style.transform = `scaleX(${sx.toFixed(3)}) rotate(${k.neigung.toFixed(1)}deg) scale(${k.sx.toFixed(3)}, ${k.sy.toFixed(3)})`;
    }

    const tick = (jetzt: number) => {
      const dt = Math.min(0.05, (jetzt - zuletzt) / 1000);
      zuletzt = jetzt;
      schritt(dt, jetzt);
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
        <div className={`zv-katze${still ? " zv-katze--ruhig" : ""}`} ref={katzeRef} aria-hidden="true">
          {blase && (
            <span
              className={`zv-katze__blase${blase.gedanke ? " zv-katze__blase--gedanke" : ""}${blase.seitlich ? " zv-katze__blase--seitlich" : ""}${blase.links ? " zv-katze__blase--links" : ""}`}
              key={blase.n}
              style={
                {
                  "--versatz": `${blase.versatz}px`,
                  "--kopf-x": `${blase.kopfX}px`,
                  "--hoehe": `${blase.hoehe}px`,
                  animationDuration: `${blase.dauer}s`,
                } as React.CSSProperties
              }
            >
              {blase.t}
            </span>
          )}
          {schlaeft && (
            <span className="zv-katze__zzz">
              <span>z</span>
              <span>z</span>
              <span>z</span>
            </span>
          )}
          <div className="zv-katze__dreher" ref={dreherRef}>
            <svg viewBox="0 0 160 100" width={KW} height={80} className="zv-katze__svg">
              <KatzenFigur rigRef={rigRef} />
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
