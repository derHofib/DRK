import { useEffect, useRef, useState } from "react";

/**
 * Easter Egg: Alt+Umschalt+K ("Katze") laesst eine kleine Katze ueber den
 * unteren Bildschirmrand laufen; eine Sprechblase sagt "Miau!".
 *
 * Bewusste Entscheidungen:
 *  - Alt+Umschalt+K, ausgewertet ueber `event.code`: Auf dem Mac erzeugt Alt
 *    ein Sonderzeichen, `event.key` waere dort nicht "k". Weder Browser noch
 *    die Anwendung belegen die Kombination.
 *  - Nie in Eingabefeldern: Alt+Umschalt+K darf beim Tippen (auch AltGr-Layouts)
 *    keine Katze ausloesen.
 *  - Kein Fremd-Asset: Katze ist Inline-SVG + CSS und liegt damit im Bundle.
 *  - Bewusst ohne Ton (Wunsch aus dem Team): im Buero wuerde er stoeren.
 *  - `pointer-events: none` und `aria-hidden`: die Katze liegt nie im Weg und
 *    ist fuer Screenreader nicht vorhanden.
 *  - prefers-reduced-motion: keine Laufbewegung, die Katze blendet nur kurz
 *    ein und aus (siehe .zv-katze--ruhig in app.css).
 */

const LAUFZEIT_MS = 7000;
const RUHIG_MS = 3000;

function inEingabefeld(ziel: EventTarget | null): boolean {
  if (!(ziel instanceof HTMLElement)) return false;
  return ziel.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(ziel.tagName);
}

function reduziert(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function KatzenEasterEgg() {
  const [lauf, setLauf] = useState<number | null>(null);
  const [ruhig, setRuhig] = useState(false);
  const laeuftRef = useRef(false);
  laeuftRef.current = lauf !== null;

  useEffect(() => {
    function taste(e: KeyboardEvent) {
      if (e.code !== "KeyK" || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (inEingabefeld(e.target)) return;
      e.preventDefault();
      const still = reduziert();
      // Zweiter Druck waehrend des Laufs bricht ab.
      if (laeuftRef.current) {
        setLauf(null);
        return;
      }
      setRuhig(still);
      setLauf((n) => (n ?? 0) + 1);
    }
    document.addEventListener("keydown", taste);
    return () => document.removeEventListener("keydown", taste);
  }, []);

  useEffect(() => {
    if (lauf === null) return;
    const t = window.setTimeout(() => setLauf(null), ruhig ? RUHIG_MS : LAUFZEIT_MS);
    return () => window.clearTimeout(t);
  }, [lauf, ruhig]);

  if (lauf === null) return null;
  return (
    <div className={`zv-katze${ruhig ? " zv-katze--ruhig" : ""}`} aria-hidden="true" style={{ animationDuration: `${LAUFZEIT_MS}ms` }}>
      <span className="zv-katze__blase">Miau!</span>
      <svg viewBox="0 0 120 70" width="96" height="56" className="zv-katze__svg">
        <g className="zv-katze__schwanz">
          <path d="M18 38 C2 34 4 14 14 10" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g className="zv-katze__bein zv-katze__bein--hinten2"><rect x="24" y="48" width="7" height="18" rx="3.5" fill="currentColor" opacity="0.7" /></g>
        <g className="zv-katze__bein zv-katze__bein--vorn2"><rect x="62" y="48" width="7" height="18" rx="3.5" fill="currentColor" opacity="0.7" /></g>
        <ellipse cx="46" cy="40" rx="32" ry="15" fill="currentColor" />
        <g className="zv-katze__bein zv-katze__bein--hinten"><rect x="30" y="48" width="8" height="18" rx="4" fill="currentColor" /></g>
        <g className="zv-katze__bein zv-katze__bein--vorn"><rect x="68" y="48" width="8" height="18" rx="4" fill="currentColor" /></g>
        <circle cx="86" cy="28" r="14" fill="currentColor" />
        <path d="M74 20 L76 4 L86 15 Z" fill="currentColor" />
        <path d="M90 15 L98 4 L100 21 Z" fill="currentColor" />
        <ellipse cx="82" cy="27" rx="2.2" ry="3" fill="var(--zv-bg)" />
        <ellipse cx="93" cy="27" rx="2.2" ry="3" fill="var(--zv-bg)" />
        <path d="M86 32 L88 34 L90 32 Z" fill="var(--zv-achtung)" />
      </svg>
    </div>
  );
}
