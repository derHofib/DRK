import { CSSProperties, useEffect, useState } from "react";
import type { DashboardDto, StandortDto } from "@zimmerakte/shared";
import { AUFGABE_PRIORITAET_LABEL } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { faelligkeitsHinweis, PRIORITAET_ICON, PRIORITAET_PILL_KLASSE } from "../components/AufgabeZeile";
import { Leerzustand } from "../components/Leerzustand";
import { Seitenpanel } from "../components/Seitenpanel";
import {
  IAnpassen,
  IAufgaben,
  IFehler,
  IKassenbuch,
  IKostenuebernahme,
  ILeerAufgaben,
  ILeerKostenuebernahmen,
  ILeerTagesberichte,
  IMitarbeitende,
  IRechnung,
  IStornieren,
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

/**
 * Reine Anzeigepraeferenz dieses Geraets, genau wie die Widget-Sichtbarkeit
 * (siehe dashboard/sichtbarkeit.ts) -- deshalb localStorage, nicht die
 * Datenbank. Eine gespeicherte ID, die es in der aktuellen Liste nicht mehr
 * gibt (Standort deaktiviert, Zuordnung geaendert), faellt beim Laden still
 * auf "Alle Standorte" zurueck statt einen Fehler zu zeigen.
 */
const STANDORT_AUSWAHL_KEY = "zimmerakte_dashboard_standort";

function geleseneStandortAuswahl(): string | null {
  try {
    return localStorage.getItem(STANDORT_AUSWAHL_KEY);
  } catch {
    return null;
  }
}

function standortAuswahlSpeichern(standortId: string | null): void {
  try {
    if (standortId) localStorage.setItem(STANDORT_AUSWAHL_KEY, standortId);
    else localStorage.removeItem(STANDORT_AUSWAHL_KEY);
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern.
  }
}

export function Dashboard() {
  const istLeitung = tokenRolle() === "bereichsleitung" || tokenRolle() === "einrichtungsleitung";
  const [daten, setDaten] = useState<DashboardDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [sichtbarkeit, setSichtbarkeit] = useState(() => geleseneSichtbarkeit(istLeitung));
  const [anpassenOffen, setAnpassenOffen] = useState(false);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [standortAuswahl, setStandortAuswahl] = useState<string | null>(() => geleseneStandortAuswahl());
  const [standorteBereit, setStandorteBereit] = useState(false);
  const [wirdGeladen, setWirdGeladen] = useState(false);

  useEffect(() => {
    api
      .standorteListe()
      .then((liste) => {
        const aktive = liste.filter((s) => s.aktiv);
        setStandorte(aktive);
        setStandortAuswahl((vorher) => (vorher && !aktive.some((s) => s.id === vorher) ? null : vorher));
      })
      .catch((err) => setFehler(err.message))
      .finally(() => setStandorteBereit(true));
  }, []);

  useEffect(() => {
    // Erst laden, wenn die Standortliste die gespeicherte Auswahl geprueft
    // hat -- sonst ginge kurz eine Anfrage mit einer inzwischen ungueltigen
    // ID raus, bevor der Rueckfall auf "Alle Standorte" greift.
    if (!standorteBereit) return;
    setWirdGeladen(true);
    api
      .dashboard(standortAuswahl ?? undefined)
      .then((d) => {
        setDaten(d);
        setFehler(null);
      })
      .catch((err) => setFehler(err.message))
      .finally(() => setWirdGeladen(false));
  }, [standortAuswahl, standorteBereit]);

  function standortWaehlen(id: string | null) {
    setStandortAuswahl(id);
    standortAuswahlSpeichern(id);
  }

  const ausgewaehlterStandort = standortAuswahl ? standorte.find((s) => s.id === standortAuswahl) ?? null : null;

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
            {standorte.length === 1 && ` · ${standorte[0].name}`}
          </p>
        </div>
        <button className="zv-btn zv-btn-sekundaer" onClick={() => setAnpassenOffen(true)}>
          <IAnpassen />
          Anpassen
        </button>
      </div>

      {standorte.length > 1 && (
        <div className="zv-tabbar" style={{ padding: 0, marginBottom: 20 }}>
          <button
            className={standortAuswahl === null ? "active" : ""}
            aria-current={standortAuswahl === null ? "true" : undefined}
            onClick={() => standortWaehlen(null)}
          >
            Alle Standorte
          </button>
          {standorte.map((s) => (
            <button
              key={s.id}
              className={standortAuswahl === s.id ? "active" : ""}
              aria-current={standortAuswahl === s.id ? "true" : undefined}
              onClick={() => standortWaehlen(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {daten && (
        <div style={{ opacity: wirdGeladen ? 0.6 : 1, transition: "opacity var(--zv-transition-base)" }}>
          <div className="zv-stat-grid">
            {sichtbarkeit.zimmer && (
              <div className="zv-stat-karte">
                <p className="zv-stat-label">
                  <IZimmer style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Plätze frei
                </p>
                <p className="zv-stat-wert">
                  {daten.zimmer.frei} / {daten.zimmer.gesamt}
                </p>
                <p className="zv-stat-sub">
                  {ausgewaehlterStandort ? ausgewaehlterStandort.name : `über ${daten.zimmer.standorte} Standorte`}
                </p>
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
            {sichtbarkeit.stornoantraege && (
              <div className="zv-stat-karte">
                <p className="zv-stat-label">
                  <IStornieren style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Offene Storno-Anträge
                </p>
                <p className="zv-stat-wert">{daten.offeneStornoantraege.anzahl}</p>
                <p className="zv-stat-sub">
                  {daten.offeneStornoantraege.anzahl === 0 ? "Nichts wartet auf Bewilligung" : "warten auf Bewilligung"}
                </p>
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

          {(sichtbarkeit.unzugewieseneAufgaben ||
            sichtbarkeit.meineAufgaben ||
            sichtbarkeit.kostenuebernahmen ||
            sichtbarkeit.tagesberichte) && (
            <div className="zv-dashboard-spalten">
              {sichtbarkeit.unzugewieseneAufgaben && (
                <div className="zv-card">
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                    <IAufgaben />
                    Unzugewiesene Zimmer-Aufgaben
                  </h3>
                  {daten.unzugewieseneZimmeraufgaben.length === 0 ? (
                    <Leerzustand icon={ILeerAufgaben}>Jede offene Zimmer-Aufgabe ist bereits zugewiesen.</Leerzustand>
                  ) : (
                    <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.3fr 0.8fr 1.3fr" } as CSSProperties}>
                      <div className="zv-liste-kopf">
                        <span>Aufgabe</span>
                        <span>Priorität</span>
                        <span>Fälligkeit</span>
                      </div>
                      {daten.unzugewieseneZimmeraufgaben.map((a) => {
                        const PrioritaetIcon = PRIORITAET_ICON[a.prioritaet];
                        const faelligkeit = faelligkeitsHinweis(a.faelligAm);
                        return (
                          <div key={a.id} className="zv-info-karte">
                            <span className="zv-liste-zelle-titel">
                              {a.titel}
                              <span className="zv-sub-inline zv-sub-inline-zeile">
                                {a.standortName}, Zimmer {a.zimmerNummer}
                              </span>
                            </span>
                            <span className="zv-liste-zelle" data-label="Priorität">
                              <span className={`zv-pill ${PRIORITAET_PILL_KLASSE[a.prioritaet]}`}>
                                <PrioritaetIcon />
                                {AUFGABE_PRIORITAET_LABEL[a.prioritaet]}
                              </span>
                            </span>
                            <span className="zv-liste-zelle" data-label="Fälligkeit">
                              {faelligkeit ? (
                                <span className={`zv-pill ${faelligkeit.klasse}`}>
                                  <span className="zv-pill-text">{faelligkeit.text}</span>
                                </span>
                              ) : (
                                <span className="zv-sub-inline">ohne Termin</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {sichtbarkeit.meineAufgaben && (
                <div className="zv-card">
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                    <IAufgaben />
                    Mir zugewiesene Aufgaben
                    {standortAuswahl !== null && <span className="zv-sub-inline">alle Standorte</span>}
                  </h3>
                  {daten.meineOffenenAufgaben.length === 0 ? (
                    <Leerzustand icon={ILeerAufgaben}>Dir sind aktuell keine offenen Aufgaben zugewiesen.</Leerzustand>
                  ) : (
                    <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.3fr 0.8fr 1.3fr" } as CSSProperties}>
                      <div className="zv-liste-kopf">
                        <span>Aufgabe</span>
                        <span>Priorität</span>
                        <span>Fälligkeit</span>
                      </div>
                      {daten.meineOffenenAufgaben.map((a) => {
                        const PrioritaetIcon = PRIORITAET_ICON[a.prioritaet];
                        const faelligkeit = faelligkeitsHinweis(a.faelligAm);
                        return (
                          <div key={a.id} className="zv-info-karte">
                            <span className="zv-liste-zelle-titel">
                              {a.titel}
                              <span className="zv-sub-inline zv-sub-inline-zeile">
                                {a.zimmerNummer ? `${a.standortName}, Zimmer ${a.zimmerNummer}` : "Persönliche Aufgabe"}
                              </span>
                            </span>
                            <span className="zv-liste-zelle" data-label="Priorität">
                              <span className={`zv-pill ${PRIORITAET_PILL_KLASSE[a.prioritaet]}`}>
                                <PrioritaetIcon />
                                {AUFGABE_PRIORITAET_LABEL[a.prioritaet]}
                              </span>
                            </span>
                            <span className="zv-liste-zelle" data-label="Fälligkeit">
                              {faelligkeit ? (
                                <span className={`zv-pill ${faelligkeit.klasse}`}>
                                  <span className="zv-pill-text">{faelligkeit.text}</span>
                                </span>
                              ) : (
                                <span className="zv-sub-inline">ohne Termin</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {sichtbarkeit.kostenuebernahmen && (
                <div className="zv-card">
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                    <IKostenuebernahme />
                    Kostenübernahmen laufen bald aus
                  </h3>
                  {daten.kostenuebernahmenBaldEndend.length === 0 ? (
                    <Leerzustand icon={ILeerKostenuebernahmen}>Keine Kostenübernahme läuft in den nächsten 30 Tagen aus.</Leerzustand>
                  ) : (
                    <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.3fr 0.8fr 1.3fr" } as CSSProperties}>
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
        </div>
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
