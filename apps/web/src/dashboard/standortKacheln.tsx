import { CSSProperties, ReactNode } from "react";
import type { StandortUebersichtDto } from "@zimmerakte/shared";
import type { KachelDef } from "../components/KachelRaster";
import { formatBetrag, formatDatum } from "../format";
import { standardPlatz } from "./anordnung";

/**
 * Die Listen-Kacheln der frueheren Standort-Uebersicht (Menuepunkt
 * "Standorte"), jetzt Teil von Heute.
 *
 * Warum zusammengelegt: Rueckmeldung aus dem Betrieb -- "Heute und
 * Dashboard sollen gleich sein, nicht zwei unterschiedliche Menues". Beide
 * Seiten waren Kachelseiten mit Standortfilter und ueberlappenden Zahlen
 * (Plaetze, HZL, Storno); man musste raten, welche die richtige ist. Jetzt
 * gibt es eine Seite; was die Uebersicht zusaetzlich hatte (Zimmer-,
 * Klient:innen- und Buchungsliste, Haus-Kasse), sind Kacheln dort, ein-
 * und ausblendbar ueber "Anpassen" wie alles andere.
 *
 * Zusammengefuehrt wird im Client aus den Einzelabfragen je Standort --
 * jede laeuft weiter unter RLS und Standortfreigabe des Kontos.
 */

export type StandortZusammen = {
  mehrere: boolean;
  zimmer: (StandortUebersichtDto["zimmer"]["liste"][number] & { standort: string })[];
  klienten: (StandortUebersichtDto["klienten"][number] & { standort: string })[];
  hausSaldoCent: number;
  klientenSaldoCent: number;
  buchungen: (StandortUebersichtDto["kassenbuch"]["letzteBuchungen"][number] & { standort: string })[];
};

export function zusammenfuehren(teile: StandortUebersichtDto[]): StandortZusammen {
  const z: StandortZusammen = { mehrere: teile.length > 1, zimmer: [], klienten: [], hausSaldoCent: 0, klientenSaldoCent: 0, buchungen: [] };
  for (const d of teile) {
    const n = d.standort.name;
    z.zimmer.push(...d.zimmer.liste.map((r) => ({ ...r, standort: n })));
    z.klienten.push(...d.klienten.map((r) => ({ ...r, standort: n })));
    z.hausSaldoCent += d.kassenbuch.hausSaldoCent;
    z.klientenSaldoCent += d.kassenbuch.klientenSaldoCent;
    z.buchungen.push(...d.kassenbuch.letzteBuchungen.map((r) => ({ ...r, standort: n })));
  }
  z.buchungen.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  z.buchungen = z.buchungen.slice(0, 10);
  return z;
}

/** Freitextsuche ueber die Listenzeilen; Kennzahlen bleiben davon unberuehrt. */
export function filtere(z: StandortZusammen, q: string): StandortZusammen {
  const t = q.trim().toLocaleLowerCase("de");
  if (!t) return z;
  const passt = (...teile: (string | null | undefined)[]) => teile.some((x) => x?.toLocaleLowerCase("de").includes(t));
  return {
    ...z,
    zimmer: z.zimmer.filter((r) => passt(r.nummer, r.etage, r.standort, ...r.bewohner.map((b) => b.name))),
    klienten: z.klienten.filter((r) => passt(r.name, r.aktenzeichen, r.zimmerNummer, r.standort, r.amt)),
    buchungen: z.buchungen.filter((r) => passt(r.klientName, r.typBezeichnung, r.verwendungszweck, r.standort)),
  };
}

export interface StandortKachelSicht {
  hauskasse: boolean;
  zimmerliste: boolean;
  klientenliste: boolean;
  buchungen: boolean;
}

/**
 * Standardplaetze stehen zentral in dashboard/anordnung.ts. Wer sein Heute
 * schon angeordnet hat, findet Kacheln ohne gespeicherten Platz unten
 * angehaengt statt mitten in seinem Layout (KachelRaster, ladeLayout).
 */
