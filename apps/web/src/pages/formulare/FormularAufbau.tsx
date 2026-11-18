import { useMemo, useState, type ReactNode } from "react";
import {
  alleBausteine,
  BAUSTEIN_LABEL,
  DATENQUELLEN,
  istEingabe,
  type Baustein,
  type FormularDefinition,
  type FormularDetailDto,
  type FormularKennzahlenDto,
} from "@zimmerakte/shared";
import { bedingungText, entfernteFelder, feldStaende, istBreit, type FeldStand } from "./formularHilfen";

/**
 * Reiter „Aufbau“ zum Ansehen (Bild 2 im Konzept „Aufbau Formular“): volle
 * Breite, links die Gliederung, in der Mitte das Formular zweispaltig, rechts
 * alles zum gewaehlten Feld. Zweispaltig NUR hier: beim Ausfuellen bleibt
 * die Reihenfolge von oben nach unten (Konzept, Frage 5).
 */

export interface AufbauVersion {
  nummer: number;
  definition: FormularDefinition;
  entwurf: boolean;
  anzahlProtokolle: number;
}

/** Alle Versionen, neueste zuerst; der Entwurf ist die neueste. */
export function aufbauVersionen(d: FormularDetailDto): AufbauVersion[] {
  return d.versionen.map((v) => ({
    nummer: v.nummer,
    definition: v.veroeffentlichtAm === null && d.entwurf ? d.entwurf.definition : v.definition,
    entwurf: v.veroeffentlichtAm === null,
    anzahlProtokolle: v.anzahlProtokolle,
  }));
}

