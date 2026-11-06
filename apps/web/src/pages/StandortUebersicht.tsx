import { CSSProperties, useEffect, useMemo, useState } from "react";
import type { StandortDto, StandortUebersichtDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { IFehler, IKassenbuch, IKlienten, ILeerStandorte, IStandort, IZimmer } from "../components/icons";
import { FilterMehrfachAuswahl, FilterPille } from "../components/Filterleiste";
import { KachelRaster, KachelDef } from "../components/KachelRaster";
import { formatBetrag, formatDatum } from "../format";

const AUSWAHL_SPEICHER = "zimmerakte_standorte_auswahl_v2";
const INFO_SPEICHER = "zimmerakte_standorte_infos";

type Info = "kennzahlen" | "zimmer" | "klienten" | "buchungen";
const INFO_LABEL: Record<Info, string> = {
  kennzahlen: "Kennzahlen",
  zimmer: "Zimmer",
  klienten: "Klient:innen",
  buchungen: "Letzte Buchungen",
};
const ALLE_INFOS = Object.keys(INFO_LABEL) as Info[];

function ladeListe(schluessel: string): string[] {
  try {
    const roh = JSON.parse(localStorage.getItem(schluessel) ?? "[]") as unknown;
    return Array.isArray(roh) ? roh.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function speichereListe(schluessel: string, liste: string[]) {
  try {
    localStorage.setItem(schluessel, JSON.stringify(liste));
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern.
  }
}

/** Ein Standort-Ergebnis mit Standortname je Zeile, damit zusammengefuehrte Listen zeigen, woher eine Zeile stammt. */
type Zusammen = {
  mehrere: boolean;
  anzahlZimmer: number;
  plaetzeGesamt: number;
  plaetzeFrei: number;
  zimmer: (StandortUebersichtDto["zimmer"]["liste"][number] & { standort: string })[];
  klienten: (StandortUebersichtDto["klienten"][number] & { standort: string })[];
  hausSaldoCent: number;
  klientenSaldoCent: number;
  hzl: { bezahlt: number; gesamt: number; isoWoche: number };
  offeneStornoantraege: number;
  buchungen: (StandortUebersichtDto["kassenbuch"]["letzteBuchungen"][number] & { standort: string })[];
};

function zusammenfuehren(teile: StandortUebersichtDto[]): Zusammen {
  const z: Zusammen = {
    mehrere: teile.length > 1,
    anzahlZimmer: 0,
    plaetzeGesamt: 0,
    plaetzeFrei: 0,
    zimmer: [],
    klienten: [],
    hausSaldoCent: 0,
    klientenSaldoCent: 0,
    hzl: { bezahlt: 0, gesamt: 0, isoWoche: teile[0]?.kassenbuch.hzl.isoWoche ?? 0 },
    offeneStornoantraege: 0,
    buchungen: [],
  };
  for (const d of teile) {
    const n = d.standort.name;
    z.anzahlZimmer += d.zimmer.anzahl;
    z.plaetzeGesamt += d.zimmer.plaetzeGesamt;
    z.plaetzeFrei += d.zimmer.plaetzeFrei;
    z.zimmer.push(...d.zimmer.liste.map((r) => ({ ...r, standort: n })));
    z.klienten.push(...d.klienten.map((r) => ({ ...r, standort: n })));
    z.hausSaldoCent += d.kassenbuch.hausSaldoCent;
    z.klientenSaldoCent += d.kassenbuch.klientenSaldoCent;
    z.hzl.bezahlt += d.kassenbuch.hzl.bezahlt;
    z.hzl.gesamt += d.kassenbuch.hzl.gesamt;
    z.offeneStornoantraege += d.kassenbuch.offeneStornoantraege;
    z.buchungen.push(...d.kassenbuch.letzteBuchungen.map((r) => ({ ...r, standort: n })));
  }
  z.buchungen.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  z.buchungen = z.buchungen.slice(0, 10);
  return z;
}

/**
 * Standort-Uebersicht (Menuepunkt "Standorte"): Zimmer, Klient:innen,
 * Kassenbuch. Statt Reitern gibt es die Filterleiste wie bei den
 * Tagesberichten: ohne Standortfilter werden alle erlaubten Standorte
 * zusammengefasst, mit Filter einer oder mehrere. Zweiter Filter waehlt, welche
 * Informationen als Kacheln erscheinen. Die Standortliste enthaelt nur die
 * dem Konto zugeordneten Standorte; die Verwaltung bleibt in den Einstellungen.
 * Zusammengefuehrt wird im Client aus den Einzelabfragen -- jede laeuft
 * weiter unter RLS und Standortfreigabe des Kontos.
 */
export function StandortUebersicht({ onBelegungOeffnen, nutzerId }: { onBelegungOeffnen: (standortId: string) => void; nutzerId: string }) {
  const [standorte, setStandorte] = useState<StandortDto[] | null>(null);
  const [auswahl, setAuswahl] = useState<string[]>(() => ladeListe(AUSWAHL_SPEICHER));
  const [infos, setInfos] = useState<Info[]>(() => ladeListe(INFO_SPEICHER).filter((i): i is Info => i in INFO_LABEL));
  const [daten, setDaten] = useState<Zusammen | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGeladen, setWirdGeladen] = useState(false);

  useEffect(() => {
    api
      .standorteListe()
      .then((liste) => setStandorte(liste.filter((s) => s.aktiv)))
      .catch((err) => setFehler(err.message));
  }, []);

  // Gespeicherte IDs, die es nicht mehr gibt, fallen still weg.
  const gueltig = useMemo(() => (standorte ? auswahl.filter((id) => standorte.some((s) => s.id === id)) : []), [standorte, auswahl]);
  const abfrageIds = standorte ? (gueltig.length > 0 ? gueltig : standorte.map((s) => s.id)) : [];
  const abfrageSchluessel = abfrageIds.join(",");

  useEffect(() => {
    if (!abfrageSchluessel) {
      setDaten(null);
      return;
    }
    let abgebrochen = false;
    setWirdGeladen(true);
    setFehler(null);
    Promise.all(abfrageSchluessel.split(",").map((id) => api.standortUebersicht(id)))
      .then((teile) => !abgebrochen && setDaten(zusammenfuehren(teile)))
      .catch((err) => !abgebrochen && setFehler(err.message))
      .finally(() => !abgebrochen && setWirdGeladen(false));
    return () => {
      abgebrochen = true;
    };
  }, [abfrageSchluessel]);

  const sichtbar = (i: Info) => infos.length === 0 || infos.includes(i);
  const einzelStandort = abfrageIds.length === 1 ? abfrageIds[0] : null;
  const filterAktiv = gueltig.length > 0 || infos.length > 0;
  const standortName = (id: string) => standorte?.find((s) => s.id === id)?.name ?? id;

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
                {daten.plaetzeFrei} / {daten.plaetzeGesamt}
              </p>
              <p className="zv-stat-sub">{daten.anzahlZimmer} Zimmer</p>
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
              <p className="zv-stat-wert">{formatBetrag(daten.hausSaldoCent)}</p>
              <p className="zv-stat-sub">Klientengelder: {formatBetrag(daten.klientenSaldoCent)}</p>
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
                {daten.hzl.bezahlt} / {daten.hzl.gesamt}
              </p>
              <p className="zv-stat-sub">
                KW {daten.hzl.isoWoche}
                {daten.offeneStornoantraege > 0 &&
                  ` · ${daten.offeneStornoantraege} Storno-Antrag/-Anträge offen`}
              </p>
            </div>
      ),
    },
    {
      id: "zimmer",
      titel: "Zimmer",
      standard: { x: 0, y: 3, w: 6, h: 8 },
      minW: 6,
      minH: 6,
      inhalt: (
        <div className="zv-kachel-karte">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
                <IZimmer />
                Zimmer
              </h3>
              {daten.zimmer.length === 0 ? (
                <p className="zv-sub">Noch keine Zimmer an diesem Standort.</p>
              ) : (
                <div className="zv-karten-liste" style={{ "--zv-liste-spalten": `minmax(44px,0.8fr) ${daten.mehrere ? "minmax(0,1.2fr) " : ""}minmax(84px,1.2fr) minmax(0,1.6fr) minmax(52px,0.9fr)` } as CSSProperties}>
                  <div className="zv-liste-kopf">
                    <span>Zimmer</span>
                    {daten.mehrere && <span>Standort</span>}
                    <span>Etage</span>
                    <span>Bewohner:innen</span>
                    <span>Belegung</span>
                  </div>
                  {daten.zimmer.map((z) => {
                    const belegt = z.bewohner.length;
                    const pill = belegt === 0 ? "zv-pill-zugeordnet" : belegt >= z.kapazitaet ? "zv-pill-vergeben" : "zv-pill-teilweise";
                    return (
                      <div key={z.id} className="zv-info-karte">
                        <span className="zv-liste-zelle-titel">{z.nummer}</span>
                        {daten.mehrere && (
                          <span className="zv-liste-zelle" data-label="Standort">
                            {z.standort}
                          </span>
                        )}
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
      minW: 6,
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
                <div className="zv-karten-liste" style={{ "--zv-liste-spalten": `minmax(0,1.6fr) ${daten.mehrere ? "minmax(0,1.2fr) " : ""}minmax(44px,0.7fr) minmax(0,1.2fr) minmax(80px,1fr)` } as CSSProperties}>
                  <div className="zv-liste-kopf">
                    <span>Name</span>
                    {daten.mehrere && <span>Standort</span>}
                    <span>Zimmer</span>
                    <span>Aktenzeichen</span>
                    <span>Einzug</span>
                  </div>
                  {daten.klienten.map((k) => (
                    <div key={k.id} className="zv-info-karte">
                      <span className="zv-liste-zelle-titel">{k.name}</span>
                      {daten.mehrere && (
                        <span className="zv-liste-zelle" data-label="Standort">
                          {k.standort}
                        </span>
                      )}
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
      minW: 7,
      minH: 6,
      inhalt: (
        <div className="zv-kachel-karte">
            <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
              <IKassenbuch />
              Letzte Buchungen
            </h3>
            {daten.buchungen.length === 0 ? (
              <p className="zv-sub">Noch keine Buchungen.</p>
            ) : (
              <div className="zv-karten-liste" style={{ "--zv-liste-spalten": `minmax(84px,0.8fr) ${daten.mehrere ? "minmax(0,1fr) " : ""}minmax(0,1.2fr) minmax(0,1.6fr) minmax(70px,0.9fr)` } as CSSProperties}>
                <div className="zv-liste-kopf">
                  <span>Datum</span>
                  {daten.mehrere && <span>Standort</span>}
                  <span>Für</span>
                  <span>Art / Zweck</span>
                  <span>Betrag</span>
                </div>
                {daten.buchungen.map((b) => (
                  <div key={b.id} className="zv-info-karte">
                    <span className="zv-liste-zelle-titel">{formatDatum(b.datum)}</span>
                    {daten.mehrere && (
                      <span className="zv-liste-zelle" data-label="Standort">
                        {b.standort}
                      </span>
                    )}
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
  ].filter((k) => sichtbar(k.id.startsWith("stat-") ? "kennzahlen" : (k.id === "buchungen" ? "buchungen" : (k.id as Info)))) : null;

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
            {daten
              ? `${einzelStandort ? standortName(einzelStandort) : `${abfrageIds.length} Standorte`} · ${daten.anzahlZimmer} Zimmer`
              : "Alle Standorte"}
          </p>
          <h2>Standorte</h2>
          {einzelStandort && standorte && (
            <p className="zv-sub" style={{ margin: "2px 0 0" }}>
              {standorte.find((s) => s.id === einzelStandort)?.adresse}
            </p>
          )}
        </div>
        {einzelStandort && (
          <button className="zv-btn" onClick={() => onBelegungOeffnen(einzelStandort)}>
            <IZimmer />
            Zimmer und Belegung
          </button>
        )}
      </div>

      {standorte !== null && standorte.length === 0 && !fehler && (
        <Leerzustand icon={ILeerStandorte}>Ihnen ist kein Standort zugeordnet.</Leerzustand>
      )}

      {standorte && standorte.length > 0 && (
        <div className="zv-filterleiste" role="search" aria-label="Standorte und Informationen filtern">
          <FilterPille
            icon={<IStandort />}
            label="Standort"
            wert={gueltig.length > 0 ? `: ${gueltig.length === 1 ? standortName(gueltig[0]) : `${gueltig.length} Standorte`}` : null}
            onEntfernen={() => {
              setAuswahl([]);
              speichereListe(AUSWAHL_SPEICHER, []);
            }}
          >
            {() => (
              <FilterMehrfachAuswahl
                optionen={standorte.map((s) => ({ wert: s.id, label: s.name }))}
                gewaehlt={gueltig}
                onAendern={(neu) => {
                  setAuswahl(neu);
                  speichereListe(AUSWAHL_SPEICHER, neu);
                }}
              />
            )}
          </FilterPille>
          <FilterPille
            icon={<IKlienten />}
            label="Informationen"
            wert={infos.length > 0 ? `: ${infos.length === 1 ? INFO_LABEL[infos[0]] : `${infos.length} von ${ALLE_INFOS.length}`}` : null}
            onEntfernen={() => {
              setInfos([]);
              speichereListe(INFO_SPEICHER, []);
            }}
          >
            {() => (
              <FilterMehrfachAuswahl
                optionen={ALLE_INFOS.map((i) => ({ wert: i, label: INFO_LABEL[i] }))}
                gewaehlt={infos}
                onAendern={(neu) => {
                  setInfos(neu);
                  speichereListe(INFO_SPEICHER, neu);
                }}
              />
            )}
          </FilterPille>
          {filterAktiv && (
            <button
              className="zv-btn zv-btn-sekundaer"
              onClick={() => {
                setAuswahl([]);
                setInfos([]);
                speichereListe(AUSWAHL_SPEICHER, []);
                speichereListe(INFO_SPEICHER, []);
              }}
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      {daten && kacheln && (
        <div style={{ opacity: wirdGeladen ? 0.6 : 1, transition: "opacity var(--zv-transition-base)" }}>
          <KachelRaster speicherSchluessel={`zimmerakte_standort_layout_${nutzerId}`} kacheln={kacheln} />
        </div>
      )}
    </div>
  );
}
