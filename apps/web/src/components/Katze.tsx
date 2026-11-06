import { useEffect, useRef, useState } from "react";
import { type Ball, FLUCHT_RADIUS, ballSchritt, fluchtziel, spazierziel, zeigerAbstand } from "./katzen-logik";

/**
 * Easter Eggs: eine kleine Begleit-Katze und ein Wollknaeuel.
 *
 *   Alt+Umschalt+K   Katze erscheint / geht wieder
 *   Alt+Umschalt+S   Wollknaeuel (Spielzeug) erscheint / verschwindet
 *
 * Bewusste Entscheidungen:
 *  - Tasten ueber `event.code`: auf dem Mac erzeugt Option ein Sonderzeichen,
 *    `event.key` waere dort nicht "k". Weder Browser noch App belegen die
 *    Kombinationen. In Eingabefeldern passiert nie etwas.
 *  - Die Katze sitzt am unteren Rand, laeuft, putzt sich und schlaeft. Kommt
 *    der Mauszeiger in ihre Naehe, steht sie auf und geht auf die andere
 *    Seite -- sie soll nie etwas verdecken, das man gerade bedienen will.
 *    Eine Ausnahme: Haelt man das Spielzeug in der Hand, bleibt sie, denn
 *    dann will man ja mit ihr spielen.
 *  - Die Schleife schreibt Positionen direkt ins DOM; React rendert nur bei
 *    Wechsel der Pose. 60 Renderdurchgaenge pro Sekunde waeren Verschwendung.
 *  - Kein Fremd-Asset, kein Ton: Inline-SVG und CSS, also auch offline da.
 *  - `pointer-events: none` ueberall ausser auf dem Wollknaeuel; `aria-hidden`.
 *  - prefers-reduced-motion: die Katze sitzt still und weicht dem Zeiger per
 *    Sprung aus, das Spielzeug folgt nur der Hand (keine Physik, kein Spiel).
 *  - Der Zustand lebt in sessionStorage: ein Neuladen im selben Tab behaelt
 *    die Katze, ein neuer Tab beginnt ohne sie.
 */

const KW = 128; // Anzeigebreite der Katze (px)
const KH = 80;
const RAND_UNTEN = 6;
const BALL_R = 16;
const BALL_RAND_UNTEN = 8;

type Pose = "gehen" | "sitzen" | "schlafen" | "putzen" | "patschen";
type Modus = "idle" | "gehen" | "aufstehen" | "flucht" | "jagen" | "patschen";