export function VersionWahl({
  versionen,
  gewaehlt,
  onWaehlen,
  label = "Version",
}: {
  versionen: AufbauVersion[];
  gewaehlt: number;
  onWaehlen: (n: number) => void;
  label?: string;
}) {
  return (
    <div className="zv-fa-wahl">
      <span className="zv-sub">{label}</span>
      <div className="zv-segmented" role="group" aria-label={label}>
        {[...versionen].reverse().map((v) => (
          <button key={v.nummer} type="button" className={v.nummer === gewaehlt ? "active" : ""} aria-pressed={v.nummer === gewaehlt} onClick={() => onWaehlen(v.nummer)}>
            {v.nummer}
            {v.entwurf ? " · Entwurf" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

const STAND_LABEL: Record<FeldStand, string> = { neu: "neu", geaendert: "geändert", gleich: "" };

export function FormularAufbau({
  d,
  version,
  onVersion,
  kennzahlen,
  kopfZusatz,
}: {
  d: FormularDetailDto;
  version: number;
  onVersion: (n: number) => void;
  kennzahlen: FormularKennzahlenDto | null;
  kopfZusatz?: ReactNode;
}) {
  const versionen = useMemo(() => aufbauVersionen(d), [d]);
  const v = versionen.find((x) => x.nummer === version) ?? versionen[0];
  const vorher = versionen.find((x) => x.nummer < v.nummer) ?? null;
  const [markieren, setMarkieren] = useState(true);
  const def = v.definition;
  const alle = useMemo(() => alleBausteine(def), [def]);
  const staende = useMemo(() => feldStaende(vorher?.definition ?? null, def), [vorher, def]);
  const entfernt = useMemo(() => entfernteFelder(vorher?.definition ?? null, def), [vorher, def]);
  const ersteEingabe = alle.find((b) => b.typ !== "abschnitt") ?? null;
  const [gewaehltSchluessel, setGewaehlt] = useState<string | null>(null);
  const gewaehlt = alle.find((b) => b.schluessel === gewaehltSchluessel) ?? ersteEingabe;

  const abschnitte = def.bausteine.filter((b) => b.typ === "abschnitt");
  const regeln = alle.filter((b) => b.sichtbarWenn || ("pflicht" in b && typeof b.pflicht === "object") || b.typ === "berechnung").length;
  const felder = alle.filter((b) => istEingabe(b)).length;
  const zeigeMarkierung = markieren && vorher !== null;

  // Oberste Ebene in Karten gliedern: Abschnitte sind eigene Karten, alles
  // davor/dazwischen ohne Abschnitt sammelt sich in einer Karte ohne Titel.
  const gruppen: { titel: Baustein | null; inhalt: Baustein[] }[] = [];
  for (const b of def.bausteine) {
    if (b.typ === "abschnitt") gruppen.push({ titel: b, inhalt: b.kinder });
    else if (gruppen.length && gruppen[gruppen.length - 1].titel === null) gruppen[gruppen.length - 1].inhalt.push(b);
    else gruppen.push({ titel: null, inhalt: [b] });
  }

  const feld = (b: Baustein): ReactNode => {
    if (b.typ === "abschnitt") {
      return (
        <div key={b.schluessel} className="zv-fa-unterabschnitt">
          <button type="button" className={`zv-fa-unterabschnitt-titel${gewaehlt?.schluessel === b.schluessel ? " zv-fa-gewaehlt" : ""}`} onClick={() => setGewaehlt(b.schluessel)}>
            {b.beschriftung}
            {b.sichtbarWenn && <span className="zv-pill">sichtbar, wenn {bedingungText(b.sichtbarWenn, def)}</span>}
          </button>
          <div className="zv-fa-raster">{b.kinder.map(feld)}</div>
        </div>
      );
    }
    const stand = staende.get(b.schluessel) ?? "gleich";
    const pflicht = "pflicht" in b && b.pflicht;
    return (
      <button
        key={b.schluessel}
        type="button"
        className={[
          "zv-fa-feld",
          istBreit(b) ? "zv-fa-breit" : "",
          gewaehlt?.schluessel === b.schluessel ? "zv-fa-gewaehlt" : "",
          zeigeMarkierung && stand !== "gleich" ? `zv-fa-${stand}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-pressed={gewaehlt?.schluessel === b.schluessel}
        onClick={() => setGewaehlt(b.schluessel)}
      >
        <span className="zv-fa-feld-titel">
          {b.beschriftung || BAUSTEIN_LABEL[b.typ]}
          {pflicht === true && <span aria-label="Pflicht"> *</span>}
          {zeigeMarkierung && stand !== "gleich" && <span className={`zv-pill ${stand === "neu" ? "zv-pill-ok" : "zv-pill-frist"}`}>{STAND_LABEL[stand]}</span>}
          {"intern" in b && b.intern && <span className="zv-pill">intern</span>}
        </span>
        <span className="zv-fa-feld-art">{feldArt(b)}</span>
      </button>
    );
  };

  return (
    <div className="zv-fa">
      <div className="zv-fa-leiste">
        <div className="zv-fa-leiste-links">
          <VersionWahl versionen={versionen} gewaehlt={v.nummer} onWaehlen={onVersion} />
          {vorher && (
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={markieren} onChange={(e) => setMarkieren(e.target.checked)} />
              Änderungen zu Version {vorher.nummer} markieren
            </label>
          )}
          {kopfZusatz}
        </div>
        <span className="zv-sub">
          {felder} {felder === 1 ? "Feld" : "Felder"} · {abschnitte.length} {abschnitte.length === 1 ? "Abschnitt" : "Abschnitte"} · {regeln} {regeln === 1 ? "Regel" : "Regeln"}
        </span>
      </div>
      {zeigeMarkierung && entfernt.length > 0 && (
        <p className="zv-sub zv-fa-entfernt">
          Gegenüber Version {vorher!.nummer} entfernt: {entfernt.map((b) => `„${b.beschriftung || BAUSTEIN_LABEL[b.typ]}“`).join(", ")}
        </p>
      )}

      <div className="zv-fa-drei">
        <nav className="zv-fo-karte zv-fa-gliederung" aria-label="Gliederung">
          <div className="zv-gruppenlabel">Gliederung</div>
          {abschnitte.length === 0 && <p className="zv-sub">Ohne Abschnitte</p>}
          {abschnitte.map((a) => (
            <a
              key={a.schluessel}
              href={`#zv-fa-${a.schluessel}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`zv-fa-${a.schluessel}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                setGewaehlt(a.schluessel);
              }}
            >
              <span>{a.beschriftung}</span>
              <span className="zv-sub zv-mono">{a.typ === "abschnitt" ? alleBausteine({ bausteine: a.kinder }).filter((x) => istEingabe(x)).length : ""}</span>
            </a>
          ))}
        </nav>

        <div className="zv-fa-formular">
          {def.bausteine.length === 0 && <p className="zv-sub">Diese Version hat noch keine Felder.</p>}
          {gruppen.map((g, i) => (
            <section key={g.titel?.schluessel ?? `ohne-${i}`} id={g.titel ? `zv-fa-${g.titel.schluessel}` : undefined} className="zv-fo-karte">
              {g.titel && (
                <button
                  type="button"
                  className={`zv-fa-abschnitt-titel${gewaehlt?.schluessel === g.titel.schluessel ? " zv-fa-gewaehlt" : ""}${zeigeMarkierung && staende.get(g.titel.schluessel) !== "gleich" ? ` zv-fa-${staende.get(g.titel.schluessel)}` : ""}`}
                  onClick={() => setGewaehlt(g.titel!.schluessel)}
                >
                  {g.titel.beschriftung}
                  {g.titel.sichtbarWenn && <span className="zv-pill">sichtbar, wenn {bedingungText(g.titel.sichtbarWenn, def)}</span>}
                </button>
              )}
              <div className="zv-fa-raster">{g.inhalt.map(feld)}</div>
            </section>
          ))}
        </div>

        <aside className="zv-fo-karte zv-fa-info" aria-label="Zum gewählten Feld">
          {gewaehlt ? (
            <FeldInfo b={gewaehlt} def={def} versionen={versionen} v={v} vorher={vorher} stand={staende.get(gewaehlt.schluessel) ?? "gleich"} kennzahlen={kennzahlen} />
          ) : (
            <p className="zv-sub">Ein Feld anklicken, um mehr zu sehen.</p>
          )}
          <p className="zv-sub zv-fa-info-hinweis">
            {v.entwurf ? "Das ist der Entwurf. Ändern im Editor (Version wählen: Entwurf bearbeiten)." : "Nur zum Ansehen. Ändern über „Bearbeiten“, dann entsteht eine neue Version."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function feldArt(b: Baustein): string {
  switch (b.typ) {
    case "auswahl":
    case "mehrfachauswahl": {
      const sichtbar = b.optionen.filter((o) => !o.ausgeblendet).map((o) => o.label);
      const text = sichtbar.length > 4 ? `${sichtbar.slice(0, 4).join(", ")}, …` : sichtbar.join(", ");
      return `${BAUSTEIN_LABEL[b.typ]}${text ? `: ${text}` : ""}`;
    }
    case "skala":
      return `${BAUSTEIN_LABEL[b.typ]} ${b.min}–${b.max}`;
    case "zahl":
      return `${BAUSTEIN_LABEL[b.typ]}${b.einheit ? ` in ${b.einheit}` : ""}`;
    case "anzeige":
      return `Anzeige: ${DATENQUELLEN[b.quelle].label}`;
    case "hinweis":
      return "Hinweis";
    default:
      return istEingabe(b) && b.vorausfuellen ? `${BAUSTEIN_LABEL[b.typ]} · vorausgefüllt` : BAUSTEIN_LABEL[b.typ];
  }
}

function FeldInfo({
  b,
  def,
  versionen,
  v,
  vorher,
  stand,
  kennzahlen,
}: {
  b: Baustein;
  def: FormularDefinition;
  versionen: AufbauVersion[];
  v: AufbauVersion;
  vorher: AufbauVersion | null;
  stand: FeldStand;
  kennzahlen: FormularKennzahlenDto | null;
}) {
  // Seit welcher Version es den Schluessel gibt: aelteste Version, in der er vorkommt.
  const seit = [...versionen].reverse().find((x) => alleBausteine(x.definition).some((y) => y.schluessel === b.schluessel));
  const ausgefuellt = kennzahlen?.felder[String(v.nummer)]?.[b.schluessel] ?? 0;
  const pflicht = "pflicht" in b ? b.pflicht : undefined;
  return (
    <>
      <h3>{b.beschriftung || BAUSTEIN_LABEL[b.typ]}</h3>
      <dl className="zv-fa-info-liste">
        <dt>Baustein</dt>
        <dd>{BAUSTEIN_LABEL[b.typ]}</dd>
        <dt>Feldschlüssel</dt>
        <dd>
          <code>{b.schluessel}</code>
        </dd>
        <dt>Seit</dt>
        <dd>Version {seit?.nummer ?? v.nummer}</dd>
        {vorher && (
          <>
            <dt>In Version {v.nummer}</dt>
            <dd>{stand === "neu" ? <span className="zv-pill zv-pill-ok">neu</span> : stand === "geaendert" ? <span className="zv-pill zv-pill-frist">geändert</span> : `unverändert zu ${vorher.nummer}`}</dd>
          </>
        )}
        {istEingabe(b) && (
          <>
            <dt>Pflicht</dt>
            <dd>{pflicht === true ? "ja" : pflicht && typeof pflicht === "object" ? `wenn ${bedingungText(pflicht, def)}` : "nein"}</dd>
          </>
        )}
        <dt>Sichtbar</dt>
        <dd>{b.sichtbarWenn ? `wenn ${bedingungText(b.sichtbarWenn, def)}` : "immer (mit seinem Abschnitt)"}</dd>
        {istEingabe(b) && b.vorausfuellen && (
          <>
            <dt>Vorausgefüllt</dt>
            <dd>
              {DATENQUELLEN[b.vorausfuellen.quelle].label} ({b.vorausfuellen.art === "festgehalten" ? "festgehalten" : "Vorschlag"})
            </dd>
          </>
        )}
        {istEingabe(b) && (
          <>
            <dt>Nur intern</dt>
            <dd>{b.intern ? "ja, nie in Unterlagen für Externe" : "nein"}</dd>
          </>
        )}
        {(b.typ === "auswahl" || b.typ === "mehrfachauswahl") && (
          <>
            <dt>Optionen</dt>
            <dd>
              {b.optionen.map((o) => (
                <span key={o.wert} className={o.ausgeblendet ? "zv-fa-option-aus" : undefined}>
                  {o.label}
                  {o.ausgeblendet ? " (ausgeblendet)" : ""}
                </span>
              ))}
            </dd>
          </>
        )}
        {(istEingabe(b) || b.typ === "berechnung") && !v.entwurf && (
          <>
            <dt>Ausgefüllt</dt>
            <dd>{v.anzahlProtokolle === 0 ? "noch keine Protokolle" : `bei ${ausgefuellt} von ${v.anzahlProtokolle} Protokollen`}</dd>
          </>
        )}
        {b.hilfetext && (
          <>
            <dt>Hilfetext</dt>
            <dd>{b.hilfetext}</dd>
          </>
        )}
      </dl>
    </>
  );
}
