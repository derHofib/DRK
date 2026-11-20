import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  STANDORT_ANGEBOTSFORM_LABEL,
  STANDORT_ANGEBOTSFORM_RECHTSGRUNDLAGE,
  STANDORT_BARRIEREFREIHEIT_LABEL,
  STANDORT_BETREUUNGSUMFANG_LABEL,
  STANDORT_FEHLENDE_ANGABE_LABEL,
  type StandortAenderungDto,
  type StandortAngabenDto,
  type StandortFehlendeAngabe,
  type StandortSteckbriefDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { AktionsMenue } from "../components/AktionsMenue";
import { Datumsfeld } from "../components/Datumsfeld";
import { Modal } from "../components/Modal";
import { Reiterleiste, reiterPanelProps, type ReiterEintrag } from "../components/Reiterleiste";
import {
  IAbbrechen,
  IAktivieren,
  IAufklappen,
  IBearbeiten,
  IDeaktivieren,
  IFehler,
  IInfo,
  IKopieren,
  IOrganigramm,
  ISpeichern,
  ISperre,
  IStandort,
  ITelefonat,
  IZurueck,
} from "../components/icons";
import { formatDatum } from "../format";

/**
 * Standort-Steckbrief (Konzept standort-daten, Phase 1). Eigene Seite im
 * Inhaltsbereich statt Dialog oder Seitenpanel: zu viel Inhalt fuer 440 px,
 * und es gibt nichts Paralleles zu vergleichen. Aufbau bewusst wie die
 * Klientenakte (Kopf, Reiterleiste, Ueberblick zwei-/einspaltig nach
 * Container-Breite, Angaben als aufklappbare Gruppen mit Sprungliste) --
 * damit niemand etwas Neues lernen muss, und damit die CSS-Klassen der Akte
 * hier ohne zweite Fassung tragen.
 *
 * Plaetze, Leitung und Team kommen abgeleitet vom Server; eingetragen wird
 * hier nur, was es nirgends sonst gibt.
 */

type Reiter = "ueberblick" | "angaben";

type GruppeId = "grunddaten" | "anschrift" | "erreichbarkeit" | "lage" | "verwaltung" | "hinweise";

type FeldTyp = "text" | "textarea" | "datum" | "tel" | "email" | "plz" | "ik" | "auswahl";

interface Feld {
  key: keyof StandortAngabenDto;
  label: string;
  typ: FeldTyp;
  optionen?: Record<string, string>;
  pflicht?: boolean;
  /** Ueber beide Spalten des Dialogs. */
  breit?: boolean;
  platzhalter?: string;
}

interface Gruppe {
  id: GruppeId;
  titel: string;
  felder: Feld[];
}

const GRUPPEN: Gruppe[] = [
  {
    id: "grunddaten",
    titel: "Grunddaten",
    felder: [
      { key: "name", label: "Name", typ: "text", pflicht: true, breit: true },
      { key: "angebotsform", label: "Angebotsform", typ: "auswahl", optionen: STANDORT_ANGEBOTSFORM_LABEL },
      { key: "betreuungsumfang", label: "Betreuung", typ: "auswahl", optionen: STANDORT_BETREUUNGSUMFANG_LABEL },
      { key: "zielgruppe", label: "Zielgruppe", typ: "text", platzhalter: "z. B. Erwachsene mit seelischer Behinderung" },
      { key: "inBetriebSeit", label: "In Betrieb seit", typ: "datum" },
    ],
  },
  {
    id: "anschrift",
    titel: "Anschrift & Kontakt",
    felder: [
      { key: "strasse", label: "Straße und Hausnummer", typ: "text", pflicht: true, breit: true },
      { key: "plz", label: "PLZ", typ: "plz" },
      { key: "ort", label: "Ort", typ: "text" },
      { key: "telefon", label: "Telefon Büro", typ: "tel" },
      { key: "fax", label: "Fax", typ: "tel" },
      { key: "email", label: "E-Mail", typ: "email", breit: true },
    ],
  },
  {
    id: "erreichbarkeit",
    titel: "Erreichbarkeit",
    felder: [
      { key: "buerozeiten", label: "Bürozeiten", typ: "text", platzhalter: "z. B. Mo–Fr 8–16 Uhr", breit: true },
      { key: "bereitschaftTelefon", label: "Bereitschaftsnummer (24 h)", typ: "tel" },
      { key: "bereitschaftHinweis", label: "Hinweis zur Bereitschaft", typ: "text", platzhalter: "z. B. Diensthandy, nachts im Haus" },
    ],
  },
  {
    id: "lage",
    titel: "Lage & Zugang",
    felder: [
      { key: "barrierefreiheit", label: "Barrierefreiheit", typ: "auswahl", optionen: STANDORT_BARRIEREFREIHEIT_LABEL },
      { key: "barrierefreiheitHinweis", label: "Erläuterung", typ: "text", platzhalter: "z. B. EG und Aufzug" },
      { key: "oepnv", label: "ÖPNV-Anbindung", typ: "text", platzhalter: "z. B. Linie 3, Haltestelle Lindenplatz (3 Min. Fußweg)", breit: true },
      { key: "zugang", label: "Zugang", typ: "textarea", platzhalter: "z. B. Schlüssel im Schlüsselkasten Büro EG", breit: true },
    ],
  },
  {
    id: "verwaltung",
    titel: "Verwaltung",
    felder: [
      { key: "kostenstelle", label: "Kostenstelle", typ: "text" },
      { key: "ikNummer", label: "IK-Nummer", typ: "ik" },
    ],
  },
  {
    id: "hinweise",
    titel: "Hinweise",
    felder: [{ key: "hinweise", label: "Allgemeine Hinweise", typ: "textarea", breit: true }],
  },
];

