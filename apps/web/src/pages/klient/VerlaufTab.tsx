import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  GESPRAECH_ART_LABEL,
  KLIENT_EINTRAG_ART_LABEL,
  VERLAUF_FILTER_LABEL,
  verlaufFilterVon,
  type KlientEintragAenderungDto,
  type KlientEintragArt,
  type KlientEintragDto,
  type VerlaufDto,
  type VerlaufFilter,
  type VerlaufZeileDto,
} from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Filterleiste, ZeitraumFilter, trifftSuche, useZeitraum } from "../../components/Listenfilter";
import { Leerzustand } from "../../components/Leerzustand";
import { Modal } from "../../components/Modal";
import { EINTRAG_ART_ICON } from "../../components/NeuerEintrag";
import { IBearbeiten, IDokument, IFehler, IGeplant, ILeerVerlauf, INeu, ISpeichern, IVerlauf } from "../../components/icons";
import { formatDatum, formatTagTrenner, formatUhrzeit, lokalesDatum } from "../../format";

const FILTER: VerlaufFilter[] = ["notiz", "telefonat", "gespraech", "entscheidung", "dokumentation", "automatisch"];

/** Zusatzangaben einer Zeile (Dauer, Teilnehmende, Ergebnis ...), ohne Titel und Text. */
export function eintragZusatz(e: KlientEintragDto): string[] {
  const z: string[] = [];
  if (e.art === "telefonat" && e.dauerMinuten) z.push(`${e.dauerMinuten} Min.`);
  if (e.art === "gespraech") {
    const namen = [...e.teilnehmende.map((t) => t.name), e.gegenueber].filter(Boolean);
    if (namen.length > 0) z.push(`mit ${namen.join(", ")}`);
  }
  if (e.art === "entscheidung" && e.entschiedenVonName) z.push(`entschieden von ${e.entschiedenVonName}`);
  if (e.wiedervorlageAm) z.push(`Wiedervorlage ${formatDatum(e.wiedervorlageAm)}`);
  if (e.anzahlKorrekturen > 0) z.push(e.anzahlKorrekturen === 1 ? "1 Korrektur" : `${e.anzahlKorrekturen} Korrekturen`);
  return z;
}

/** CSS-Klasse fuer Farbe und Marke einer Zeile -- je Filtergruppe, nicht je Quelle. */
export function verlaufKlasse(z: VerlaufZeileDto): string {
  return `zv-verlauf-${verlaufFilterVon(z.quelle)}`;
}

export function verlaufArtLabel(z: VerlaufZeileDto): string {
  if (z.eintrag) {
    return z.eintrag.gespraechArt ? GESPRAECH_ART_LABEL[z.eintrag.gespraechArt] : KLIENT_EINTRAG_ART_LABEL[z.eintrag.art];
  }
  // Titel ist schon "Tagesbericht" bzw. der Formularname; die Marke sagt die Gruppe.
  if (z.quelle === "tagesbericht" || z.quelle === "protokoll") return "Dokumentation";
  return "automatisch";
}

/**
 * Reiter "Verlauf" (Konzept chronik, Abschnitt 4): eine Zeitleiste je
 * Klient:in. Erfasste Eintraege und abgeleitete Ereignisse kommen fertig
 * gemischt vom Server; gefiltert nach Art und Suchtext wird hier, der
 * Zeitraum geht an den Server (er begrenzt die Menge).
 */
