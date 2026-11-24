import { useState } from "react";
import {
  alleBausteine,
  ausrichtungVon,
  BAUSTEIN_AUSRICHTUNG_LABEL,
  BAUSTEIN_AUSRICHTUNGEN,
  BAUSTEIN_LABEL,
  DATENQUELLEN,
  quelleBrauchtKlient,
  zuordnungKenntKlient,
  zuordnungVon,
  istEingabe,
  schluesselAusBeschriftung,
  type Baustein,
  type BausteinAusrichtung,
  type Datenquelle,
  type FormularDefinition,
} from "@zimmerakte/shared";
import {
  IAusrichtungLinks,
  IAusrichtungMitte,
  IAusrichtungRechts,
  ILoeschen,
  ISperre,
  IVerschiebenHoch,
  IVerschiebenRunter,
} from "../icons";
import { BedingungsWahl, PflichtWahl, Vergleiche } from "./Bedingungen";
import { FormelBaukasten } from "./FormelBaukasten";
import { OptionenListe, PlaetzeListe } from "./PlaetzeOptionen";

// ---------------------------------------------------------------------------
// Eigenschaften
// ---------------------------------------------------------------------------

type Reiter = "feld" | "logik" | "daten";

export function Eigenschaften({
  b,
  definition,
  gesperrt,
  abschnitte,
  inAbschnitt,
  onAendern,
  onDefinition,
  onEntfernen,
  onVerschieben,
  onVerlegen,
}: {
  b: Baustein;
  definition: FormularDefinition;
  /** Fassung dieses Bausteins in einer frueher veroeffentlichten Version -- dann ist der Schluessel fest. */
  gesperrt: Baustein | null;
  abschnitte: Baustein[];
  inAbschnitt: string;
  onAendern: (b: Baustein) => void;
  onDefinition: (d: FormularDefinition) => void;
  onEntfernen: () => void;
  onVerschieben: (r: -1 | 1) => void;
  onVerlegen: (abschnitt: string) => void;
}) {
  const [reiter, setReiter] = useState<Reiter>("feld");
  const alle = alleBausteine(definition);
  const andereSchluessel = new Set(alle.filter((x) => x.schluessel !== b.schluessel).map((x) => x.schluessel));
  const id = (s: string) => `zv-fe-${b.schluessel}-${s}`;
  const hatDaten = istEingabe(b) && b.typ !== "mitarbeitende";

  function beschriftungAendern(beschriftung: string) {
    // Der Schluessel folgt der Beschriftung, solange er noch nie veroeffentlicht
    // war und niemand ihn von Hand geaendert hat.
    const automatisch = !gesperrt && b.schluessel === schluesselAusBeschriftung(b.beschriftung, andereSchluessel);
    const schluessel = automatisch && beschriftung.trim() ? schluesselAusBeschriftung(beschriftung, andereSchluessel) : b.schluessel;
    onAendern({ ...b, beschriftung, schluessel });
  }

  return (
    <div className="zv-fe-eig">
      <div className="zv-fe-eig-kopf">
        <span className="zv-fe-typ">{BAUSTEIN_LABEL[b.typ]}</span>
        <span className="zv-aktionen-reihe">
          <button type="button" className="zv-icon-btn" onClick={() => onVerschieben(-1)} aria-label="Nach oben" title="Nach oben">
            <IVerschiebenHoch />
          </button>
          <button type="button" className="zv-icon-btn" onClick={() => onVerschieben(1)} aria-label="Nach unten" title="Nach unten">
            <IVerschiebenRunter />
          </button>
          <button type="button" className="zv-icon-btn" onClick={onEntfernen} aria-label="Baustein entfernen" title="Entfernen">
            <ILoeschen />
          </button>
        </span>
      </div>

      <div className="zv-segmented" role="tablist" aria-label="Eigenschaften">
        {(["feld", "logik", ...(hatDaten ? ["daten"] : [])] as Reiter[]).map((r) => (
          <button key={r} type="button" role="tab" aria-selected={reiter === r} className={reiter === r ? "active" : ""} onClick={() => setReiter(r)}>
            {r === "feld" ? "Feld" : r === "logik" ? "Logik" : "Daten"}
          </button>
        ))}
      </div>

      {reiter === "feld" && (
        <>
          <div className="zv-field">
            <label htmlFor={id("beschriftung")}>{b.typ === "hinweis" ? "Text" : "Beschriftung"}</label>
            {b.typ === "hinweis" ? (
              <textarea id={id("beschriftung")} rows={3} value={b.beschriftung} onChange={(e) => beschriftungAendern(e.target.value)} />
            ) : (
              <input id={id("beschriftung")} value={b.beschriftung} onChange={(e) => beschriftungAendern(e.target.value)} />
            )}
          </div>
          {b.typ !== "hinweis" && (
            <div className="zv-field">
              <label htmlFor={id("hilfe")}>Hilfetext</label>
              <input id={id("hilfe")} value={b.hilfetext ?? ""} placeholder="optional" onChange={(e) => onAendern({ ...b, hilfetext: e.target.value || undefined })} />
            </div>
          )}

          {/* Unterschriften stehen im eigenen Raster (Anordnung unten), eine Ausrichtung haette dort keine Wirkung. */}
          {b.typ !== "unterschriften" && (
            <AusrichtungWahl labelId={id("ausrichtung")} wert={ausrichtungVon(b)} onWahl={(a) => onAendern({ ...b, ausrichtung: a === "links" ? undefined : a })} />
          )}

          <TypEinstellungen b={b} definition={definition} gesperrt={gesperrt} id={id} onAendern={onAendern} onDefinition={onDefinition} />

          {istEingabe(b) && (
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={!!b.intern} onChange={(e) => onAendern({ ...b, intern: e.target.checked || undefined })} />
              Intern: nie in Ausdrucke für Ämter
            </label>
          )}

          {(istEingabe(b) || b.typ === "berechnung") && (
            <label className="zv-checkbox-zeile">
              <input
                type="checkbox"
                checked={!!b.inTagesberichtListe}
                onChange={(e) => onAendern({ ...b, inTagesberichtListe: e.target.checked || undefined })}
              />
              In der Tagesbericht-Liste zeigen
            </label>
          )}

          {b.typ !== "abschnitt" && abschnitte.length > 0 && (
            <div className="zv-field">
              <label htmlFor={id("ort")}>Liegt in</label>
              <select id={id("ort")} value={inAbschnitt} onChange={(e) => onVerlegen(e.target.value)}>
                <option value="">keinem Abschnitt</option>
                {abschnitte.map((a) => (
                  <option key={a.schluessel} value={a.schluessel}>
                    {a.beschriftung || a.schluessel}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="zv-field">
            <label htmlFor={id("schluessel")}>Feldschlüssel</label>
            {gesperrt ? (
              <div className="zv-fe-schluessel">
                <ISperre size={14} />
                <code>{b.schluessel}</code>
                <span className="zv-sub-inline">fest, seit es veröffentlicht ist</span>
              </div>
            ) : (
              <SchluesselEingabe id={id("schluessel")} wert={b.schluessel} vergeben={andereSchluessel} onAendern={(schluessel) => onAendern({ ...b, schluessel })} />
            )}
            <p className="zv-protokoll-hilfe">
              Der interne Name dieses Feldes, den nur das System sieht. Ausfüllende sehen immer die Beschriftung. Gebraucht wird er als
              Spaltenname in Auswertungen und Listen-Exporten und als Bezug in Bedingungen und Berechnungen. Er entsteht von selbst aus der
              Beschriftung; ändern müssen Sie ihn nur, wenn Sie einen bestimmten Spaltennamen wollen. Nur Kleinbuchstaben, Ziffern und
              Unterstrich. Nach dem Veröffentlichen fest, damit alte Protokolle ihre Antworten behalten.
            </p>
          </div>
        </>
      )}

      {reiter === "logik" && (
        <>
          <BedingungsWahl
            titel={b.typ === "abschnitt" ? "Abschnitt zeigen" : "Zeigen"}
            leer="immer"
            bedingung={b.sichtbarWenn}
            definition={definition}
            bis={b.schluessel}
            onAendern={(sichtbarWenn) => onAendern({ ...b, sichtbarWenn })}
          />
          {istEingabe(b) && (
            <PflichtWahl
              b={b}
              definition={definition}
              onAendern={(pflicht) => onAendern({ ...b, pflicht })}
            />
          )}
          {istEingabe(b) && (b.typ === "zahl" || b.typ === "datum" || b.typ === "uhrzeit") && (
            <Vergleiche b={b} definition={definition} onAendern={(pruefungen) => onAendern({ ...b, pruefungen: pruefungen.length ? pruefungen : undefined })} />
          )}
          {b.typ === "berechnung" && <FormelBaukasten b={b} definition={definition} onAendern={(ausdruck) => onAendern({ ...b, ausdruck })} />}
        </>
      )}

      {reiter === "daten" && istEingabe(b) && (
        <div className="zv-field">
          <label htmlFor={id("quelle")}>Vorausfüllen aus</label>
          <select
            id={id("quelle")}
            value={b.vorausfuellen?.quelle ?? ""}
            onChange={(e) =>
              onAendern({
                ...b,
                vorausfuellen: e.target.value ? { quelle: e.target.value as Datenquelle, art: b.vorausfuellen?.art ?? "vorschlag" } : undefined,
              })
            }
          >
            <option value="">nichts, leer lassen</option>
            {(Object.keys(DATENQUELLEN) as Datenquelle[])
              // Identitaet (Name, Geburtsdatum ...) nur als Anzeige-Baustein, nie als gespeicherte Kopie (pruefeDefinition).
              .filter((q) => !DATENQUELLEN[q].identitaet)
              // Ohne Klient:in blieben Klientenquellen immer leer (pruefeDefinition lehnt sie ab).
              .filter((q) => zuordnungKenntKlient(zuordnungVon(definition)) || !quelleBrauchtKlient(q) || b.vorausfuellen?.quelle === q)
              .map((q) => (
                <option key={q} value={q}>
                  {DATENQUELLEN[q].label}
                </option>
              ))}
          </select>
          {b.vorausfuellen && (
            <div className="zv-fe-radios" role="radiogroup" aria-label="Art der Vorausfüllung">
              <label className="zv-checkbox-zeile">
                <input type="radio" checked={b.vorausfuellen.art === "vorschlag"} onChange={() => onAendern({ ...b, vorausfuellen: { ...b.vorausfuellen!, art: "vorschlag" } })} />
                Als Vorschlag, darf geändert werden
              </label>
              <label className="zv-checkbox-zeile">
                <input type="radio" checked={b.vorausfuellen.art === "festgehalten"} onChange={() => onAendern({ ...b, vorausfuellen: { ...b.vorausfuellen!, art: "festgehalten" } })} />
                Festgehalten: nur lesend, Stand beim Abschließen
              </label>
            </div>
          )}
          <p className="zv-protokoll-hilfe">Name, Geburtsdatum und Aktenzeichen gibt es nur als Baustein „Vorausgefüllte Anzeige“: sie werden angezeigt, aber nie mitgespeichert.</p>
        </div>
      )}
    </div>
  );
}

const AUSRICHTUNG_ICON: Record<BausteinAusrichtung, typeof IAusrichtungLinks> = {
  links: IAusrichtungLinks,
  mitte: IAusrichtungMitte,
  rechts: IAusrichtungRechts,
};

/**
 * Links/Mitte/Rechts als Knopfreihe statt Ausklappliste: drei Moeglichkeiten,
 * alle auf einen Blick. "links" wird nicht gespeichert (undefined), damit ein
 * nie angefasster Baustein in der Definition genauso aussieht wie vorher und
 * der Versionsvergleich keine Scheinaenderung meldet.
 */
function AusrichtungWahl({ labelId, wert, onWahl }: { labelId: string; wert: BausteinAusrichtung; onWahl: (a: BausteinAusrichtung) => void }) {
  return (
    <div className="zv-field">
      <span className="zv-fe-feldlabel" id={labelId}>
        Ausrichtung
      </span>
      <div className="zv-segmented zv-fe-ausrichtung" role="radiogroup" aria-labelledby={labelId}>
        {BAUSTEIN_AUSRICHTUNGEN.map((a) => {
          const Icon = AUSRICHTUNG_ICON[a];
          return (
            <button key={a} type="button" role="radio" aria-checked={wert === a} className={wert === a ? "active" : ""} onClick={() => onWahl(a)}>
              <Icon size={15} />
              {BAUSTEIN_AUSRICHTUNG_LABEL[a]}
            </button>
          );
        })}
      </div>
      <p className="zv-protokoll-hilfe">Gilt beim Ausfüllen, in der Ansicht und im PDF. Mittig oder rechts steht der Baustein allein in seiner Zeile.</p>
    </div>
  );
}

/**
 * Der Schluessel wird beim Tippen durchlaufen ("a", "ab", ...): ein
 * Zwischenstand darf leer oder schon vergeben sein, ohne dass das Feld die
 * Eingabe verweigert. Deshalb ein eigener Entwurf; nach oben geht nur ein
 * gueltiger Stand, beim Verlassen springt ein ungueltiger auf den letzten
 * gueltigen zurueck.
 */
function SchluesselEingabe({ id, wert, vergeben, onAendern }: { id: string; wert: string; vergeben: Set<string>; onAendern: (s: string) => void }) {
  const [entwurf, setEntwurf] = useState(wert);
  // Aendert sich der Schluessel von aussen (er folgt der Beschriftung), zieht der Entwurf mit.
  const [zuletzt, setZuletzt] = useState(wert);
  if (wert !== zuletzt) {
    setZuletzt(wert);
    setEntwurf(wert);
  }
  const problem = !entwurf ? "Bitte einen Schlüssel eingeben." : vergeben.has(entwurf) ? "Diesen Schlüssel hat schon ein anderes Feld." : null;
  return (
    <>
      <input
        id={id}
        className="zv-mono"
        value={entwurf}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(e) => {
          const s = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
          setEntwurf(s);
          if (s && !vergeben.has(s)) {
            setZuletzt(s);
            onAendern(s);
          }
        }}
        onBlur={() => setEntwurf(wert)}
      />
      {problem && (
        <p id={`${id}-problem`} className="zv-protokoll-hilfe zv-fe-schluessel-problem">
          {problem} Beim Verlassen des Feldes gilt wieder „{wert}“.
        </p>
      )}
    </>
  );
}

function ZahlFeld({
  id,
  label,
  wert,
  onAendern,
  ganz,
  min,
  hilfe,
}: {
  id: string;
  label: string;
  wert: number | undefined;
  onAendern: (w: number | undefined) => void;
  ganz?: boolean;
  min?: number;
  hilfe?: string;
}) {
  return (
    <div className="zv-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        step={ganz ? 1 : "any"}
        min={min}
        value={wert ?? ""}
        onChange={(e) => onAendern(e.target.value === "" ? undefined : ganz ? Math.trunc(Number(e.target.value)) : Number(e.target.value))}
      />
      {hilfe && <p className="zv-protokoll-hilfe">{hilfe}</p>}
    </div>
  );
}

function TypEinstellungen({
  b,
  definition,
  gesperrt,
  id,
  onAendern,
  onDefinition,
}: {
  b: Baustein;
  definition: FormularDefinition;
  gesperrt: Baustein | null;
  id: (s: string) => string;
  onAendern: (b: Baustein) => void;
  onDefinition: (d: FormularDefinition) => void;
}) {
  switch (b.typ) {
    case "hinweis":
      return (
        <div className="zv-field">
          <label htmlFor={id("ton")}>Darstellung</label>
          <select id={id("ton")} value={b.ton ?? "info"} onChange={(e) => onAendern({ ...b, ton: e.target.value as "info" | "warnung" })}>
            <option value="info">Hinweis</option>
            <option value="warnung">Warnung</option>
          </select>
        </div>
      );
    case "anzeige":
      return (
        <div className="zv-field">
          <label htmlFor={id("quelle")}>Zeigt an</label>
          <select id={id("quelle")} value={b.quelle} onChange={(e) => onAendern({ ...b, quelle: e.target.value as Datenquelle })}>
            {(Object.keys(DATENQUELLEN) as Datenquelle[])
              .filter((q) => zuordnungKenntKlient(zuordnungVon(definition)) || !quelleBrauchtKlient(q) || b.quelle === q)
              .map((q) => (
                <option key={q} value={q}>
                  {DATENQUELLEN[q].label}
                </option>
              ))}
          </select>
          <p className="zv-protokoll-hilfe">Wird beim Öffnen frisch gelesen und nie im Protokoll gespeichert.</p>
        </div>
      );
    case "kurztext":
    case "langtext":
      return (
        <ZahlFeld
          id={id("max")}
          label="Höchstens Zeichen"
          ganz
          min={1}
          hilfe="Leer lassen für keine Grenze. Wer ausfüllt, sieht, wie viele Zeichen noch gehen."
          wert={b.maxLaenge}
          onAendern={(maxLaenge) => onAendern({ ...b, maxLaenge })}
        />
      );
    case "zahl":
      return (
        <div className="zv-fe-zweispaltig">
          <ZahlFeld id={id("min")} label="Kleinster Wert" wert={b.min} onAendern={(min) => onAendern({ ...b, min })} />
          <ZahlFeld id={id("max")} label="Größter Wert" wert={b.max} onAendern={(max) => onAendern({ ...b, max })} />
          <ZahlFeld id={id("nk")} label="Nachkommastellen" ganz wert={b.nachkommastellen} onAendern={(nachkommastellen) => onAendern({ ...b, nachkommastellen })} />
          <div className="zv-field">
            <label htmlFor={id("einheit")}>Einheit</label>
            <input id={id("einheit")} value={b.einheit ?? ""} placeholder="z. B. kg" onChange={(e) => onAendern({ ...b, einheit: e.target.value || undefined })} />
          </div>
        </div>
      );
    case "datum":
      return (
        <>
          <label className="zv-checkbox-zeile">
            <input type="checkbox" checked={!!b.nichtInZukunft} onChange={(e) => onAendern({ ...b, nichtInZukunft: e.target.checked || undefined })} />
            Darf nicht in der Zukunft liegen
          </label>
          <label className="zv-checkbox-zeile">
            <input
              type="checkbox"
              checked={definition.bezugsdatumFeld === b.schluessel}
              onChange={(e) => {
                const d = { ...definition };
                if (e.target.checked) d.bezugsdatumFeld = b.schluessel;
                else delete d.bezugsdatumFeld;
                onDefinition(d);
              }}
            />
            Danach wird das Protokoll in der Akte einsortiert
          </label>
        </>
      );
    case "skala":
      return (
        <div className="zv-fe-zweispaltig">
          <ZahlFeld id={id("min")} label="Von" ganz wert={b.min} onAendern={(min) => onAendern({ ...b, min: min ?? 0 })} />
          <ZahlFeld id={id("max")} label="Bis" ganz wert={b.max} onAendern={(max) => onAendern({ ...b, max: max ?? 0 })} />
          {/* "Beschriftung unten/oben" war missverstaendlich (Rueckmeldung
              6af2300c: wo erscheint das, wofuer ist es?). Die Bezeichnung nennt
              jetzt die Zahl, unter der der Text steht, und der Hilfetext sagt,
              wo er auftaucht -- und wo bewusst nicht. */}
          <div className="zv-field">
            <label htmlFor={id("lmin")}>Text unter der {b.min}</label>
            <input id={id("lmin")} value={b.labelMin ?? ""} placeholder="z. B. sehr schlecht" aria-describedby={id("lhilfe")} onChange={(e) => onAendern({ ...b, labelMin: e.target.value || undefined })} />
          </div>
          <div className="zv-field">
            <label htmlFor={id("lmax")}>Text unter der {b.max}</label>
            <input id={id("lmax")} value={b.labelMax ?? ""} placeholder="z. B. sehr gut" aria-describedby={id("lhilfe")} onChange={(e) => onAendern({ ...b, labelMax: e.target.value || undefined })} />
          </div>
          <p className="zv-protokoll-hilfe zv-fe-ganz" id={id("lhilfe")}>
            Beim Ausfüllen steht dieser Text klein unter der kleinsten und der größten Zahl, damit klar ist, was die Zahlen bedeuten (z. B. {b.min} = sehr schlecht, {b.max} = sehr gut). Beides ist freiwillig. In der Akte, im PDF und in Auswertungen steht nur die gewählte Zahl, etwa „7 von {b.max}“.
          </p>
        </div>
      );
    case "berechnung":
      return (
        <div className="zv-fe-zweispaltig">
          <div className="zv-field">
            <label htmlFor={id("einheit")}>Einheit</label>
            <input id={id("einheit")} value={b.einheit ?? ""} placeholder="z. B. Minuten" onChange={(e) => onAendern({ ...b, einheit: e.target.value || undefined })} />
          </div>
          <ZahlFeld id={id("nk")} label="Nachkommastellen" ganz wert={b.nachkommastellen} onAendern={(nachkommastellen) => onAendern({ ...b, nachkommastellen })} />
          <p className="zv-protokoll-hilfe zv-fe-ganz">Die Formel stellen Sie unter „Logik“ ein.</p>
        </div>
      );
    case "auswahl":
    case "mehrfachauswahl":
      return <OptionenListe b={b} definition={definition} gesperrt={gesperrt} onAendern={onAendern} onDefinition={onDefinition} />;
    case "unterschriften":
      return <PlaetzeListe b={b} gesperrt={gesperrt} onAendern={onAendern} />;
    default:
      return null;
  }
}
