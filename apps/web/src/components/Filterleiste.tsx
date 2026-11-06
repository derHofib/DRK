import { ReactNode, useEffect, useRef, useState } from "react";
import { IAbbrechen, IAufklappen, IBestaetigen } from "./icons";

/**
 * Baustein der Filterleiste: ein Knopf, der ein kleines Popover oeffnet.
 * Ist ein Wert gesetzt, wird aus der "Pille" ein Chip mit Wert und
 * Entfernen-Kreuz -- so sieht man auf einen Blick, was die Liste gerade
 * einschraenkt, und kann es mit einem Klick loesen.
 *
 * Das Popover ist bewusst `position: fixed` (wie AktionsMenue): die
 * Leiste scrollt auf dem Handy horizontal (overflow-x), und ein absolut
 * positioniertes Popover wuerde von diesem Scrollcontainer abgeschnitten.
 */
export function FilterPille({
  icon,
  label,
  wert,
  onEntfernen,
  startOffen,
  children,
}: {
  icon: ReactNode;
  label: string;
  /** Anzeigetext des aktiven Filters; null = kein Filter gesetzt. */
  wert: string | null;
  onEntfernen?: () => void;
  startOffen?: boolean;
  /** Inhalt des Popovers; bekommt eine Funktion zum Schliessen. */
  children: (schliessen: () => void) => ReactNode;
}) {
  const knopf = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const offen = pos !== null;

  function oeffnen() {
    const r = knopf.current!.getBoundingClientRect();
    const breite = 300;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - breite - 8)) });
  }

  useEffect(() => {
    if (startOffen) oeffnen();
    // nur beim Einblenden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!offen) return;
    const zu = () => setPos(null);
    function aussen(e: MouseEvent) {
      const t = e.target as Node;
      if (!popover.current?.contains(t) && !knopf.current?.contains(t)) zu();
    }
    function taste(e: KeyboardEvent) {
      if (e.key === "Escape") {
        zu();
        knopf.current?.focus();
      }
    }
    // Seitenscroll schliesst; Scrollen der Leiste selbst (waagerecht auf dem
    // Handy) verschiebt nur den Knopf -- das Popover folgt ihm.
    function scroll(e: Event) {
      if (popover.current?.contains(e.target as Node)) return;
      if (e.target === document) return zu();
      oeffnen();
    }
    document.addEventListener("mousedown", aussen);
    document.addEventListener("keydown", taste);
    window.addEventListener("resize", zu);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", aussen);
      document.removeEventListener("keydown", taste);
      window.removeEventListener("resize", zu);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [offen]);

  return (
    <>
      <span className={`zv-filter-pille${wert !== null ? " aktiv" : ""}`}>
        <button
          ref={knopf}
          type="button"
          className="zv-filter-pille-knopf"
          aria-haspopup="dialog"
          aria-expanded={offen}
          onClick={() => (offen ? setPos(null) : oeffnen())}
        >
          {icon}
          <span>
            {label}
            {wert !== null && <span className="zv-filter-wert">{wert}</span>}
          </span>
          {wert === null && <IAufklappen style={{ width: 14, height: 14 }} />}
        </button>
        {wert !== null && onEntfernen && (
          <button type="button" className="zv-filter-x" aria-label={`Filter ${label} entfernen`} onClick={onEntfernen}>
            <IAbbrechen style={{ width: 14, height: 14 }} />
          </button>
        )}
      </span>
      {pos && (
        <div ref={popover} role="dialog" aria-label={label} className="zv-filter-popover" style={{ top: pos.top, left: pos.left }}>
          {children(() => setPos(null))}
        </div>
      )}
    </>
  );
}

/** Einfache Auswahlliste fuer das Popover (genau ein Eintrag oder keiner). */
export function FilterAuswahl<T extends string>({
  optionen,
  gewaehlt,
  onWaehlen,
}: {
  optionen: { wert: T; label: string }[];
  gewaehlt: T | null;
  onWaehlen: (wert: T) => void;
}) {
  if (optionen.length === 0) return <div className="zv-filter-leer">Keine Einträge vorhanden.</div>;
  return (
    <div className="zv-filter-liste" role="listbox">
      {optionen.map((o) => (
        <button key={o.wert} type="button" role="option" aria-selected={gewaehlt === o.wert} onClick={() => onWaehlen(o.wert)}>
          <span>{o.label}</span>
          {gewaehlt === o.wert && <IBestaetigen style={{ width: 14, height: 14 }} />}
        </button>
      ))}
    </div>
  );
}
