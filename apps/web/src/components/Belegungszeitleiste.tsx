import { useMemo, useState } from "react";
import type { RaumplanEtageDto } from "@zimmerakte/shared";
import { formatDatum, lokalesDatum } from "../format";

type Zimmer = RaumplanEtageDto["zimmer"][number];
type Massstab = "monat" | "halbjahr" | "jahr";

/**
 * Fenster je Massstab in Tagen relativ zu heute und Breite je Tag. Ein Stück
 * Vergangenheit bleibt sichtbar, damit "seit wann" erkennbar ist; der Rest
 * ist Zukunft, weil Planung (Auszug, Einzug) die Frage dieser Ansicht ist.
 * Die Breite je Tag ist FEST (nicht Prozent der Containerbreite): so bleiben
 * die Balken auf dem Handy lesbar, und der Inhalt scrollt im eigenen
 * Container statt die Seite aufzureissen.
 */
const MASSSTAB: Record<Massstab, { label: string; zurueck: number; tage: number; px: number }> = {
  monat: { label: "Monat", zurueck: 7, tage: 30, px: 26 },
  halbjahr: { label: "6 Monate", zurueck: 30, tage: 183, px: 6 },
  jahr: { label: "Jahr", zurueck: 30, tage: 365, px: 3 },
};

const MONAT_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function tagesnummer(datum: string): number {
  const [j, m, t] = datum.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(j, m - 1, t) / 86_400_000);
}

interface Balken {
  schluessel: string;
  text: string;
  von: number;
  bis: number;
  geplant: boolean;
  auszugAngekuendigt: boolean;
  titel: string;
}

function balkenVon(z: Zimmer, start: number, ende: number): Balken[] {
  const liste: Balken[] = [];
  for (const b of z.bewohner) {
    const auszug = b.auszug ? tagesnummer(b.auszug) : null;
    liste.push({
      schluessel: `b:${b.klientId}:${b.einzug}`,
      text: b.name,
      von: Math.max(tagesnummer(b.einzug), start),
      bis: auszug === null ? ende : Math.min(auszug, ende),
      geplant: false,
      auszugAngekuendigt: auszug !== null,
      titel: `${b.name}: seit ${formatDatum(b.einzug)}${b.auszug ? `, Auszug ${formatDatum(b.auszug)}` : ""}`,
    });
  }
  for (const g of z.geplanteEinzuege) {
    liste.push({
      schluessel: `g:${g.klientId}:${g.einzug}`,
      text: g.name,
      von: Math.max(tagesnummer(g.einzug), start),
      bis: ende,
      geplant: true,
      auszugAngekuendigt: false,
      titel: `${g.name}: Einzug geplant ${formatDatum(g.einzug)}`,
    });
  }
  // Ausserhalb des Fensters (z. B. Einzug nach dem Fensterende) ergibt
  // von >= bis -- so ein Balken waere nur ein Strich ohne Aussage.
  return liste.filter((b) => b.bis > b.von);
}

/**
 * Belegung als Zeitleiste statt Zimmerkarten: links die Zimmer nach Etage,
 * rechts je Zimmer Balken ueber die Zeit. Gefuellt = belegt, gestrichelt =
 * geplanter Einzug, Koralle an der rechten Kante = angekuendigter Auszug,
 * senkrechte Koralle-Linie = heute. Ein freies Zimmer faellt ueber die
 * hervorgehobene Zeile und das "frei"-Tag auf, ohne dass man Karten
 * durchsuchen muss.
 *
 * Bei Kapazitaet > 1 bekommt jede Person eine eigene Bahn -- zwei
 * ueberlappende Balken in einer Bahn waeren nicht zu unterscheiden.
 */
