import { ReactNode, useEffect, useState } from "react";

/** Ab dieser Breite steht ein angedocktes Panel NEBEN dem Inhalt (siehe app.css, gleiche Zahl). */
const ANDOCK_MEDIEN = "(min-width: 1280px)";

/** Ob ein Panel mit `angedockt` gerade tatsaechlich angedockt steht -- fuer Seiten, die dann ihren Inhalt schmaler machen. */
export function useAngedockt(): boolean {
  const [passt, setPasst] = useState(() => typeof window !== "undefined" && window.matchMedia(ANDOCK_MEDIEN).matches);
  useEffect(() => {
    const mq = window.matchMedia(ANDOCK_MEDIEN);
    const aenderung = () => setPasst(mq.matches);
    mq.addEventListener("change", aenderung);
    return () => mq.removeEventListener("change", aenderung);
  }, []);
  return passt;
}
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
 *
 * `angedockt` (Zimmer-Panel, Rueckmeldung d5f8252d): auf breiten Fenstern
 * steht das Panel ohne Abdunkeln neben dem Inhalt, damit man Zimmer fuer
 * Zimmer durchklicken kann, ohne es jedes Mal zu schliessen. Die Seite
 * macht ihren Inhalt dafuer selbst schmaler (useAngedockt()). Darunter
 * verhaelt es sich genau wie ohne -- dort ist kein Platz fuer beides.
 */
export function Seitenpanel({
  offen,
  onSchliessen,
  children,
  angedockt: andockenErwuenscht = false,
  label,
}: {
  offen: boolean;
  onSchliessen: () => void;
  children: ReactNode;
  angedockt?: boolean;
  /** Name fuer Screenreader (und Pruefskripte), wenn mehrere Panels auf einer Seite liegen. */
  label?: string;
}) {
  const [vollbild, setVollbild] = useState(false);
  const breitGenug = useAngedockt();
  const angedockt = andockenErwuenscht && breitGenug && !vollbild;

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
        className={`zv-seitenpanel-hintergrund${offen && !angedockt ? " zv-offen" : ""}`}
        onClick={onSchliessen}
        aria-hidden="true"
      />
      <div
        className={`zv-seitenpanel${offen ? " zv-offen" : ""}${vollbild ? " zv-seitenpanel-vollbild" : ""}${angedockt ? " zv-seitenpanel-angedockt" : ""}`}
        role={angedockt ? "complementary" : "dialog"}
        aria-modal={angedockt ? undefined : "true"}
        aria-label={label}
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
