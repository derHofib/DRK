import { useEffect, useState, type ReactNode } from "react";
import { IAbbrechen, IVergroessern, IVerkleinern } from "./icons";

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
  breit = false,
}: {
  titel: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Breite Lese-Fassung (ein Protokoll ausserhalb der Akte). Eigene Variante
   * statt die 440 px allgemein anzuheben: kurze Anlegen-Formulare sollen die
   * Liste dahinter weiter sichtbar lassen.
   */
  breit?: boolean;
}) {
  const [vollbild, setVollbild] = useState(false);
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
        className={`zv-modal${breit ? " zv-modal-breit" : ""}${breit && vollbild ? " zv-modal-vollbild" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zv-modal-titel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="zv-modal-kopf">
          <h3 id="zv-modal-titel">{titel}</h3>
          <div className="zv-modal-knoepfe">
            {breit && (
              <button
                type="button"
                className="zv-icon-btn zv-modal-vollbild-knopf"
                aria-label={vollbild ? "Vollbild verlassen" : "Vollbild anzeigen"}
                title={vollbild ? "Vollbild verlassen" : "Vollbild anzeigen"}
                onClick={() => setVollbild((v) => !v)}
              >
                {vollbild ? <IVerkleinern /> : <IVergroessern />}
              </button>
            )}
            <button type="button" className="zv-icon-btn" aria-label="Schließen" onClick={onClose}>
              <IAbbrechen />
            </button>
          </div>
        </div>
        <div className="zv-modal-inhalt">{children}</div>
      </div>
    </div>
  );
}