interface KatzenZustand {
  x: number;
  richtung: 1 | -1;
  pose: Pose;
  modus: Modus;
  timer: number;
  ziel: number;
  abkuehlung: number;
  patschPause: number;
  gekickt: boolean;
  spielzeit: number;
  uninteressiert: number;
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

function Kopf({ zu = false }: { zu?: boolean }) {
  return (
    <g>
      <path className="k-fell" d="M-12 -7 L-13 -23 L-1 -13 Z" />
      <path className="k-ohr" d="M-10.5 -10 L-11 -19 L-4 -13 Z" />
      <path className="k-fell" d="M3 -13 L13 -23 L14 -6 Z" />
      <path className="k-ohr" d="M5.5 -13 L12 -19.5 L12.5 -9 Z" />
      <ellipse className="k-fell" cx="0" cy="0" rx="16" ry="14.5" />
      <path className="k-streifen k-duenn" d="M-3 -13.5 L-3 -8 M2 -14 L2 -7.5 M-8 -12 L-7 -7.5 M-13 3 L-7 4 M-13 8 L-7 7" />
      <ellipse className="k-hell" cx="8" cy="6" rx="8.5" ry="6.2" />
      <path className="k-ohr" d="M11.5 2.4 L16.5 2.4 L14 5.8 Z" />
      <path className="k-linie" d="M14 5.8 L14 8 M14 8 Q11.5 11 8 9.5 M14 8 Q16 10.5 18 9" />
      <g className="k-augen">
        {zu ? (
          <path className="k-linie" d="M-0.5 -2.5 Q2.5 0.5 5.5 -2.5 M7.5 -2.5 Q10.5 0.5 13.5 -2.5" />
        ) : (
          <>
            <ellipse className="k-auge" cx="2.5" cy="-2.5" rx="3.4" ry="3.7" />
            <ellipse className="k-pupille" cx="3" cy="-2.5" rx="1.1" ry="3.1" />
            <ellipse className="k-auge" cx="10.5" cy="-2.5" rx="3" ry="3.4" />
            <ellipse className="k-pupille" cx="11" cy="-2.5" rx="1" ry="2.9" />
          </>
        )}
      </g>
      <path className="k-linie k-schnurr" d="M17 5 L30 2 M17 7 L30 8 M16 6 L29 5" />
    </g>
  );
}

function PoseGehen() {
  return (
    <>
      <g className="k-schwanz-g">
        <path className="k-schwanz" d="M34 56 C14 56 8 34 20 22" />
      </g>
      <g className="k-bein k-bein-a">
        <rect className="k-fell-dunkel" x="36" y="62" width="9" height="30" rx="4.5" />
        <ellipse className="k-hell" cx="41.5" cy="93" rx="6" ry="3.4" />
      </g>
      <g className="k-bein k-bein-b">
        <rect className="k-fell-dunkel" x="92" y="62" width="9" height="30" rx="4.5" />
        <ellipse className="k-hell" cx="97.5" cy="93" rx="6" ry="3.4" />
      </g>
      <path
        className="k-fell"
        d="M26 58 C24 44 40 38 62 38 C84 38 102 40 112 48 C118 56 112 70 96 72 C78 74 50 74 38 70 C30 67 27 63 26 58Z"
      />
      <path className="k-hell" d="M44 70 C60 76 90 76 102 70 C94 74 56 74 44 70Z" />
      <path className="k-streifen" d="M48 40 Q50 48 46 54 M62 38.5 Q65 47 60 55 M77 39 Q80 47 76 54 M92 41 Q94 47 91 52" />
      <g className="k-bein k-bein-b">
        <rect className="k-fell" x="50" y="62" width="10" height="30" rx="5" />
        <ellipse className="k-hell" cx="55" cy="93" rx="6.5" ry="3.6" />
      </g>
      <g className="k-bein k-bein-a k-bein-vn">
        <rect className="k-fell" x="104" y="62" width="10" height="30" rx="5" />
        <ellipse className="k-hell" cx="109" cy="93" rx="6.5" ry="3.6" />
      </g>
      <g transform="translate(126 45) rotate(6)">
        <Kopf />
      </g>
    </>
  );
}

function SitzKoerper({ vorderbein }: { vorderbein: boolean }) {
  return (
    <>
      <path className="k-schwanz" d="M40 93 C60 100 112 100 126 93 C131 91 132 86 129 83" />
      <path className="k-fell" d="M36 94 C30 66 46 40 76 34 C96 31 110 42 108 64 L106 94 Z" />
      <ellipse className="k-fell" cx="50" cy="76" rx="22" ry="19" />
      <path className="k-streifen k-duenn" d="M34 72 C40 60 60 60 68 74" />
      <path className="k-streifen" d="M54 44 Q60 54 56 62 M66 38 Q73 50 68 60 M78 36 Q84 46 80 54" />
      <ellipse className="k-hell" cx="62" cy="94.5" rx="11" ry="3.8" />
      <ellipse className="k-hell" cx="100" cy="72" rx="7" ry="20" />
      <rect className="k-fell-dunkel" x="103" y="62" width="9" height="32" rx="4.5" />
      <ellipse className="k-hell" cx="107.5" cy="94.5" rx="6.5" ry="3.4" />
      {vorderbein && (
        <>
          <rect className="k-fell" x="92" y="62" width="10" height="32" rx="5" />
          <ellipse className="k-hell" cx="97" cy="94.5" rx="6.5" ry="3.6" />
        </>
      )}
    </>
  );
}

function PoseSitzen() {
  return (
    <>
      <SitzKoerper vorderbein />
      <g transform="translate(96 32)">
        <Kopf />
      </g>
    </>
  );
}

function PosePutzen() {
  return (
    <>
      <SitzKoerper vorderbein={false} />
      <g transform="translate(101 36) rotate(20)">
        <Kopf zu />
      </g>
      <g className="k-pfote">
        <path className="k-bein-linie" d="M97 64 L110 48" />
        <ellipse className="k-hell" cx="111.5" cy="46.5" rx="5.5" ry="4.2" />
      </g>
    </>
  );
}

function PoseSchlafen() {
  return (
    <g className="k-atmen">
      <path
        className="k-fell"
        d="M20 92 C14 72 32 54 64 52 C96 50 118 62 120 84 C121 92 118 95 110 95 L30 95 C24 95 21 94 20 92Z"
      />
      <path className="k-streifen" d="M44 56 Q48 68 42 80 M60 53 Q64 66 58 80 M76 52 Q80 65 74 78 M92 55 Q96 65 92 75" />
      <ellipse className="k-fell" cx="40" cy="82" rx="16" ry="12" />
      <path className="k-streifen k-duenn" d="M26 80 C30 70 48 70 54 82" />
      <path className="k-schwanz" d="M24 92 C40 100 110 100 128 93 C136 91 138 85 134 81" />
      <ellipse className="k-hell" cx="124" cy="92" rx="9" ry="4" />
      <g transform="translate(116 80) rotate(10)">
        <Kopf zu />
      </g>
      <text className="k-zzz k-zzz-1" x="132" y="62">z</text>
      <text className="k-zzz k-zzz-2" x="140" y="52">z</text>
      <text className="k-zzz k-zzz-3" x="147" y="40">z</text>
    </g>
  );
}

function Wollknaeuel() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" className="zv-wolle__svg">
      <path className="w-faden" d="M30 28 C38 30 40 36 34 38" />
      <circle className="w-kugel" cx="20" cy="20" r="16" />
      <path className="w-linie" d="M6 16 C14 10 26 12 34 20 M5 22 C14 16 28 18 34 26 M10 31 C16 24 26 24 31 30 M14 6 C12 16 16 28 24 35" />
    </svg>
  );
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
  const z = useRef<KatzenZustand>({
    x: -KW,
    richtung: 1,
    pose: "sitzen",
    modus: "idle",
    timer: 0,
    ziel: 0,
    abkuehlung: 0,
    patschPause: 0,
    gekickt: false,
    spielzeit: 0,
    uninteressiert: 0,
  });
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
  // Die Tastenbehandlung braucht den aktuellen Wert, ohne bei jeder Aenderung neu zu registrieren.
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
        setKatze((an) => {
          merken("zv-katze", !an);
          return !an;
        });
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

  // Zeigerposition nur von der Maus: ein Finger auf dem Wollknaeuel soll die Katze nicht verscheuchen.
  useEffect(() => {
    if (!katze) return;
    const bewegt = (e: PointerEvent) => {
      if (e.pointerType === "mouse") zeiger.current = { x: e.clientX, y: e.clientY };
    };
    const raus = (e: MouseEvent) => {
      if (!e.relatedTarget) zeiger.current = null;
    };
    document.addEventListener("pointermove", bewegt);
    document.addEventListener("mouseout", raus);
    return () => {
      document.removeEventListener("pointermove", bewegt);
      document.removeEventListener("mouseout", raus);
      zeiger.current = null;
    };
  }, [katze]);

  // Auftritt der Katze
  useEffect(() => {
    if (!katze) return;
    const k = z.current;
    const vw = window.innerWidth;
    k.abkuehlung = 0;
    k.uninteressiert = 0;
    k.spielzeit = 0;
    if (reduziert()) {
      k.x = vw - KW - 16;
      k.modus = "idle";
      k.richtung = -1;
      k.pose = "sitzen";
      setPoseState("sitzen");
    } else {
      k.x = -KW;
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
    b.y = reduziert() ? vh - BALL_RAND_UNTEN - BALL_R : -BALL_R;
  }, [spielzeug]);

  useEffect(() => {
    if (!katze && !spielzeug) return;
    const k = z.current;
    const b = ball.current;
    let raf = 0;
    let zuletzt = performance.now();

    function setzePose(p: Pose) {
      if (k.pose !== p) {
        k.pose = p;
        setPoseState(p);
      }
    }
    function sitzen(sekunden: number) {
      k.modus = "idle";
      setzePose("sitzen");
      k.timer = sekunden;
    }
    function gehe(dt: number, tempo: number, fertig: () => void) {
      const dx = k.ziel - (k.x + KW / 2);
      if (Math.abs(dx) < 3) {
        fertig();
        return;
      }
      k.richtung = dx > 0 ? 1 : -1;
      k.x += k.richtung * Math.min(Math.abs(dx), tempo * dt);
    }

    function katzeSchritt(dt: number, vw: number, vh: number, boden: number) {
      k.timer -= dt;
      k.abkuehlung -= dt;
      k.patschPause -= dt;
      k.uninteressiert -= dt;
      const zg = zeiger.current;
      const nah =
        zg !== null && !b.gezogen && zeigerAbstand(zg, k.x, KW, KH + RAND_UNTEN, vh) < FLUCHT_RADIUS;

      if (reduziert()) {
        // Kein Laufen: bei Annaeherung springt sie auf die andere Seite.
        if (nah) k.x = zg!.x < vw / 2 ? vw - KW - 16 : 16;
        return;
      }

      const mitte = k.x + KW / 2;
      if (nah && k.modus !== "flucht" && k.modus !== "aufstehen" && k.abkuehlung <= 0) {
        k.modus = "aufstehen";
        k.timer = k.pose === "schlafen" ? 0.55 : 0.15;
        setzePose("sitzen");
      }

      switch (k.modus) {
        case "aufstehen":
          if (k.timer <= 0) {
            k.ziel = fluchtziel(zg?.x ?? mitte, vw, KW);
            k.modus = "flucht";
            setzePose("gehen");
            setBlase({ t: "Hmpf!", n: Date.now() });
          }
          break;
        case "flucht":
          gehe(dt, 190, () => {
            sitzen(zufall(1.5, 3));
            k.abkuehlung = 0.8;
          });
          break;
        case "gehen":
          gehe(dt, 70, () => sitzen(zufall(3, 6)));
          break;
        case "idle":
          if (spielzeug && k.uninteressiert <= 0) {
            k.modus = "jagen";
            k.spielzeit = 0;
            setzePose("gehen");
            break;
          }
          if (k.timer > 0) break;
          if (k.pose === "sitzen") {
            const r = Math.random();
            if (r < 0.3) {
              setzePose("putzen");
              k.timer = zufall(3.5, 5.5);
            } else if (r < 0.6) {
              setzePose("schlafen");
              k.timer = zufall(9, 18);
            } else {
              k.ziel = spazierziel(mitte, vw, KW);
              k.modus = "gehen";
              setzePose("gehen");
            }
          } else {
            sitzen(zufall(3, 6));
          }
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
          const dx = b.x - mitte;
          const abstand = Math.abs(dx);
          if (abstand > 8) k.richtung = dx > 0 ? 1 : -1;
          if (abstand > 85) {
            setzePose("gehen");
            k.x += k.richtung * Math.min(abstand - 85, 150 * dt);
          } else {
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

    function schritt(dt: number) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const boden = vh - BALL_RAND_UNTEN - BALL_R;
      if (spielzeug) {
        if (!b.gezogen && !reduziert()) ballSchritt(b, dt, vw, boden, BALL_R);
        if (!b.gezogen && b.y > boden) b.y = boden;
        const el = ballRef.current;
        if (el) el.style.transform = `translate3d(${b.x - BALL_R}px, ${b.y - BALL_R}px, 0) rotate(${b.drehung}deg)`;
      }
      if (katze) {
        katzeSchritt(dt, vw, vh, boden);
        if (katzeRef.current) katzeRef.current.style.transform = `translate3d(${k.x}px, 0, 0)`;
        if (dreherRef.current) dreherRef.current.style.transform = `scaleX(${k.richtung})`;
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
    b.y = Math.min(Math.max(e.clientY + b.offY, BALL_R), window.innerHeight - BALL_RAND_UNTEN - BALL_R);
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
            <svg viewBox="0 0 160 100" width={KW} height={KH} className="zv-katze__svg">
              {(pose === "gehen" || pose === "patschen") && <PoseGehen />}
              {pose === "sitzen" && <PoseSitzen />}
              {pose === "putzen" && <PosePutzen />}
              {pose === "schlafen" && <PoseSchlafen />}
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
