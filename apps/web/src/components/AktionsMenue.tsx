import { ReactNode, useEffect, useRef, useState } from "react";
import { IMehrAktionen } from "./icons";

/**
 * Drei-Punkte-Knopf mit kleinem Popover fuer Zeilenaktionen.
 *
 * Bewusst `position: fixed` mit aus dem Knopf berechneten Koordinaten statt
 * `absolute`: die umgebende .zv-karten-liste hat overflow:hidden (damit
 * breite Tabellen die Seite nicht aufreissen) und wuerde das Menue der
 * letzten Zeile abschneiden. Beim Scrollen/Groessenaendern schliesst es,
 * statt falsch positioniert stehenzubleiben.
 * Ein Klick auf einen Eintrag schliesst das Menue; die Aktionen selbst
 * oeffnen ihre eigenen Dialoge.
 */
export function AktionsMenue({
  label,
  children,
  variante,
  beschriftung,
  icon,
}: {
  label: string;
  children: ReactNode;
  /** "pille": beschrifteter Knopf im Stil der Filterleiste statt Drei-Punkte-Icon. */
  variante?: "pille";
  beschriftung?: string;
  icon?: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; right: number; hoch: boolean } | null>(null);
  const knopf = useRef<HTMLButtonElement>(null);
  const menue = useRef<HTMLDivElement>(null);
  const offen = pos !== null;

  function umschalten() {
    if (offen) return setPos(null);
    const r = knopf.current!.getBoundingClientRect();
    // Unten kaum Platz (letzte Zeile): nach oben aufklappen.
    const hoch = window.innerHeight - r.bottom < 260 && r.top > 260;
    setPos({
      top: hoch ? r.top - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
      hoch,
    });
  }

  useEffect(() => {
    if (!offen) return;
    const zu = () => setPos(null);
    function aussen(e: MouseEvent) {
      const t = e.target as Node;
      if (!menue.current?.contains(t) && !knopf.current?.contains(t)) zu();
    }
    function taste(e: KeyboardEvent) {
      if (e.key === "Escape") {
        zu();
        knopf.current?.focus();
      }
    }
    document.addEventListener("mousedown", aussen);
    document.addEventListener("keydown", taste);
    window.addEventListener("resize", zu);
    window.addEventListener("scroll", zu, true);
    menue.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", aussen);
      document.removeEventListener("keydown", taste);
      window.removeEventListener("resize", zu);
      window.removeEventListener("scroll", zu, true);
    };
  }, [offen]);

  return (
    <>
      <button
        ref={knopf}
        type="button"
        className={variante === "pille" ? "zv-filter-pille zv-filter-pille-knopf zv-filter-plus" : "zv-icon-btn"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={offen}
        onClick={umschalten}
      >
        {variante === "pille" ? (
          <>
            {icon}
            {beschriftung}
          </>
        ) : (
          <IMehrAktionen />
        )}
      </button>
      {pos && (
        <div
          ref={menue}
          role="menu"
          className="zv-aktionsmenue"
          style={{
            top: pos.hoch ? undefined : pos.top,
            bottom: pos.hoch ? window.innerHeight - pos.top : undefined,
            right: pos.right,
          }}
          onClick={() => setPos(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = Array.from(menue.current!.querySelectorAll<HTMLElement>("[role=menuitem]"));
            const i = items.indexOf(document.activeElement as HTMLElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}
