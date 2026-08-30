import { CSSProperties, useEffect, useState } from "react";
import type { DashboardDto } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Seitenpanel } from "../components/Seitenpanel";
import {
  IAnpassen,
  IFehler,
  IKassenbuch,
  IKostenuebernahme,
  ILeerKostenuebernahmen,
  ILeerTagesberichte,
  IMitarbeitende,
  IRechnung,
  ITagesberichte,
  IZimmer,
  IZuruecksetzen,
} from "../components/icons";
import { formatBetrag, formatDatum } from "../format";
import {
  geleseneSichtbarkeit,
  sichtbarkeitSpeichern,
  sichtbarkeitZuruecksetzen,
  standardSichtbarkeit,
  WIDGET_LABEL,
  WIDGET_REIHENFOLGE,
  type WidgetId,
} from "../dashboard/sichtbarkeit";

const HEUTE = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

export function Dashboard() {
  const istLeitung = tokenRolle() === "bereichsleitung" || tokenRolle() === "einrichtungsleitung";
  const [daten, setDaten] = useState<DashboardDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [sichtbarkeit, setSichtbarkeit] = useState(() => geleseneSichtbarkeit(istLeitung));
  const [anpassenOffen, setAnpassenOffen] = useState(false);

  useEffect(() => {
    api.dashboard().then(setDaten).catch((err) => setFehler(err.message));
  }, []);

  function sichtbarkeitAendern(id: WidgetId, sichtbar: boolean) {
    setSichtbarkeit((vorher) => {
      const naechste = { ...vorher, [id]: sichtbar };
      sichtbarkeitSpeichern(naechste, istLeitung);
      return naechste;
    });
  }

  function zuruecksetzen() {
    sichtbarkeitZuruecksetzen();
    setSichtbarkeit(standardSichtbarkeit(istLeitung));
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <div>
          <h2>Dashboard</h2>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            {HEUTE}
          </p>
        </div>
        <button className="zv-btn zv-btn-sekundaer" onClick={() => setAnpassenOffen(true)}>
          <IAnpassen />
          Anpassen
        </button>
      </div>

      {daten && (
        <>
          <div className="zv-stat-grid">
            {sichtbarkeit.zimmer && (
              <div className="zv-stat-karte">
                <p className="zv-stat-label">
                  <IZimmer style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Zimmer frei
                </p>
                <p className="zv-stat-wert">
                  {daten.zimmer.frei} / {daten.zimmer.gesamt}
                </p>
                <p className="zv-stat-sub">über {daten.zimmer.standorte} Standorte</p>
              </div>
            )}
            {sichtbarkeit.hzl && (
              <div className="zv-stat-karte">
                <p className="zv-stat-label">
                  <IKassenbuch style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  HZL diese Woche
                </p>
                <p className="zv-stat-wert">
                  {daten.hzlWoche.bezahlt} / {daten.hzlWoche.gesamt}
                </p>
                <p className="zv-stat-sub">KW {daten.hzlWoche.isoWoche}</p>
              </div>
            )}
            {sichtbarkeit.rechnungen && (
              <div className="zv-stat-karte">
                <p className="zv-stat-label">
                  <IRechnung style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Offene Rechnungen
                </p>
                <p className="zv-stat-wert">{daten.offeneRechnungen.anzahl}</p>
                <p className="zv-stat-sub">{formatBetrag(daten.offeneRechnungen.summeCent)} warten auf Genehmigung</p>
              </div>
            )}
            {sichtbarkeit.mitarbeitende && (
              <div className="zv-stat-karte">
                <p className="zv-stat-label">
                  <IMitarbeitende style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Mitarbeitende
                </p>
                <p className="zv-stat-wert">{daten.mitarbeitende.aktiv}</p>
                <p className="zv-stat-sub">
                  {daten.mitarbeitende.ausstehendeResets === 0
                    ? "Keine offenen Passwort-Resets"
                    : `${daten.mitarbeitende.ausstehendeResets} Passwort-Reset(s) ausstehend`}
                </p>
              </div>
            )}
          </div>

          {(sichtbarkeit.kostenuebernahmen || sichtbarkeit.tagesberichte) && (
            <div className="zv-dashboard-spalten">
              {sichtbarkeit.kostenuebernahmen && (
                <div className="zv-card">
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                    <IKostenuebernahme />
                    Kostenübernahmen laufen bald aus
                  </h3>
                  {daten.kostenuebernahmenBaldEndend.length === 0 ? (
                    <Leerzustand icon={ILeerKostenuebernahmen}>Keine Kostenübernahme läuft in den nächsten 30 Tagen aus.</Leerzustand>
                  ) : (
                    <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.6fr 1fr 1fr" } as CSSProperties}>
                      <div className="zv-liste-kopf">
                        <span>Klient</span>
                        <span>Bis</span>
                        <span>Verbleibend</span>
                      </div>
                      {daten.kostenuebernahmenBaldEndend.map((k) => (
                        <div key={k.klientId} className="zv-info-karte">
                          <span className="zv-liste-zelle-titel">
                            {k.klientName}
                            <span className="zv-sub-inline zv-sub-inline-zeile">{k.amt}</span>
                          </span>
                          <span className="zv-liste-zelle" data-label="Bis">
                            {formatDatum(k.bis)}
                          </span>
                          <span className="zv-liste-zelle" data-label="Verbleibend">
                            <span className={`zv-pill ${k.tageVerbleibend <= 7 ? "zv-pill-vergeben" : "zv-pill-offen"}`}>
                              in {k.tageVerbleibend} {k.tageVerbleibend === 1 ? "Tag" : "Tagen"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {sichtbarkeit.tagesberichte && (
                <div className="zv-card">
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                    <ITagesberichte />
                    Klienten ohne aktuellen Tagesbericht
                  </h3>
                  {daten.klientenOhneTagesbericht.length === 0 ? (
                    <Leerzustand icon={ILeerTagesberichte}>Für alle Klient:innen liegt ein aktueller Tagesbericht vor.</Leerzustand>
                  ) : (
                    <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.6fr 1.4fr" } as CSSProperties}>
                      <div className="zv-liste-kopf">
                        <span>Klient</span>
                        <span>Letzter Bericht</span>
                      </div>
                      {daten.klientenOhneTagesbericht.map((k) => (
                        <div key={k.klientId} className="zv-info-karte">
                          <span className="zv-liste-zelle-titel">
                            {k.klientName}
                            <span className="zv-sub-inline zv-sub-inline-zeile">
                              {k.standortName}, Zimmer {k.zimmerNummer}
                            </span>
                          </span>
                          <span className="zv-liste-zelle" data-label="Letzter Bericht">
                            {k.tageSeitLetztem === null ? (
                              <span className="zv-pill zv-pill-vergeben">Noch nie</span>
                            ) : (
                              <span className="zv-pill zv-pill-vergeben">
                                vor {k.tageSeitLetztem} {k.tageSeitLetztem === 1 ? "Tag" : "Tagen"}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Seitenpanel offen={anpassenOffen} onSchliessen={() => setAnpassenOffen(false)}>
        <h3 style={{ marginTop: 0 }}>Widgets anpassen</h3>
        <p className="zv-sub">Gilt nur für dich, auf diesem Gerät.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {WIDGET_REIHENFOLGE.map((id) => (
            <label key={id} className="zv-checkbox-zeile">
              <input type="checkbox" checked={sichtbarkeit[id]} onChange={(e) => sichtbarkeitAendern(id, e.target.checked)} />
              {WIDGET_LABEL[id]}
            </label>
          ))}
        </div>
        <button className="zv-btn zv-btn-still" onClick={zuruecksetzen} style={{ marginTop: 20 }}>
          <IZuruecksetzen />
          Zurücksetzen
        </button>
      </Seitenpanel>
    </div>
  );
}
