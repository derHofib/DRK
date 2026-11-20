import { useEffect, useRef } from "react";
import type { StandortSichtDto, StandortSichtEintrag } from "@zimmerakte/shared";
import { IAbbrechen, IFehler, IKlienten, IStandort, IVertretung } from "./icons";
import { formatDatum } from "../format";

/**
 * Standort-Sicht der angemeldeten Person (Migration 0084, Konzept
 * standort-sichtbarkeit): Zeile unter dem Namen und der Aufklapper
 * "Deine Sicht". Zeigt nur an, was die API liefert -- die Schranke selbst
 * sitzt im Server (sichtbare_standorte()), hier wird nichts gefiltert.
 */

/** Eigene Standorte (fest oder aus dem Rang) zuerst, geliehene danach. */
function eigene(sicht: StandortSichtDto): StandortSichtEintrag[] {
  return sicht.eintraege.filter((e) => e.herkunft !== "vertretung");
}

function geliehen(sicht: StandortSichtDto): StandortSichtEintrag[] {
  return sicht.eintraege.filter((e) => e.herkunft === "vertretung");
}

/** "Haus A", "Haus A + 1" oder "Kein Standort"; null bei "alle". */
export function sichtKurztext(sicht: StandortSichtDto): string | null {
  if (sicht.alle) return null;
  const e = eigene(sicht);
  if (e.length === 0) return geliehen(sicht).length > 0 ? "Nur über Vertretung" : "Kein Standort zugeordnet";
  return e.length === 1 ? e[0].standortName : `${e[0].standortName} + ${e.length - 1}`;
}

/** Kurzform der Vertretung fuer die Pille: "+ Haus B bis 24.11." */
export function vertretungKurztext(sicht: StandortSichtDto): string | null {
  const g = geliehen(sicht);
  if (g.length === 0) return null;
  const bis = g.map((e) => e.bis).filter(Boolean).sort()[0];
  const name = g.length === 1 ? g[0].standortName : `${g.length} Standorte`;
  return `+ ${name}${bis ? ` bis ${formatDatum(bis).slice(0, 6)}` : ""}`;
}

/**
 * Dritte Zeile im Namensblock. Bewusst ein Knopf: ein Klick erklaert die
 * Sicht ("Deine Sicht"). Bei "alle" gibt es keine Zeile -- Leitung und
 * Geschaeftsfuehrung sehen den Block wie bisher.
 */
export function StandortZeile({ sicht, onOeffnen }: { sicht: StandortSichtDto; onOeffnen: () => void }) {
  const text = sichtKurztext(sicht);
  const vertretung = vertretungKurztext(sicht);
  if (text === null) return null;
  const keiner = eigene(sicht).length === 0 && !vertretung;
  const voll = eigene(sicht)
    .map((e) => e.standortName)
    .join(", ");
  return (
    <>
      <button
        type="button"
        className={`zv-sicht-zeile${keiner ? " zv-sicht-zeile-keiner" : ""}`}
        data-sicht-ausloeser=""
        onClick={onOeffnen}
        title={voll || text}
        aria-label={`Deine Sicht: ${voll || text}`}
      >
        {keiner ? <IFehler /> : <IStandort />}
        <span>{text}</span>
      </button>
      {vertretung && (
        <span className="zv-sicht-pille">
          <IVertretung />
          {vertretung}
        </span>
      )}
    </>
  );
}

const HERKUNFT_TEXT: Record<"fest" | "rang", string> = {
  fest: "Von deiner Leitung festgelegt",
  rang: "Aus deinem Rang (Arbeitet an)",
};

/**
 * "Deine Sicht": welche Standorte, woher, und was ausserdem sichtbar bleibt.
 * Am Desktop ein Aufklapper ueber dem Namensblock, am Handy ein Blatt von
 * unten (app.css, .zv-sicht-blatt) -- dieselbe Komponente.
 */
