import { type ReactNode } from "react";
import {
  alleBausteine,
  bedingungAlsSatz,
  datentypVon,
  speichernderBaustein,
  type Baustein,
  type Bedingung,
  type BedingungOperator,
  type FormularDefinition,
  type Vergleichspruefung,
} from "@zimmerakte/shared";
import { ILoeschen, INeu } from "../icons";
import { Datumsfeld } from "../Datumsfeld";

// ---------------------------------------------------------------------------
// Logik: Bedingungen als Satz
// ---------------------------------------------------------------------------

type Blatt = Extract<Bedingung, { feld: string }>;

/** Felder, auf die sich eine Bedingung beziehen darf: Datenfelder weiter oben (pruefeDefinition verlangt das). */
export function felderVor(definition: FormularDefinition, bis: string | null): Baustein[] {
  const alle = alleBausteine(definition);
  const i = bis ? alle.findIndex((x) => x.schluessel === bis) : alle.length;
  return alle.slice(0, i < 0 ? alle.length : i).filter(speichernderBaustein);
}

function operatorenFuer(f: Baustein | undefined): BedingungOperator[] {
  if (!f) return ["nicht_leer", "leer"];
  switch (f.typ) {
    case "ja_nein":
      return ["ist", "leer", "nicht_leer"];
    case "auswahl":
      return ["ist", "ist_nicht", "leer", "nicht_leer"];
    case "mehrfachauswahl":
      return ["enthaelt", "leer", "nicht_leer"];
    case "mitarbeitende":
      return ["nicht_leer", "leer"];
    case "kurztext":
    case "langtext":
      return ["ist", "ist_nicht", "nicht_leer", "leer"];
    default:
      return ["groesser", "kleiner", "mindestens", "hoechstens", "ist", "nicht_leer", "leer"];
  }
}

const OP_LABEL: Record<BedingungOperator, string> = {
  ist: "ist",
  ist_nicht: "ist nicht",
  eine_von: "ist eine von",
  enthaelt: "enthält",
  leer: "ist leer",
  nicht_leer: "ist ausgefüllt",
  groesser: "ist größer als",
  kleiner: "ist kleiner als",
  mindestens: "ist mindestens",
  hoechstens: "ist höchstens",
};

function startwert(f: Baustein | undefined, op: BedingungOperator): Blatt["wert"] {
  if (op === "leer" || op === "nicht_leer" || !f) return undefined;
  if (f.typ === "ja_nein") return true;
  if (f.typ === "auswahl" || f.typ === "mehrfachauswahl") return f.optionen[0]?.wert;
  if (f.typ === "kurztext" || f.typ === "langtext" || f.typ === "datum" || f.typ === "uhrzeit") return "";
  return 0;
}

/** Zerlegt eine Bedingung in Zeilen, wenn sie die einfache Form hat (eine Ebene und/oder). */
function alsZeilen(b: Bedingung | undefined): { verknuepfung: "alle" | "eine"; zeilen: Blatt[] } | null {
  if (!b) return { verknuepfung: "alle", zeilen: [] };
  if ("feld" in b) return { verknuepfung: "alle", zeilen: [b] };
  const liste = "alle" in b ? b.alle : b.eine;
  if (!liste.every((x) => "feld" in x)) return null;
  return { verknuepfung: "alle" in b ? "alle" : "eine", zeilen: liste as Blatt[] };
}

function ausZeilen(verknuepfung: "alle" | "eine", zeilen: Blatt[]): Bedingung | undefined {
  if (zeilen.length === 0) return undefined;
  if (zeilen.length === 1) return zeilen[0];
  return verknuepfung === "alle" ? { alle: zeilen } : { eine: zeilen };
}

