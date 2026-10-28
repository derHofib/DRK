import { CSSProperties, useEffect, useState } from "react";
import type { StandortDto, StandortUebersichtDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { IFehler, IKassenbuch, IKlienten, ILeerStandorte, IZimmer } from "../components/icons";
import { StandortReiter } from "../components/StandortReiter";
import { formatBetrag, formatDatum } from "../format";

const AUSWAHL_SPEICHER = "zimmerakte_standorte_auswahl";

function ladeAuswahl(): string | null {
  try {
    return localStorage.getItem(AUSWAHL_SPEICHER);
  } catch {
    return null;
  }
}

function speichereAuswahl(id: string) {
  try {
    localStorage.setItem(AUSWAHL_SPEICHER, id);
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern.
  }
}

/**
 * Standort-Uebersicht (Menuepunkt "Standorte"): alles zu EINEM der dem Konto
 * zugeordneten Standorte an einer Stelle -- Zimmer, Klient:innen, Kassenbuch.
 * Die Standortliste kommt aus derselben Quelle wie in Dashboard/Zimmer und
 * enthaelt damit nur die erlaubten Standorte; die Verwaltung (Anlegen,
 * Umbenennen, Deaktivieren) bleibt in den Einstellungen.
 */
export function StandortUebersicht({ onBelegungOeffnen }: { onBelegungOeffnen: (standortId: string) => void }) {
  const [standorte, setStandorte] = useState<StandortDto[] | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(() => ladeAuswahl());
  const [daten, setDaten] = useState<StandortUebersichtDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGeladen, setWirdGeladen] = useState(false);

  useEffect(() => {
    api
      .standorteListe()
      .then((liste) => {
        const aktive = liste.filter((s) => s.aktiv);
        setStandorte(aktive);
        // Eine gespeicherte ID, die es nicht mehr gibt, faellt still auf den ersten Standort zurueck.
        setAuswahl((a) => (a && aktive.some((s) => s.id === a) ? a : (aktive[0]?.id ?? null)));
      })
      .catch((err) => setFehler(err.message));
  }, []);

  useEffect(() => {
    if (!auswahl) return;
    let abgebrochen = false;
    setWirdGeladen(true);
    setFehler(null);
    api
      .standortUebersicht(auswahl)
      .then((d) => !abgebrochen && setDaten(d))
      .catch((err) => !abgebrochen && setFehler(err.message))
      .finally(() => !abgebrochen && setWirdGeladen(false));
    return () => {
      abgebrochen = true;
    };
  }, [auswahl]);

  function waehlen(id: string) {
    setAuswahl(id);
    speichereAuswahl(id);
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
          <p className="zv-kontextzeile">
            {daten ? `${daten.standort.name} · ${daten.zimmer.anzahl} Zimmer` : "Alle Standorte"}
          </p>
          <h2>Standorte</h2>
          {daten && (
            <p className="zv-sub" style={{ margin: "2px 0 0" }}>
              {daten.standort.adresse}
            </p>
          )}
        </div>
        {auswahl && (
          <button className="zv-btn" onClick={() => onBelegungOeffnen(auswahl)}>
            <IZimmer />
            Zimmer und Belegung
          </button>
        )}
      </div>

      {standorte !== null && standorte.length === 0 && !fehler && (
        <Leerzustand icon={ILeerStandorte}>Ihnen ist kein Standort zugeordnet.</Leerzustand>
      )}

      {standorte && (
        <StandortReiter
          eintraege={standorte.map((st) => ({ id: st.id, label: st.name }))}
          aktiv={auswahl}
          onWaehle={(id) => id && waehlen(id)}
        />
      )}

      {daten && daten.standort.id === auswahl && (
        <div style={{ opacity: wirdGeladen ? 0.6 : 1, transition: "opacity var(--zv-transition-base)" }}>
          <div className="zv-stat-grid">
            <div className="zv-stat-karte">
              <p className="zv-stat-label">
                <IZimmer style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Plätze frei
              </p>
              <p className="zv-stat-wert">
                {daten.zimmer.plaetzeFrei} / {daten.zimmer.plaetzeGesamt}
              </p>
              <p className="zv-stat-sub">{daten.zimmer.anzahl} Zimmer</p>
            </div>
            <div className="zv-stat-karte">
              <p className="zv-stat-label">
                <IKlienten style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Klient:innen
              </p>
              <p className="zv-stat-wert">{daten.klienten.length}</p>
              <p className="zv-stat-sub">wohnen aktuell hier</p>
            </div>
            <div className="zv-stat-karte">
              <p className="zv-stat-label">
                <IKassenbuch style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Haus-Kasse
              </p>
              <p className="zv-stat-wert">{formatBetrag(daten.kassenbuch.hausSaldoCent)}</p>
              <p className="zv-stat-sub">Klientengelder: {formatBetrag(daten.kassenbuch.klientenSaldoCent)}</p>
            </div>
            <div className="zv-stat-karte">
              <p className="zv-stat-label">
                <IKassenbuch style={{ verticalAlign: "-2px", marginRight: 6 }} />
                HZL diese Woche
              </p>
              <p className="zv-stat-wert">
                {daten.kassenbuch.hzl.bezahlt} / {daten.kassenbuch.hzl.gesamt}
              </p>
              <p className="zv-stat-sub">
                KW {daten.kassenbuch.hzl.isoWoche}
                {daten.kassenbuch.offeneStornoantraege > 0 &&
                  ` · ${daten.kassenbuch.offeneStornoantraege} Storno-Antrag/-Anträge offen`}
              </p>
            </div>
          </div>

          <div className="zv-dashboard-spalten">
            <div className="zv-card">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                <IZimmer />
                Zimmer
              </h3>
              {daten.zimmer.liste.length === 0 ? (
                <p className="zv-sub">Noch keine Zimmer an diesem Standort.</p>
              ) : (
                <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.8fr 0.6fr 2fr 1fr" } as CSSProperties}>
                  <div className="zv-liste-kopf">
                    <span>Zimmer</span>
                    <span>Etage</span>
                    <span>Bewohner:innen</span>
                    <span>Belegung</span>
                  </div>
                  {daten.zimmer.liste.map((z) => {
                    const belegt = z.bewohner.length;
                    const pill = belegt === 0 ? "zv-pill-zugeordnet" : belegt >= z.kapazitaet ? "zv-pill-vergeben" : "zv-pill-teilweise";
                    return (
                      <div key={z.id} className="zv-info-karte">
                        <span className="zv-liste-zelle-titel">{z.nummer}</span>
                        <span className="zv-liste-zelle" data-label="Etage">
                          {z.etage || "–"}
                        </span>
                        <span className="zv-liste-zelle" data-label="Bewohner:innen">
                          {belegt === 0 ? "frei" : z.bewohner.map((b) => b.name).join(", ")}
                        </span>
                        <span className="zv-liste-zelle" data-label="Belegung">
                          <span className={`zv-pill ${pill}`}>
                            {belegt} / {z.kapazitaet}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="zv-card">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                <IKlienten />
                Klient:innen
              </h3>
              {daten.klienten.length === 0 ? (
                <p className="zv-sub">Zurzeit wohnt niemand an diesem Standort.</p>
              ) : (
                <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.6fr 0.7fr 1fr 1fr" } as CSSProperties}>
                  <div className="zv-liste-kopf">
                    <span>Name</span>
                    <span>Zimmer</span>
                    <span>Aktenzeichen</span>
                    <span>Einzug</span>
                  </div>
                  {daten.klienten.map((k) => (
                    <div key={k.id} className="zv-info-karte">
                      <span className="zv-liste-zelle-titel">{k.name}</span>
                      <span className="zv-liste-zelle" data-label="Zimmer">
                        {k.zimmerNummer}
                      </span>
                      <span className="zv-liste-zelle" data-label="Aktenzeichen">
                        {k.aktenzeichen ?? "–"}
                      </span>
                      <span className="zv-liste-zelle" data-label="Einzug">
                        {formatDatum(k.einzug)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="zv-card" style={{ marginTop: 16 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
              <IKassenbuch />
              Letzte Buchungen
            </h3>
            {daten.kassenbuch.letzteBuchungen.length === 0 ? (
              <p className="zv-sub">Noch keine Buchungen.</p>
            ) : (
              <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.8fr 1.4fr 1.4fr 1fr" } as CSSProperties}>
                <div className="zv-liste-kopf">
                  <span>Datum</span>
                  <span>Für</span>
                  <span>Art / Zweck</span>
                  <span>Betrag</span>
                </div>
                {daten.kassenbuch.letzteBuchungen.map((b) => (
                  <div key={b.id} className="zv-info-karte">
                    <span className="zv-liste-zelle-titel">{formatDatum(b.datum)}</span>
                    <span className="zv-liste-zelle" data-label="Für">
                      {b.klientName ?? "Haus"}
                    </span>
                    <span className="zv-liste-zelle" data-label="Art / Zweck">
                      {b.typBezeichnung}
                      {b.verwendungszweck && ` · ${b.verwendungszweck}`}
                    </span>
                    <span className="zv-liste-zelle" data-label="Betrag">
                      {formatBetrag(b.betragCent)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