export function Belegungszeitleiste({
  etagen,
  onOeffnen,
}: {
  etagen: RaumplanEtageDto[];
  onOeffnen: (zimmerId: string) => void;
}) {
  const [massstab, setMassstab] = useState<Massstab>("halbjahr");
  const m = MASSSTAB[massstab];
  const heute = tagesnummer(lokalesDatum(new Date()));
  const start = heute - m.zurueck;
  const ende = start + m.tage;
  const breite = m.tage * m.px;

  const marken = useMemo(() => {
    const liste: { links: number; text: string }[] = [];
    for (let tag = start; tag < ende; tag++) {
      const d = new Date(tag * 86_400_000);
      const monatsErster = d.getUTCDate() === 1;
      const wochenanfang = massstab === "monat" && d.getUTCDay() === 1;
      if (massstab === "monat" ? wochenanfang : monatsErster) {
        liste.push({
          links: (tag - start) * m.px,
          text: massstab === "monat" ? `${d.getUTCDate()}.${d.getUTCMonth() + 1}.` : MONAT_KURZ[d.getUTCMonth()],
        });
      }
    }
    return liste;
  }, [massstab, start, ende, m.px]);

  const alleZimmer = etagen.flatMap((e) => e.zimmer);

  return (
    <div>
      <div className="zv-zl-werkzeug">
        <div className="zv-segmented" role="radiogroup" aria-label="Zeitraum">
          {(Object.keys(MASSSTAB) as Massstab[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={massstab === k}
              className={massstab === k ? "active" : ""}
              onClick={() => setMassstab(k)}
            >
              {MASSSTAB[k].label}
            </button>
          ))}
        </div>
        <ul className="zv-zl-legende" aria-label="Legende">
          <li><span className="zv-zl-probe" /> belegt</li>
          <li><span className="zv-zl-probe zv-zl-probe-geplant" /> Einzug geplant</li>
          <li><span className="zv-zl-probe zv-zl-probe-auszug" /> Auszug angekündigt</li>
        </ul>
      </div>

      {alleZimmer.length === 0 ? null : (
        <div className="zv-zl" role="region" aria-label="Belegung über die Zeit" tabIndex={0}>
          <div className="zv-zl-innen" style={{ minWidth: `calc(var(--zv-zl-label) + ${breite}px)` }}>
            <div className="zv-zl-zeile zv-zl-kopf">
              <div className="zv-zl-label" />
              <div className="zv-zl-spur" style={{ width: breite }}>
                {marken.map((mk) => (
                  <span key={mk.links} className="zv-zl-marke zv-mono" style={{ left: mk.links }}>
                    {mk.text}
                  </span>
                ))}
              </div>
            </div>

            {etagen
              .filter((e) => e.zimmer.length > 0)
              .map((e) => (
                <div key={e.etage} role="group" aria-label={`Etage ${e.etage}`}>
                  <div className="zv-zl-etage zv-gruppenlabel-inline">{e.etage}</div>
                  {e.zimmer.map((z) => {
                    const balken = balkenVon(z, start, ende);
                    const frei = z.bewohner.length < z.kapazitaet;
                    const bahnen = Math.max(1, z.kapazitaet, balken.length);
                    return (
                      <div key={z.id} className={`zv-zl-zeile${z.bewohner.length === 0 ? " zv-zl-frei" : ""}`}>
                        <button type="button" className="zv-zl-label" onClick={() => onOeffnen(z.id)} title="Details zum Zimmer">
                          <span className="zv-mono zv-zl-nummer">{z.nummer}</span>
                          <span className="zv-zl-typ">{z.kapazitaet === 1 ? "Einzel" : `${z.kapazitaet}-Bett`}</span>
                          {frei && (
                            <span className="zv-pill zv-pill-achtung">
                              {z.bewohner.length === 0 ? "frei" : `${z.kapazitaet - z.bewohner.length} frei`}
                            </span>
                          )}
                        </button>
                        <div
                          className="zv-zl-spur"
                          style={{
                            width: breite,
                            height: bahnen * 28 + 8,
                            // Position der Heute-Linie; die Linie selbst zeichnet ::after.
                            ["--zv-zl-heute" as string]: `${(heute - start) * m.px}px`,
                          }}
                        >
                          {balken.map((b, i) => (
                            <button
                              key={b.schluessel}
                              type="button"
                              className={`zv-zl-balken${b.geplant ? " zv-zl-balken-geplant" : ""}${
                                b.auszugAngekuendigt ? " zv-zl-balken-auszug" : ""
                              }`}
                              style={{ left: (b.von - start) * m.px, width: (b.bis - b.von) * m.px, top: 4 + i * 28 }}
                              title={b.titel}
                              onClick={() => onOeffnen(z.id)}
                            >
                              <span>{b.text}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
