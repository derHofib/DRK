import {
  schluesselAusBeschriftung,
  type Baustein,
  type FormularDefinition,
  type Option,
  type UnterschriftPlatz,
  type UnterschriftRolle,
  neuePlatzId,
  platzBeschriftung,
  unterschriftZeilen,
  UNTERSCHRIFT_MAX_PLAETZE,
  UNTERSCHRIFT_ROLLE_HERKUNFT,
  UNTERSCHRIFT_ROLLE_LABEL,
  UNTERSCHRIFT_ROLLEN,
} from "@zimmerakte/shared";
import { ILoeschen, INeu, IVerborgen, IVerschiebenHoch, IVerschiebenRunter, ISichtbar } from "../icons";
import { finde, mitKindern, optionsverweiseUmbenennen } from "./baum";

/**
 * Plaetze eines Unterschriften-Bausteins. Die Anordnung ist bewusst kein
 * freies Raster: "wie viele nebeneinander" plus "hier neue Zeile" deckt die
 * gewuenschten Formen (zwei Leitungen oben, Klient:in allein darunter) ab und
 * gilt gleich fuer Formular, Akte und PDF (unterschriftZeilen in shared).
 */
export function PlaetzeListe({
  b,
  gesperrt,
  onAendern,
}: {
  b: Extract<Baustein, { typ: "unterschriften" }>;
  gesperrt: Baustein | null;
  onAendern: (b: Baustein) => void;
}) {
  // Ein veroeffentlichter Platz kann schon unterschrieben sein: Rolle fest,
  // entfernen nicht moeglich (die Datenbank prueft Platz UND Rolle gegen die
  // Version des Protokolls, aendern wuerde also nichts kaputt machen -- aber
  // in der naechsten Version waere es ein anderer Platz unter gleicher Kennung).
  const fest = new Map(gesperrt?.typ === "unterschriften" ? gesperrt.plaetze.map((p) => [p.id, p.rolle] as const) : []);
  const setze = (plaetze: UnterschriftPlatz[]) => onAendern({ ...b, plaetze });
  const aendere = (i: number, teil: Partial<UnterschriftPlatz>) => setze(b.plaetze.map((p, j) => (j === i ? { ...p, ...teil } : p)));
  const zeilen = unterschriftZeilen(b.plaetze, b.spalten);

  return (
    <>
      <div className="zv-field">
        <label id={`zv-fe-${b.schluessel}-anordnung`}>
          Nebeneinander
        </label>
        <div className="zv-segmented" role="radiogroup" aria-labelledby={`zv-fe-${b.schluessel}-anordnung`}>
          {([1, 2, 3, 4] as const).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={b.spalten === n} className={b.spalten === n ? "active" : ""} onClick={() => onAendern({ ...b, spalten: n })}>
              {n === 1 ? "untereinander" : n}
            </button>
          ))}
        </div>
        <p className="zv-protokoll-hilfe">
          {zeilen.length} {zeilen.length === 1 ? "Zeile" : "Zeilen"}: {zeilen.map((z) => z.length).join(" + ")}. Auf dem Handy stehen die Plätze immer untereinander.
        </p>
      </div>

      <div className="zv-field">
        <label>Plätze</label>
        <ul className="zv-fe-plaetze">
          {b.plaetze.map((p, i) => {
            const rolleFest = fest.has(p.id);
            return (
              <li key={p.id} className="zv-fe-platz">
                <div className="zv-fe-platz-kopf">
                  <select
                    aria-label={`Rolle von Platz ${i + 1}`}
                    value={p.rolle}
                    disabled={rolleFest}
                    title={rolleFest ? "Schon veröffentlicht: die Rolle bleibt fest." : undefined}
                    onChange={(e) => aendere(i, { rolle: e.target.value as UnterschriftRolle })}
                  >
                    {UNTERSCHRIFT_ROLLEN.map((r) => (
                      <option key={r} value={r}>
                        {UNTERSCHRIFT_ROLLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="zv-icon-btn"
                    aria-label="Platz nach vorn"
                    title="Nach vorn"
                    disabled={i === 0}
                    onClick={() => {
                      const c = [...b.plaetze];
                      [c[i - 1], c[i]] = [c[i], c[i - 1]];
                      setze(c);
                    }}
                  >
                    <IVerschiebenHoch size={14} />
                  </button>
                  <button
                    type="button"
                    className="zv-icon-btn"
                    aria-label="Platz nach hinten"
                    title="Nach hinten"
                    disabled={i === b.plaetze.length - 1}
                    onClick={() => {
                      const c = [...b.plaetze];
                      [c[i + 1], c[i]] = [c[i], c[i + 1]];
                      setze(c);
                    }}
                  >
                    <IVerschiebenRunter size={14} />
                  </button>
                  <button
                    type="button"
                    className="zv-icon-btn"
                    aria-label={`${platzBeschriftung(p)} entfernen`}
                    title={rolleFest ? "Schon veröffentlicht: kann nicht entfernt werden" : "Entfernen"}
                    disabled={rolleFest || b.plaetze.length <= 1}
                    onClick={() => setze(b.plaetze.filter((_, j) => j !== i))}
                  >
                    <ILoeschen size={14} />
                  </button>
                </div>
                <input
                  aria-label={`Beschriftung von Platz ${i + 1}`}
                  value={p.beschriftung}
                  maxLength={80}
                  placeholder={p.rolle === "eigene" ? "z. B. Gesetzliche Betreuung" : UNTERSCHRIFT_ROLLE_LABEL[p.rolle]}
                  onChange={(e) => aendere(i, { beschriftung: e.target.value })}
                />
                <p className="zv-protokoll-hilfe">Name: {UNTERSCHRIFT_ROLLE_HERKUNFT[p.rolle]}.</p>
                <div className="zv-fe-platz-schalter">
                  <label className="zv-checkbox-zeile">
                    <input type="checkbox" checked={!!p.neueZeile} disabled={i === 0} onChange={(e) => aendere(i, { neueZeile: e.target.checked || undefined })} />
                    Neue Zeile
                  </label>
                  <label className="zv-checkbox-zeile">
                    <input type="checkbox" checked={!p.ohneName} onChange={(e) => aendere(i, { ohneName: e.target.checked ? undefined : true })} />
                    Name
                  </label>
                  <label className="zv-checkbox-zeile">
                    <input type="checkbox" checked={!p.ohneOrtDatum} onChange={(e) => aendere(i, { ohneOrtDatum: e.target.checked ? undefined : true })} />
                    Ort, Datum
                  </label>
                  <label className="zv-checkbox-zeile">
                    <input type="checkbox" checked={!p.nurPapier} onChange={(e) => aendere(i, { nurPapier: e.target.checked ? undefined : true })} />
                    In der App
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="zv-btn zv-btn-still zv-btn-klein"
          disabled={b.plaetze.length >= UNTERSCHRIFT_MAX_PLAETZE}
          onClick={() => setze([...b.plaetze, { id: neuePlatzId(b.plaetze.map((p) => p.id)), rolle: "mitarbeiter", beschriftung: "" }])}
        >
          <INeu size={14} />
          Platz hinzufügen
        </button>
        <p className="zv-protokoll-hilfe">
          Leere Plätze werden im PDF als Linie gedruckt. In der App wird erst nach dem Abschließen unterschrieben; Leitungsplätze nur von der Leitung selbst.
        </p>
      </div>
    </>
  );
}

export function OptionenListe({
  b,
  definition,
  gesperrt,
  onAendern,
  onDefinition,
}: {
  b: Extract<Baustein, { typ: "auswahl" | "mehrfachauswahl" }>;
  definition: FormularDefinition;
  gesperrt: Baustein | null;
  onAendern: (b: Baustein) => void;
  onDefinition: (d: FormularDefinition) => void;
}) {
  // Eine einmal veroeffentlichte Option steht in alten Protokollen: nur ausblenden, nie loeschen oder umschluesseln.
  const fest = new Set(gesperrt && (gesperrt.typ === "auswahl" || gesperrt.typ === "mehrfachauswahl") ? gesperrt.optionen.map((o) => o.wert) : []);
  const setze = (optionen: Option[]) => onAendern({ ...b, optionen });

  function beschriften(i: number, label: string) {
    const o = b.optionen[i];
    const andere = new Set(b.optionen.filter((_, j) => j !== i).map((x) => x.wert));
    const wert = fest.has(o.wert) || !label.trim() ? o.wert : schluesselAusBeschriftung(label, andere);
    const optionen = b.optionen.map((x, j) => (j === i ? { ...x, label, wert } : x));
    if (wert === o.wert) return setze(optionen);
    // Bedingungen, die auf den alten Wert zeigen, ziehen mit.
    const def = optionsverweiseUmbenennen(definition, b.schluessel, o.wert, wert);
    const pfad = finde(def.bausteine, b.schluessel)!;
    onDefinition({
      ...def,
      bausteine: mitKindern(def.bausteine, pfad.slice(0, -1), (k) => k.map((x, j) => (j === pfad[pfad.length - 1] ? { ...b, optionen } : x))),
    });
  }

  return (
    <div className="zv-field">
      <label>Optionen</label>
      <ul className="zv-fe-optionen">
        {b.optionen.map((o, i) => (
          // Position statt o.wert als key: der Wert folgt der Beschriftung, ein
          // key daran baute die Zeile bei jedem Buchstaben neu auf (Fokus weg).
          <li key={i} className={o.ausgeblendet ? "zv-fe-option-aus" : undefined}>
            <input aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => beschriften(i, e.target.value)} />
            <button
              type="button"
              className="zv-icon-btn"
              aria-label="Nach oben"
              title="Nach oben"
              disabled={i === 0}
              onClick={() => {
                const c = [...b.optionen];
                [c[i - 1], c[i]] = [c[i], c[i - 1]];
                setze(c);
              }}
            >
              <IVerschiebenHoch size={14} />
            </button>
            {fest.has(o.wert) ? (
              <button
                type="button"
                className="zv-icon-btn"
                aria-label={o.ausgeblendet ? `${o.label} wieder anbieten` : `${o.label} ausblenden`}
                title={o.ausgeblendet ? "Wieder anbieten" : "Ausblenden (schon benutzt, alte Protokolle behalten sie)"}
                onClick={() => setze(b.optionen.map((x, j) => (j === i ? { ...x, ausgeblendet: x.ausgeblendet ? undefined : true } : x)))}
              >
                {o.ausgeblendet ? <IVerborgen size={14} /> : <ISichtbar size={14} />}
              </button>
            ) : (
              <button
                type="button"
                className="zv-icon-btn"
                aria-label={`${o.label} entfernen`}
                title="Entfernen"
                onClick={() => setze(b.optionen.filter((_, j) => j !== i))}
              >
                <ILoeschen size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="zv-btn zv-btn-still zv-btn-klein"
        onClick={() => {
          const vorhanden = new Set(b.optionen.map((o) => o.wert));
          const label = `Option ${b.optionen.length + 1}`;
          setze([...b.optionen, { wert: schluesselAusBeschriftung(label, vorhanden), label }]);
        }}
      >
        <INeu size={14} />
        Option hinzufügen
      </button>
      {fest.size > 0 && <p className="zv-protokoll-hilfe">Schon veröffentlichte Optionen lassen sich nur ausblenden, damit alte Protokolle ihre Beschriftung behalten.</p>}
    </div>
  );
}
