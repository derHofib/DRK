import { CSSProperties, useEffect, useState } from "react";
import type { StandortDto, StandortUebersichtDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { IFehler, IKassenbuch, IKlienten, ILeerStandorte, IZimmer } from "../components/icons";
import { KachelRaster, KachelDef } from "../components/KachelRaster";
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
export function StandortUebersicht({ onBelegungOeffnen, nutzerId }: { onBelegungOeffnen: (standortId: string) => void; nutzerId: string }) {
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

  const kacheln: KachelDef[] | null = daten ? [
    {
      id: "stat-plaetze",
      titel: "Plätze frei",
      standard: { x: 0, y: 0, w: 3, h: 3 },
      minW: 3,
      minH: 3,
      inhalt: (
        <div className="zv-kachel-stat">
              <p className="zv-stat-label">
                <IZimmer style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Plätze frei
              </p>
              <p className="zv-stat-wert">
                {daten.zimmer.plaetzeFrei} / {daten.zimmer.plaetzeGesamt}
              </p>
              <p className="zv-stat-sub">{daten.zimmer.anzahl} Zimmer</p>
            </div>
      ),
    },
    {
      id: "stat-klienten",
      titel: "Klient:innen (Anzahl)",
      standard: { x: 3, y: 0, w: 3, h: 3 },
      minW: 3,
      minH: 3,
      inhalt: (
        <div className="zv-kachel-stat">
              <p className="zv-stat-label">
                <IKlienten style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Klient:innen
              </p>
              <p className="zv-stat-wert">{daten.klienten.length}</p>
              <p className="zv-stat-sub">wohnen aktuell hier</p>
            </div>
      ),
    },
    {
      id: "stat-kasse",
      titel: "Haus-Kasse",
      standard: { x: 6, y: 0, w: 3, h: 3 },
      minW: 3,
      minH: 3,
      inhalt: (
        <div className="zv-kachel-stat">
              <p className="zv-stat-label">
                <IKassenbuch style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Haus-Kasse
              </p>
              <p className="zv-stat-wert">{formatBetrag(daten.kassenbuch.hausSaldoCent)}</p>
              <p className="zv-stat-sub">Klientengelder: {formatBetrag(daten.kassenbuch.klientenSaldoCent)}</p>
            </div>
      ),
    },
    {
      id: "stat-hzl",
      titel: "HZL diese Woche",
      standard: { x: 9, y: 0, w: 3, h: 3 },
      minW: 3,
      minH: 3,
      inhalt: (
        <div className="zv-kachel-stat">
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
      ),
    },
    {
      id: "zimmer",
      titel: "Zimmer",
      standard: { x: 0, y: 3, w: 6, h: 8 },
      minW: 5,
      minH: 6,
      inhalt: (
        <div className="zv-kachel-karte">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                <IZimmer />
                Zimmer
              </h3>
              {daten.zimmer.liste.length === 0 ? (
                <p className="zv-sub">Noch keine Zimmer an diesem Standort.</p>
              ) : (
                <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "minmax(44px,0.8fr) minmax(84px,1.2fr) minmax(0,1.6fr) minmax(52px,0.9fr)" } as CSSProperties}>
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
      ),
    },
    {
      id: "klienten",
      titel: "Klient:innen",
      standard: { x: 6, y: 3, w: 6, h: 8 },
      minW: 5,
      minH: 6,
      inhalt: (
        <div className="zv-kachel-karte">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                <IKlienten />
                Klient:innen
              </h3>
              {daten.klienten.length === 0 ? (
                <p className="zv-sub">Zurzeit wohnt niemand an diesem Standort.</p>
              ) : (
                <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "minmax(0,1.6fr) minmax(44px,0.7fr) minmax(0,1.2fr) minmax(80px,1fr)" } as CSSProperties}>
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
      ),
    },
    {
      id: "buchungen",
      titel: "Letzte Buchungen",
      standard: { x: 0, y: 11, w: 12, h: 8 },
      minW: 6,
      minH: 6,
      inhalt: (
        <div className="zv-kachel-karte">
            <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
              <IKassenbuch />
              Letzte Buchungen
            </h3>
            {daten.kassenbuch.letzteBuchungen.length === 0 ? (
              <p className="zv-sub">Noch keine Buchungen.</p>
            ) : (
              <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "minmax(84px,0.8fr) minmax(0,1.2fr) minmax(0,1.6fr) minmax(70px,0.9fr)" } as CSSProperties}>
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
      ),
    },
  ] : null;

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

      {daten && kacheln && daten.standort.id === auswahl && (
        <div style={{ opacity: wirdGeladen ? 0.6 : 1, transition: "opacity var(--zv-transition-base)" }}>
          <KachelRaster speicherSchluessel={`zimmerakte_standort_layout_${nutzerId}`} kacheln={kacheln} />
        </div>
      )}
    </div>
  );
}
