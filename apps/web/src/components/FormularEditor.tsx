import { useMemo, useState, type ReactNode } from "react";
import {
  alleBausteine,
  BAUSTEIN_LABEL,
  bedingungAlsSatz,
  DATENQUELLEN,
  ZUORDNUNG_ERKLAERUNG,
  ZUORDNUNG_LABEL,
  quelleBrauchtKlient,
  zuordnungKenntKlient,
  zuordnungVon,
  type FormularZuordnung,
  datentypVon,
  istEingabe,
  pruefeVeroeffentlichung,
  pruefeWerte,
  schluesselAusBeschriftung,
  speichernderBaustein,
  type Ausdruck,
  type Baustein,
  type BausteinTyp,
  type Bedingung,
  type BedingungOperator,
  type Datenquelle,
  type FeldWert,
  type FeldWerte,
  type FormularDefinition,
  type Option,
  type Vergleichspruefung,
} from "@zimmerakte/shared";
import { ProtokollEingabe } from "./ProtokollFormular";
import { IBestaetigen, ILoeschen, INeu, ISperre, IVerborgen, IVerschiebenHoch, IVerschiebenRunter, ISichtbar } from "./icons";
import { Datumsfeld } from "./Datumsfeld";

/**
 * Formular-Editor (Konzept Formulare, Abschnitt 5): links der Bausteinkasten,
 * in der Mitte der Aufbau (oder "Ausprobieren" wie beim Ausfuellen), rechts
 * die Eigenschaften des gewaehlten Bausteins.
 *
 * Gesteuert von aussen (definition/onAendern): die Seite speichert den
 * Entwurf automatisch und muss vor dem Veroeffentlichen sicher sein, dass der
 * letzte Stand auf dem Server liegt -- das geht nur, wenn sie ihn haelt.
 *
 * Logik wird nur aus Saetzen und einer festen Funktionsliste gebaut, nie als
 * freier Ausdruck: wer ein Formular baut, ist keine Programmierer:in, und der
 * Auswerter in packages/shared kennt ohnehin nur diese Formen.
 */

type Pfad = number[];

const KASTEN: { titel: string; typen: BausteinTyp[] }[] = [
  { titel: "Aufbau", typen: ["abschnitt", "hinweis", "anzeige"] },
  { titel: "Eingaben", typen: ["kurztext", "langtext", "zahl", "datum", "uhrzeit", "ja_nein", "auswahl", "mehrfachauswahl", "skala", "mitarbeitende"] },
  { titel: "Rechnen", typen: ["berechnung"] },
];

/** Beispielwerte fuer "Ausprobieren": erfunden, damit nie echte Daten im Editor stehen. */
const BEISPIEL: Record<Datenquelle, string> = {
  "klient.name": "Erika Beispiel",
  "klient.vorname": "Erika",
  "klient.nachname": "Beispiel",
  "klient.initialen": "E. B.",
  "klient.geburtsdatum": "1980-04-12",
  "klient.alter": "46",
  "klient.aktenzeichen": "AZ-0000",
  "klient.amt": "Beispielamt",
  "klient.bezugsbetreuung": "Max Muster",
  "belegung.standort": "Haus Beispiel",
  "belegung.zimmer": "Zimmer 1",
  "belegung.wohnung": "Haus Beispiel, Zimmer 1",
  "ausfuellende.name": "Sie selbst",
  "zeit.heute": new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()),
  "zeit.jetzt": new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date()),
};

// ---------------------------------------------------------------------------
// Baum-Hilfen
// ---------------------------------------------------------------------------

function finde(liste: Baustein[], schluessel: string, pfad: Pfad = []): Pfad | null {
  for (let i = 0; i < liste.length; i++) {
    const b = liste[i];
    if (b.schluessel === schluessel) return [...pfad, i];
    if (b.typ === "abschnitt") {
      const t = finde(b.kinder, schluessel, [...pfad, i]);
      if (t) return t;
    }
  }
  return null;
}

