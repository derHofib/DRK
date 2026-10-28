import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatKontaktDto, TerminAnlegenEingabe, TerminDto } from "@zimmerakte/shared";
import { TERMIN_ANTWORT_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { TerminFormular } from "../components/TerminFormular";
import { IBearbeiten, IFehler, IHerunterladen, ILeerKalender, INeu, IStornieren, IVor, IZurueckPfeil } from "../components/icons";
import { formatDatum, formatTagTrenner, formatTerminUhrzeit, formatTerminZeit, lokalesDatum, terminTag } from "../format";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_TAGE_JE_TERMIN = 62;

type Ansicht = "tag" | "woche" | "monat";

function datumAusKey(key: string): Date {
  const [j, m, t] = key.split("-").map(Number);
  return new Date(j, m - 1, t);
}

function addTage(key: string, tage: number): string {
  const d = datumAusKey(key);
  d.setDate(d.getDate() + tage);
  return lokalesDatum(d);
}

/** Montag der Woche, in der `key` liegt. */
function wochenStart(key: string): string {
  const d = datumAusKey(key);
  return addTage(key, -((d.getDay() + 6) % 7));
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

/**
 * `kontakteLaden`: woher die waehlbaren Teilnehmenden kommen. Mitarbeitende
 * nutzen die Voreinstellung (/chat/kontakte); fuer Klient:innen liefert
 * dieser Endpunkt bewusst nichts -- sie koennen nur Personen eintragen, mit
 * denen sie einen gemeinsamen Chat haben (KlientShell leitet sie daraus ab).
 */
export function Kalender({ titel = "Kalender", kontakteLaden = () => api.chatKontakte() }: { titel?: string; kontakteLaden?: () => Promise<ChatKontaktDto[]> }) {
  const heute = lokalesDatum(new Date());
  const [gewaehlt, setGewaehlt] = useState(heute);
  const [monat, setMonat] = useState(() => heute.slice(0, 7));
  const [ansicht, setAnsicht] = useState<Ansicht>("woche");
  const [termine, setTermine] = useState<TerminDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const rasterStart = useMemo(() => wochenStart(`${monat}-01`), [monat]);
  const rasterTage = useMemo(() => Array.from({ length: 42 }, (_, i) => addTage(rasterStart, i)), [rasterStart]);

  const laden = useCallback(() => {
    // Einen Tag Puffer: Zeitpunkt-Termine sind UTC gespeichert, die Raster-Grenzen lokal.
    api
      .termine(addTage(rasterStart, -1), addTage(rasterStart, 43))
      .then((t) => {
        setTermine(t);
        setFehler(null);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Termine konnten nicht geladen werden."));
  }, [rasterStart]);

  useEffect(laden, [laden]);

  const nachTag = useMemo(() => {
    const karte = new Map<string, TerminDto[]>();
    for (const t of termine) for (const tag of tageVon(t)) karte.set(tag, [...(karte.get(tag) ?? []), t]);
    for (const liste of karte.values()) liste.sort(sortiere);
    return karte;
  }, [termine]);

  const listenTage = useMemo(() => {
    if (ansicht === "tag") return [gewaehlt];
    if (ansicht === "woche") return Array.from({ length: 7 }, (_, i) => addTage(wochenStart(gewaehlt), i));
    return rasterTage.filter((t) => t.startsWith(monat));
  }, [ansicht, gewaehlt, rasterTage, monat]);

  const listeMitTerminen = listenTage.filter((t) => (nachTag.get(t) ?? []).length > 0);

  function monatWechseln(delta: number) {
    const d = datumAusKey(`${monat}-01`);
    d.setMonth(d.getMonth() + delta);
    setMonat(lokalesDatum(d).slice(0, 7));
  }

  function waehleTag(tag: string) {
    setGewaehlt(tag);
    if (!tag.startsWith(monat)) setMonat(tag.slice(0, 7));
  }

  const monatsName = datumAusKey(`${monat}-01`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const detail = termine.find((t) => t.id === detailId) ?? null;

  function ersetzen(t: TerminDto) {
    setTermine((alt) => alt.map((x) => (x.id === t.id ? t : x)));
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

      <div className="zv-kal-navigation">
        <button type="button" className="zv-icon-btn" onClick={() => monatWechseln(-1)} aria-label="Vorheriger Monat">
          <IZurueckPfeil />
        </button>
        <strong className="zv-kal-monat" aria-live="polite">
          {monatsName}
        </strong>
        <button type="button" className="zv-icon-btn" onClick={() => monatWechseln(1)} aria-label="Nächster Monat">
          <IVor />
        </button>
        <button
          type="button"
          className="zv-btn zv-btn-sekundaer zv-btn-klein"
          onClick={() => {
            setGewaehlt(heute);
            setMonat(heute.slice(0, 7));
          }}
        >
          Heute
        </button>
      </div>

      <div className="zv-kal-raster" role="grid" aria-label={`Monatsübersicht ${monatsName}`}>
        {WOCHENTAGE.map((w) => (
          <div key={w} className="zv-kal-wochentag" role="columnheader">
            {w}
          </div>
        ))}
        {rasterTage.map((tag) => {
          const liste = nachTag.get(tag) ?? [];
          const aktiv = liste.filter((t) => !t.abgesagtAm).length;
          return (
            <button
              type="button"
              key={tag}
              role="gridcell"
              className={`zv-kal-tag${tag === gewaehlt ? " gewaehlt" : ""}${tag === heute ? " heute" : ""}${tag.startsWith(monat) ? "" : " fremd"}`}
              onClick={() => waehleTag(tag)}
              aria-label={`${formatDatum(tag)}${liste.length ? `, ${liste.length} Termin${liste.length === 1 ? "" : "e"}` : ""}`}
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
        })}
      </div>

      <div className="zv-kal-listenkopf">
        <h3>{ansicht === "tag" ? formatTagTrenner(`${gewaehlt}T12:00:00`) : ansicht === "woche" ? "Woche" : monatsName}</h3>
        <div className="zv-segmented" role="tablist" aria-label="Zeitraum der Liste">
          {(["tag", "woche", "monat"] as const).map((a) => (
            <button key={a} type="button" role="tab" aria-selected={ansicht === a} className={ansicht === a ? "active" : ""} onClick={() => setAnsicht(a)}>
              {a === "tag" ? "Tag" : a === "woche" ? "Woche" : "Monat"}
            </button>
          ))}
        </div>
      </div>

      {listeMitTerminen.length === 0 ? (
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
      )}

      {neuOffen && (
        <NeuerTermin
          standardDatum={gewaehlt}
          kontakteLaden={kontakteLaden}
          onClose={() => setNeuOffen(false)}
          onAngelegt={(t) => {
            setNeuOffen(false);
            waehleTag(terminTag(t.beginn, t.ganztaegig));
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
