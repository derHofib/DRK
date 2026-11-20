import { useRef, useState } from "react";
import { SCHNELLWAHL_LABEL, type Schnellwahl } from "../pages/tagesberichte-filter";
import { Datumseingabe, Kalender, useGrobZeiger } from "./Datumsfeld";
import { zeitraumInWorten } from "./datumsfeld-logik";

/**
 * Inhalt der Zeitraum-Pille in Filterleisten (Konzept Datumsfeld, 3.6):
 * Schnellwahl links, rechts Von/Bis zum Tippen ueber zwei Monaten.
 *
 * Vorher Liste + zwei native Felder: ein Klick aufs Symbol oeffnete ein
 * zweites, fremdes Popup ueber dem eigenen Popover, und den gewaehlten
 * Zeitraum sah man nirgends am Stueck.
 *
 * Schnellwahl filtert sofort und schliesst. Ein eigener Zeitraum erst mit
 * "Übernehmen": wer den ersten Tag anklickt, will noch nicht filtern, und
 * eine Liste, die zwischen zwei Klicks umspringt, wirkt kaputt.
 */
export function ZeitraumAuswahl({
  idPraefix,
  schnellwahl,
  von,
  bis,
  onSchnellwahl,
  onUebernehmen,
}: {
  idPraefix: string;
  schnellwahl: Schnellwahl | null;
  von: string;
  bis: string;
  onSchnellwahl: (w: Schnellwahl) => void;
  onUebernehmen: (von: string, bis: string) => void;
}) {
  const grob = useGrobZeiger();
  const [eVon, setEVon] = useState(von);
  const [eBis, setEBis] = useState(bis);
  const [phase, setPhase] = useState<"von" | "bis">("von");
  const [zeige, setZeige] = useState<string | undefined>(undefined);
  const vonFeld = useRef<HTMLInputElement>(null);
  // Unter 760 px passen Liste und zwei Monate nicht nebeneinander (gemessen
  // ~700 px Inhalt): dann ein Monat, Schnellwahl als Chips darueber.
  const kompakt = grob || window.innerWidth < 760;
  const ungueltig = Boolean(eVon && eBis && eVon > eBis);
  // Sobald Von/Bis angefasst sind, gilt der Entwurf als eigener Zeitraum --
  // die alte Schnellwahl hervorzuheben, waere dann falsch.
  const [eigen, setEigen] = useState(false);
  const benutzerdefiniert = eigen || schnellwahl === null;

  const schnell = (Object.keys(SCHNELLWAHL_LABEL) as Schnellwahl[]).map((w) => ({ wert: w, label: SCHNELLWAHL_LABEL[w] }));

  function feld(teil: "von" | "bis") {
    const id = `${idPraefix}-${teil}`;
    const wert = teil === "von" ? eVon : eBis;
    const setzen = (v: string) => {
      if (teil === "von") setEVon(v);
      else setEBis(v);
      if (v) setZeige(v);
      setEigen(true);
      setPhase(teil === "von" ? "bis" : "von");
    };
    return (
      <div className="zv-field">
        <label htmlFor={id}>{teil === "von" ? "Von" : "Bis"}</label>
        {grob ? (
          <input
            id={id}
            type="date"
            className="zv-datum-nativ kompakt"
            value={wert}
            min={teil === "bis" ? eVon || undefined : undefined}
            max={teil === "von" ? eBis || undefined : undefined}
            onChange={(e) => setzen(e.target.value)}
          />
        ) : (
          <Datumseingabe
            id={id}
            wert={wert}
            onWert={setzen}
            kompakt
            ohneKalender
            eingabeRef={teil === "von" ? vonFeld : undefined}
            aria-invalid={teil === "bis" && ungueltig}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`zv-zeitraumwahl${kompakt ? " kompakt" : ""}`}>
      <div className="zv-zeitraumwahl-schnell" role="listbox" aria-label="Schnellwahl">
        {schnell.map((o) => (
          <button key={o.wert} type="button" role="option" aria-selected={!eigen && schnellwahl === o.wert} onClick={() => onSchnellwahl(o.wert)}>
            {o.label}
          </button>
        ))}
        <button
          type="button"
          role="option"
          aria-selected={benutzerdefiniert}
          onClick={() => {
            setEigen(true);
            setPhase("von");
            vonFeld.current?.focus();
          }}
        >
          Benutzerdefiniert
        </button>
      </div>
      <div className="zv-zeitraumwahl-haupt">
        <div className="zv-zeitraumwahl-felder">
          {feld("von")}
          {feld("bis")}
        </div>
        {!grob && (
          <Kalender
            bereich={{ von: eVon, bis: eBis, phase }}
            monate={kompakt ? 1 : 2}
            zeige={zeige}
            onWaehlen={(iso) => {
              setEigen(true);
              if (phase === "von") {
                setEVon(iso);
                if (eBis && eBis < iso) setEBis("");
                setPhase("bis");
              } else {
                if (eVon && iso < eVon) {
                  setEBis(eVon);
                  setEVon(iso);
                } else setEBis(iso);
                setPhase("von");
              }
            }}
          />
        )}
        <div className="zv-zeitraumwahl-fuss">
          <span className="zv-zeitraumwahl-text" aria-live="polite">
            {ungueltig ? "„Bis“ liegt vor „Von“." : zeitraumInWorten(eVon, eBis)}
          </span>
          <button
            type="button"
            className="zv-btn zv-btn-klein"
            disabled={(!eVon && !eBis) || ungueltig}
            onClick={() => onUebernehmen(eVon, eBis)}
          >
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