function holen(liste: Baustein[], pfad: Pfad): Baustein {
  const b = liste[pfad[0]];
  return pfad.length === 1 || b.typ !== "abschnitt" ? b : holen(b.kinder, pfad.slice(1));
}

function mitKindern(liste: Baustein[], eltern: Pfad, fn: (kinder: Baustein[]) => Baustein[]): Baustein[] {
  if (eltern.length === 0) return fn(liste);
  const [i, ...rest] = eltern;
  return liste.map((b, j) => (j === i && b.typ === "abschnitt" ? { ...b, kinder: mitKindern(b.kinder, rest, fn) } : b));
}

/**
 * Ein Feldschluessel kommt ausser am Baustein selbst in Bedingungen,
 * Formeln, Vergleichen und im Bezugsdatum vor. Beim Umbenennen muessen alle
 * mit -- sonst zeigte eine Bedingung danach ins Leere.
 */
function verweiseUmbenennen(def: FormularDefinition, alt: string, neu: string): FormularDefinition {
  const lauf = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(lauf);
    if (!x || typeof x !== "object") return x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      out[k] = (k === "feld" || k === "von" || k === "bis") && v === alt ? neu : k === "kinder" ? (v as Baustein[]).map(bausteinLauf) : lauf(v);
    }
    return out;
  };
  const bausteinLauf = (b: Baustein): Baustein => {
    const c = { ...b } as Record<string, unknown>;
    for (const k of ["sichtbarWenn", "pflicht", "ausdruck", "pruefungen"]) if (c[k] !== undefined) c[k] = lauf(c[k]);
    if (b.typ === "abschnitt") c.kinder = b.kinder.map(bausteinLauf);
    return c as unknown as Baustein;
  };
  return {
    ...def,
    bausteine: def.bausteine.map(bausteinLauf),
    bezugsdatumFeld: def.bezugsdatumFeld === alt ? neu : def.bezugsdatumFeld,
  };
}

/** Optionswert in Bedingungen nachziehen, die sich auf dieses Feld beziehen. */
function optionsverweiseUmbenennen(def: FormularDefinition, feld: string, alt: string, neu: string): FormularDefinition {
  const bed = (b: Bedingung): Bedingung => {
    if ("alle" in b) return { alle: b.alle.map(bed) };
    if ("eine" in b) return { eine: b.eine.map(bed) };
    if (b.feld !== feld) return b;
    if (b.wert === alt) return { ...b, wert: neu };
    if (Array.isArray(b.wert)) return { ...b, wert: b.wert.map((w) => (w === alt ? neu : w)) };
    return b;
  };
  const aus = (a: Ausdruck): Ausdruck => {
    if (typeof a === "number" || "feld" in a) return a;
    if ("op" in a) return { ...a, a: aus(a.a), b: aus(a.b) };
    if ("wenn" in a) return { wenn: bed(a.wenn), dann: aus(a.dann), sonst: aus(a.sonst) };
    if (a.fn === "dauer_minuten" || a.fn === "tage_zwischen") return a;
    return { ...a, args: a.args.map(aus) };
  };
  const lauf = (b: Baustein): Baustein => {
    const c = { ...b } as Baustein;
    if (c.sichtbarWenn) c.sichtbarWenn = bed(c.sichtbarWenn);
    if (istEingabe(c) && c.pflicht && typeof c.pflicht === "object") c.pflicht = bed(c.pflicht);
    if (c.typ === "berechnung") c.ausdruck = aus(c.ausdruck);
    if (c.typ === "abschnitt") c.kinder = c.kinder.map(lauf);
    return c;
  };
  return { ...def, bausteine: def.bausteine.map(lauf) };
}

