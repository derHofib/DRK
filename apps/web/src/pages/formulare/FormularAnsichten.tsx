import { useEffect, useMemo, useState } from "react";
import {
  ANHEFT_DARSTELLUNG_LABEL,
  type FeldWert,
  type FeldWerte,
  type FormularDetailDto,
  type FormularKennzahlenDto,
  type ProtokollDto,
} from "@zimmerakte/shared";
import { api } from "../../api/client";
import { ProtokollAnsicht, ProtokollEingabe } from "../../components/ProtokollFormular";
import { IFehler, IInfo, IZuruecksetzen } from "../../components/icons";
import { formatDatum, formatUhrzeit } from "../../format";
import { aufbauVersionen, VersionWahl } from "./FormularAufbau";
import { BEISPIEL_PERSON, beispielDaten } from "./formularHilfen";

/**
 * Reiter „Ansichten“ (Bild 3 und 4 im Konzept „Aufbau Formular“): wie das
 * Formular aussieht, in jeder Darstellung, die es gibt -- ohne ein echtes
 * Protokoll anzulegen. Es sind dieselben Komponenten wie beim echten
 * Ausfuellen und Lesen, keine Nachbildung: sonst gaebe es zwei Wahrheiten
 * ueber das Aussehen. Gespeichert wird hier nichts.
 *
 * PDF-Ansichten gibt es noch nicht (eigener Schritt, Konzept Frage 2); sie
 * stehen ausgegraut in der Liste, damit sichtbar ist, wo sie hinkommen.
 */

type Ansicht = "rechner" | "handy" | "akte" | "tagesbericht";
type Daten = "leer" | "beispiel" | "echt";

const ANSICHTEN: { wert: Ansicht; label: string; text: string }[] = [
  { wert: "rechner", label: "Ausfüllen am Rechner", text: "So füllen Kolleg:innen das Formular am Rechner aus, in der Klientenakte unter Protokolle." },
  {
    wert: "handy",
    label: "Ausfüllen am Handy",
    text: "Dasselbe Formular in Handybreite. Pflichtfelder haben einen Stern, Regeln wirken sofort: was nur unter einer Bedingung gefragt wird, erscheint erst dann.",
  },
  { wert: "akte", label: "Lesen in der Akte", text: "So steht ein abgeschlossenes Protokoll in der Klientenakte. Verborgene Felder fehlen, so wie sie auch nicht gespeichert werden." },
  { wert: "tagesbericht", label: "Im Tagesbericht", text: "So erscheint das Formular beim Anlegen eines Tagesberichts." },
];

