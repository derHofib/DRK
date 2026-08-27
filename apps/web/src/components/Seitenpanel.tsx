import { ReactNode, useEffect, useState } from "react";
import { IAbbrechen, IVergroessern, IVerkleinern } from "./icons";

/**
 * Ersetzt das fruehere Master-Detail-Layout (Liste schrumpft, Detail steht
 * daneben): ein Panel schiebt sich von rechts ueber den Inhalt, die Liste
 * dahinter bleibt unveraendert breit. Bewusst als eigene, wiederverwendbare
 * Komponente -- analog zu Modal.tsx, nur fuer den Fall "Liste -> Detail"
 * statt "kurzes Formular".
 *
 * Backdrop und Panel bleiben IMMER im DOM (auch geschlossen) und wechseln
 * nur eine CSS-Klasse -- ein bedingtes Mounten wuerde das Element schon in
 * seiner Endposition einfuegen, die Ein-/Ausfahr-Transition liefe dann nie.
 */
export function Seitenpanel({
  offen,
  onSchliessen,
  children,
}: {
  offen: boolean;
  onSchliessen: () => void;
  children: ReactNode;
}) {
  const [vollbild, setVollbild] = useState(false);

  // Naechstes Oeffnen soll wieder schmal starten, nicht im zuletzt
  // genutzten Vollbild-Zustand.
  useEffect(() => {
    if (!offen) setVollbild(false);
  }, [offen]);

  useEffect(() => {
    if (!offen) return;
    function beiEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onSchliessen();
    }
    document.addEventListener("keydown", beiEscape);
    return () => document.removeEventListener("keydown", beiEscape);
  }, [offen, onSchliessen]);

  return (
    <>
      <div
        className={`zv-seitenpanel-hintergrund${offen ? " zv-offen" : ""}`}
        onClick={onSchliessen}
        aria-hidden="true"
      />
      <div
        className={`zv-seitenpanel${offen ? " zv-offen" : ""}${vollbild ? " zv-seitenpanel-vollbild" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="zv-seitenpanel-kopf">
          <button
            type="button"
            className="zv-icon-btn zv-seitenpanel-vollbild-knopf"
            aria-label={vollbild ? "Vollbild verlassen" : "Vollbild anzeigen"}
            title={vollbild ? "Vollbild verlassen" : "Vollbild anzeigen"}
            onClick={() => setVollbild((v) => !v)}
          >
            {vollbild ? <IVerkleinern /> : <IVergroessern />}
          </button>
          <button type="button" className="zv-icon-btn" aria-label="Schließen" onClick={onSchliessen}>
            <IAbbrechen />
          </button>
        </div>
        <div className="zv-seitenpanel-inhalt">{children}</div>
      </div>
    </>
  );
}
