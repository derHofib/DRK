import type { CSSProperties } from "react";
import {
  platzBeschriftung,
  unterschriftZeilen,
  type ProtokollUnterschriftDto,
  type UnterschriftenBaustein,
} from "@zimmerakte/shared";
import { formatDatum, formatUhrzeit } from "../format";
import { IUnterschrift } from "./icons";

/**
 * Unterschriften-Baustein im Formular und in der Akte. Die Zeilen kommen aus
 * unterschriftZeilen (shared) -- dieselbe Stelle, nach der auch das PDF setzt,
 * damit "zwei nebeneinander, Klient:in darunter" ueberall gleich aussieht.
 *
 * Jede Zeile ist ein eigenes Raster mit so vielen Spalten wie eingestellt,
 * auch wenn sie weniger Plaetze hat: ein einzelner Platz in der letzten Zeile
 * soll so breit sein wie die darueber, nicht die ganze Breite fuellen. Wird
 * die Ansicht schmal, stehen alle untereinander (Container-Abfrage in app.css).
 */
function Raster<T extends { neueZeile?: boolean }>({
  b,
  plaetze,
  zelle,
}: {
  b: UnterschriftenBaustein;
  plaetze: T[];
  zelle: (p: T) => React.ReactNode;
}) {
  return (
    <div className="zv-us-raster">
      {unterschriftZeilen(plaetze, b.spalten).map((zeile, i) => (
        <div key={i} className="zv-us-zeile" style={{ "--zv-us-spalten": b.spalten } as CSSProperties}>
          {zeile.map(zelle)}
        </div>
      ))}
    </div>
  );
}

/** Beim Ausfuellen: nur zeigen, was spaeter kommt -- unterschrieben wird erst nach dem Abschliessen. */
export function UnterschriftenVorschau({ b }: { b: UnterschriftenBaustein }) {
  return (
    <section className="zv-us" aria-label={b.beschriftung || "Unterschriften"}>
      {b.beschriftung && <h4 className="zv-us-titel">{b.beschriftung}</h4>}
      <Raster
        b={b}
        plaetze={b.plaetze}
        zelle={(p) => (
          <div key={p.id} className="zv-us-platz">
            <div className="zv-us-linie zv-us-linie-leer" />
            <span className="zv-us-beschriftung">{platzBeschriftung(p)}</span>
            {p.nurPapier && <span className="zv-pill">nur auf Papier</span>}
          </div>
        )}
      />
      <p className="zv-protokoll-hilfe">Unterschrieben wird nach dem Abschließen. Leere Plätze stehen im PDF als Linie zum Unterschreiben auf Papier.</p>
    </section>
  );
}

/** In der Akte: Stand je Platz, und wo ich darf, der Knopf zum Unterschreiben. */
export function UnterschriftenAnzeige({
  b,
  eintraege,
  onUnterschreiben,
}: {
  b: UnterschriftenBaustein;
  eintraege: ProtokollUnterschriftDto[];
  onUnterschreiben?: (e: ProtokollUnterschriftDto) => void;
}) {
  const jePlatz = new Map(eintraege.filter((e) => e.baustein === b.schluessel).map((e) => [e.platz, e]));
  const plaetze = b.plaetze.flatMap((p) => {
    const e = jePlatz.get(p.id);
    return e ? [{ ...e, neueZeile: p.neueZeile, ohneName: p.ohneName, ohneOrtDatum: p.ohneOrtDatum }] : [];
  });
  if (plaetze.length === 0) return null;
  return (
    <section className="zv-us" aria-label={b.beschriftung || "Unterschriften"}>
      {b.beschriftung && <h4 className="zv-us-titel">{b.beschriftung}</h4>}
      <Raster
        b={b}
        plaetze={plaetze}
        zelle={(e) => {
          const g = e.geleistet;
          const name = g?.name ?? e.name;
          return (
            <div key={e.platz} className="zv-us-platz" data-us-platz={e.platz}>
              {g ? (
                <div className="zv-us-linie">
                  <img className="zv-us-bild" src={g.bild} alt={`Unterschrift ${name ?? e.beschriftung}`} />
                </div>
              ) : (
                <div className="zv-us-linie zv-us-linie-leer" />
              )}
              <span className="zv-us-beschriftung">
                {!e.ohneName && name ? (
                  <>
                    <strong>{name}</strong>, {e.beschriftung}
                  </>
                ) : (
                  e.beschriftung
                )}
              </span>
              {g ? (
                <span className="zv-us-meta">
                  {!e.ohneOrtDatum && <>{[g.ort, `${formatDatum(g.am.slice(0, 10))}, ${formatUhrzeit(g.am)}`].filter(Boolean).join(", ")} · </>}
                  Prüfnr. <span className="zv-mono">{g.pruefnummer}</span>
                </span>
              ) : null}
              <span className="zv-us-stand">
                {g ? (
                  <span className="zv-pill zv-pill-ok">unterschrieben</span>
                ) : e.nurPapier ? (
                  <span className="zv-pill">auf Papier</span>
                ) : (
                  <span className="zv-pill zv-pill-frist">offen</span>
                )}
                {g?.vorAenderung && (
                  <span className="zv-pill zv-pill-frist" title="Das Protokoll wurde nach dieser Unterschrift korrigiert.">
                    vor der Änderung
                  </span>
                )}
              </span>
              {!g && e.darfIch && onUnterschreiben && (
                <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein zv-us-knopf" onClick={() => onUnterschreiben(e)}>
                  <IUnterschrift size={14} />
                  {e.fuerAndere ? `${e.beschriftung} unterschreiben lassen` : "Unterschreiben"}
                </button>
              )}
            </div>
          );
        }}
      />
    </section>
  );
}

/** "2 von 4 unterschrieben" fuer den Kopf der Akte; null, wenn das Formular keine Plaetze hat. */
export function unterschriftenStand(eintraege: ProtokollUnterschriftDto[]): string | null {
  const zaehlend = eintraege.filter((e) => !e.nurPapier || e.geleistet);
  if (zaehlend.length === 0) return null;
  return `${zaehlend.filter((e) => e.geleistet).length} von ${zaehlend.length} unterschrieben`;
}