export function FormularAnsichten({ d, kennzahlen }: { d: FormularDetailDto; kennzahlen: FormularKennzahlenDto | null }) {
  const versionen = useMemo(() => aufbauVersionen(d), [d]);
  const [ansicht, setAnsicht] = useState<Ansicht>("rechner");
  const [daten, setDaten] = useState<Daten>("beispiel");
  const [versionNr, setVersionNr] = useState<number>(d.veroeffentlichteVersion ?? versionen[0]?.nummer ?? 1);
  const [echtId, setEchtId] = useState<string>("");
  const [echt, setEcht] = useState<ProtokollDto | null>(null);
  const [echtFehler, setEchtFehler] = useState<string | null>(null);
  const [werte, setWerte] = useState<FeldWerte>({});
  const anheftungTb = d.anheftungen.find((a) => a.anheftpunkt === "tagesbericht");
  const v = versionen.find((x) => x.nummer === versionNr) ?? versionen[0];
  const definition = v?.definition ?? { bausteine: [] };
  const beispiel = useMemo(() => beispielDaten(definition), [definition]);

  useEffect(() => {
    if (daten !== "echt" || !echtId) {
      setEcht(null);
      return;
    }
    let aktiv = true;
    setEchtFehler(null);
    api
      .protokoll(echtId)
      .then((p) => aktiv && setEcht(p))
      .catch((err) => aktiv && setEchtFehler(err instanceof Error ? err.message : "Protokoll konnte nicht geladen werden."));
    return () => {
      aktiv = false;
    };
  }, [daten, echtId]);

  // Ausgangswerte je Datenwahl; danach darf man in der Vorschau frei tippen (Regeln testen).
  const ausgang: FeldWerte = daten === "beispiel" ? beispiel.werte : daten === "echt" && echt ? echt.werte : {};
  useEffect(() => setWerte(ausgang), [daten, echt, beispiel]);
  const anzeige = daten === "beispiel" ? beispiel.anzeige : daten === "echt" && echt ? echt.anzeige : {};
  const personen = { ...beispiel.personen, ...(echt?.personen ?? {}) };
  const aendern = (k: string, w: FeldWert | null) =>
    setWerte((alt) => {
      const neu = { ...alt };
      if (w === null) delete neu[k];
      else neu[k] = w;
      return neu;
    });

  if (!v) return <p className="zv-sub">Dieses Formular hat noch keine Version.</p>;

  const eingabe = (praefix: string) => (
    <ProtokollEingabe
      definition={definition}
      werte={werte}
      anzeige={anzeige}
      personen={personen}
      auswahlPersonen={[BEISPIEL_PERSON]}
      fehler={{}}
      onAendern={aendern}
      idPraefix={praefix}
    />
  );
  const beschreibung = ANSICHTEN.find((a) => a.wert === ansicht)!;

  return (
    <div className="zv-fv">
      <nav className="zv-fo-karte zv-fv-liste" aria-label="Ansichten">
        <div className="zv-gruppenlabel">Bildschirm</div>
        {ANSICHTEN.filter((a) => a.wert !== "tagesbericht" || anheftungTb).map((a) => (
          <button key={a.wert} type="button" className={ansicht === a.wert ? "active" : ""} aria-current={ansicht === a.wert ? "true" : undefined} onClick={() => setAnsicht(a.wert)}>
            <span>{a.label}</span>
            <span className="zv-sub">{a.wert === "tagesbericht" ? "angeheftet" : "automatisch"}</span>
          </button>
        ))}
        <div className="zv-gruppenlabel">PDF</div>
        <button type="button" disabled aria-disabled="true">
          <span>Standard-PDF</span>
          <span className="zv-pill">später</span>
        </button>
        <button type="button" disabled aria-disabled="true">
          <span>Eigene Druckansichten</span>
          <span className="zv-pill">später</span>
        </button>
        <p className="zv-sub zv-fv-liste-hinweis">PDF und eigene Druckansichten (z. B. „Für das Amt“ ohne interne Felder) kommen in einem eigenen Schritt.</p>
      </nav>

      <div className="zv-fv-haupt">
        <div className="zv-fv-leiste">
          <div className="zv-fa-wahl">
            <span className="zv-sub">Daten</span>
            <div className="zv-segmented" role="group" aria-label="Daten">
              {(
                [
                  ["leer", "Leer"],
                  ["beispiel", "Beispieldaten"],
                  ["echt", "Echtes Protokoll"],
                ] as [Daten, string][]
              ).map(([w, l]) => (
                <button
                  key={w}
                  type="button"
                  className={daten === w ? "active" : ""}
                  aria-pressed={daten === w}
                  disabled={w === "echt" && !kennzahlen?.letzte.length}
                  title={w === "echt" && !kennzahlen?.letzte.length ? "Noch kein abgeschlossenes Protokoll, das Sie sehen dürfen." : undefined}
                  onClick={() => {
                    setDaten(w);
                    if (w === "echt" && !echtId && kennzahlen?.letzte[0]) setEchtId(kennzahlen.letzte[0].id);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {daten === "echt" && kennzahlen && kennzahlen.letzte.length > 0 && (
            <div className="zv-field zv-fv-echt">
              <label htmlFor="zv-fv-echt" className="zv-sr-only">
                Protokoll
              </label>
              <select id="zv-fv-echt" value={echtId} onChange={(e) => setEchtId(e.target.value)}>
                {kennzahlen.letzte.map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatDatum(l.abgeschlossenAm.slice(0, 10))}, {formatUhrzeit(l.abgeschlossenAm)} · {l.klientInitialen} · Version {l.versionNummer}
                  </option>
                ))}
              </select>
            </div>
          )}
          <VersionWahl versionen={versionen} gewaehlt={v.nummer} onWaehlen={setVersionNr} />
          <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={() => setWerte(ausgang)}>
            <IZuruecksetzen size={14} />
            Zurücksetzen
          </button>
        </div>
        {echtFehler && (
          <p className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {echtFehler}
          </p>
        )}
        {daten === "echt" && echt && echt.versionNummer !== v.nummer && (
          <p className="zv-hinweis zv-hinweis-info">
            <IInfo />
            Das Protokoll wurde mit Version {echt.versionNummer} ausgefüllt und wird hier in Version {v.nummer} gezeigt. Felder, die es damals nicht gab, bleiben leer.
          </p>
        )}

        <div className={`zv-fv-buehne zv-fv-buehne-${ansicht}`}>
          {ansicht === "handy" ? (
            <div className="zv-fv-handy" aria-label="Vorschau in Handybreite">
              <div className="zv-fv-handy-kopf">
                <span className="zv-sub">{anzeigeKlient(daten, echt)}</span>
                <strong>{d.name}</strong>
              </div>
              {eingabe("zv-fv-h-")}
            </div>
          ) : ansicht === "rechner" ? (
            <div className="zv-fv-rechner">
              <h3>{d.name}</h3>
              {eingabe("zv-fv-r-")}
            </div>
          ) : ansicht === "akte" ? (
            <div className="zv-fv-rechner">
              <h3>
                {d.name} <span className="zv-sub">Version {v.nummer}</span>
              </h3>
              <ProtokollAnsicht definition={definition} werte={werte} anzeige={anzeige} personen={personen} />
            </div>
          ) : (
            <div className="zv-fv-rechner">
              <h3>Tagesbericht anlegen</h3>
              {anheftungTb?.darstellung === "ersetzt" ? (
                <p className="zv-sub">{ANHEFT_DARSTELLUNG_LABEL.ersetzt}: Das Formular ist der Tagesbericht, ein Freitext ist nur noch eine optionale Bemerkung.</p>
              ) : (
                <div className="zv-field">
                  <label htmlFor="zv-fv-tb-text">Was war heute? *</label>
                  <textarea id="zv-fv-tb-text" rows={3} disabled placeholder="Freitext des Tagesberichts" />
                </div>
              )}
              <div className="zv-fv-tb-formular">
                <h4>
                  {d.name}
                  {anheftungTb?.pflicht && <span className="zv-pill zv-pill-frist">Pflicht</span>}
                  {anheftungTb?.modus === "dazunehmen" && <span className="zv-pill">zum Dazunehmen per Knopf</span>}
                </h4>
                {eingabe("zv-fv-t-")}
              </div>
            </div>
          )}
          <aside className="zv-fv-text">
            <h3>{beschreibung.label}</h3>
            <p className="zv-sub">{beschreibung.text}</p>
            <p className="zv-sub">Sie können in der Vorschau ausprobieren, wie Regeln wirken. Es wird nichts gespeichert; „Zurücksetzen“ stellt die gewählten Daten wieder her.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function anzeigeKlient(daten: Daten, echt: ProtokollDto | null): string {
  if (daten === "echt" && echt) return `Protokoll vom ${formatDatum(echt.bezugsdatum)}`;
  if (daten === "beispiel") return "M. B. · Haus Beispiel";
  return "Klient:in";
}