export function BedingungsWahl({
  titel,
  leer,
  bedingung,
  definition,
  bis,
  onAendern,
  alleFelder,
}: {
  titel: string;
  leer: string;
  bedingung: Bedingung | undefined;
  definition: FormularDefinition;
  bis: string | null;
  onAendern: (b: Bedingung | undefined) => void;
  /** Pflicht darf sich auch auf weiter unten stehende Felder beziehen (werteAus wertet sie zuletzt aus). */
  alleFelder?: boolean;
}) {
  const felder = felderVor(definition, alleFelder ? null : bis).filter((f) => f.schluessel !== bis);
  const zerlegt = alsZeilen(bedingung);
  if (!zerlegt) {
    // Aus einer frueheren Vorlage kann eine verschachtelte Bedingung stammen -- nicht still umbauen.
    return (
      <fieldset className="zv-fe-logik-block">
        <legend>{titel}</legend>
        <p>nur wenn {bedingungAlsSatz(definition, bedingung!)}</p>
        <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={() => onAendern(undefined)}>
          Bedingung entfernen
        </button>
      </fieldset>
    );
  }
  const { verknuepfung, zeilen } = zerlegt;
  const setze = (z: Blatt[], v = verknuepfung) => onAendern(ausZeilen(v, z));
  const neueZeile = (): Blatt | null => {
    const f = felder[felder.length - 1];
    if (!f) return null;
    const op = operatorenFuer(f)[0];
    return { feld: f.schluessel, op, wert: startwert(f, op) };
  };

  return (
    <fieldset className="zv-fe-logik-block">
      <legend>{titel}</legend>
      {zeilen.length === 0 ? (
        <p className="zv-sub">{leer}</p>
      ) : (
        <>
          {zeilen.length > 1 && (
            <div className="zv-fe-verknuepfung">
              <select aria-label="Verknüpfung" value={verknuepfung} onChange={(e) => setze(zeilen, e.target.value as "alle" | "eine")}>
                <option value="alle">wenn alle zutreffen</option>
                <option value="eine">wenn eine zutrifft</option>
              </select>
            </div>
          )}
          {zeilen.length === 1 && <p className="zv-fe-satz">nur wenn</p>}
          {zeilen.map((z, i) => (
            <BedingungsZeile
              key={i}
              zeile={z}
              felder={felder}
              onAendern={(neu) => setze(zeilen.map((x, j) => (j === i ? neu : x)))}
              onEntfernen={() => setze(zeilen.filter((_, j) => j !== i))}
            />
          ))}
        </>
      )}
      {felder.length === 0 ? (
        <p className="zv-protokoll-hilfe">Bedingungen beziehen sich auf Felder weiter oben. Hier steht noch keins.</p>
      ) : (
        <button
          type="button"
          className="zv-btn zv-btn-still zv-btn-klein"
          onClick={() => {
            const z = neueZeile();
            if (z) setze([...zeilen, z]);
          }}
        >
          <INeu size={14} />
          {zeilen.length === 0 ? "Nur unter Bedingung" : "Weitere Bedingung"}
        </button>
      )}
    </fieldset>
  );
}

function BedingungsZeile({ zeile, felder, onAendern, onEntfernen }: { zeile: Blatt; felder: Baustein[]; onAendern: (z: Blatt) => void; onEntfernen: () => void }) {
  const f = felder.find((x) => x.schluessel === zeile.feld);
  const ops = operatorenFuer(f);
  const ohneWert = zeile.op === "leer" || zeile.op === "nicht_leer";
  let wertEingabe: ReactNode = null;
  if (!ohneWert && f) {
    if (f.typ === "ja_nein") {
      wertEingabe = (
        <select aria-label="Wert" value={zeile.wert === false ? "nein" : "ja"} onChange={(e) => onAendern({ ...zeile, wert: e.target.value === "ja" })}>
          <option value="ja">Ja</option>
          <option value="nein">Nein</option>
        </select>
      );
    } else if (f.typ === "auswahl" || f.typ === "mehrfachauswahl") {
      wertEingabe = (
        <select aria-label="Wert" value={String(zeile.wert ?? "")} onChange={(e) => onAendern({ ...zeile, wert: e.target.value })}>
          {f.optionen.map((o) => (
            <option key={o.wert} value={o.wert}>
              {o.label}
            </option>
          ))}
        </select>
      );
    } else if (f.typ === "datum") {
      wertEingabe = (
        <Datumsfeld
          aria-label="Wert"
          groesse="kompakt"
          value={zeile.wert === undefined ? "" : String(zeile.wert)}
          onChange={(v) => onAendern({ ...zeile, wert: v })}
        />
      );
    } else {
      const zahl = datentypVon(f.typ) === "zahl";
      wertEingabe = (
        <input
          aria-label="Wert"
          type={zahl ? "number" : f.typ === "uhrzeit" ? "time" : "text"}
          value={zeile.wert === undefined ? "" : String(zeile.wert)}
          onChange={(e) => onAendern({ ...zeile, wert: zahl ? Number(e.target.value) : e.target.value })}
        />
      );
    }
  }
  return (
    <div className="zv-fe-bedingung">
      <select
        aria-label="Feld"
        value={zeile.feld}
        onChange={(e) => {
          const nf = felder.find((x) => x.schluessel === e.target.value);
          const op = operatorenFuer(nf).includes(zeile.op) ? zeile.op : operatorenFuer(nf)[0];
          onAendern({ feld: e.target.value, op, wert: startwert(nf, op) });
        }}
      >
        {!f && <option value={zeile.feld}>{zeile.feld} (fehlt)</option>}
        {felder.map((x) => (
          <option key={x.schluessel} value={x.schluessel}>
            {x.beschriftung || x.schluessel}
          </option>
        ))}
      </select>
      <select
        aria-label="Vergleich"
        value={zeile.op}
        onChange={(e) => {
          const op = e.target.value as BedingungOperator;
          onAendern({ ...zeile, op, wert: op === "leer" || op === "nicht_leer" ? undefined : zeile.wert ?? startwert(f, op) });
        }}
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {OP_LABEL[o]}
          </option>
        ))}
      </select>
      {wertEingabe}
      <button type="button" className="zv-icon-btn" aria-label="Bedingung entfernen" title="Entfernen" onClick={onEntfernen}>
        <ILoeschen size={14} />
      </button>
    </div>
  );
}