export function standortKacheln(
  daten: StandortZusammen,
  sicht: StandortKachelSicht,
  kopf: (titel: string, link?: { label: string; ziel: () => void }) => ReactNode,
  ziele: { belegung: () => void; klienten: () => void; kassenbuch: () => void },
): KachelDef[] {
  const k: KachelDef[] = [];
  if (sicht.hauskasse) {
    k.push({
      id: "hauskasse",
      titel: "Haus-Kasse",
      standard: standardPlatz("hauskasse"),
      minW: 2,
      minH: 3,
      inhalt: (
        <div className="zv-kachel-stat">
          <p className="zv-stat-label">Haus-Kasse</p>
          <p className="zv-stat-wert zv-mono">{formatBetrag(daten.hausSaldoCent)}</p>
          <p className="zv-stat-sub">Klientengelder: {formatBetrag(daten.klientenSaldoCent)}</p>
        </div>
      ),
    });
  }
  if (sicht.zimmerliste) {
    k.push({
      id: "zimmerliste",
      titel: "Zimmer",
      standard: standardPlatz("zimmerliste"),
      minW: 5,
      minH: 5,
      inhalt: (
        <section className="zv-kachel-karte" aria-label="Zimmer">
          {kopf("Zimmer", { label: "Belegung", ziel: ziele.belegung })}
          {daten.zimmer.length === 0 ? (
            <p className="zv-rand-leer">Keine Zimmer.</p>
          ) : (
            <div
              className="zv-karten-liste"
              style={{ "--zv-liste-spalten": `minmax(44px,0.8fr) ${daten.mehrere ? "minmax(0,1.2fr) " : ""}minmax(64px,1fr) minmax(0,1.6fr) minmax(52px,0.9fr)` } as CSSProperties}
            >
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
                    <span className="zv-liste-zelle-titel zv-mono">{z.nummer}</span>
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
        </section>
      ),
    });
  }
  if (sicht.klientenliste) {
    k.push({
      id: "klientenliste",
      titel: "Klient:innen",
      standard: standardPlatz("klientenliste"),
      minW: 5,
      minH: 5,
      inhalt: (
        <section className="zv-kachel-karte" aria-label="Klient:innen">
          {kopf("Klient:innen", { label: "Öffnen", ziel: ziele.klienten })}
          {daten.klienten.length === 0 ? (
            <p className="zv-rand-leer">Zurzeit wohnt hier niemand.</p>
          ) : (
            <div
              className="zv-karten-liste"
              style={{ "--zv-liste-spalten": `minmax(0,1.6fr) ${daten.mehrere ? "minmax(0,1.2fr) " : ""}minmax(44px,0.7fr) minmax(0,1.2fr) minmax(80px,1fr)` } as CSSProperties}
            >
              <div className="zv-liste-kopf">
                <span>Name</span>
                {daten.mehrere && <span>Standort</span>}
                <span>Zimmer</span>
                <span>Aktenzeichen</span>
                <span>Einzug</span>
              </div>
              {daten.klienten.map((kl) => (
                <div key={kl.id} className="zv-info-karte">
                  <span className="zv-liste-zelle-titel">{kl.name}</span>
                  {daten.mehrere && (
                    <span className="zv-liste-zelle" data-label="Standort">
                      {kl.standort}
                    </span>
                  )}
                  <span className="zv-liste-zelle" data-label="Zimmer">
                    {kl.zimmerNummer}
                  </span>
                  <span className="zv-liste-zelle" data-label="Aktenzeichen">
                    {kl.aktenzeichen ?? "–"}
                  </span>
                  <span className="zv-liste-zelle" data-label="Einzug">
                    {formatDatum(kl.einzug)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ),
    });
  }
  if (sicht.buchungen) {
    k.push({
      id: "letzte-buchungen",
      titel: "Letzte Buchungen",
      standard: standardPlatz("letzte-buchungen"),
      minW: 6,
      minH: 5,
      inhalt: (
        <section className="zv-kachel-karte" aria-label="Letzte Buchungen">
          {kopf("Letzte Buchungen", { label: "Kassenbuch", ziel: ziele.kassenbuch })}
          {daten.buchungen.length === 0 ? (
            <p className="zv-rand-leer">Noch keine Buchungen.</p>
          ) : (
            <div
              className="zv-karten-liste"
              style={{ "--zv-liste-spalten": `minmax(84px,0.8fr) ${daten.mehrere ? "minmax(0,1fr) " : ""}minmax(0,1.2fr) minmax(0,1.6fr) minmax(70px,0.9fr)` } as CSSProperties}
            >
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
                  <span className="zv-liste-zelle zv-num" data-label="Betrag">
                    {formatBetrag(b.betragCent)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ),
    });
  }
  return k;
}
