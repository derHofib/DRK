import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatKontaktDto, TerminAnlegenEingabe, TerminDto } from "@zimmerakte/shared";
import { TERMIN_ANTWORT_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { TerminFormular } from "../components/TerminFormular";
import { IBearbeiten, IFehler, IHerunterladen, ILeerKalender, INeu, IStornieren, IVor, IZurueckPfeil } from "../components/icons";
import { formatDatum, formatTagTrenner, formatTerminUhrzeit, formatTerminZeit, kalenderwoche, lokalesDatum, terminTag } from "../format";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_TAGE_JE_TERMIN = 62;

type Ansicht = "woche" | "monat" | "jahr";
const ANSICHTEN: { wert: Ansicht; label: string }[] = [
  { wert: "woche", label: "Woche" },
  { wert: "monat", label: "Monat" },
  { wert: "jahr", label: "Jahr" },
];

function datumAusKey(key: string): Date {
  const [j, m, t] = key.split("-").map(Number);
  return new Date(j, m - 1, t);
}

function addTage(key: string, tage: number): string {
  const d = datumAusKey(key);
  d.setDate(d.getDate() + tage);
  return lokalesDatum(d);
}

/**
 * Verschiebt um ganze Monate und haelt den Tag im Zielmonat: der 31.1. plus
 * ein Monat ist der 28./29.2. -- nicht der 3.3., wie es setMonth() taete.
 */
function addMonate(key: string, monate: number): string {
  const [j, m, t] = key.split("-").map(Number);
  const ziel = new Date(j, m - 1 + monate, 1);
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  ziel.setDate(Math.min(t, letzter));
  return lokalesDatum(ziel);
}

/** Montag der Woche, in der `key` liegt. */
function wochenStart(key: string): string {
  const d = datumAusKey(key);
  return addTage(key, -((d.getDay() + 6) % 7));
}

/** Die 42 Tage (6 Wochen) des Monatsrasters, in dem `key` liegt. */
function monatsRaster(key: string): string[] {
  const start = wochenStart(`${key.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => addTage(start, i));
}

/** Alle Tage eines Monats ("YYYY-MM") ohne Auffuellung, mit Leerfeldern vorne, damit der erste unter dem richtigen Wochentag steht. */
function miniMonat(monat: string): (string | null)[] {
  const erster = `${monat}-01`;
  const vorn = (datumAusKey(erster).getDay() + 6) % 7;
  const anzahl = new Date(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), 0).getDate();
  return [...Array<null>(vorn).fill(null), ...Array.from({ length: anzahl }, (_, i) => `${monat}-${String(i + 1).padStart(2, "0")}`)];
}

/** Abgefragter Zeitraum je Ansicht; je einen Tag Puffer, weil Zeitpunkt-Termine UTC gespeichert sind, die Grenzen aber lokal. */
function ladeZeitraum(ansicht: Ansicht, tag: string): [string, string] {
  if (ansicht === "woche") {
    const start = wochenStart(tag);
    return [addTage(start, -1), addTage(start, 8)];
  }
  if (ansicht === "monat") {
    const start = monatsRaster(tag)[0];
    return [addTage(start, -1), addTage(start, 43)];
  }
  const jahr = tag.slice(0, 4);
  return [addTage(`${jahr}-01-01`, -1), addTage(`${jahr}-12-31`, 2)];
}

/** Alle lokalen Kalendertage, die ein Termin beruehrt (gedeckelt, damit ein Termin ueber Jahre nichts aufblaeht). */
function tageVon(t: TerminDto): string[] {
  const von = terminTag(t.beginn, t.ganztaegig);
  let bis = terminTag(t.ende, t.ganztaegig);
  // Ein Termin, der genau um Mitternacht endet, gehoert nicht mehr zum Folgetag.
  if (!t.ganztaegig && t.ende > t.beginn) bis = lokalesDatum(new Date(new Date(t.ende).getTime() - 1));
  const tage: string[] = [];
  for (let k = von, i = 0; k <= bis && i < MAX_TAGE_JE_TERMIN; k = addTage(k, 1), i++) tage.push(k);
  return tage.length > 0 ? tage : [von];
}

function sortiere(a: TerminDto, b: TerminDto): number {
  if (a.ganztaegig !== b.ganztaegig) return a.ganztaegig ? -1 : 1;
  return a.beginn.localeCompare(b.beginn);
}

function terminWort(anzahl: number): string {
  return `${anzahl} Termin${anzahl === 1 ? "" : "e"}`;
}

/**
 * `kontakteLaden`: woher die waehlbaren Teilnehmenden kommen. Mitarbeitende
 * nutzen die Voreinstellung (/chat/kontakte); fuer Klient:innen liefert
 * dieser Endpunkt bewusst nichts -- sie koennen nur Personen eintragen, mit
 * denen sie einen gemeinsamen Chat haben (KlientShell leitet sie daraus ab).
 */
export function Kalender({ titel = "Kalender", kontakteLaden = () => api.chatKontakte() }: { titel?: string; kontakteLaden?: () => Promise<ChatKontaktDto[]> }) {
  const heute = lokalesDatum(new Date());
  // `gewaehlt` ist der einzige Zeitanker: Woche, Monat und Jahr leiten sich daraus ab.
  // So landet man beim Umschalten immer im Zeitraum, den man gerade ansieht.
  const [gewaehlt, setGewaehlt] = useState(heute);
  const [ansicht, setAnsicht] = useState<Ansicht>("woche");
  const [termine, setTermine] = useState<TerminDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const monat = gewaehlt.slice(0, 7);
  const jahr = gewaehlt.slice(0, 4);
  const wochenTage = useMemo(() => Array.from({ length: 7 }, (_, i) => addTage(wochenStart(gewaehlt), i)), [gewaehlt]);
  const rasterTage = useMemo(() => monatsRaster(gewaehlt), [gewaehlt]);
  const [ladeVon, ladeBis] = useMemo(() => ladeZeitraum(ansicht, gewaehlt), [ansicht, gewaehlt]);

  const laden = useCallback(() => {
    let verworfen = false;
    api
      .termine(ladeVon, ladeBis)
      .then((t) => {
        // Schnelles Durchblaettern: eine spaete Antwort fuer einen laengst verlassenen Zeitraum darf die aktuelle nicht ueberschreiben.
        if (verworfen) return;
        setTermine(t);
        setFehler(null);
      })
      .catch((err) => {
        if (!verworfen) setFehler(err instanceof Error ? err.message : "Termine konnten nicht geladen werden.");
      });
    return () => {
      verworfen = true;
    };
  }, [ladeVon, ladeBis]);

  useEffect(laden, [laden]);

  const nachTag = useMemo(() => {
    const karte = new Map<string, TerminDto[]>();
    for (const t of termine) for (const tag of tageVon(t)) karte.set(tag, [...(karte.get(tag) ?? []), t]);
    for (const liste of karte.values()) liste.sort(sortiere);
    return karte;
  }, [termine]);

  const listenTage = ansicht === "woche" ? wochenTage : ansicht === "monat" ? rasterTage.filter((t) => t.startsWith(monat)) : [];
  const listeMitTerminen = listenTage.filter((t) => (nachTag.get(t) ?? []).length > 0);

  function schritt(richtung: 1 | -1) {
    setGewaehlt((alt) => (ansicht === "woche" ? addTage(alt, 7 * richtung) : addMonate(alt, (ansicht === "monat" ? 1 : 12) * richtung)));
  }

  const monatsName = datumAusKey(`${monat}-01`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const zeitraumName =
    ansicht === "jahr"
      ? jahr
      : ansicht === "monat"
        ? monatsName
        : `KW ${kalenderwoche(datumAusKey(wochenTage[0]))} · ${formatDatum(wochenTage[0])} – ${formatDatum(wochenTage[6])}`;
  // Grammatik der Knopfbeschriftung: die Woche, der Monat, das Jahr.
  const endung = ansicht === "monat" ? "r" : ansicht === "jahr" ? "s" : "";
  const einheit = ansicht === "woche" ? "Woche" : ansicht === "monat" ? "Monat" : "Jahr";
  const detail = termine.find((t) => t.id === detailId) ?? null;

  function ersetzen(t: TerminDto) {
    setTermine((alt) => alt.map((x) => (x.id === t.id ? t : x)));
  }

  function tagKnopf(tag: string, fremd: boolean) {
    const liste = nachTag.get(tag) ?? [];
    const aktiv = liste.filter((t) => !t.abgesagtAm).length;
    return (
      <button
        type="button"
        key={tag}
        role="gridcell"
        className={`zv-kal-tag${tag === gewaehlt ? " gewaehlt" : ""}${tag === heute ? " heute" : ""}${fremd ? " fremd" : ""}`}
        onClick={() => setGewaehlt(tag)}
        aria-label={`${formatDatum(tag)}${liste.length ? `, ${terminWort(liste.length)}` : ""}`}
        aria-pressed={tag === gewaehlt}
      >
        <span className="zv-kal-tag-zahl">{Number(tag.slice(8))}</span>
        {liste.length > 0 && (
          <span className="zv-kal-punkte" aria-hidden="true">
            {aktiv > 0 && <span className="zv-kal-punkt" />}
            {aktiv > 1 && <span className="zv-kal-punkt" />}
            {aktiv > 2 && <span className="zv-kal-punkt" />}
            {aktiv === 0 && <span className="zv-kal-punkt abgesagt" />}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="zv-kalender">
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      <div className="zv-seiten-kopf">
        <h2>{titel}</h2>
        <button className="zv-btn" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neuer Termin
        </button>
      </div>

      <div className="zv-kal-umschalter">
        <div className="zv-segmented" role="tablist" aria-label="Ansicht">
          {ANSICHTEN.map((a) => (
            <button key={a.wert} type="button" role="tab" aria-selected={ansicht === a.wert} className={ansicht === a.wert ? "active" : ""} onClick={() => setAnsicht(a.wert)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="zv-kal-navigation">
        <button type="button" className="zv-icon-btn" onClick={() => schritt(-1)} aria-label={`Vorherige${endung} ${einheit}`}>
          <IZurueckPfeil />
        </button>
        <strong className="zv-kal-monat" aria-live="polite">
          {zeitraumName}
        </strong>
        <button type="button" className="zv-icon-btn" onClick={() => schritt(1)} aria-label={`Nächste${endung} ${einheit}`}>
          <IVor />
        </button>
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => setGewaehlt(heute)}>
          Heute
        </button>
      </div>

      {ansicht === "jahr" ? (
        <div className="zv-kal-jahr" data-testid="kalender-jahr">
          {Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, "0")}`).map((m) => {
            const zellen = miniMonat(m);
            const anzahl = zellen.reduce((n, tag) => n + (tag && (nachTag.get(tag) ?? []).length > 0 ? 1 : 0), 0);
            const name = datumAusKey(`${m}-01`).toLocaleDateString("de-DE", { month: "long" });
            return (
              <section key={m} className={`zv-kal-mini${m === heute.slice(0, 7) ? " heute" : ""}`}>
                <button
                  type="button"
                  className="zv-kal-mini-titel"
                  onClick={() => {
                    setGewaehlt(m === heute.slice(0, 7) ? heute : `${m}-01`);
                    setAnsicht("monat");
                  }}
                  aria-label={`${name} ${jahr} öffnen${anzahl ? `, ${anzahl} Tag${anzahl === 1 ? "" : "e"} mit Terminen` : ""}`}
                >
                  {name}
                </button>
                <div className="zv-kal-mini-raster" aria-hidden="true">
                  {WOCHENTAGE.map((w) => (
                    <span key={w} className="zv-kal-mini-kopf">
                      {w.slice(0, 1)}
                    </span>
                  ))}
                  {zellen.map((tag, i) => {
                    if (!tag) return <span key={`leer-${i}`} />;
                    const liste = nachTag.get(tag) ?? [];
                    return (
                      <span key={tag} className={`zv-kal-mini-tag${tag === heute ? " heute" : ""}${liste.length ? (liste.some((t) => !t.abgesagtAm) ? " belegt" : " abgesagt") : ""}`}>
                        {Number(tag.slice(8))}
                      </span>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="zv-kal-raster" role="grid" aria-label={ansicht === "woche" ? `Wochenübersicht ${zeitraumName}` : `Monatsübersicht ${monatsName}`}>
          {WOCHENTAGE.map((w) => (
            <div key={w} className="zv-kal-wochentag" role="columnheader">
              {w}
            </div>
          ))}
          {ansicht === "woche" ? wochenTage.map((tag) => tagKnopf(tag, false)) : rasterTage.map((tag) => tagKnopf(tag, !tag.startsWith(monat)))}
        </div>
      )}

      {ansicht !== "jahr" &&
        (listeMitTerminen.length === 0 ? (
          <Leerzustand icon={ILeerKalender} aktion={<button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setNeuOffen(true)}>Termin anlegen</button>}>
            Keine Termine in diesem Zeitraum.
          </Leerzustand>
        ) : (
          listeMitTerminen.map((tag) => (
            <div key={tag} className="zv-kal-gruppe">
              <h4 className="zv-etagen-kopf">{formatTagTrenner(`${tag}T12:00:00`)}</h4>
              <ul className="zv-kal-liste">
                {(nachTag.get(tag) ?? []).map((t) => (
                  <li key={t.id}>
                    <button type="button" className="zv-kal-termin" onClick={() => setDetailId(t.id)}>
                      <span className="zv-kal-zeit">{formatTerminUhrzeit(t)}</span>
                      <span className="zv-kal-termin-text">
                        <strong className={t.abgesagtAm ? "zv-durchgestrichen" : undefined}>{t.titel}</strong>
                        {t.ort && <span>{t.ort}</span>}
                      </span>
                      {t.abgesagtAm ? (
                        <span className="zv-pill zv-pill-danger">Abgesagt</span>
                      ) : t.meineAntwort && t.meineAntwort !== "zugesagt" ? (
                        <span className={`zv-pill ${t.meineAntwort === "abgelehnt" ? "zv-pill-danger" : "zv-pill-offen"}`}>{TERMIN_ANTWORT_LABEL[t.meineAntwort]}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ))}

      {neuOffen && (
        <NeuerTermin
          standardDatum={gewaehlt}
          kontakteLaden={kontakteLaden}
          onClose={() => setNeuOffen(false)}
          onAngelegt={(t) => {
            setNeuOffen(false);
            setGewaehlt(terminTag(t.beginn, t.ganztaegig));
            laden();
          }}
        />
      )}
      {detail && <TerminDetail termin={detail} onClose={() => setDetailId(null)} onGeaendert={ersetzen} />}
    </div>
  );
}

function NeuerTermin({
  standardDatum,
  kontakteLaden,
  onClose,
  onAngelegt,
}: {
  standardDatum: string;
  kontakteLaden: () => Promise<ChatKontaktDto[]>;
  onClose: () => void;
  onAngelegt: (t: TerminDto) => void;
}) {
  const [kontakte, setKontakte] = useState<ChatKontaktDto[] | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    kontakteLaden().then(setKontakte).catch(() => setKontakte([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function absenden(eingabe: TerminAnlegenEingabe) {
    setLaeuft(true);
    setFehler(null);
    try {
      onAngelegt(await api.terminAnlegen(eingabe));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termin konnte nicht angelegt werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Neuer Termin" onClose={onClose}>
      {kontakte === null ? (
        <p className="zv-sub">Wird geladen…</p>
      ) : (
        <TerminFormular standardDatum={standardDatum} kontakte={kontakte} mitBeschreibung absendenLabel="Termin anlegen" wirdGesendet={laeuft} fehler={fehler} onAbsenden={absenden} />
      )}
    </Modal>
  );
}

function TerminDetail({ termin, onClose, onGeaendert }: { termin: TerminDto; onClose: () => void; onGeaendert: (t: TerminDto) => void }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [absagenFrage, setAbsagenFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function aktion(fn: () => Promise<TerminDto | void>, fallback: string) {
    setLaeuft(true);
    setFehler(null);
    try {
      const neu = await fn();
      if (neu) onGeaendert(neu);
      return true;
    } catch (err) {
      setFehler(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setLaeuft(false);
    }
  }

  if (bearbeiten) {
    return (
      <Modal titel="Termin bearbeiten" onClose={() => setBearbeiten(false)}>
        <TerminFormular
          initial={termin}
          mitBeschreibung
          absendenLabel="Änderungen speichern"
          wirdGesendet={laeuft}
          fehler={fehler}
          onAbsenden={async (e) => {
            const ok = await aktion(
              () => api.terminAendern(termin.id, { titel: e.titel, beschreibung: e.beschreibung ?? null, ort: e.ort ?? null, beginn: e.beginn, ende: e.ende, ganztaegig: e.ganztaegig }),
              "Termin konnte nicht gespeichert werden."
            );
            if (ok) setBearbeiten(false);
          }}
        />
      </Modal>
    );
  }

  const abgesagt = !!termin.abgesagtAm;
  return (
    <Modal titel={termin.titel} onClose={onClose}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {abgesagt && <span className="zv-pill zv-pill-danger">Abgesagt</span>}
      <dl className="zv-datenliste" style={{ marginTop: "var(--zv-space-2)" }}>
        <dt>Wann</dt>
        <dd className={abgesagt ? "zv-durchgestrichen" : undefined}>{formatTerminZeit(termin)}</dd>
        {termin.ort && (
          <>
            <dt>Ort</dt>
            <dd>{termin.ort}</dd>
          </>
        )}
        {termin.beschreibung && (
          <>
            <dt>Beschreibung</dt>
            <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{termin.beschreibung}</dd>
          </>
        )}
        <dt>Erstellt von</dt>
        <dd>{termin.erstelltVon.name}</dd>
      </dl>

      <h3 className="zv-etagen-kopf">Teilnehmende ({termin.teilnehmer.length})</h3>
      <ul className="zv-kontaktliste">
        {termin.teilnehmer.map((t) => (
          <li key={`${t.art}:${t.id}`} className="zv-kontakt-zeile">
            <span className="zv-kontakt-name">{t.name}</span>
            <span className={`zv-pill ${t.antwort === "zugesagt" ? "zv-pill-ok" : t.antwort === "abgelehnt" ? "zv-pill-danger" : "zv-pill-offen"}`}>{TERMIN_ANTWORT_LABEL[t.antwort]}</span>
          </li>
        ))}
      </ul>

      <div className="zv-aktionszeile" style={{ marginTop: "var(--zv-space-4)" }}>
        {!abgesagt && termin.meineAntwort !== null && (
          <>
            <button type="button" className="zv-btn" disabled={laeuft || termin.meineAntwort === "zugesagt"} onClick={() => void aktion(() => api.terminAntworten(termin.id, "zugesagt"), "Zusage fehlgeschlagen.")}>
              Zusagen
            </button>
            <button type="button" className="zv-btn zv-btn-sekundaer" disabled={laeuft || termin.meineAntwort === "abgelehnt"} onClick={() => void aktion(() => api.terminAntworten(termin.id, "abgelehnt"), "Absage fehlgeschlagen.")}>
              Ablehnen
            </button>
          </>
        )}
        {!abgesagt && termin.meineAntwort === null && (
          <button type="button" className="zv-btn" disabled={laeuft} onClick={() => void aktion(() => api.terminUebernehmen(termin.id), "Termin konnte nicht übernommen werden.")}>
            In meinen Kalender übernehmen
          </button>
        )}
        <button type="button" className="zv-btn zv-btn-still" disabled={laeuft} onClick={() => void aktion(() => api.terminIcsHerunterladen(termin.id), "Download fehlgeschlagen.")}>
          <IHerunterladen />
          .ics herunterladen
        </button>
      </div>

      {termin.binErsteller && !abgesagt && (
        <div className="zv-aktionszeile" style={{ marginTop: "var(--zv-space-3)" }}>
          <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setBearbeiten(true)} disabled={laeuft}>
            <IBearbeiten />
            Bearbeiten
          </button>
          {absagenFrage ? (
            <>
              <button type="button" className="zv-btn zv-btn-gefahr" disabled={laeuft} onClick={() => void aktion(() => api.terminAbsagen(termin.id), "Termin konnte nicht abgesagt werden.").then(() => setAbsagenFrage(false))}>
                Ja, Termin absagen
              </button>
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setAbsagenFrage(false)}>
                Abbrechen
              </button>
            </>
          ) : (
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => setAbsagenFrage(true)} disabled={laeuft}>
              <IStornieren />
              Termin absagen
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
