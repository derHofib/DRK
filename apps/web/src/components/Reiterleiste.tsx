import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IVor, IZurueckPfeil } from "./icons";

export interface ReiterEintrag<T extends string> {
  wert: T;
  label: string;
  zaehler?: number;
}

/**
 * Gemeinsame Reiterleiste (Rueckmeldung "Ansicht Klienten": "Tabs gut mit
 * der Maus bedienen", Konzept klienten-ansicht, Abschnitt 3.3).
 *
 * Vorher war jede Leiste ein <nav class="zv-reiter"> mit overflow-x:auto.
 * Passten die Reiter nicht, blieb als einziger Weg der duenne Scrollbalken,
 * den man mit der Maus kaum trifft; das Mausrad scrollte die Seite statt
 * der Leiste, und ein Reiter rechts aussen war unsichtbar, ohne dass etwas
 * darauf hinwies. Hier deshalb:
 *  - Pfeilknoepfe links/rechts, nur solange es in die Richtung weitergeht,
 *    und ein Ausblendverlauf am Rand ("da kommt noch was");
 *  - Mausrad senkrecht verschiebt die Leiste waagrecht, solange der Zeiger
 *    darueber steht -- aber nur, wenn sie in die Richtung noch kann, sonst
 *    scrollt die Seite wie gewohnt weiter;
 *  - der aktive Reiter wird immer ins Bild gerueckt;
 *  - Tastatur nach dem tablist-Muster (Pfeile, Pos1/Ende).
 */
export function Reiterleiste<T extends string>({
  reiter,
  aktiv,
  onWahl,
  label,
  idPraefix,
  mitPanel = true,
}: {
  reiter: ReiterEintrag<T>[];
  aktiv: T;
  onWahl: (wert: T) => void;
  label: string;
  /** Fuer id/aria-controls; die Inhaltsflaeche nutzt reiterPanelId(). */
  idPraefix: string;
  /** false, wenn die Seite keine Flaeche mit reiterPanelProps() hat (aria-controls zeigte sonst ins Leere). */
  mitPanel?: boolean;
}) {
  const leiste = useRef<HTMLDivElement>(null);
  const [rand, setRand] = useState({ links: false, rechts: false });

  const randPruefen = useCallback(() => {
    const el = leiste.current;
    if (!el) return;
    // 1px Toleranz: gebrochene Pixel bei Zoom liessen sonst einen Pfeil
    // stehen, obwohl nichts mehr zu sehen ist.
    const links = el.scrollLeft > 1;
    const rechts = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setRand((alt) => (alt.links === links && alt.rechts === rechts ? alt : { links, rechts }));
  }, []);

  useLayoutEffect(() => {
    const el = leiste.current;
    if (!el) return;
    randPruefen();
    const beobachter = new ResizeObserver(randPruefen);
    beobachter.observe(el);
    el.addEventListener("scroll", randPruefen, { passive: true });
    return () => {
      beobachter.disconnect();
      el.removeEventListener("scroll", randPruefen);
    };
  }, [randPruefen, reiter.length]);

  // Nicht-passiv per addEventListener: Reacts onWheel ist passiv
  // registriert, preventDefault() waere dort wirkungslos.
  useEffect(() => {
    const el = leiste.current;
    if (!el) return;
    function rad(e: WheelEvent) {
      if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const kannWeiter = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 1;
      if (!kannWeiter) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
    el.addEventListener("wheel", rad, { passive: false });
    return () => el.removeEventListener("wheel", rad);
  }, []);

  // Von Hand statt scrollIntoView(): das wuerde auch den senkrechten
  // Scrollcontainer (Seitenpanel) mitbewegen und die Akte springen lassen.
  useEffect(() => {
    const el = leiste.current;
    const knopf = el?.querySelector<HTMLElement>(`[data-reiter="${aktiv}"]`);
    if (!el || !knopf) return;
    const puffer = 40; // Breite eines Pfeilknopfs, damit der Reiter nicht darunter liegt
    if (knopf.offsetLeft < el.scrollLeft + puffer) el.scrollLeft = Math.max(0, knopf.offsetLeft - puffer);
    else if (knopf.offsetLeft + knopf.offsetWidth > el.scrollLeft + el.clientWidth - puffer)
      el.scrollLeft = knopf.offsetLeft + knopf.offsetWidth - el.clientWidth + puffer;
  }, [aktiv]);

  function blaettern(richtung: 1 | -1) {
    const el = leiste.current;
    if (!el) return;
    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: richtung * el.clientWidth * 0.7, behavior: ruhig ? "auto" : "smooth" });
  }

  function taste(e: KeyboardEvent<HTMLDivElement>) {
    const i = reiter.findIndex((r) => r.wert === aktiv);
    let ziel: number | null = null;
    if (e.key === "ArrowRight") ziel = (i + 1) % reiter.length;
    else if (e.key === "ArrowLeft") ziel = (i - 1 + reiter.length) % reiter.length;
    else if (e.key === "Home") ziel = 0;
    else if (e.key === "End") ziel = reiter.length - 1;
    if (ziel === null) return;
    e.preventDefault();
    onWahl(reiter[ziel].wert);
    leiste.current?.querySelector<HTMLElement>(`[data-reiter="${reiter[ziel].wert}"]`)?.focus();
  }

  return (
    <div className="zv-reiterleiste" data-links={rand.links || undefined} data-rechts={rand.rechts || undefined}>
      {/* tabIndex -1: mit der Tastatur wechselt man per Pfeiltaste, die
          Knoepfe sind nur fuer die Maus und wuerden die Tab-Reihenfolge
          verlaengern. */}
      {rand.links && (
        <button
          type="button"
          className="zv-reiter-pfeil zv-reiter-pfeil-links"
          aria-label="Weitere Reiter links"
          tabIndex={-1}
          onClick={() => blaettern(-1)}
        >
          <IZurueckPfeil />
        </button>
      )}
      <div ref={leiste} className="zv-reiter" role="tablist" aria-label={label} onKeyDown={taste}>
        {reiter.map((r) => (
          <button
            key={r.wert}
            type="button"
            role="tab"
            id={`${idPraefix}-reiter-${r.wert}`}
            aria-controls={mitPanel ? reiterPanelId(idPraefix) : undefined}
            aria-selected={r.wert === aktiv}
            tabIndex={r.wert === aktiv ? 0 : -1}
            data-reiter={r.wert}
            className={r.wert === aktiv ? "active" : ""}
            onClick={() => onWahl(r.wert)}
          >
            {r.label}
            {r.zaehler !== undefined && <span className="zv-mono zv-reiter-zaehler">{r.zaehler}</span>}
          </button>
        ))}
      </div>
      {rand.rechts && (
        <button
          type="button"
          className="zv-reiter-pfeil zv-reiter-pfeil-rechts"
          aria-label="Weitere Reiter rechts"
          tabIndex={-1}
          onClick={() => blaettern(1)}
        >
          <IVor />
        </button>
      )}
    </div>
  );
}

export function reiterPanelId(idPraefix: string) {
  return `${idPraefix}-reiterinhalt`;
}

/** Inhaltsflaeche zur Reiterleiste (role=tabpanel, beschriftet vom aktiven Reiter). */
export function reiterPanelProps(idPraefix: string, aktiv: string) {
  return {
    role: "tabpanel" as const,
    id: reiterPanelId(idPraefix),
    "aria-labelledby": `${idPraefix}-reiter-${aktiv}`,
  };
}
