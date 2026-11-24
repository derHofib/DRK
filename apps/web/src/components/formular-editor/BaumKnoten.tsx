import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ausrichtungVon,
  BAUSTEIN_LABEL,
  bedingungAlsSatz,
  istEingabe,
  type Baustein,
  type FormularDefinition,
} from "@zimmerakte/shared";
import { IGriff } from "../icons";
import { type Ziel } from "./baum";

export function BaumKnoten({
  b,
  definition,
  gewaehlt,
  zug,
  onWaehlen,
  onGriff,
  onGriffTaste,
}: {
  b: Baustein;
  definition: FormularDefinition;
  gewaehlt: string | null;
  zug: { schluessel: string; ziel: Ziel | null } | null;
  onWaehlen: (s: string) => void;
  onGriff: (e: ReactPointerEvent<HTMLButtonElement>, b: Baustein) => void;
  onGriffTaste: (e: ReactKeyboardEvent<HTMLButtonElement>, schluessel: string) => void;
}) {
  const merkmale: string[] = [];
  if (istEingabe(b)) {
    if (b.pflicht === true) merkmale.push("Pflicht");
    else if (b.pflicht) merkmale.push("Pflicht unter Bedingung");
    if (b.vorausfuellen) merkmale.push(b.vorausfuellen.art === "festgehalten" ? "festgehalten" : "vorausgefüllt");
    if (b.intern) merkmale.push("intern");
  }
  if ((istEingabe(b) || b.typ === "berechnung") && b.inTagesberichtListe) merkmale.push("in der Liste");
  if (definition.bezugsdatumFeld === b.schluessel) merkmale.push("Bezugsdatum");
  if (b.typ === "unterschriften") {
    merkmale.push(`${b.plaetze.length} ${b.plaetze.length === 1 ? "Platz" : "Plätze"}`);
    merkmale.push(b.spalten === 1 ? "untereinander" : `${b.spalten} nebeneinander`);
  }
  if (ausrichtungVon(b) !== "links") merkmale.push(ausrichtungVon(b) === "mitte" ? "mittig" : "rechts");
  return (
    <li
      className={[
        "zv-fe-knoten",
        b.typ === "abschnitt" ? "zv-fe-knoten-abschnitt" : "",
        zug?.schluessel === b.schluessel ? "zv-fe-gezogen" : "",
        zug?.ziel?.bezug === b.schluessel ? `zv-fe-ziel-${zug.ziel.lage}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-fe-knoten={b.schluessel}
      data-fe-abschnitt={b.typ === "abschnitt" ? "1" : undefined}
    >
      <div className="zv-fe-zeilen-rahmen" data-fe-zeile={b.schluessel} data-fe-abschnitt={b.typ === "abschnitt" ? "1" : undefined}>
        <button
          type="button"
          className={`zv-fe-zeile${gewaehlt === b.schluessel ? " active" : ""}`}
          aria-pressed={gewaehlt === b.schluessel}
          onClick={() => onWaehlen(b.schluessel)}
        >
          <span className="zv-fe-typ">{BAUSTEIN_LABEL[b.typ]}</span>
          <span className="zv-fe-beschriftung">{b.beschriftung || <em>ohne Beschriftung</em>}</span>
          {merkmale.map((m) => (
            <span key={m} className="zv-pill zv-fe-merkmal">
              {m}
            </span>
          ))}
          {b.sichtbarWenn && <span className="zv-fe-logik">nur wenn {bedingungAlsSatz(definition, b.sichtbarWenn)}</span>}
        </button>
        <button
          type="button"
          className="zv-fe-griff"
          data-fe-griff={b.schluessel}
          aria-label={`${b.beschriftung || BAUSTEIN_LABEL[b.typ]} verschieben (ziehen oder Pfeiltasten)`}
          title="Ziehen zum Verschieben"
          onPointerDown={(e) => onGriff(e, b)}
          onKeyDown={(e) => onGriffTaste(e, b.schluessel)}
          onClick={() => onWaehlen(b.schluessel)}
        >
          <IGriff />
        </button>
      </div>
      {b.typ === "abschnitt" && (
        <ul className="zv-fe-baum">
          {b.kinder.length === 0 && <li className="zv-fe-leer-abschnitt">Leer. Abschnitt wählen und links Bausteine hinzufügen oder hierher ziehen.</li>}
          {b.kinder.map((k) => (
            <BaumKnoten
              key={k.schluessel}
              b={k}
              definition={definition}
              gewaehlt={gewaehlt}
              zug={zug}
              onWaehlen={onWaehlen}
              onGriff={onGriff}
              onGriffTaste={onGriffTaste}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