export function DeineSicht({
  sicht,
  onClose,
  onBelegung,
}: {
  sicht: StandortSichtDto;
  onClose: () => void;
  onBelegung: (standortId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function beiEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function beiKlick(e: MouseEvent) {
      const ziel = e.target as HTMLElement;
      // Der Ausloeser schaltet selbst um; sonst schloesse mousedown und der
      // folgende click oeffnete sofort wieder.
      if (ziel.closest?.("[data-sicht-ausloeser]")) return;
      if (ref.current && !ref.current.contains(ziel)) onClose();
    }
    document.addEventListener("keydown", beiEscape);
    // Erst nach dem oeffnenden Klick lauschen, sonst schliesst er sofort wieder.
    const zeit = window.setTimeout(() => document.addEventListener("mousedown", beiKlick));
    ref.current?.focus();
    return () => {
      window.clearTimeout(zeit);
      document.removeEventListener("keydown", beiEscape);
      document.removeEventListener("mousedown", beiKlick);
    };
  }, [onClose]);

  const e = eigene(sicht);
  const g = geliehen(sicht);
  return (
    <>
      <div className="zv-sicht-scrim" aria-hidden="true" />
      <div className="zv-sicht-blatt" role="dialog" aria-modal="false" aria-labelledby="zv-sicht-titel" ref={ref} tabIndex={-1}>
        <div className="zv-sicht-kopf">
          <h3 id="zv-sicht-titel">Deine Sicht</h3>
          <button type="button" className="zv-icon-btn" onClick={onClose} aria-label="Schließen">
            <IAbbrechen />
          </button>
        </div>
        {e.length === 0 && g.length === 0 && (
          <p className="zv-sicht-text">
            Du bist noch keinem Standort zugeordnet und siehst deshalb keine Klient:innen. Wende dich an deine Leitung.
          </p>
        )}
        <ul className="zv-sicht-liste">
          {e.map((s) => (
            <li key={s.standortId}>
              <IStandort />
              <div>
                <button type="button" className="zv-link-btn" onClick={() => onBelegung(s.standortId)}>
                  {s.standortName}
                </button>
                <span>{HERKUNFT_TEXT[s.herkunft as "fest" | "rang"]}</span>
              </div>
            </li>
          ))}
          {g.map((s) => (
            <li key={s.standortId}>
              <IVertretung />
              <div>
                <button type="button" className="zv-link-btn" onClick={() => onBelegung(s.standortId)}>
                  {s.standortName}
                </button>
                <span>
                  Vertretung für {s.vertretenerName ?? "eine Kollegin oder einen Kollegen"}
                  {s.bis ? `, bis ${formatDatum(s.bis)}` : ""}
                </span>
              </div>
            </li>
          ))}
          <li>
            <IKlienten />
            <div>
              <strong>Deine Bezugsklient:innen</strong>
              <span>bleiben sichtbar, auch nach einem Umzug</span>
            </div>
          </li>
        </ul>
        <p className="zv-sicht-text">Andere Standorte siehst du nur während einer Vertretung.</p>
      </div>
    </>
  );
}

/**
 * Hinweis auf "Heute", solange eine Vertretung Standorte oeffnet -- damit klar
 * ist, dass die zusaetzlichen Klient:innen nur geliehen sind. Bei "kein
 * Standort" der Hinweis, warum die Seite leer bleibt.
 */
export function SichtHinweis({ sicht }: { sicht: StandortSichtDto | null }) {
  if (!sicht || sicht.alle) return null;
  const g = geliehen(sicht);
  if (eigene(sicht).length === 0 && g.length === 0) {
    return (
      <div className="zv-hinweis zv-hinweis-info">
        <IFehler />
        <span>Du bist noch keinem Standort zugeordnet und siehst deshalb keine Klient:innen. Wende dich an deine Leitung.</span>
      </div>
    );
  }
  if (g.length === 0) return null;
  return (
    <div className="zv-hinweis zv-hinweis-info">
      <IVertretung />
      <span>
        {g.map((s, i) => (
          <span key={s.standortId}>
            {i > 0 && " · "}
            Bis <strong>{s.bis ? formatDatum(s.bis) : "auf Weiteres"}</strong> siehst du auch <strong>{s.standortName}</strong>
            {s.vertretenerName ? ` (Vertretung für ${s.vertretenerName})` : ""}.
          </span>
        ))}
      </span>
    </div>
  );
}
