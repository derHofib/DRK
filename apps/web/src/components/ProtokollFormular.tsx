import { useMemo, type CSSProperties, type ReactElement } from "react";
import {
  alleBausteine,
  istEingabe,
  PROTOKOLL_QUELLE_LABEL,
  werteAus,
  zeichenGrenze,
  type Baustein,
  type EingabeBaustein,
  type FeldWert,
  type FeldWerte,
  type FormularDefinition,
  type ProtokollUnterschriftDto,
  type ProtokollWertQuelle,
} from "@zimmerakte/shared";
import { UnterschriftenAnzeige, UnterschriftenVorschau } from "./Unterschriften";
import { formatDatum } from "../format";
import { IAbbrechen, IInfo } from "./icons";
import { Datumsfeld } from "./Datumsfeld";

export interface PersonAuswahl {
  id: string;
  name: string;
}

interface Gemeinsam {
  definition: FormularDefinition;
  werte: FeldWerte;
  /** Frisch gelesene Anzeigewerte (Name, Geburtsdatum, ...), nie gespeichert. */
  anzeige: Record<string, string | null>;
  quellen?: Record<string, ProtokollWertQuelle>;
  /** Namen zu Benutzer-IDs, die schon in Mitarbeitende-Feldern stehen. */
  personen: Record<string, string>;
}

function leer(w: FeldWert | null | undefined): boolean {
  return w === null || w === undefined || w === "" || (Array.isArray(w) && w.length === 0);
}

/**
 * Welche schon eingetragenen Angaben durch die aktuelle Logik verborgen sind
 * und deshalb beim Speichern verworfen werden (der Server macht dasselbe mit
 * demselben Auswerter aus packages/shared). Die Oberflaeche sagt es vorher,
 * damit niemand ueberrascht ist, dass ein ausgefuellter Abschnitt fehlt.
 */
export function verworfeneAngaben(definition: FormularDefinition, werte: FeldWerte): string[] {
  const { sichtbar } = werteAus(definition, werte);
  return alleBausteine(definition)
    .filter((b) => istEingabe(b) && !sichtbar.has(b.schluessel) && !leer(werte[b.schluessel]))
    .map((b) => b.beschriftung);
}

/** Lesbarer Text eines gespeicherten Werts -- fuer Ansicht und Historie gleich. */
export function wertAlsText(b: Baustein | undefined, w: FeldWert | null | undefined, personen: Record<string, string>): string {
  if (leer(w)) return "–";
  if (!b) return Array.isArray(w) ? w.join(", ") : String(w);
  switch (b.typ) {
    case "ja_nein":
      return w ? "Ja" : "Nein";
    case "datum":
      return formatDatum(String(w));
    case "auswahl":
      return b.optionen.find((o) => o.wert === w)?.label ?? String(w);
    case "mehrfachauswahl":
      return (w as string[]).map((x) => b.optionen.find((o) => o.wert === x)?.label ?? x).join(", ");
    case "mitarbeitende":
      return (w as string[]).map((x) => personen[x] ?? "unbekannte Person").join(", ");
    case "zahl":
    case "berechnung":
      return `${String(w).replace(".", ",")}${b.einheit ? ` ${b.einheit}` : ""}`;
    case "skala":
      return `${w} von ${b.max}`;
    default:
      return String(w);
  }
}

/**
 * Ausfuellen eines Protokolls. Sichtbarkeit, Pflicht und Berechnungen kommen
 * aus demselben Auswerter, mit dem der Server beim Abschliessen prueft.
 */
