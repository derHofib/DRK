import { useEffect, type ReactNode } from "react";
import { IAbbrechen } from "./icons";

/**
 * Generisches kleines Fenster fuer kurze Anlegen-Formulare (siehe
 * Zimmer.tsx). Bewusst als eigene, wiederverwendbare Komponente statt
 * direkt in der Seite verdrahtet -- weitere Seiten koennen sie spaeter
 * genauso benutzen, ohne Scrim/Escape/Fokus erneut zu bauen.
 *
 * Absichtlich schlicht gehalten (kein Fokus-Trap, keine
 * Wiederherstellung des vorherigen Fokus): fuer die kurzen, wenige Felder
 * umfassenden Formulare hier reicht das. Ein voller Dialog-Baukasten waere
 * fuer diesen Anwendungsfall mehr, als gebraucht wird.
 */
export function Modal({
  titel,
  onClose,
  children,
}: {
  titel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function beiEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", beiEscape);
    return () => document.removeEventListener("keydown", beiEscape);
  }, [onClose]);

  return (
    <div className="zv-modal-scrim" onClick={onClose}>
      <div
        className="zv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zv-modal-titel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="zv-modal-kopf">
          <h3 id="zv-modal-titel">{titel}</h3>
          <button type="button" className="zv-icon-btn" aria-label="Schließen" onClick={onClose}>
            <IAbbrechen />
          </button>
        </div>
        <div className="zv-modal-inhalt">{children}</div>
      </div>
    </div>
  );
}
