import { type RefObject, useEffect, useRef } from "react";

/**
 * Schliess-Mechanik fuer schwebende Ebenen (Filter-Popover, Kalender):
 * Klick ausserhalb, Fenstergroesse, Seitenscroll. Aus FilterPille
 * herausgeloest statt kopiert, damit Filter und Kalender sich gleich
 * verhalten (Konzept Datumsfeld, 3.2).
 *
 * Scrollt ein innerer Container (Modal, Leiste am Handy), wird nur neu
 * positioniert -- das schwebende Element folgt seinem Anker. Scrollt die
 * Seite selbst, schliesst es: sonst haenge es losgeloest im Bild.
 *
 * Escape ist bewusst NICHT hier: ein Kalender in einem Modal muss Escape
 * selbst abfangen (stopPropagation), sonst schliesst der Document-Listener
 * des Modals gleich mit.
 */
export function useSchwebendSchliessen(
  offen: boolean,
  innen: RefObject<HTMLElement>[],
  schliessen: () => void,
  neuPositionieren: () => void
) {
  // Refs statt Abhaengigkeiten: die Rueckrufe aendern sich bei jedem
  // Rendern, die Listener sollen aber nur beim Oeffnen neu haengen.
  const zu = useRef(schliessen);
  const neu = useRef(neuPositionieren);
  zu.current = schliessen;
  neu.current = neuPositionieren;

  useEffect(() => {
    if (!offen) return;
    const drin = (t: EventTarget | null) => innen.some((r) => r.current?.contains(t as Node));
    function aussen(e: MouseEvent) {
      if (!drin(e.target)) zu.current();
    }
    function groesse() {
      zu.current();
    }
    function scroll(e: Event) {
      if (drin(e.target)) return;
      if (e.target === document) return zu.current();
      neu.current();
    }
    document.addEventListener("mousedown", aussen);
    window.addEventListener("resize", groesse);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", aussen);
      window.removeEventListener("resize", groesse);
      window.removeEventListener("scroll", scroll, true);
    };
    // innen ist eine Liste stabiler Refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);
}