export function VerlaufTab({
  klientId,
  archiviert,
  aktualisierung,
  onNeuerEintrag,
  onDokumentationOeffnen,
}: {
  klientId: string;
  archiviert: boolean;
  /** Zaehlt hoch, wenn ausserhalb (Kopf "+ Eintrag") etwas angelegt wurde. */
  aktualisierung: number;
  onNeuerEintrag: (art?: KlientEintragArt) => void;
  onDokumentationOeffnen: (quelle: "tagesbericht" | "protokoll") => void;
}) {
  const [daten, setDaten] = useState<VerlaufDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [filter, setFilter] = useState<VerlaufFilter[]>([]);
  const [suche, setSuche] = useState("");
  const zeitraum = useZeitraum();
  const [korrektur, setKorrektur] = useState<KlientEintragDto | null>(null);
  const [historie, setHistorie] = useState<KlientEintragDto | null>(null);

  const laden = useCallback(() => {
    if (zeitraum.ungueltig) return;
    api
      .verlauf(klientId, { von: zeitraum.von || undefined, bis: zeitraum.bis || undefined })
      .then((d) => {
        setDaten(d);
        setFehler(null);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Verlauf konnte nicht geladen werden."));
  }, [klientId, zeitraum.von, zeitraum.bis, zeitraum.ungueltig]);

  useEffect(laden, [laden, aktualisierung]);

  const sichtbar = useMemo(
    () =>
      (daten?.zeilen ?? []).filter(
        (z) =>
          (filter.length === 0 || filter.includes(verlaufFilterVon(z.quelle))) &&
          trifftSuche(suche, [z.titel, z.text, z.autorName, z.eintrag?.ergebnis, z.eintrag?.naechsterSchritt])
      ),
    [daten, filter, suche]
  );

  const zaehlung = useMemo(() => {
    const m = new Map<VerlaufFilter, number>();
    for (const z of daten?.zeilen ?? []) {
      const f = verlaufFilterVon(z.quelle);
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [daten]);

  const tage = useMemo(() => {
    const gruppen: { tag: string; zeilen: VerlaufZeileDto[] }[] = [];
    for (const z of sichtbar) {
      const tag = z.ganztaegig ? z.zeitpunkt.slice(0, 10) : lokalesDatum(new Date(z.zeitpunkt));
      const letzte = gruppen[gruppen.length - 1];
      if (letzte && letzte.tag === tag) letzte.zeilen.push(z);
      else gruppen.push({ tag, zeilen: [z] });
    }
    return gruppen;
  }, [sichtbar]);

  const umschalten = (f: VerlaufFilter) => setFilter((alt) => (alt.includes(f) ? alt.filter((x) => x !== f) : [...alt, f]));

  return (
    <div className="zv-verlauf">
      <div className="zv-verlauf-werkzeug">
        <Filterleiste
          ariaLabel="Verlauf filtern"
          suche={{ wert: suche, onChange: setSuche, placeholder: "Text, Person …", ariaLabel: "Verlauf durchsuchen" }}
          aktiv={filter.length > 0 || suche !== "" || zeitraum.aktiv}
          onZuruecksetzen={() => {
            setFilter([]);
            setSuche("");
            zeitraum.waehlen("alle");
          }}
        >
          <ZeitraumFilter zeitraum={zeitraum} idPrefix="verlauf" />
        </Filterleiste>
        {!archiviert && (
          <button type="button" className="zv-btn" onClick={() => onNeuerEintrag()}>
            <INeu />
            Eintrag
          </button>
        )}
      </div>

      <div className="zv-verlauf-chips" role="group" aria-label="Nach Art filtern">
        <span className={`zv-filter-pille${filter.length === 0 ? " aktiv" : ""}`}>
          <button type="button" className="zv-filter-pille-knopf" aria-pressed={filter.length === 0} onClick={() => setFilter([])}>
            Alles
          </button>
        </span>
        {FILTER.map((f) => (
          <span key={f} className={`zv-filter-pille${filter.includes(f) ? " aktiv" : ""}`}>
            <button type="button" className="zv-filter-pille-knopf" aria-pressed={filter.includes(f)} onClick={() => umschalten(f)}>
              <span className={`zv-verlauf-punkt zv-verlauf-${f}`} aria-hidden="true" />
              {VERLAUF_FILTER_LABEL[f]}
              <span className="zv-mono zv-reiter-zaehler">{zaehlung.get(f) ?? 0}</span>
            </button>
          </span>
        ))}
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {zeitraum.ungueltig && <p className="zv-fehlertext">Der Zeitraum endet vor seinem Beginn.</p>}

      <div className="zv-verlauf-raster">
        <section className="zv-verlauf-liste" aria-label="Einträge">
          {daten === null ? null : tage.length === 0 ? (
            <Leerzustand icon={ILeerVerlauf}>
              {daten.zeilen.length === 0 ? "Noch nichts im Verlauf. Der erste Eintrag kommt über „+ Eintrag“." : "Keine Einträge für diese Auswahl."}
            </Leerzustand>
          ) : (
            tage.map((t) => (
              <div key={t.tag} className="zv-verlauf-tag">
                <h4 className="zv-verlauf-tagkopf">{formatTagTrenner(`${t.tag}T12:00:00`)}</h4>
                <ol>
                  {t.zeilen.map((z) => (
                    <VerlaufZeile
                      key={z.schluessel}
                      zeile={z}
                      archiviert={archiviert}
                      onKorrigieren={setKorrektur}
                      onHistorie={setHistorie}
                      onDokumentationOeffnen={onDokumentationOeffnen}
                    />
                  ))}
                </ol>
              </div>
            ))
          )}
          {daten?.gekuerzt && (
            <p className="zv-sub-inline">Es gibt ältere Einträge. Grenze den Zeitraum ein, um sie zu sehen.</p>
          )}
        </section>

        <aside
          className={`zv-verlauf-rand${!daten || daten.wiedervorlagen.length === 0 ? " zv-verlauf-rand-leer" : ""}`}
          aria-label="Wiedervorlagen"
        >
          <div className="zv-abschnittskopf">
            <h3>Wiedervorlagen</h3>
          </div>
          {!daten || daten.wiedervorlagen.length === 0 ? (
            <p className="zv-rand-leer">Nichts zur Wiedervorlage.</p>
          ) : (
            <ul className="zv-rand-liste zv-ueberblick-liste">
              {daten.wiedervorlagen.map((w) => (
                <li key={w.schluessel}>
                  <span className="zv-todo-titel">{w.titel}</span>
                  <span className="zv-todo-meta">
                    <IGeplant /> {w.datum ? formatDatum(w.datum) : "ohne Datum"} ·{" "}
                    {w.herkunft === "aufgabe" ? "Aufgabe" : "Entscheidung"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="zv-todo-meta zv-verlauf-summe">
            {(daten?.zeilen.length ?? 0) === 1 ? "1 Zeile" : `${daten?.zeilen.length ?? 0} Zeilen`}
            {zeitraum.text && zeitraum.aktiv ? ` · ${zeitraum.text}` : " insgesamt"}
          </p>
        </aside>
      </div>

      {korrektur && (
        <KorrekturFenster
          eintrag={korrektur}
          onSchliessen={() => setKorrektur(null)}
          onGespeichert={() => {
            setKorrektur(null);
            laden();
          }}
        />
      )}
      {historie && <HistorieFenster eintrag={historie} onSchliessen={() => setHistorie(null)} />}
    </div>
  );
}

function VerlaufZeile({
  zeile: z,
  archiviert,
  onKorrigieren,
  onHistorie,
  onDokumentationOeffnen,
}: {
  zeile: VerlaufZeileDto;
  archiviert: boolean;
  onKorrigieren: (e: KlientEintragDto) => void;
  onHistorie: (e: KlientEintragDto) => void;
  onDokumentationOeffnen: (quelle: "tagesbericht" | "protokoll") => void;
}) {
  const e = z.eintrag;
  const Icon = e ? EINTRAG_ART_ICON[e.art] : z.quelle === "tagesbericht" || z.quelle === "protokoll" ? IDokument : IVerlauf;
  const automatisch = verlaufFilterVon(z.quelle) === "automatisch";
  const dokumentation = z.quelle === "tagesbericht" || z.quelle === "protokoll";
  const zusatz = e ? eintragZusatz(e) : [];
  return (
    <li className={`zv-verlauf-zeile ${verlaufKlasse(z)}${automatisch ? " zv-verlauf-auto" : ""}`}>
      <span className="zv-verlauf-zeit zv-mono">{z.ganztaegig ? "" : formatUhrzeit(z.zeitpunkt)}</span>
      <span className="zv-verlauf-symbol" aria-hidden="true">
        <Icon />
      </span>
      <div className="zv-verlauf-inhalt">
        <p className="zv-verlauf-titel">
          <span className="zv-verlauf-art">{verlaufArtLabel(z)}</span>
          {z.titel}
        </p>
        {z.text && <p className="zv-verlauf-text">{z.text}</p>}
        {e?.ergebnis && (
          <p className="zv-verlauf-text">
            <strong>{e.art === "entscheidung" ? "Begründung: " : "Ergebnis: "}</strong>
            {e.ergebnis}
          </p>
        )}
        {e?.naechsterSchritt && (
          <p className="zv-verlauf-text">
            <strong>Nächster Schritt: </strong>
            {e.naechsterSchritt}
            {e.aufgabe && (e.aufgabe.erledigt ? " (Aufgabe erledigt)" : e.aufgabe.faelligAm ? ` (Aufgabe bis ${formatDatum(e.aufgabe.faelligAm)})` : " (Aufgabe offen)")}
          </p>
        )}
        <p className="zv-todo-meta">
          {[z.autorName, ...zusatz].filter(Boolean).join(" · ")}
          {(e || dokumentation) && " "}
          {dokumentation && (
            <button type="button" className="zv-link-btn" onClick={() => onDokumentationOeffnen(z.quelle as "tagesbericht" | "protokoll")}>
              In Dokumentation öffnen
            </button>
          )}
          {e && e.korrigierbar && !archiviert && (
            <button type="button" className="zv-link-btn" onClick={() => onKorrigieren(e)}>
              <IBearbeiten />
              Korrigieren
            </button>
          )}
          {e && e.anzahlKorrekturen > 0 && (
            <button type="button" className="zv-link-btn" onClick={() => onHistorie(e)}>
              Änderungen
            </button>
          )}
        </p>
      </div>
    </li>
  );
}

function KorrekturFenster({
  eintrag,
  onSchliessen,
  onGespeichert,
}: {
  eintrag: KlientEintragDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [text, setText] = useState(eintrag.text);
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientEintragKorrigieren(eintrag.id, { text: text.trim(), grund: grund.trim() || undefined });
      onGespeichert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Korrektur konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={`${KLIENT_EINTRAG_ART_LABEL[eintrag.art]} korrigieren`} onClose={onSchliessen}>
      <form onSubmit={speichern}>
        <p className="zv-sub-inline" style={{ marginTop: 0 }}>
          Der bisherige Text bleibt in den Änderungen sichtbar; ein Eintrag wird nie gelöscht.
        </p>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="korrektur-text">Text</label>
          <textarea id="korrektur-text" rows={5} required value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {eintrag.korrekturBrauchtGrund && (
          <div className="zv-field">
            <label htmlFor="korrektur-grund">Grund der Korrektur</label>
            <input id="korrektur-grund" required maxLength={500} value={grund} onChange={(e) => setGrund(e.target.value)} />
          </div>
        )}
        <button
          className="zv-btn zv-btn-block"
          type="submit"
          disabled={wirdGespeichert || !text.trim() || text.trim() === eintrag.text || (eintrag.korrekturBrauchtGrund && !grund.trim())}
        >
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : "Korrektur speichern"}
        </button>
      </form>
    </Modal>
  );
}

function HistorieFenster({ eintrag, onSchliessen }: { eintrag: KlientEintragDto; onSchliessen: () => void }) {
  const [liste, setListe] = useState<KlientEintragAenderungDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    api.klientEintragHistorie(eintrag.id).then(setListe).catch((err) => setFehler(err.message));
  }, [eintrag.id]);
  return (
    <Modal titel="Änderungen am Eintrag" onClose={onSchliessen}>
      {fehler && <p className="zv-fehlertext">{fehler}</p>}
      {liste?.map((a) => (
        <div key={a.id} className="zv-verlauf-aenderung">
          <p className="zv-todo-meta">
            {formatDatum(lokalesDatum(new Date(a.geaendertAm)))} {formatUhrzeit(a.geaendertAm)} · {a.geaendertVonName ?? "unbekannt"}
            {a.grund ? ` · Grund: ${a.grund}` : ""}
          </p>
          <p className="zv-verlauf-text">
            <strong>Vorher: </strong>
            {a.textAlt}
          </p>
        </div>
      ))}
    </Modal>
  );
}