export function ProtokollEingabe({
  definition,
  werte,
  anzeige,
  quellen,
  personen,
  auswahlPersonen,
  fehler,
  onAendern,
  idPraefix = "",
}: Gemeinsam & {
  auswahlPersonen: PersonAuswahl[];
  fehler: Record<string, string>;
  onAendern: (schluessel: string, wert: FeldWert | null) => void;
  /** Mehrere Formulare in einem Fenster (Tagesbericht): Feld-IDs muessen eindeutig bleiben, sonst zeigt ein <label> aufs falsche Feld. */
  idPraefix?: string;
}) {
  const auswertung = useMemo(() => werteAus(definition, werte), [definition, werte]);
  const namen = useMemo(() => {
    const n: Record<string, string> = { ...personen };
    for (const p of auswahlPersonen) n[p.id] = p.name;
    return n;
  }, [personen, auswahlPersonen]);

  const baustein = (b: Baustein) => {
    if (!auswertung.sichtbar.has(b.schluessel)) return null;
    switch (b.typ) {
      case "abschnitt":
        return (
          <fieldset key={b.schluessel} className="zv-protokoll-abschnitt">
            <legend>{b.beschriftung}</legend>
            {b.hilfetext && <p className="zv-protokoll-hilfe">{b.hilfetext}</p>}
            {b.kinder.map(baustein)}
          </fieldset>
        );
      case "hinweis":
        return (
          <div key={b.schluessel} className={b.ton === "warnung" ? "zv-hinweis zv-protokoll-warnung" : "zv-hinweis zv-hinweis-info"}>
            <IInfo />
            {b.beschriftung}
          </div>
        );
      case "anzeige":
        return (
          <div key={b.schluessel} className="zv-protokoll-anzeige">
            <span className="zv-protokoll-label">{b.beschriftung}</span>
            <span>{anzeige[b.schluessel] ? (b.quelle === "klient.geburtsdatum" ? formatDatum(anzeige[b.schluessel]!) : anzeige[b.schluessel]) : "–"}</span>
          </div>
        );
      case "unterschriften":
        return <UnterschriftenVorschau key={b.schluessel} b={b} />;
      case "berechnung":
        return (
          <div key={b.schluessel} className="zv-field">
            <label>{b.beschriftung}</label>
            <div className="zv-protokoll-nurlesen">
              {wertAlsText(b, auswertung.werte[b.schluessel], namen)} <span className="zv-pill">berechnet</span>
            </div>
          </div>
        );
      default:
        return (
          <EingabeFeld
            key={b.schluessel}
            b={b}
            wert={werte[b.schluessel] ?? null}
            pflicht={auswertung.pflicht.has(b.schluessel)}
            fehler={fehler[b.schluessel]}
            quelle={quellen?.[b.schluessel]}
            namen={namen}
            auswahlPersonen={auswahlPersonen}
            onAendern={(w) => onAendern(b.schluessel, w)}
            idPraefix={idPraefix}
          />
        );
    }
  };

  return <div className="zv-protokoll">{definition.bausteine.map(baustein)}</div>;
}