export function PflichtWahl({
  b,
  definition,
  onAendern,
}: {
  b: Extract<Baustein, { pflicht?: unknown }>;
  definition: FormularDefinition;
  onAendern: (p: boolean | Bedingung | undefined) => void;
}) {
  const art = b.pflicht === true ? "immer" : b.pflicht ? "wenn" : "nie";
  return (
    <fieldset className="zv-fe-logik-block">
      <legend>Pflicht</legend>
      <select
        aria-label="Pflicht"
        value={art}
        onChange={(e) => {
          if (e.target.value === "immer") onAendern(true);
          else if (e.target.value === "nie") onAendern(undefined);
          else {
            const f = felderVor(definition, null).find((x) => x.schluessel !== b.schluessel);
            if (f) onAendern({ feld: f.schluessel, op: operatorenFuer(f)[0], wert: startwert(f, operatorenFuer(f)[0]) });
          }
        }}
      >
        <option value="nie">freiwillig</option>
        <option value="immer">immer Pflicht</option>
        <option value="wenn">Pflicht unter Bedingung</option>
      </select>
      {art === "wenn" && typeof b.pflicht === "object" && (
        <BedingungsWahl
          titel="Pflicht, wenn"
          leer="–"
          bedingung={b.pflicht}
          definition={definition}
          bis={b.schluessel}
          alleFelder
          onAendern={(p) => onAendern(p ?? undefined)}
        />
      )}
    </fieldset>
  );
}

export function Vergleiche({ b, definition, onAendern }: { b: Baustein & { pruefungen?: Vergleichspruefung[] }; definition: FormularDefinition; onAendern: (p: Vergleichspruefung[]) => void }) {
  const gleicheArt = alleBausteine(definition).filter((x) => x.typ === b.typ && x.schluessel !== b.schluessel);
  const liste = b.pruefungen ?? [];
  if (gleicheArt.length === 0 && liste.length === 0) return null;
  return (
    <fieldset className="zv-fe-logik-block">
      <legend>Prüfen gegen ein anderes Feld</legend>
      {liste.map((p, i) => (
        <div key={i} className="zv-fe-vergleich">
          <div className="zv-fe-bedingung">
            <select aria-label="Vergleich" value={p.op} onChange={(e) => onAendern(liste.map((x, j) => (j === i ? { ...x, op: e.target.value as Vergleichspruefung["op"] } : x)))}>
              <option value="groesser">muss größer sein als</option>
              <option value="mindestens">muss mindestens sein wie</option>
              <option value="kleiner">muss kleiner sein als</option>
              <option value="hoechstens">darf höchstens sein wie</option>
            </select>
            <select aria-label="Anderes Feld" value={p.feld} onChange={(e) => onAendern(liste.map((x, j) => (j === i ? { ...x, feld: e.target.value } : x)))}>
              {gleicheArt.map((x) => (
                <option key={x.schluessel} value={x.schluessel}>
                  {x.beschriftung || x.schluessel}
                </option>
              ))}
            </select>
            <button type="button" className="zv-icon-btn" aria-label="Prüfung entfernen" title="Entfernen" onClick={() => onAendern(liste.filter((_, j) => j !== i))}>
              <ILoeschen size={14} />
            </button>
          </div>
          <input aria-label="Meldung" value={p.meldung} placeholder="Meldung, z. B. Ende muss nach Beginn liegen" onChange={(e) => onAendern(liste.map((x, j) => (j === i ? { ...x, meldung: e.target.value } : x)))} />
        </div>
      ))}
      {gleicheArt.length > 0 && (
        <button
          type="button"
          className="zv-btn zv-btn-still zv-btn-klein"
          onClick={() => onAendern([...liste, { op: "groesser", feld: gleicheArt[0].schluessel, meldung: "" }])}
        >
          <INeu size={14} />
          Prüfung hinzufügen
        </button>
      )}
    </fieldset>
  );
}