/** Wo eine fehlende Angabe eingetragen wird. */
const FEHLT_IN_GRUPPE: Record<StandortFehlendeAngabe, GruppeId> = {
  angebotsform: "grunddaten",
  anschrift: "anschrift",
  telefon: "anschrift",
  bereitschaft: "erreichbarkeit",
};

/**
 * Vier oder mehr Ziffern am Stueck sehen nach einem Tuer- oder Alarmcode aus
 * (Konzept 3.5). Nur eine Warnung, kein Verbot: Hausnummern und Linien sind
 * auch Zahlen, das Abwaegen liegt bei der Leitung.
 */
const SIEHT_NACH_CODE_AUS = /\d{4,}/;

function angebotsformText(a: StandortAngabenDto): string | null {
  if (!a.angebotsform) return null;
  const recht = STANDORT_ANGEBOTSFORM_RECHTSGRUNDLAGE[a.angebotsform];
  return recht ? `${STANDORT_ANGEBOTSFORM_LABEL[a.angebotsform]} (${recht})` : STANDORT_ANGEBOTSFORM_LABEL[a.angebotsform];
}

function telLink(nummer: string): string {
  return `tel:${nummer.replace(/[^\d+]/g, "")}`;
}

function anzeigeWert(feld: Feld, a: StandortAngabenDto): string {
  const wert = a[feld.key];
  if (wert === null || wert === undefined || wert === "") return "–";
  if (feld.typ === "datum") return formatDatum(String(wert));
  if (feld.typ === "auswahl" && feld.optionen) return feld.optionen[String(wert)] ?? String(wert);
  return String(wert);
}