function EingabeFeld({
  b,
  wert,
  pflicht,
  fehler,
  quelle,
  namen,
  auswahlPersonen,
  onAendern,
  idPraefix,
}: {
  idPraefix: string;
  b: EingabeBaustein;
  wert: FeldWert | null;
  pflicht: boolean;
  fehler?: string;
  quelle?: ProtokollWertQuelle;
  namen: Record<string, string>;
  auswahlPersonen: PersonAuswahl[];
  onAendern: (w: FeldWert | null) => void;
}) {
  const id = `zv-feld-${idPraefix}${b.schluessel}`;
  const fest = b.vorausfuellen?.art === "festgehalten";
  const kopf = (
    <label htmlFor={id}>
      {b.beschriftung}
      {pflicht && <span aria-hidden="true"> *</span>}
      {b.intern && <span className="zv-pill zv-protokoll-pill">intern</span>}
      {quelle === "vorschlag" && <span className="zv-pill zv-protokoll-pill">vorausgefüllt</span>}
    </label>
  );
  const hilfe = b.hilfetext && <p className="zv-protokoll-hilfe">{b.hilfetext}</p>;
  const meldung = fehler && (
    <p className="zv-feld-fehler" id={`${id}-fehler`} role="alert">
      {fehler}
    </p>
  );
  const aria = { "aria-invalid": fehler ? true : undefined, "aria-describedby": fehler ? `${id}-fehler` : undefined };

  if (fest) {
    return (
      <div className="zv-field">
        {kopf}
        <div className="zv-protokoll-nurlesen" id={id}>
          {wertAlsText(b, wert, namen)} <span className="zv-pill">festgehalten</span>
        </div>
        <p className="zv-protokoll-hilfe">Wird beim Abschließen mit dem dann aktuellen Stand gespeichert.</p>
      </div>
    );
  }

  // Sichtbar machen, warum das Tippen aufhoert: ohne Zaehler wirkt ein volles
  // Feld wie ein kaputtes (Rueckmeldung 95d08c6a).
  const grenze = b.typ === "kurztext" || b.typ === "langtext" ? zeichenGrenze(b) : undefined;
  const zaehler = grenze !== undefined && (
    <p className="zv-protokoll-hilfe zv-protokoll-zaehler" aria-live="polite">
      {typeof wert === "string" ? wert.length : 0} von höchstens {grenze} Zeichen
    </p>
  );

  let eingabe;
  switch (b.typ) {
    case "kurztext":
      eingabe = <input id={id} {...aria} value={typeof wert === "string" ? wert : ""} maxLength={grenze} onChange={(e) => onAendern(e.target.value || null)} />;
      break;
    case "langtext":
      eingabe = (
        <textarea id={id} {...aria} rows={4} value={typeof wert === "string" ? wert : ""} maxLength={grenze} onChange={(e) => onAendern(e.target.value || null)} />
      );
      break;
    case "zahl":
      eingabe = (
        <div className="zv-protokoll-zahl">
          <input
            id={id}
            {...aria}
            type="number"
            inputMode="decimal"
            min={b.min}
            max={b.max}
            step={b.nachkommastellen === undefined ? "any" : 10 ** -b.nachkommastellen}
            value={typeof wert === "number" ? wert : ""}
            onChange={(e) => onAendern(e.target.value === "" ? null : Number(e.target.value))}
          />
          {b.einheit && <span>{b.einheit}</span>}
        </div>
      );
      break;
    case "datum":
      eingabe = (
        <Datumsfeld
          id={id}
          {...aria}
          max={b.nichtInZukunft ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()) : undefined}
          value={typeof wert === "string" ? wert : ""}
          onChange={(v) => onAendern(v || null)}
          schnellwahl={b.nichtInZukunft ? "heute-gestern" : "heute"}
        />
      );
      break;
    case "uhrzeit":
      eingabe = <input id={id} {...aria} type="time" value={typeof wert === "string" ? wert : ""} onChange={(e) => onAendern(e.target.value || null)} />;
      break;
    case "ja_nein":
      eingabe = (
        <Knoepfe
          id={id}
          optionen={[
            { wert: true, label: "Ja" },
            { wert: false, label: "Nein" },
          ]}
          aktiv={typeof wert === "boolean" ? wert : null}
          onWahl={(w) => onAendern(w === wert ? null : w)}
        />
      );
      break;
    case "auswahl": {
      const optionen = b.optionen.filter((o) => !o.ausgeblendet || o.wert === wert);
      eingabe =
        optionen.length <= 5 ? (
          <Knoepfe id={id} optionen={optionen} aktiv={typeof wert === "string" ? wert : null} onWahl={(w) => onAendern(w === wert ? null : w)} />
        ) : (
          <select id={id} {...aria} value={typeof wert === "string" ? wert : ""} onChange={(e) => onAendern(e.target.value || null)}>
            <option value="">Bitte wählen…</option>
            {optionen.map((o) => (
              <option key={o.wert} value={o.wert}>
                {o.label}
              </option>
            ))}
          </select>
        );
      break;
    }
    case "mehrfachauswahl": {
      const gewaehlt = Array.isArray(wert) ? wert : [];
      eingabe = (
        <div className="zv-protokoll-mehrfach" id={id} role="group" aria-label={b.beschriftung}>
          {b.optionen
            .filter((o) => !o.ausgeblendet || gewaehlt.includes(o.wert))
            .map((o) => (
              <label key={o.wert} className="zv-protokoll-haken">
                <input
                  type="checkbox"
                  checked={gewaehlt.includes(o.wert)}
                  onChange={(e) => {
                    const neu = e.target.checked ? [...gewaehlt, o.wert] : gewaehlt.filter((x) => x !== o.wert);
                    onAendern(neu.length ? neu : null);
                  }}
                />
                {o.label}
              </label>
            ))}
        </div>
      );
      break;
    }
    case "skala": {
      const stufen = Array.from({ length: b.max - b.min + 1 }, (_, i) => b.min + i);
      eingabe = (
        <div className="zv-protokoll-skala">
          <div className="zv-protokoll-skala-innen" style={{ "--zv-skala-stufen": stufen.length } as CSSProperties}>
            <Knoepfe id={id} optionen={stufen.map((s) => ({ wert: s, label: String(s) }))} aktiv={typeof wert === "number" ? wert : null} onWahl={(w) => onAendern(w === wert ? null : w)} />
            {(b.labelMin || b.labelMax) && (
              <div className="zv-protokoll-skala-enden">
                <span>{b.labelMin}</span>
                <span>{b.labelMax}</span>
              </div>
            )}
          </div>
        </div>
      );
      break;
    }
    case "mitarbeitende": {
      const gewaehlt = Array.isArray(wert) ? wert : [];
      const frei = auswahlPersonen.filter((p) => !gewaehlt.includes(p.id));
      eingabe = (
        <div className="zv-protokoll-personen">
          {gewaehlt.map((pid) => (
            <span key={pid} className="zv-pill zv-protokoll-person">
              {namen[pid] ?? "unbekannte Person"}
              <button type="button" className="zv-icon-btn" aria-label={`${namen[pid] ?? "Person"} entfernen`} onClick={() => {
                const neu = gewaehlt.filter((x) => x !== pid);
                onAendern(neu.length ? neu : null);
              }}>
                <IAbbrechen size={14} />
              </button>
            </span>
          ))}
          <select
            id={id}
            {...aria}
            value=""
            onChange={(e) => {
              if (e.target.value) onAendern([...gewaehlt, e.target.value]);
            }}
          >
            <option value="">Person hinzufügen…</option>
            {frei.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      );
      break;
    }
  }

  return (
    <div className={`zv-field${fehler ? " zv-field-fehler" : ""}`}>
      {kopf}
      {hilfe}
      {eingabe}
      {zaehler}
      {meldung}
    </div>
  );
}

