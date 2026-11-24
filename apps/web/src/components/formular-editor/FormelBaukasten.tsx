import { datentypVon, type Ausdruck, type Baustein, type FormularDefinition } from "@zimmerakte/shared";
import { felderVor } from "./Bedingungen";

// ---------------------------------------------------------------------------
// Logik: Formel aus fester Liste
// ---------------------------------------------------------------------------

type FormelArt = "summe" | "mittelwert" | "min" | "max" | "anzahl" | "dauer_minuten" | "tage_zwischen" | "rechnung" | "andere";

const FORMEL_LABEL: Record<Exclude<FormelArt, "andere">, string> = {
  summe: "Summe von Feldern",
  mittelwert: "Mittelwert von Feldern",
  min: "Kleinster Wert von Feldern",
  max: "Größter Wert von Feldern",
  anzahl: "Anzahl ausgefüllter Felder",
  dauer_minuten: "Minuten zwischen zwei Uhrzeiten",
  tage_zwischen: "Tage zwischen zwei Daten",
  rechnung: "Feld mal, geteilt, plus oder minus",
};

function formelArt(a: Ausdruck): FormelArt {
  if (typeof a === "number" || "feld" in a || "wenn" in a) return "andere";
  if ("op" in a) return "feld" in (a.a as object) && (typeof a.b === "number" || "feld" in (a.b as object)) ? "rechnung" : "andere";
  if (a.fn === "dauer_minuten" || a.fn === "tage_zwischen") return a.fn;
  return a.args.every((x) => typeof x === "object" && "feld" in x) ? a.fn : "andere";
}

export function FormelBaukasten({ b, definition, onAendern }: { b: Extract<Baustein, { typ: "berechnung" }>; definition: FormularDefinition; onAendern: (a: Ausdruck) => void }) {
  const art = formelArt(b.ausdruck);
  const vorher = felderVor(definition, b.schluessel);
  const zahlen = vorher.filter((f) => datentypVon(f.typ) === "zahl" || f.typ === "ja_nein" || f.typ === "mehrfachauswahl" || f.typ === "mitarbeitende");
  const uhrzeiten = vorher.filter((f) => f.typ === "uhrzeit");
  const daten = vorher.filter((f) => f.typ === "datum");
  const a = b.ausdruck;

  function artWechseln(neu: FormelArt) {
    if (neu === "dauer_minuten") onAendern({ fn: "dauer_minuten", von: uhrzeiten[0]?.schluessel ?? "", bis: uhrzeiten[1]?.schluessel ?? uhrzeiten[0]?.schluessel ?? "" });
    else if (neu === "tage_zwischen") onAendern({ fn: "tage_zwischen", von: daten[0]?.schluessel ?? "", bis: daten[1]?.schluessel ?? daten[0]?.schluessel ?? "" });
    else if (neu === "rechnung") onAendern({ op: "*", a: { feld: zahlen[0]?.schluessel ?? "" }, b: 1 });
    else if (neu !== "andere") onAendern({ fn: neu, args: [] });
  }

  const feldWahl = (liste: Baustein[], wert: string, aendern: (s: string) => void, label: string) => (
    <select aria-label={label} value={wert} onChange={(e) => aendern(e.target.value)}>
      {!liste.some((f) => f.schluessel === wert) && <option value={wert}>bitte wählen</option>}
      {liste.map((f) => (
        <option key={f.schluessel} value={f.schluessel}>
          {f.beschriftung || f.schluessel}
        </option>
      ))}
    </select>
  );

  return (
    <fieldset className="zv-fe-logik-block">
      <legend>Formel</legend>
      {art === "andere" ? (
        <>
          <p className="zv-sub">Diese Formel stammt aus einer früheren Vorlage und lässt sich hier nur ersetzen.</p>
          <select aria-label="Neue Formel" value="" onChange={(e) => artWechseln(e.target.value as FormelArt)}>
            <option value="">Ersetzen durch …</option>
            {(Object.keys(FORMEL_LABEL) as (keyof typeof FORMEL_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {FORMEL_LABEL[k]}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <select aria-label="Art der Formel" value={art} onChange={(e) => artWechseln(e.target.value as FormelArt)}>
            {(Object.keys(FORMEL_LABEL) as (keyof typeof FORMEL_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {FORMEL_LABEL[k]}
              </option>
            ))}
          </select>
          {typeof a === "object" && "fn" in a && (a.fn === "dauer_minuten" || a.fn === "tage_zwischen") && (
            <div className="zv-fe-bedingung">
              <span>von</span>
              {feldWahl(a.fn === "dauer_minuten" ? uhrzeiten : daten, a.von, (von) => onAendern({ ...a, von }), "Von")}
              <span>bis</span>
              {feldWahl(a.fn === "dauer_minuten" ? uhrzeiten : daten, a.bis, (bis) => onAendern({ ...a, bis }), "Bis")}
            </div>
          )}
          {typeof a === "object" && "fn" in a && a.fn !== "dauer_minuten" && a.fn !== "tage_zwischen" && (
            <div className="zv-fe-formel-felder">
              {zahlen.length === 0 && <p className="zv-protokoll-hilfe">Weiter oben steht noch kein Zahl-, Skala- oder Ja/Nein-Feld.</p>}
              {zahlen.map((f) => {
                const drin = a.args.some((x) => typeof x === "object" && "feld" in x && x.feld === f.schluessel);
                return (
                  <label key={f.schluessel} className="zv-checkbox-zeile">
                    <input
                      type="checkbox"
                      checked={drin}
                      onChange={(e) =>
                        onAendern({
                          ...a,
                          args: e.target.checked
                            ? [...a.args, { feld: f.schluessel }]
                            : a.args.filter((x) => !(typeof x === "object" && "feld" in x && x.feld === f.schluessel)),
                        })
                      }
                    />
                    {f.beschriftung || f.schluessel}
                  </label>
                );
              })}
            </div>
          )}
          {typeof a === "object" && "op" in a && "feld" in (a.a as object) && (
            <div className="zv-fe-bedingung">
              {feldWahl(zahlen, (a.a as { feld: string }).feld, (s) => onAendern({ ...a, a: { feld: s } }), "Feld")}
              <select aria-label="Rechenart" value={a.op} onChange={(e) => onAendern({ ...a, op: e.target.value as "+" | "-" | "*" | "/" })}>
                <option value="*">mal</option>
                <option value="/">geteilt durch</option>
                <option value="+">plus</option>
                <option value="-">minus</option>
              </select>
              {typeof a.b === "number" ? (
                <input aria-label="Zahl" type="number" step="any" value={a.b} onChange={(e) => onAendern({ ...a, b: Number(e.target.value) })} />
              ) : (
                feldWahl(zahlen, (a.b as { feld: string }).feld, (s) => onAendern({ ...a, b: { feld: s } }), "Zweites Feld")
              )}
              <button
                type="button"
                className="zv-btn zv-btn-still zv-btn-klein"
                onClick={() => onAendern({ ...a, b: typeof a.b === "number" ? { feld: zahlen[0]?.schluessel ?? "" } : 1 })}
              >
                {typeof a.b === "number" ? "mit Feld" : "mit Zahl"}
              </button>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