function neuerBaustein(typ: BausteinTyp, vorhanden: Set<string>): Baustein {
  const beschriftung =
    typ === "abschnitt" ? "Neuer Abschnitt" : typ === "hinweis" ? "Hinweistext" : typ === "anzeige" ? "Name" : typ === "berechnung" ? "Ergebnis" : "Neue Frage";
  const schluessel = schluesselAusBeschriftung(beschriftung, vorhanden);
  switch (typ) {
    case "abschnitt":
      return { typ, schluessel, beschriftung, kinder: [] };
    case "hinweis":
      return { typ, schluessel, beschriftung, ton: "info" };
    case "anzeige":
      return { typ, schluessel, beschriftung, quelle: "klient.name" };
    case "auswahl":
    case "mehrfachauswahl":
      return {
        typ,
        schluessel,
        beschriftung,
        optionen: [
          { wert: "option_1", label: "Option 1" },
          { wert: "option_2", label: "Option 2" },
        ],
      };
    case "skala":
      return { typ, schluessel, beschriftung, min: 1, max: 5 };
    case "berechnung":
      return { typ, schluessel, beschriftung, ausdruck: { fn: "summe", args: [] } };
    default:
      return { typ, schluessel, beschriftung } as Baustein;
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function FormularEditor({
  definition,
  frueher,
  onAendern,
  status,
}: {
  definition: FormularDefinition;
  /** Frueher veroeffentlichte Fassungen: ihre Schluessel und Optionen sind gesperrt. */
  frueher: FormularDefinition[];
  onAendern: (neu: FormularDefinition) => void;
  /** Speicherstand fuer die Kopfzeile ("Gespeichert 14:02"). */
  status: ReactNode;
}) {
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<"aufbau" | "ausprobieren">("aufbau");

  const gesperrt = useMemo(() => {
    const m = new Map<string, Baustein>();
    for (const d of frueher) for (const b of alleBausteine(d)) m.set(b.schluessel, b);
    return m;
  }, [frueher]);
  const hinweise = useMemo(() => pruefeVeroeffentlichung(definition, frueher), [definition, frueher]);
  const pfad = gewaehlt ? finde(definition.bausteine, gewaehlt) : null;
  const auswahl = pfad ? holen(definition.bausteine, pfad) : null;

  function hinzufuegen(typ: BausteinTyp) {
    const b = neuerBaustein(typ, new Set(alleBausteine(definition).map((x) => x.schluessel)));
    let bausteine: Baustein[];
    if (!pfad) {
      bausteine = [...definition.bausteine, b];
    } else if (auswahl?.typ === "abschnitt" && typ !== "abschnitt") {
      // In den gewaehlten Abschnitt hinein -- so baut man einen Abschnitt am schnellsten auf.
      bausteine = mitKindern(definition.bausteine, pfad, (k) => [...k, b]);
    } else {
      // Abschnitte liegen immer oben: nach dem aeussersten Elternteil einfuegen.
      const ziel = typ === "abschnitt" ? pfad.slice(0, 1) : pfad;
      const eltern = ziel.slice(0, -1);
      const i = ziel[ziel.length - 1];
      bausteine = mitKindern(definition.bausteine, eltern, (k) => [...k.slice(0, i + 1), b, ...k.slice(i + 1)]);
    }
    onAendern({ ...definition, bausteine });
    setGewaehlt(b.schluessel);
    setAnsicht("aufbau");
  }

  function aendern(neu: Baustein) {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    let def: FormularDefinition = { ...definition, bausteine: mitKindern(definition.bausteine, eltern, (k) => k.map((b, j) => (j === i ? neu : b))) };
    if (neu.schluessel !== auswahl.schluessel) {
      def = verweiseUmbenennen(def, auswahl.schluessel, neu.schluessel);
      setGewaehlt(neu.schluessel);
    }
    onAendern(def);
  }

  function entfernen() {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    const def = { ...definition, bausteine: mitKindern(definition.bausteine, eltern, (k) => k.filter((_, j) => j !== i)) };
    if (def.bezugsdatumFeld === auswahl.schluessel) delete def.bezugsdatumFeld;
    onAendern(def);
    setGewaehlt(null);
  }

  function verschieben(richtung: -1 | 1) {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    const geschwister = eltern.length ? (holen(definition.bausteine, eltern) as Extract<Baustein, { typ: "abschnitt" }>).kinder : definition.bausteine;
    const j = i + richtung;
    if (j < 0 || j >= geschwister.length) {
      // Am Rand eines Abschnitts: hinaus, vor bzw. hinter den Abschnitt.
      if (!eltern.length) return;
      const ohne = mitKindern(definition.bausteine, eltern, (k) => k.filter((_, x) => x !== i));
      const ep = eltern[eltern.length - 1] + (richtung === 1 ? 1 : 0);
      onAendern({ ...definition, bausteine: mitKindern(ohne, eltern.slice(0, -1), (k) => [...k.slice(0, ep), auswahl, ...k.slice(ep)]) });
      return;
    }
    onAendern({
      ...definition,
      bausteine: mitKindern(definition.bausteine, eltern, (k) => {
        const c = [...k];
        [c[i], c[j]] = [c[j], c[i]];
        return c;
      }),
    });
  }

  function verlegen(abschnitt: string | "") {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    const ohne = mitKindern(definition.bausteine, eltern, (k) => k.filter((_, x) => x !== i));
    const ziel = abschnitt ? finde(ohne, abschnitt) : null;
    onAendern({ ...definition, bausteine: ziel ? mitKindern(ohne, ziel, (k) => [...k, auswahl]) : [...ohne, auswahl] });
  }

  const abschnitte = definition.bausteine.filter((b) => b.typ === "abschnitt");

  return (
    <div className="zv-fe">
      <aside className="zv-fe-kasten" aria-label="Bausteinkasten">
        {KASTEN.map((g) => (
          <div key={g.titel} className="zv-fe-kasten-gruppe">
            <div className="zv-gruppenlabel">{g.titel}</div>
            {g.typen.map((t) => (
              <button key={t} type="button" className="zv-fe-kasten-knopf" onClick={() => hinzufuegen(t)}>
                <INeu size={14} />
                {BAUSTEIN_LABEL[t]}
              </button>
            ))}
          </div>
        ))}
        <p className="zv-fe-kasten-tipp">
          Neue Bausteine landen hinter dem gewählten Baustein, bei einem gewählten Abschnitt darin.
        </p>
      </aside>

      <section className="zv-fe-mitte" aria-label="Formular">
        <div className="zv-fe-mitte-kopf">
          <div className="zv-segmented" role="tablist" aria-label="Ansicht">
            <button type="button" role="tab" aria-selected={ansicht === "aufbau"} className={ansicht === "aufbau" ? "active" : ""} onClick={() => setAnsicht("aufbau")}>
              Aufbau
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ansicht === "ausprobieren"}
              className={ansicht === "ausprobieren" ? "active" : ""}
              onClick={() => setAnsicht("ausprobieren")}
            >
              Ausprobieren
            </button>
          </div>
          <span className="zv-fe-status" aria-live="polite">
            {status}
          </span>
        </div>
        {ansicht === "aufbau" ? (
          definition.bausteine.length === 0 ? (
            <div className="zv-fe-leer">Noch leer. Wählen Sie links einen Baustein, z. B. einen Abschnitt oder eine Frage.</div>
          ) : (
            <ul className="zv-fe-baum">
              {definition.bausteine.map((b) => (
                <BaumKnoten key={b.schluessel} b={b} definition={definition} gewaehlt={gewaehlt} onWaehlen={setGewaehlt} />
              ))}
            </ul>
          )
        ) : (
          <Ausprobieren definition={definition} />
        )}
        {hinweise.length > 0 && (
          <div className="zv-fe-hinweise" role="status">
            <strong>Vor dem Veröffentlichen noch zu klären</strong>
            <ul>
              {hinweise.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <aside className="zv-fe-eigenschaften" aria-label="Eigenschaften">
        {auswahl && pfad ? (
          <Eigenschaften
            key={auswahl.schluessel}
            b={auswahl}
            definition={definition}
            gesperrt={gesperrt.get(auswahl.schluessel) ?? null}
            abschnitte={abschnitte}
            inAbschnitt={pfad.length > 1 ? (holen(definition.bausteine, pfad.slice(0, 1)).schluessel) : ""}
            onAendern={aendern}
            onDefinition={onAendern}
            onEntfernen={entfernen}
            onVerschieben={verschieben}
            onVerlegen={verlegen}
          />
        ) : (
          <>
            <ZuordnungWahl definition={definition} gesperrt={frueher.length > 0} onAendern={onAendern} />
            <p className="zv-sub">Wählen Sie in der Mitte einen Baustein, um ihn zu bearbeiten.</p>
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * Wozu ein ausgefuelltes Formular gehoert (Konzept dokumentation-formulare,
 * Bild 3A). Steht hier im Aufbau statt in den Einstellungen, weil es Teil der
 * VERSION ist: es aendert, was beim Ausfuellen gefragt wird, und gilt erst ab
 * der naechsten Veroeffentlichung -- bereits ausgefuellte Dokumente behalten ihre.
 */
function ZuordnungWahl({
  definition,
  gesperrt,
  onAendern,
}: {
  definition: FormularDefinition;
  gesperrt: boolean;
  onAendern: (neu: FormularDefinition) => void;
}) {
  const aktuell = zuordnungVon(definition);
  return (
    <fieldset className="zv-fe-zuordnung">
      <legend>Zuordnung</legend>
      <p className="zv-sub">Wozu gehört ein ausgefülltes Dokument?</p>
      {(Object.keys(ZUORDNUNG_LABEL) as FormularZuordnung[]).map((z) => (
        <label key={z} className="zv-checkbox-zeile zv-fe-zuordnung-wahl">
          <input
            type="radio"
            name="zv-fe-zuordnung"
            checked={aktuell === z}
            onChange={() => {
              const neu = { ...definition };
              if (z === "klient") delete neu.zuordnung;
              else neu.zuordnung = z;
              onAendern(neu);
            }}
          />
          <span>
            <strong>{ZUORDNUNG_LABEL[z]}</strong>
            <span className="zv-sub">{ZUORDNUNG_ERKLAERUNG[z]}</span>
          </span>
        </label>
      ))}
      {gesperrt && <p className="zv-protokoll-hilfe">Gilt ab der nächsten veröffentlichten Version. Bereits ausgefüllte Dokumente behalten ihre Zuordnung.</p>}
      {!zuordnungKenntKlient(aktuell) && (
        <p className="zv-protokoll-hilfe">Ohne Klient:in gibt es keine Klienten- und Belegungsdaten zum Anzeigen oder Vorausfüllen.</p>
      )}
    </fieldset>
  );
}

function BaumKnoten({
  b,
  definition,
  gewaehlt,
  onWaehlen,
}: {
  b: Baustein;
  definition: FormularDefinition;
  gewaehlt: string | null;
  onWaehlen: (s: string) => void;
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
  return (
    <li className={b.typ === "abschnitt" ? "zv-fe-knoten zv-fe-knoten-abschnitt" : "zv-fe-knoten"}>
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
      {b.typ === "abschnitt" && (
        <ul className="zv-fe-baum">
          {b.kinder.length === 0 && <li className="zv-fe-leer-abschnitt">Leer. Abschnitt wählen und links Bausteine hinzufügen.</li>}
          {b.kinder.map((k) => (
            <BaumKnoten key={k.schluessel} b={k} definition={definition} gewaehlt={gewaehlt} onWaehlen={onWaehlen} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Wie beim Ausfuellen, mit erfundener Beispiel-Klient:in. Nichts davon wird gespeichert. */
function Ausprobieren({ definition }: { definition: FormularDefinition }) {
  const start = useMemo(() => {
    const w: FeldWerte = {};
    for (const b of alleBausteine(definition)) {
      if (istEingabe(b) && b.vorausfuellen) {
        const v = BEISPIEL[b.vorausfuellen.quelle];
        w[b.schluessel] = b.typ === "zahl" ? Number(v) || null : v;
      }
    }
    return w;
  }, [definition]);
  const [werte, setWerte] = useState<FeldWerte>(start);
  const [fehler, setFehler] = useState<Record<string, string>>({});
  const [geprueft, setGeprueft] = useState(false);
  const anzeige = useMemo(() => {
    const a: Record<string, string> = {};
    for (const b of alleBausteine(definition)) if (b.typ === "anzeige") a[b.schluessel] = BEISPIEL[b.quelle];
    return a;
  }, [definition]);

  function pruefen() {
    const f = pruefeWerte(definition, werte, { heute: BEISPIEL["zeit.heute"] });
    setFehler(Object.fromEntries(f.map((x) => [x.schluessel, x.meldung])));
    setGeprueft(true);
  }

  return (
    <div className="zv-fe-probe">
      <p className="zv-hinweis zv-hinweis-info">Probelauf mit der erfundenen Klient:in „Erika Beispiel“. Es wird nichts gespeichert.</p>
      <ProtokollEingabe
        definition={definition}
        werte={werte}
        anzeige={anzeige}
        personen={{}}
        auswahlPersonen={[
          { id: "00000000-0000-4000-8000-000000000001", name: "Max Muster" },
          { id: "00000000-0000-4000-8000-000000000002", name: "Mia Probe" },
        ]}
        fehler={fehler}
        idPraefix="probe-"
        onAendern={(s: string, w: FeldWert | null) => {
          setWerte((alt) => ({ ...alt, [s]: w }));
          setGeprueft(false);
        }}
      />
      <div className="zv-protokoll-leiste">
        {geprueft && Object.keys(fehler).length === 0 && (
          <span className="zv-protokoll-status">
            <IBestaetigen size={14} /> So ließe sich das Protokoll abschließen.
          </span>
        )}
        <button
          type="button"
          className="zv-btn zv-btn-still zv-btn-klein"
          onClick={() => {
            setWerte(start);
            setFehler({});
            setGeprueft(false);
          }}
        >
          Zurücksetzen
        </button>
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={pruefen}>
          Abschließen prüfen
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eigenschaften
// ---------------------------------------------------------------------------

type Reiter = "feld" | "logik" | "daten";

function Eigenschaften({
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
              <input
                id={id("schluessel")}
                className="zv-mono"
                value={b.schluessel}
                onChange={(e) => {
                  const s = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  if (s && !andereSchluessel.has(s)) onAendern({ ...b, schluessel: s });
                }}
              />
            )}
            <p className="zv-protokoll-hilfe">Name der Spalte in Auswertungen. Nach dem Veröffentlichen nicht mehr änderbar.</p>
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
          <div className="zv-field">
            <label htmlFor={id("lmin")}>Beschriftung unten</label>
            <input id={id("lmin")} value={b.labelMin ?? ""} placeholder="z. B. schlecht" onChange={(e) => onAendern({ ...b, labelMin: e.target.value || undefined })} />
          </div>
          <div className="zv-field">
            <label htmlFor={id("lmax")}>Beschriftung oben</label>
            <input id={id("lmax")} value={b.labelMax ?? ""} placeholder="z. B. sehr gut" onChange={(e) => onAendern({ ...b, labelMax: e.target.value || undefined })} />
          </div>
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
    default:
      return null;
  }
}

function OptionenListe({
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
          <li key={o.wert} className={o.ausgeblendet ? "zv-fe-option-aus" : undefined}>
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

// ---------------------------------------------------------------------------
// Logik: Bedingungen als Satz
// ---------------------------------------------------------------------------

type Blatt = Extract<Bedingung, { feld: string }>;

/** Felder, auf die sich eine Bedingung beziehen darf: Datenfelder weiter oben (pruefeDefinition verlangt das). */
function felderVor(definition: FormularDefinition, bis: string | null): Baustein[] {
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

function BedingungsWahl({
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

function PflichtWahl({
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

function Vergleiche({ b, definition, onAendern }: { b: Baustein & { pruefungen?: Vergleichspruefung[] }; definition: FormularDefinition; onAendern: (p: Vergleichspruefung[]) => void }) {
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

function FormelBaukasten({ b, definition, onAendern }: { b: Extract<Baustein, { typ: "berechnung" }>; definition: FormularDefinition; onAendern: (a: Ausdruck) => void }) {
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