function Knoepfe<T extends string | number | boolean>({
  id,
  optionen,
  aktiv,
  onWahl,
}: {
  id: string;
  optionen: { wert: T; label: string }[];
  aktiv: T | null;
  onWahl: (w: T) => void;
}) {
  return (
    <div className="zv-protokoll-knoepfe" id={id} role="radiogroup">
      {optionen.map((o) => (
        <button
          key={String(o.wert)}
          type="button"
          role="radio"
          aria-checked={aktiv === o.wert}
          className={aktiv === o.wert ? "active" : ""}
          onClick={() => onWahl(o.wert)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Typen, deren Wert nie umbrechen darf: ein Datum, das zeichenweise
 * untereinander steht ("0 4 . 1 1 ."), war der Ausloeser der Rueckmeldung
 * "Ansicht Protokolle". Lieber eine Zeile, die in die naechste Zeile rutscht.
 */
const EINZEILIG = new Set<Baustein["typ"]>(["datum", "uhrzeit", "zahl", "skala", "berechnung"]);

/**
 * Lesende Ansicht eines Protokolls: Beschriftung, Wert und woher der Wert
 * kommt (vorausgefuellt, festgehalten, berechnet). Verborgene Felder fehlen,
 * so wie sie auch nicht gespeichert sind.
 *
 * Zwei Spalten statt drei: die Herkunfts-Plakette steht in der Wertzelle
 * hinter dem Wert. Als eigene auto-Spalte hat sie dem Wert im schmalen
 * Fenster bis auf 36 px Platz genommen (Konzept protokoll-ansicht, 2.).
 * Ob gestapelt oder zweispaltig, entscheidet die Breite der Ansicht selbst
 * (Container-Abfrage in app.css), nicht die Fensterbreite.
 */
export function ProtokollAnsicht({
  definition,
  werte,
  anzeige,
  quellen,
  personen,
  unterschriften,
  onUnterschreiben,
}: Gemeinsam & {
  /** Stand der Unterschriften; ohne (z. B. "Ausprobieren" im Editor) zeigt der Baustein die leeren Plaetze. */
  unterschriften?: ProtokollUnterschriftDto[];
  onUnterschreiben?: (e: ProtokollUnterschriftDto) => void;
}) {
  const auswertung = useMemo(() => werteAus(definition, werte), [definition, werte]);
  const zeile = (b: Baustein): ReactElement | null => {
    if (!auswertung.sichtbar.has(b.schluessel)) return null;
    if (b.typ === "abschnitt") {
      return (
        <section key={b.schluessel} className="zv-protokoll-abschnitt">
          <h4>{b.beschriftung}</h4>
          {b.kinder.map(zeile)}
        </section>
      );
    }
    if (b.typ === "hinweis") return null;
    if (b.typ === "unterschriften") {
      return unterschriften ? (
        <UnterschriftenAnzeige key={b.schluessel} b={b} eintraege={unterschriften} onUnterschreiben={onUnterschreiben} />
      ) : (
        <UnterschriftenVorschau key={b.schluessel} b={b} />
      );
    }
    if (b.typ === "anzeige") {
      const w = anzeige[b.schluessel];
      const datum = b.quelle === "klient.geburtsdatum";
      return (
        <div key={b.schluessel} className="zv-protokoll-zeile">
          <span className="zv-protokoll-label">{b.beschriftung}</span>
          <span className="zv-protokoll-wertzelle">
            <span className={`zv-protokoll-wert${datum ? " zv-protokoll-wert-einzeilig" : ""}`}>{w ? (datum ? formatDatum(w) : w) : "–"}</span>
          </span>
        </div>
      );
    }
    const w = werte[b.schluessel];
    const q = quellen?.[b.schluessel];
    // Fliesstext in einer 60-%-Spalte liest sich schlecht: Langtext immer ueber die volle Breite.
    const voll = b.typ === "langtext";
    return (
      <div key={b.schluessel} className={`zv-protokoll-zeile${voll ? " zv-protokoll-zeile-voll" : ""}`}>
        <span className="zv-protokoll-label">
          {b.beschriftung}
          {"intern" in b && b.intern && <span className="zv-pill zv-protokoll-pill">intern</span>}
        </span>
        <span className="zv-protokoll-wertzelle">
          <span className={`zv-protokoll-wert${EINZEILIG.has(b.typ) ? " zv-protokoll-wert-einzeilig" : ""}`}>{wertAlsText(b, w, personen)}</span>
          {q && q !== "eingabe" && !leer(w) && <span className={`zv-pill${q === "vorschlag_geaendert" ? " zv-pill-frist" : ""}`}>{PROTOKOLL_QUELLE_LABEL[q]}</span>}
        </span>
      </div>
    );
  };
  return <div className="zv-protokoll zv-protokoll-lesen">{definition.bausteine.map(zeile)}</div>;
}
