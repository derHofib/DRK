import { useEffect, useState } from "react";
import { AKTEN_ZUGRIFF_AKTION_LABEL, type AktenZugriffAuswertungDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatDatum } from "../format";
import { Leerzustand } from "./Leerzustand";
import { IFehler, IVerlauf } from "./icons";

const SEITE = 50;

function zeitpunkt(iso: string): string {
  const d = new Date(iso);
  const tag = d.toLocaleDateString("sv-SE"); // YYYY-MM-DD in lokaler Zeit
  return `${formatDatum(tag)}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

/**
 * Wer hat wann welche Klientenakte geoeffnet (Protokoll aus
 * migrations/0070). Ob die Person das sehen darf, entscheidet allein der
 * Server (Recht klienten.zugriffsprotokoll): bei 403 wird der ganze Bereich
 * gar nicht erst gezeigt, ein Hinweis auf ein verwehrtes Protokoll waere
 * selbst eine Information.
 */
export function AktenZugriffe() {
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [benutzerId, setBenutzerId] = useState("");
  const [seite, setSeite] = useState(0);
  const [daten, setDaten] = useState<AktenZugriffAuswertungDto | null>(null);
  // Die Personenauswahl speist sich aus der ungefilterten Auswertung, sonst
  // verschwaende die Auswahl, sobald man eine Person gewaehlt hat.
  const [personen, setPersonen] = useState<{ id: string; name: string }[]>([]);
  const [verborgen, setVerborgen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let aktuell = true;
    api
      .aktenZugriffe({ von, bis, benutzerId, offset: seite * SEITE, limit: SEITE })
      .then((r) => {
        if (!aktuell) return;
        setFehler(null);
        setDaten(r);
        if (!von && !bis && !benutzerId) setPersonen(r.jeBenutzer.map((b) => ({ id: b.benutzerId, name: b.benutzerName })));
      })
      .catch((err) => {
        if (!aktuell) return;
        if (err instanceof Error && /Berechtigung/.test(err.message)) setVerborgen(true);
        else setFehler(err instanceof Error ? err.message : "Zugriffsprotokoll konnte nicht geladen werden.");
      });
    return () => {
      aktuell = false;
    };
  }, [von, bis, benutzerId, seite]);

  if (verborgen) return null;

  function filterAendern(setter: (wert: string) => void, wert: string) {
    setter(wert);
    setSeite(0);
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Zugriffsprotokoll Klientenakten</h3>
      <p className="zv-sub">
        Wer hat wann eine Klientenakte geöffnet oder einen Aktenauszug abgerufen. Die Einträge sind unveränderlich;
        ein erneutes Öffnen derselben Akte innerhalb von 15 Minuten zählt nicht doppelt.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
        <div className="zv-field">
          <label htmlFor="zugriff-von">Von</label>
          <input id="zugriff-von" type="date" value={von} max={bis || undefined} onChange={(e) => filterAendern(setVon, e.target.value)} />
        </div>
        <div className="zv-field">
          <label htmlFor="zugriff-bis">Bis</label>
          <input id="zugriff-bis" type="date" value={bis} min={von || undefined} onChange={(e) => filterAendern(setBis, e.target.value)} />
        </div>
        <div className="zv-field">
          <label htmlFor="zugriff-person">Person</label>
          <select id="zugriff-person" value={benutzerId} onChange={(e) => filterAendern(setBenutzerId, e.target.value)}>
            <option value="">Alle</option>
            {personen.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {daten && daten.gesamt === 0 && <Leerzustand icon={IVerlauf}>Keine Zugriffe im gewählten Zeitraum.</Leerzustand>}

      {daten && daten.gesamt > 0 && (
        <>
          <h4>Zusammenfassung je Person</h4>
          <table className="zv-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Zugriffe</th>
                <th>Verschiedene Klient:innen</th>
                <th>Letzter Zugriff</th>
              </tr>
            </thead>
            <tbody>
              {daten.jeBenutzer.map((b) => (
                <tr key={b.benutzerId}>
                  <td>{b.benutzerName}</td>
                  <td>{b.anzahl}</td>
                  <td>{b.anzahlKlienten}</td>
                  <td>{zeitpunkt(b.letzterZugriff)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 style={{ marginTop: 24 }}>Einzelne Zugriffe ({daten.gesamt})</h4>
          <table className="zv-table">
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Person</th>
                <th>Klient:in</th>
                <th>Vorgang</th>
              </tr>
            </thead>
            <tbody>
              {daten.eintraege.map((e) => (
                <tr key={e.id}>
                  <td>{zeitpunkt(e.erstelltAm)}</td>
                  <td>{e.benutzerName}</td>
                  <td>{e.klientName}</td>
                  <td>{AKTEN_ZUGRIFF_AKTION_LABEL[e.aktion]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {daten.gesamt > SEITE && (
            <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
              <button className="zv-btn zv-btn-sekundaer" disabled={seite === 0} onClick={() => setSeite(seite - 1)}>
                Zurück
              </button>
              <span className="zv-sub-inline">
                {seite * SEITE + 1}–{Math.min((seite + 1) * SEITE, daten.gesamt)} von {daten.gesamt}
              </span>
              <button
                className="zv-btn zv-btn-sekundaer"
                disabled={(seite + 1) * SEITE >= daten.gesamt}
                onClick={() => setSeite(seite + 1)}
              >
                Weiter
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
