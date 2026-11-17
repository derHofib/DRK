import { CSSProperties, useId } from "react";
import { TACHO_BOGEN_GRAD, TACHO_START_GRAD, auslastungBerechnen, bogenPfad, tachoFarbton, tachoPunkt, tachoWinkel } from "./tacho";

const CX = 60;
const CY = 60;
const R = 50;
const RING = 8;
/** Feiner als 100 Stufen sieht niemand; grober zeigt Treppen im Verlauf. */
const SEGMENTE = 60;

/**
 * Die Skala Gruen -> Rot liegt FEST auf dem ganzen Bogen (0 % gruen,
 * 100 % rot); sichtbar wird davon nur das Stueck bis zum aktuellen Wert,
 * per Maske. So hat dieselbe Stelle des Rings immer dieselbe Farbe -- 80 %
 * sieht nicht anders aus, nur weil daneben weniger gefuellt ist -- und das
 * rote Ende erscheint erst, wenn das Haus wirklich voll ist.
 *
 * SVG kann keinen Verlauf entlang eines Bogens; deshalb kurze Segmente mit
 * je eigenem Farbton. Jedes Segment ragt ein Stueck ins naechste, sonst
 * zeichnet die Kantenglaettung zwischen zwei Segmenten feine Fugen.
 */
const SEGMENT_PFADE = Array.from({ length: SEGMENTE }, (_, i) => {
  const breite = TACHO_BOGEN_GRAD / SEGMENTE;
  const von = TACHO_START_GRAD + i * breite;
  const bis = Math.min(TACHO_START_GRAD + TACHO_BOGEN_GRAD, von + breite + 0.6);
  return { d: bogenPfad(CX, CY, R, von, bis), hue: tachoFarbton((i + 0.5) / SEGMENTE) };
});
const GANZER_BOGEN = bogenPfad(CX, CY, R, TACHO_START_GRAD, TACHO_START_GRAD + TACHO_BOGEN_GRAD);

export function AuslastungTacho({ gesamt, frei }: { gesamt: number; frei: number }) {
  const maskeId = `zv-tacho-maske-${useId().replace(/:/g, "")}`;
  const { belegt, prozent, anteil } = auslastungBerechnen(gesamt, frei);
  const winkel = tachoWinkel(anteil);
  // Der Strich ragt beidseitig ueber den Ring hinaus, damit er auch bei 0 %
  // (nichts gefuellt) und 100 % (Rot bis zum Ende) als Marke lesbar bleibt.
  const innen = tachoPunkt(CX, CY, R - RING / 2 - 4, winkel);
  const aussen = tachoPunkt(CX, CY, R + RING / 2 + 4, winkel);

  return (
    <div className="zv-tacho">
      <svg
        className="zv-tacho-svg"
        viewBox="0 0 120 102"
        role="img"
        aria-label={`Auslastung ${prozent} %, ${belegt} von ${gesamt} Plätzen belegt`}
        data-anteil={anteil}
      >
        <defs>
          {/* mask-type: alpha (CSS) -- dann zaehlt nur die Deckkraft, und die
              Maske braucht keine eigene Farbangabe. */}
          <mask id={maskeId} className="zv-tacho-maske" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="102">
            <path
              className="zv-tacho-fuellung"
              d={GANZER_BOGEN}
              pathLength={100}
              strokeWidth={RING + 2}
              style={{ strokeDasharray: `${anteil * 100} 100` } as CSSProperties}
            />
          </mask>
        </defs>
        <path className="zv-tacho-spur" d={GANZER_BOGEN} strokeWidth={RING} />
        <g mask={`url(#${maskeId})`}>
          {SEGMENT_PFADE.map((s, i) => (
            <path key={i} className="zv-tacho-segment" d={s.d} strokeWidth={RING} style={{ "--zv-tacho-h": s.hue } as CSSProperties} />
          ))}
        </g>
        <line className="zv-tacho-strich" x1={innen.x} y1={innen.y} x2={aussen.x} y2={aussen.y} />
        <text className="zv-tacho-wert zv-mono" x={CX} y={CY + 2} textAnchor="middle" dominantBaseline="middle">
          {prozent} %
        </text>
      </svg>
      <div className="zv-tacho-text">
        <p className="zv-tacho-zeile">
          <span className="zv-mono">{belegt}</span> von <span className="zv-mono">{gesamt}</span> Plätzen belegt
        </p>
        <p className="zv-stat-sub">{gesamt === 0 ? "Keine Plätze erfasst" : frei <= 0 ? "Haus voll" : `${frei} frei`}</p>
      </div>
    </div>
  );
}
