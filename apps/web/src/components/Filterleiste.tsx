import { ReactNode, useEffect, useRef, useState } from "react";
import { IAbbrechen, IAufklappen, IBestaetigen, ISuche } from "./icons";

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

/** Gross-/Kleinschreibung und Akzente ignorieren ("Aerzte" findet "Ärzte" nicht, "Arzte" schon -- bewusst einfach). */
function normalisiere(t: string): string {
  return t.toLocaleLowerCase("de").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Auswahlliste fuer das Popover (genau ein Eintrag oder keiner).
 *
 * Ab SUCHE_AB Eintraegen bekommt sie ein Eingabefeld, das die Liste beim
 * Tippen filtert (Enter waehlt den ersten Treffer, Pfeil runter springt in
 * die Liste). Bei Zeitraum/Sortierung mit ihren wenigen festen Eintraegen
 * waere das Feld nur Ballast -- deshalb abhaengig von der Laenge statt
 * immer; mit `durchsuchbar` laesst es sich je Aufruf erzwingen/abschalten.
 */
const SUCHE_AB = 7;

export function FilterAuswahl<T extends string>({
  optionen,
  gewaehlt,
  onWaehlen,
  durchsuchbar,
}: {
  optionen: { wert: T; label: string }[];
  gewaehlt: T | null;
  onWaehlen: (wert: T) => void;
  durchsuchbar?: boolean;
}) {
  const [eingabe, setEingabe] = useState("");
  const liste = useRef<HTMLDivElement>(null);
  const mitSuche = durchsuchbar ?? optionen.length >= SUCHE_AB;
  const q = normalisiere(eingabe.trim());
  const treffer = q ? optionen.filter((o) => normalisiere(o.label).includes(q)) : optionen;

  if (optionen.length === 0) return <div className="zv-filter-leer">Keine Einträge vorhanden.</div>;
  return (
    <>
      {mitSuche && (
        <div className="zv-filter-eingabe">
          <ISuche />
          <input
            type="text"
            value={eingabe}
            autoFocus
            placeholder="Eingeben zum Filtern…"
            aria-label="Auswahl filtern"
            onChange={(e) => setEingabe(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && treffer.length > 0) {
                e.preventDefault();
                onWaehlen(treffer[0].wert);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                liste.current?.querySelector<HTMLElement>("button")?.focus();
              }
            }}
          />
        </div>
      )}
      {treffer.length === 0 ? (
        <div className="zv-filter-leer">Keine Treffer.</div>
      ) : (
        <div
          className="zv-filter-liste"
          role="listbox"
          ref={liste}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const knoepfe = Array.from(liste.current!.querySelectorAll<HTMLElement>("button"));
            const i = knoepfe.indexOf(document.activeElement as HTMLElement);
            knoepfe[Math.max(0, Math.min(knoepfe.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
          }}
        >
          {treffer.map((o) => (
            <button key={o.wert} type="button" role="option" aria-selected={gewaehlt === o.wert} onClick={() => onWaehlen(o.wert)}>
              <span>{o.label}</span>
              {gewaehlt === o.wert && <IBestaetigen style={{ width: 14, height: 14 }} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Wie FilterAuswahl, aber mit beliebig vielen gewaehlten Eintraegen: das
 * Popover bleibt beim Anklicken offen, damit man mehrere nacheinander
 * ankreuzen kann. Leere Auswahl heisst "kein Filter", nicht "nichts".
 */
export function FilterMehrfachAuswahl<T extends string>({
  optionen,
  gewaehlt,
  onAendern,
  durchsuchbar,
}: {
  optionen: { wert: T; label: string }[];
  gewaehlt: T[];
  onAendern: (neu: T[]) => void;
  durchsuchbar?: boolean;
}) {
  const [eingabe, setEingabe] = useState("");
  const mitSuche = durchsuchbar ?? optionen.length >= SUCHE_AB;
  const q = normalisiere(eingabe.trim());
  const treffer = q ? optionen.filter((o) => normalisiere(o.label).includes(q)) : optionen;
  const umschalten = (w: T) => onAendern(gewaehlt.includes(w) ? gewaehlt.filter((g) => g !== w) : [...gewaehlt, w]);

  if (optionen.length === 0) return <div className="zv-filter-leer">Keine Einträge vorhanden.</div>;
  return (
    <>
      {mitSuche && (
        <div className="zv-filter-eingabe">
          <ISuche />
          <input
            type="text"
            value={eingabe}
            autoFocus
            placeholder="Eingeben zum Filtern…"
            aria-label="Auswahl filtern"
            onChange={(e) => setEingabe(e.target.value)}
          />
        </div>
      )}
      {treffer.length === 0 ? (
        <div className="zv-filter-leer">Keine Treffer.</div>
      ) : (
        <div className="zv-filter-liste" role="listbox" aria-multiselectable="true">
          {treffer.map((o) => (
            <button key={o.wert} type="button" role="option" aria-selected={gewaehlt.includes(o.wert)} onClick={() => umschalten(o.wert)}>
              <span>{o.label}</span>
              {gewaehlt.includes(o.wert) && <IBestaetigen style={{ width: 14, height: 14 }} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