export function StandortSteckbrief({
  standortId,
  zurueckLabel,
  onZurueck,
  onGeaendert,
  onOrganigramm,
}: {
  standortId: string;
  zurueckLabel: string;
  onZurueck: () => void;
  /** Liste dahinter neu laden (Name, Status, fehlende Angaben). */
  onGeaendert?: () => void;
  onOrganigramm?: () => void;
}) {
  const [daten, setDaten] = useState<StandortSteckbriefDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [reiter, setReiter] = useState<Reiter>("ueberblick");
  const [bearbeiteteGruppe, setBearbeiteteGruppe] = useState<GruppeId | null>(null);
  const [aktivDialog, setAktivDialog] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  const laden = useCallback(() => {
    api
      .standortSteckbrief(standortId)
      .then((d) => {
        setDaten(d);
        setFehler(null);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Steckbrief konnte nicht geladen werden."));
  }, [standortId]);
  useEffect(laden, [laden]);

  function nachAenderung() {
    laden();
    onGeaendert?.();
  }

  function gruppeBearbeiten(id: GruppeId) {
    setReiter("angaben");
    setBearbeiteteGruppe(id);
  }

  async function aktivUmschalten() {
    if (!daten) return;
    try {
      await api.standortAktualisieren(daten.id, { aktiv: !daten.aktiv });
      setAktivDialog(false);
      nachAenderung();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Standort konnte nicht geändert werden.");
    }
  }

  async function anschriftKopieren(a: StandortAngabenDto) {
    const text = [a.name, a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(true);
      window.setTimeout(() => setKopiert(false), 2000);
    } catch {
      setFehler("Die Anschrift konnte nicht kopiert werden.");
    }
  }

  const a = daten?.angaben;
  const mitVerwaltung = !!a && "kostenstelle" in a;
  const gruppen = GRUPPEN.filter((g) => g.id !== "verwaltung" || mitVerwaltung);
  const reiterListe: ReiterEintrag<Reiter>[] = [
    { wert: "ueberblick", label: "Überblick" },
    { wert: "angaben", label: "Angaben", zaehler: daten?.fehlendeAngaben.length || undefined },
  ];

  return (
    <div className="zv-akte zv-steckbrief">
      <button className="zv-link-btn zv-steckbrief-zurueck" onClick={onZurueck}>
        <IZurueck />
        {zurueckLabel}
      </button>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {daten && a && (
        <>
          <header className="zv-akte-kopf">
            <span className="zv-initialen-kachel" aria-hidden="true">
              <IStandort />
            </span>
            <div className="zv-akte-titel">
              <h2>
                {a.name}
                <span className={`zv-pill ${daten.aktiv ? "zv-pill-zugeordnet" : "zv-pill-neutral"}`}>
                  {daten.aktiv ? "Aktiv" : "Inaktiv"}
                </span>
              </h2>
              <p className="zv-akte-meta">
                {[
                  angebotsformText(a),
                  daten.adresse,
                  `${daten.plaetze.belegt} von ${daten.plaetze.eingerichtet} Plätzen belegt`,
                  a.kostenstelle ? `Kostenstelle ${a.kostenstelle}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {daten.darfBearbeiten && (
              <div className="zv-akte-aktionen">
                <AktionsMenue label="Weitere Aktionen zum Standort">
                  <button type="button" role="menuitem" onClick={() => gruppeBearbeiten("grunddaten")}>
                    <IBearbeiten />
                    Angaben bearbeiten
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={daten.aktiv ? "zv-menue-gefahr" : undefined}
                    onClick={() => setAktivDialog(true)}
                  >
                    {daten.aktiv ? <IDeaktivieren /> : <IAktivieren />}
                    {daten.aktiv ? "Deaktivieren …" : "Wieder aktivieren …"}
                  </button>
                </AktionsMenue>
              </div>
            )}
          </header>

          <Reiterleiste label="Bereiche des Steckbriefs" idPraefix="steckbrief" reiter={reiterListe} aktiv={reiter} onWahl={setReiter} />

          <div {...reiterPanelProps("steckbrief", reiter)}>
            {reiter === "ueberblick" ? (
              <Ueberblick
                daten={daten}
                angaben={a}
                kopiert={kopiert}
                onKopieren={() => anschriftKopieren(a)}
                onBearbeiten={daten.darfBearbeiten ? gruppeBearbeiten : undefined}
                onOrganigramm={onOrganigramm}
              />
            ) : (
              <Angaben
                gruppen={gruppen}
                angaben={a}
                darfBearbeiten={daten.darfBearbeiten}
                onBearbeiten={setBearbeiteteGruppe}
              />
            )}
          </div>

          {bearbeiteteGruppe && (
            <GruppeBearbeiten
              standortId={daten.id}
              gruppe={GRUPPEN.find((g) => g.id === bearbeiteteGruppe)!}
              angaben={a}
              onSchliessen={() => setBearbeiteteGruppe(null)}
              onGespeichert={() => {
                setBearbeiteteGruppe(null);
                nachAenderung();
              }}
            />
          )}

          {aktivDialog && (
            <Modal titel={daten.aktiv ? "Standort deaktivieren" : "Standort wieder aktivieren"} onClose={() => setAktivDialog(false)}>
              <p style={{ marginTop: 0 }}>
                {daten.aktiv
                  ? "Hier können danach keine neuen Zimmer mehr angelegt werden. Bestehende Zimmer, Belegungen und der Steckbrief bleiben sichtbar; das lässt sich jederzeit rückgängig machen."
                  : "Der Standort steht danach wieder für neue Zimmer zur Verfügung."}
              </p>
              <button className={`zv-btn zv-btn-block${daten.aktiv ? " zv-btn-gefahr" : ""}`} onClick={aktivUmschalten}>
                {daten.aktiv ? <IDeaktivieren /> : <IAktivieren />}
                {daten.aktiv ? "Jetzt deaktivieren" : "Jetzt aktivieren"}
              </button>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function Wert({ children }: { children: ReactNode }) {
  return <>{children === null || children === undefined || children === "" ? "–" : children}</>;
}

function Ueberblick({
  daten,
  angaben: a,
  kopiert,
  onKopieren,
  onBearbeiten,
  onOrganigramm,
}: {
  daten: StandortSteckbriefDto;
  angaben: StandortAngabenDto;
  kopiert: boolean;
  onKopieren: () => void;
  onBearbeiten?: (g: GruppeId) => void;
  onOrganigramm?: () => void;
}) {
  const blick: [string, ReactNode][] = [
    ["Angebotsform", a.angebotsform ? STANDORT_ANGEBOTSFORM_LABEL[a.angebotsform] : null],
    ["Rechtsgrundlage", a.angebotsform ? STANDORT_ANGEBOTSFORM_RECHTSGRUNDLAGE[a.angebotsform] : null],
    ["Plätze", `${daten.plaetze.belegt} belegt · ${daten.plaetze.eingerichtet} eingerichtet`],
    ["Betreuung", a.betreuungsumfang ? STANDORT_BETREUUNGSUMFANG_LABEL[a.betreuungsumfang] : null],
    ["In Betrieb seit", a.inBetriebSeit ? formatDatum(a.inBetriebSeit) : null],
    [
      "Barrierefreiheit",
      a.barrierefreiheit
        ? [STANDORT_BARRIEREFREIHEIT_LABEL[a.barrierefreiheit], a.barrierefreiheitHinweis ? `(${a.barrierefreiheitHinweis})` : null]
            .filter(Boolean)
            .join(" ")
        : null,
    ],
  ];
  if (a.zielgruppe) blick.push(["Zielgruppe", a.zielgruppe]);
  // Nur mit standorte.bearbeiten im JSON -- sonst fehlt die Zeile ganz.
  if ("kostenstelle" in a) blick.push(["Kostenstelle", a.kostenstelle]);
  if ("ikNummer" in a) blick.push(["IK-Nummer", a.ikNummer]);

  const achtung = daten.fehlendeAngaben.map((f) => ({
    schluessel: f,
    titel: `Angabe fehlt: ${STANDORT_FEHLENDE_ANGABE_LABEL[f]}`,
    meta: `Angaben › ${GRUPPEN.find((g) => g.id === FEHLT_IN_GRUPPE[f])!.titel}`,
    gruppe: FEHLT_IN_GRUPPE[f],
  }));

  const notfallNummern = [
    a.bereitschaftTelefon ? { label: "Bereitschaft anrufen", nummer: a.bereitschaftTelefon, haupt: true } : null,
    a.telefon ? { label: "Büro", nummer: a.telefon, haupt: !a.bereitschaftTelefon } : null,
  ].filter((n): n is { label: string; nummer: string; haupt: boolean } => n !== null);

  return (
    <div className="zv-ueberblick zv-steckbrief-ueberblick">
      <div className="zv-ueberblick-haupt">
        {/* Nur in schmaler Ansicht (Handy, siehe app.css): wer nachts den
            Steckbrief oeffnet, sucht eine Nummer, keine Tabelle. */}
        {notfallNummern.length > 0 && (
          <section className="zv-steckbrief-notfall" aria-label="Im Notfall">
            <div className="zv-abschnittskopf">
              <h3>Im Notfall</h3>
            </div>
            {notfallNummern.map((n) => (
              <a key={n.label} className={`zv-btn zv-btn-block${n.haupt ? "" : " zv-btn-sekundaer"}`} href={telLink(n.nummer)}>
                <ITelefonat />
                {n.label} · {n.nummer}
              </a>
            ))}
            {a.bereitschaftHinweis && <p className="zv-sub">{a.bereitschaftHinweis}</p>}
          </section>
        )}

        <section className="zv-steckbrief-erreichbarkeit" aria-label="Erreichbarkeit">
          <div className="zv-abschnittskopf">
            <h3>Erreichbarkeit</h3>
            {onBearbeiten && (
              <button type="button" className="zv-link-btn" onClick={() => onBearbeiten("erreichbarkeit")}>
                <IBearbeiten />
                Bearbeiten
              </button>
            )}
          </div>
          <dl className="zv-kennwerte">
            <div>
              <dt>Telefon Büro</dt>
              <dd>{a.telefon ? <a href={telLink(a.telefon)}>{a.telefon}</a> : "–"}</dd>
            </div>
            <div>
              <dt>E-Mail</dt>
              <dd>{a.email ? <a href={`mailto:${a.email}`}>{a.email}</a> : "–"}</dd>
            </div>
            <div>
              <dt>Fax</dt>
              <dd>
                <Wert>{a.fax}</Wert>
              </dd>
            </div>
            <div>
              <dt>Bürozeiten</dt>
              <dd>
                <Wert>{a.buerozeiten}</Wert>
              </dd>
            </div>
            <div>
              <dt>Bereitschaft (24 h)</dt>
              <dd className="zv-steckbrief-wichtig">
                {a.bereitschaftTelefon ? <a href={telLink(a.bereitschaftTelefon)}>{a.bereitschaftTelefon}</a> : "–"}
              </dd>
            </div>
            <div>
              <dt>Bereitschaft Hinweis</dt>
              <dd>
                <Wert>{a.bereitschaftHinweis}</Wert>
              </dd>
            </div>
          </dl>
        </section>

        <section className="zv-steckbrief-leitung" aria-label="Leitung und Team">
          <div className="zv-abschnittskopf">
            <h3>Leitung & Team</h3>
            {onOrganigramm && (
              <button type="button" className="zv-link-btn" onClick={onOrganigramm}>
                <IOrganigramm />
                Im Organigramm
              </button>
            )}
          </div>
          <ul className="zv-rand-liste zv-ueberblick-liste">
            {daten.leitung.length === 0 ? (
              <li>
                <span className="zv-todo-titel">Keine Leitung im Organigramm</span>
                <span className="zv-todo-meta">Die Leitung ergibt sich aus der besetzten Position am Standort im Organigramm.</span>
              </li>
            ) : (
              daten.leitung.map((l) => (
                <li key={`${l.benutzerId}-${l.positionTitel}`}>
                  <span className="zv-todo-titel">{l.name}</span>
                  <span className="zv-todo-meta">{l.positionTitel}</span>
                </li>
              ))
            )}
            <li>
              <span className="zv-todo-titel">
                {daten.team.anzahl === 1 ? "1 Mitarbeitende:r" : `${daten.team.anzahl} Mitarbeitende`}
              </span>
              <span className="zv-todo-meta">diesem Standort zugeordnet</span>
            </li>
          </ul>
        </section>
      </div>

      <div className="zv-ueberblick-rand">
        <section className="zv-steckbrief-blick" aria-label="Auf einen Blick">
          <div className="zv-abschnittskopf">
            <h3>Auf einen Blick</h3>
          </div>
          <dl className="zv-kennwerte">
            {blick.map(([label, wert]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <Wert>{wert}</Wert>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {achtung.length > 0 && (
          <section className="zv-steckbrief-achtung" aria-label="Braucht Aufmerksamkeit">
            <div className="zv-abschnittskopf">
              <h3>Braucht Aufmerksamkeit</h3>
            </div>
            <ul className="zv-achtung-liste">
              {achtung.map((e) => (
                <li key={e.schluessel}>
                  {onBearbeiten ? (
                    <button type="button" className="zv-achtung-eintrag" onClick={() => onBearbeiten(e.gruppe)}>
                      <span className="zv-todo-titel">{e.titel}</span>
                      <span className="zv-todo-meta">{e.meta}</span>
                    </button>
                  ) : (
                    <div className="zv-achtung-eintrag">
                      <span className="zv-todo-titel">{e.titel}</span>
                      <span className="zv-todo-meta">{e.meta}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="zv-steckbrief-lage" aria-label="Lage und Zugang">
          <div className="zv-abschnittskopf">
            <h3>Lage & Zugang</h3>
            <button type="button" className="zv-link-btn" onClick={onKopieren}>
              <IKopieren />
              {kopiert ? "Kopiert" : "Anschrift kopieren"}
            </button>
          </div>
          <dl className="zv-kennwerte zv-steckbrief-lage-liste">
            <div>
              <dt>Anschrift</dt>
              <dd>
                {a.strasse}
                <br />
                {a.plz && a.ort ? `${a.plz} ${a.ort}` : <span className="zv-steckbrief-unvollstaendig">PLZ und Ort fehlen</span>}
              </dd>
            </div>
            {a.oepnv && (
              <div>
                <dt>ÖPNV</dt>
                <dd>{a.oepnv}</dd>
              </div>
            )}
            {a.zugang && (
              <div>
                <dt>Zugang</dt>
                <dd className="zv-steckbrief-mehrzeilig">{a.zugang}</dd>
              </div>
            )}
            {a.hinweise && (
              <div>
                <dt>Hinweise</dt>
                <dd className="zv-steckbrief-mehrzeilig">{a.hinweise}</dd>
              </div>
            )}
          </dl>
          <p className="zv-sub zv-steckbrief-codehinweis">
            <ISperre />
            Tür-, Tresor- und Alarmcodes stehen bewusst nicht in der Zimmerakte.
          </p>
        </section>
      </div>
    </div>
  );
}

function gruppenAnker(id: GruppeId) {
  return `steckbrief-gruppe-${id}`;
}

function Angaben({
  gruppen,
  angaben,
  darfBearbeiten,
  onBearbeiten,
}: {
  gruppen: Gruppe[];
  angaben: StandortAngabenDto;
  darfBearbeiten: boolean;
  onBearbeiten: (g: GruppeId) => void;
}) {
  return (
    <div className="zv-stammdaten">
      <nav className="zv-stammdaten-sprung" aria-label="Abschnitte der Angaben">
        {gruppen.map((g) => (
          <button
            key={g.id}
            type="button"
            className="zv-link-btn"
            onClick={() => {
              const el = document.getElementById(gruppenAnker(g.id)) as HTMLDetailsElement | null;
              if (!el) return;
              el.open = true;
              el.scrollIntoView({ block: "start" });
            }}
          >
            {g.titel}
          </button>
        ))}
      </nav>
      <div className="zv-stammdaten-gruppen">
        {gruppen.map((g) => (
          <details key={g.id} className="zv-card zv-card-weit zv-stammdaten-gruppe" id={gruppenAnker(g.id)} open>
            <summary>
              <h3>{g.titel}</h3>
              <IAufklappen />
            </summary>
            {darfBearbeiten && (
              <div className="zv-stammdaten-gruppe-kopf">
                <button className="zv-link-btn" onClick={() => onBearbeiten(g.id)}>
                  <IBearbeiten />
                  Bearbeiten
                </button>
              </div>
            )}
            <dl className="zv-angaben-liste">
              {g.felder.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd className={f.typ === "textarea" ? "zv-steckbrief-mehrzeilig" : undefined}>{anzeigeWert(f, angaben)}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    </div>
  );
}

function GruppeBearbeiten({
  standortId,
  gruppe,
  angaben,
  onSchliessen,
  onGespeichert,
}: {
  standortId: string;
  gruppe: Gruppe;
  angaben: StandortAngabenDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [codeVerdacht, setCodeVerdacht] = useState<Partial<Record<keyof StandortAngabenDto, boolean>>>(() =>
    Object.fromEntries(gruppe.felder.map((f) => [f.key, SIEHT_NACH_CODE_AUS.test(String(angaben[f.key] ?? ""))]))
  );

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const aenderung: Record<string, string | null> = {};
    for (const f of gruppe.felder) {
      const wert = String(form.get(f.key) ?? "").trim();
      // Auswahlfelder: "" ist kein gueltiger Wert der festen Liste, sondern "nicht angegeben".
      aenderung[f.key] = f.typ === "auswahl" && wert === "" ? null : wert;
    }
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.standortAktualisieren(standortId, aenderung as StandortAenderungDto);
      onGespeichert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Angaben konnten nicht gespeichert werden.");
      setWirdGespeichert(false);
    }
  }

  const freitextMitCodePruefung = new Set<keyof StandortAngabenDto>(["zugang", "hinweise"]);

  return (
    <Modal titel={`${gruppe.titel} bearbeiten`} onClose={onSchliessen} breit>
      <form onSubmit={speichern} className="zv-angaben-formular">
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler zv-angaben-voll">
            <IFehler />
            {fehler}
          </div>
        )}
        {gruppe.felder.map((f) => {
          const id = `standort-${f.key}`;
          const vorgabe = angaben[f.key] ?? "";
          const hinweisId = `${id}-hinweis`;
          const codeWarnung = freitextMitCodePruefung.has(f.key) && codeVerdacht[f.key];
          return (
            <div key={f.key} className={`zv-field${f.breit ? " zv-angaben-voll" : ""}`}>
              <label htmlFor={id}>{f.label}</label>
              {f.typ === "auswahl" ? (
                <select id={id} name={f.key} defaultValue={String(vorgabe)}>
                  <option value="">Nicht angegeben</option>
                  {Object.entries(f.optionen ?? {}).map(([wert, label]) => (
                    <option key={wert} value={wert}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : f.typ === "datum" ? (
                <Datumsfeld id={id} name={f.key} defaultValue={String(vorgabe)} />
              ) : f.typ === "textarea" ? (
                <textarea
                  id={id}
                  name={f.key}
                  rows={3}
                  defaultValue={String(vorgabe)}
                  placeholder={f.platzhalter}
                  aria-describedby={codeWarnung ? hinweisId : undefined}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    setCodeVerdacht((alt) => ({ ...alt, [f.key]: SIEHT_NACH_CODE_AUS.test(v) }));
                  }}
                />
              ) : (
                <input
                  id={id}
                  name={f.key}
                  type={f.typ === "email" ? "email" : f.typ === "tel" ? "tel" : "text"}
                  inputMode={f.typ === "plz" || f.typ === "ik" ? "numeric" : undefined}
                  pattern={f.typ === "plz" ? "[0-9]{5}" : f.typ === "ik" ? "[0-9]{9}" : undefined}
                  title={f.typ === "plz" ? "Fünf Ziffern" : f.typ === "ik" ? "Neun Ziffern" : undefined}
                  maxLength={f.typ === "plz" ? 5 : f.typ === "ik" ? 9 : undefined}
                  defaultValue={String(vorgabe)}
                  placeholder={f.platzhalter}
                  required={f.pflicht}
                  aria-describedby={codeWarnung ? hinweisId : undefined}
                  onInput={
                    freitextMitCodePruefung.has(f.key)
                      ? (e) => {
                          const v = e.currentTarget.value;
                          setCodeVerdacht((alt) => ({ ...alt, [f.key]: SIEHT_NACH_CODE_AUS.test(v) }));
                        }
                      : undefined
                  }
                />
              )}
              {codeWarnung && (
                <div id={hinweisId} className="zv-hinweis zv-hinweis-fehler zv-angaben-feldhinweis" role="status">
                  <IFehler />
                  Das sieht nach einem Zahlencode aus. Tür-, Tresor- und Alarmcodes bitte nicht hier speichern: jede:r mit Zugriff auf
                  den Standort sieht diesen Text.
                </div>
              )}
              {f.key === "bereitschaftTelefon" && (
                <div className="zv-hinweis zv-hinweis-info zv-angaben-feldhinweis">
                  <IInfo />
                  Bitte eine dienstliche Nummer eintragen. Private Handynummern von Mitarbeitenden gehören nicht in den Steckbrief.
                </div>
              )}
              {f.key === "hinweise" && (
                <p className="zv-sub">Keine Angaben zu Klient:innen: den Steckbrief sehen alle, die den Standort sehen.</p>
              )}
            </div>
          );
        })}
        <div className="zv-vorschau-zeile zv-angaben-voll">
          <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
            <ISpeichern />
            {wirdGespeichert ? "Speichert…" : "Speichern"}
          </button>
          <button className="zv-btn zv-btn-still" type="button" onClick={onSchliessen}>
            <IAbbrechen />
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  );
}
