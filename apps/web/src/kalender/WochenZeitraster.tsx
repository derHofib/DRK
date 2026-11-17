import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TerminDto } from "@zimmerakte/shared";
import { formatDatum, formatTerminUhrzeit, lokalesDatum } from "../format";
import { personFarbStil } from "../personFarbe";
import { ganztagsBalken, startStunde, zeitBloecke } from "./zeitraster";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const STUNDEN = Array.from({ length: 24 }, (_, i) => i);

function minutenJetzt(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Wochenansicht als Zeitraster: Spalte je Tag, oben die ganztaegigen (und
 * mehr als 24 Stunden langen) Termine als Balken, darunter die Termine nach
 * Uhrzeit. Lage und Groesse der Bloecke gehen als reine Zahlen (Minuten,
 * Spalten) per CSS-Variable hinaus; was eine Minute in Pixeln ist, steht
 * allein im CSS (--zv-kal-stunde), damit Raster und Bloecke nie
 * auseinanderlaufen.
 */
export function WochenZeitraster({
  wochenTage,
  heute,
  gewaehlt,
  termine,
  farbIndexVon,
  onTagWaehlen,
  onTerminOeffnen,
  onNeu,
}: {
  wochenTage: string[];
  heute: string;
  gewaehlt: string;
  termine: TerminDto[];
  farbIndexVon: (t: TerminDto) => number | undefined;
  onTagWaehlen: (tag: string) => void;
  onTerminOeffnen: (id: string) => void;
  onNeu: (tag: string, uhrzeit: string) => void;
}) {
  const balken = useMemo(() => ganztagsBalken(termine, wochenTage), [termine, wochenTage]);
  const spuren = balken.reduce((n, b) => Math.max(n, b.spur + 1), 0);
  const bloeckeJeTag = useMemo(() => wochenTage.map((tag) => zeitBloecke(termine, tag)), [termine, wochenTage]);

  const [jetzt, setJetzt] = useState(minutenJetzt);
  useEffect(() => {
    const uhr = window.setInterval(() => setJetzt(minutenJetzt()), 60_000);
    return () => window.clearInterval(uhr);
  }, []);

  // Beim Oeffnen und beim Blaettern einmal an den Anfang des Tages
  // scrollen -- nicht bei jedem Neuladen der Termine, sonst springt das
  // Raster unter der Hand weg, waehrend man darin liest.
  const koerper = useRef<HTMLDivElement>(null);
  const wochenSchluessel = wochenTage[0];
  const geladen = bloeckeJeTag.some((l) => l.length > 0);
  const gescrollt = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = koerper.current;
    if (!el || gescrollt.current === `${wochenSchluessel}:${geladen}` || gescrollt.current === `${wochenSchluessel}:true`) return;
    gescrollt.current = `${wochenSchluessel}:${geladen}`;
    const frueheste = bloeckeJeTag
      .flat()
      .filter((b) => !b.vorher)
      .reduce<number | null>((m, b) => (m === null ? b.anfang : Math.min(m, b.anfang)), null);
    const zeile = el.querySelector<HTMLElement>(`[data-stunde="${startStunde(frueheste)}"]`);
    // Etwas Luft ueber der Linie, damit ihre Beschriftung (mittig auf der Linie) nicht angeschnitten ist.
    el.scrollTop = zeile ? Math.max(0, zeile.offsetTop - 12) : 0;
  }, [wochenSchluessel, geladen, bloeckeJeTag]);

  function terminKlassen(t: TerminDto, basis: string): { className: string; style?: CSSProperties } {
    const fi = farbIndexVon(t);
    if (t.abgesagtAm) return { className: `${basis} abgesagt` };
    if (fi === undefined) return { className: `${basis} neutral` };
    return { className: `${basis} zv-person-flaeche`, style: personFarbStil(fi) };
  }

  return (
    <div className="zv-kal-woche" role="grid" aria-label="Wochenübersicht nach Uhrzeit">
      <div className="zv-kal-woche-kopf" role="row">
        <span className="zv-kal-woche-ecke" aria-hidden="true" />
        {wochenTage.map((tag, i) => (
          <button
            key={tag}
            type="button"
            role="columnheader"
            className={`zv-kal-woche-tag${tag === heute ? " heute" : ""}${tag === gewaehlt ? " gewaehlt" : ""}`}
            onClick={() => onTagWaehlen(tag)}
            aria-pressed={tag === gewaehlt}
            aria-label={`${WOCHENTAGE[i]}, ${formatDatum(tag)}`}
          >
            <span>{WOCHENTAGE[i]}</span>
            <strong>{Number(tag.slice(8))}</strong>
          </button>
        ))}
      </div>

      <div className="zv-kal-ganztag" style={{ "--spuren": Math.max(1, spuren) } as CSSProperties}>
        <span className="zv-kal-ganztag-label">Ganztägig</span>
        {balken.map((b) => {
          const { className, style } = terminKlassen(b.termin, "zv-kal-balken");
          return (
            <button
              key={b.termin.id}
              type="button"
              className={`${className}${b.vorher ? " vorher" : ""}${b.nachher ? " nachher" : ""}`}
              style={{ ...style, gridColumn: `${b.von + 2} / ${b.bis + 3}`, gridRow: b.spur + 1 }}
              onClick={() => onTerminOeffnen(b.termin.id)}
              title={`${b.termin.titel} · ${b.termin.erstelltVon.name}`}
            >
              <span className={b.termin.abgesagtAm ? "zv-durchgestrichen" : undefined}>{b.termin.titel}</span>
            </button>
          );
        })}
      </div>

      <div className="zv-kal-woche-koerper" ref={koerper}>
        <div className="zv-kal-stunden" aria-hidden="true">
          {STUNDEN.map((h) => (
            <span key={h} className="zv-kal-stunde" data-stunde={h}>
              {h > 0 && `${String(h).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {wochenTage.map((tag, i) => (
          <div key={tag} className={`zv-kal-spalte${tag === heute ? " heute" : ""}`} role="gridcell" aria-label={formatDatum(tag)}>
            {/* Leere Stunde anklicken legt dort einen Termin an, wie in Outlook. */}
            {STUNDEN.map((h) => (
              <button
                key={h}
                type="button"
                className="zv-kal-slot"
                tabIndex={-1}
                aria-label={`Neuer Termin am ${formatDatum(tag)} um ${h} Uhr`}
                onClick={() => onNeu(tag, `${String(h).padStart(2, "0")}:00`)}
              />
            ))}
            {bloeckeJeTag[i].map((b) => {
              const { className, style } = terminKlassen(b.termin, "zv-kal-block");
              const lage = { "--anfang": b.anfang, "--dauer": b.ende - b.anfang, "--spalte": b.spalte, "--spalten": b.spalten } as CSSProperties;
              return (
                <button
                  key={b.termin.id}
                  type="button"
                  className={`${className}${b.ende - b.anfang <= 45 ? " kurz" : ""}`}
                  style={{ ...style, ...lage }}
                  onClick={() => onTerminOeffnen(b.termin.id)}
                  title={`${formatTerminUhrzeit(b.termin)} · ${b.termin.titel} · ${b.termin.erstelltVon.name}`}
                >
                  <strong className={b.termin.abgesagtAm ? "zv-durchgestrichen" : undefined}>{b.termin.titel}</strong>
                  <span>{formatTerminUhrzeit(b.termin)}</span>
                  {b.termin.ort && <span>{b.termin.ort}</span>}
                </button>
              );
            })}
            {tag === heute && tag === lokalesDatum(new Date()) && (
              <span className="zv-kal-jetzt" style={{ "--anfang": jetzt } as CSSProperties} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
