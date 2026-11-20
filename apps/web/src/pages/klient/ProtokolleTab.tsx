import { zuordnungText } from "../dokumentation/zuordnung";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  alleBausteine,
  type FeldWert,
  type FeldWerte,
  type FormularAngebotDto,
  type ProtokollAenderungDto,
  type ProtokollDto,
  type ProtokolleRechteDto,
  type ProtokollKurzDto,
} from "@zimmerakte/shared";
import { api, ApiFehler } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import { Modal } from "../../components/Modal";
import { ProtokollAnsicht, ProtokollEingabe, verworfeneAngaben, wertAlsText, type PersonAuswahl } from "../../components/ProtokollFormular";
import {
  IBearbeiten,
  IBestaetigen,
  IFehler,
  IInfo,
  ILeerTagesberichte,
  ILoeschen,
  INeu,
  ISpeichern,
  IZurueck,
} from "../../components/icons";
import { formatDatum, formatUhrzeit } from "../../format";

/**
 * Protokolle einer Klient:in (Formular-Baukasten, Schritt 1). Liste, Neu
 * anlegen, Ausfuellen mit automatischem Zwischenspeichern, Abschliessen und
 * Korrigieren mit Grund. Pruefungen und Logik kommen aus packages/shared --
 * derselbe Auswerter laeuft auf dem Server, der beim Abschliessen verbindlich
 * prueft.
 */
/** Ruecksprung an die Stelle, von der aus ein Protokoll geoeffnet wurde. */
export interface Ruecksprung {
  label: string;
  onKlick: () => void;
}

export function ProtokolleTab({
  klientId,
  archiviert,
  start,
}: {
  klientId: string;
  archiviert: boolean;
  /** Aus einem Tagesbericht geoeffnet: gleich dieses Protokoll zeigen, mit Weg zurueck. */
  start?: { protokollId: string; ruecksprung: Ruecksprung };
}) {
  const [rechte, setRechte] = useState<ProtokolleRechteDto | null>(null);
  const [liste, setListe] = useState<ProtokollKurzDto[]>([]);
  const [formulare, setFormulare] = useState<FormularAngebotDto[]>([]);
  const [offen, setOffen] = useState<string | null>(start?.protokollId ?? null);
  const [auswahlOffen, setAuswahlOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(() => {
    api.protokolle(klientId).then(setListe).catch((err) => setFehler(err.message));
  }, [klientId]);

  useEffect(() => {
    api.protokolleRechte().then(setRechte).catch(() => setRechte({ ansehen: false, ausfuellen: false, formulareVerwalten: false }));
    // Nur, was fuer DIESE Klient:in angeboten wird: veroeffentlicht, nicht
    // stillgelegt, fuer ihren Standort freigegeben (prueft der Server).
    api.formularAngebot(klientId).then(setFormulare).catch(() => setFormulare([]));
    laden();
  }, [laden, klientId]);

  async function neu(formularId: string) {
    setFehler(null);
    try {
      const p = await api.protokollAnlegen(formularId, klientId);
      setAuswahlOffen(false);
      setOffen(p.id);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Protokoll konnte nicht angelegt werden.");
    }
  }

  if (offen) {
    return (
      <ProtokollDetail
        id={offen}
        ruecksprung={offen === start?.protokollId ? start.ruecksprung : undefined}
        onZurueck={() => {
          setOffen(null);
          laden();
        }}
      />
    );
  }

  const nutzbar = formulare;

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <div className="zv-protokoll-kopfzeile">
        <h3>Protokolle</h3>
        {rechte?.ausfuellen && !archiviert && nutzbar.length > 0 && (
          <button className="zv-btn" onClick={() => setAuswahlOffen(true)}>
            <INeu />
            Neues Protokoll
          </button>
        )}
      </div>

      {auswahlOffen && (
        <Modal titel="Welches Formular?" onClose={() => setAuswahlOffen(false)}>
          <div className="zv-protokoll-formularwahl">
            {nutzbar.map((f) => (
              <button key={f.id} type="button" className="zv-protokoll-formularwahl-eintrag" onClick={() => neu(f.id)}>
                <strong>{f.name}</strong>
                {f.beschreibung && <span>{f.beschreibung}</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {liste.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>
          {nutzbar.length === 0
            ? "Für diese Klient:in ist noch kein Formular veröffentlicht. Formulare werden unter Organisatorisch › Formulare gebaut."
            : "Noch keine Protokolle für diese Klient:in."}
        </Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.9fr 2fr 1.4fr 1.1fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Datum</span>
            <span>Formular</span>
            <span>Ausgefüllt von</span>
            <span>Stand</span>
          </div>
          {liste.map((p) => (
            <div
              key={p.id}
              className="zv-info-karte zv-info-karte-klickbar"
              role="button"
              tabIndex={0}
              onClick={() => setOffen(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOffen(p.id);
                }
              }}
            >
              <span className="zv-liste-zelle" data-label="Datum">
                {formatDatum(p.bezugsdatum)}
              </span>
              <span className="zv-liste-zelle-titel">
                {p.formularName}
                {p.tagesberichtId && <span className="zv-pill zv-protokoll-zum-tagesbericht">zum Tagesbericht</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Ausgefüllt von">
                {p.autorName ?? "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Stand">
                {!p.abgeschlossen ? (
                  <span className="zv-pill zv-pill-frist">Entwurf</span>
                ) : p.anzahlAenderungen > 0 ? (
                  <span className="zv-pill">korrigiert</span>
                ) : (
                  <span className="zv-pill zv-pill-ok">abgeschlossen</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Modus = "lesen" | "bearbeiten" | "korrigieren";

export function ProtokollDetail({ id, onZurueck, ruecksprung }: { id: string; onZurueck: () => void; ruecksprung?: Ruecksprung }) {
  const [p, setP] = useState<ProtokollDto | null>(null);
  const [werte, setWerte] = useState<FeldWerte>({});
  const [modus, setModus] = useState<Modus>("lesen");
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichertUm, setGespeichertUm] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [grund, setGrund] = useState("");
  const [historie, setHistorie] = useState<ProtokollAenderungDto[]>([]);
  const [personen, setPersonen] = useState<PersonAuswahl[]>([]);
  const [verwerfenOffen, setVerwerfenOffen] = useState(false);
  const geaendert = useRef(false);

  const uebernehmen = useCallback((neu: ProtokollDto) => {
    setP(neu);
    setWerte(neu.werte);
    setModus(!neu.abgeschlossen && neu.bearbeitbar ? "bearbeiten" : "lesen");
    if (neu.abgeschlossen) api.protokollHistorie(neu.id).then(setHistorie).catch(() => setHistorie([]));
  }, []);

  useEffect(() => {
    api.protokoll(id).then(uebernehmen).catch((err) => setFehler(err.message));
    api
      .benutzerListe()
      .then((l) => setPersonen(l.filter((b) => b.aktiv).map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name, "de"))))
      .catch(() => setPersonen([]));
  }, [id, uebernehmen]);

  // Entwurf automatisch zwischenspeichern: niemand soll im Nachtdienst eine
  // halbe Eingabe verlieren. Pflicht prueft der Server erst beim Abschliessen.
  useEffect(() => {
    if (modus !== "bearbeiten" || !geaendert.current) return;
    const t = window.setTimeout(async () => {
      geaendert.current = false;
      try {
        const neu = await api.protokollEntwurfSpeichern(id, werte);
        setP(neu);
        setGespeichertUm(new Date().toISOString());
        setFeldFehler({});
      } catch (err) {
        zeigeFehler(err, "Entwurf konnte nicht gespeichert werden.");
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [werte, modus, id]);

  function zeigeFehler(err: unknown, fallback: string) {
    if (err instanceof ApiFehler && err.fehler) {
      setFeldFehler(Object.fromEntries(err.fehler.map((f) => [f.schluessel, f.meldung])));
    }
    setFehler(err instanceof Error ? err.message : fallback);
  }

  function aendern(schluessel: string, wert: FeldWert | null) {
    geaendert.current = true;
    setWerte((alt) => ({ ...alt, [schluessel]: wert }));
    setFeldFehler((alt) => {
      if (!(schluessel in alt)) return alt;
      const { [schluessel]: _weg, ...rest } = alt;
      return rest;
    });
  }

  async function abschliessen() {
    setFehler(null);
    setWirdGespeichert(true);
    geaendert.current = false;
    try {
      uebernehmen(await api.protokollAbschliessen(id, werte));
      setFeldFehler({});
    } catch (err) {
      zeigeFehler(err, "Protokoll konnte nicht abgeschlossen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function korrekturSpeichern() {
    setFehler(null);
    if (!grund.trim()) {
      setFehler("Bitte einen Grund für die Korrektur angeben.");
      return;
    }
    setWirdGespeichert(true);
    try {
      uebernehmen(await api.protokollKorrigieren(id, werte, grund.trim()));
      setGrund("");
      setFeldFehler({});
    } catch (err) {
      zeigeFehler(err, "Korrektur konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function verwerfen() {
    try {
      await api.protokollEntwurfLoeschen(id);
      onZurueck();
    } catch (err) {
      zeigeFehler(err, "Entwurf konnte nicht verworfen werden.");
    }
  }

  const verworfen = useMemo(() => (p ? verworfeneAngaben(p.definition, werte) : []), [p, werte]);
  const beschriftung = useMemo(() => new Map(p ? alleBausteine(p.definition).map((b) => [b.schluessel, b]) : []), [p]);
  const namen = useMemo(() => {
    const n: Record<string, string> = { ...(p?.personen ?? {}) };
    for (const x of personen) n[x.id] = x.name;
    return n;
  }, [p, personen]);

  if (!p) {
    return fehler ? (
      <div className="zv-hinweis zv-hinweis-fehler">
        <IFehler />
        {fehler}
      </div>
    ) : null;
  }

  const bearbeitend = modus !== "lesen";

  return (
    <div className="zv-protokoll-detail">
      {ruecksprung ? (
        <div className="zv-protokoll-ruecksprung">
          <button type="button" className="zv-link-btn zv-protokoll-zurueck-tagesbericht" onClick={ruecksprung.onKlick}>
            <IZurueck />
            {ruecksprung.label}
          </button>
          <button type="button" className="zv-link-btn" onClick={onZurueck}>
            Alle Protokolle
          </button>
        </div>
      ) : (
        <button type="button" className="zv-link-btn" onClick={onZurueck}>
          <IZurueck />
          Alle Protokolle
        </button>
      )}

      <div className="zv-protokoll-kopf">
        <div>
          <h3>{p.formularName}</h3>
          <p className="zv-protokoll-meta">
            {formatDatum(p.bezugsdatum)} · {zuordnungText(p)} · {p.autorName ?? "–"}
            {p.abgeschlossenAm && ` · abgeschlossen ${formatDatum(p.abgeschlossenAm.slice(0, 10))}, ${formatUhrzeit(p.abgeschlossenAm)}`} · Formular
            Version {p.versionNummer}
          </p>
        </div>
        <div className="zv-protokoll-kopf-aktionen">
          <span className={`zv-pill${p.abgeschlossen ? " zv-pill-ok" : " zv-pill-frist"}`}>{p.abgeschlossen ? "abgeschlossen" : "Entwurf"}</span>
          {p.abgeschlossen && p.bearbeitbar && modus === "lesen" && (
            <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setModus("korrigieren")}>
              <IBearbeiten />
              Korrigieren
            </button>
          )}
        </div>
      </div>

      {!p.abgeschlossen && p.neuereVersion && (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          Es gibt eine neuere Version dieses Formulars. Dieser Entwurf bleibt bei Version {p.versionNummer}.
        </div>
      )}
      {modus === "korrigieren" && (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          Das Protokoll ist abgeschlossen. Jede Änderung wird mit Grund, Person und Zeitpunkt in der Historie festgehalten.
        </div>
      )}
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}

      {bearbeitend ? (
        <ProtokollEingabe
          definition={p.definition}
          werte={werte}
          anzeige={p.anzeige}
          quellen={p.quellen}
          personen={p.personen}
          auswahlPersonen={personen}
          fehler={feldFehler}
          onAendern={aendern}
        />
      ) : (
        <ProtokollAnsicht definition={p.definition} werte={p.werte} anzeige={p.anzeige} quellen={p.quellen} personen={namen} />
      )}

      {bearbeitend && verworfen.length > 0 && (
        <div className="zv-hinweis zv-protokoll-warnung">
          <IInfo />
          Ausgeblendet und wird beim Speichern verworfen: {verworfen.join(", ")}.
        </div>
      )}

      {modus === "bearbeiten" && (
        <div className="zv-protokoll-leiste">
          <span className="zv-protokoll-status" aria-live="polite">
            {gespeichertUm ? `Entwurf gespeichert ${formatUhrzeit(gespeichertUm)}` : "Entwurf"}
          </span>
          <button type="button" className="zv-btn zv-btn-still" onClick={() => setVerwerfenOffen(true)}>
            <ILoeschen />
            Verwerfen
          </button>
          <button type="button" className="zv-btn" onClick={abschliessen} disabled={wirdGespeichert}>
            <IBestaetigen />
            {wirdGespeichert ? "Wird abgeschlossen…" : "Abschließen"}
          </button>
        </div>
      )}

      {modus === "korrigieren" && (
        <div className="zv-protokoll-korrektur">
          <div className="zv-field">
            <label htmlFor="zv-korrektur-grund">Grund der Korrektur *</label>
            <input id="zv-korrektur-grund" value={grund} maxLength={1000} onChange={(e) => setGrund(e.target.value)} placeholder="z. B. Uhrzeit laut Dienstbuch" />
          </div>
          <div className="zv-protokoll-leiste">
            <button
              type="button"
              className="zv-btn zv-btn-still"
              onClick={() => {
                setWerte(p.werte);
                setFeldFehler({});
                setFehler(null);
                setModus("lesen");
              }}
            >
              Abbrechen
            </button>
            <button type="button" className="zv-btn" onClick={korrekturSpeichern} disabled={wirdGespeichert}>
              <ISpeichern />
              Korrektur speichern
            </button>
          </div>
        </div>
      )}

      {verwerfenOffen && (
        <Modal titel="Entwurf verwerfen?" onClose={() => setVerwerfenOffen(false)}>
          <p className="zv-protokoll-modal-text">Der Entwurf wird gelöscht. Abgeschlossene Protokolle sind davon nie betroffen.</p>
          <button className="zv-btn zv-btn-gefahr zv-btn-block" onClick={verwerfen}>
            <ILoeschen />
            Entwurf verwerfen
          </button>
        </Modal>
      )}

      {p.abgeschlossen && historie.length > 0 && (
        <section className="zv-protokoll-historie">
          <h4>Änderungen nach dem Abschließen</h4>
          <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1fr 1fr 1.2fr 1.6fr 1.4fr" } as CSSProperties}>
            <div className="zv-liste-kopf">
              <span>Wann</span>
              <span>Wer</span>
              <span>Feld</span>
              <span>vorher → nachher</span>
              <span>Grund</span>
            </div>
            {historie.map((h) => {
              const b = beschriftung.get(h.feldSchluessel);
              return (
                <div key={h.id} className="zv-info-karte">
                  <span className="zv-liste-zelle" data-label="Wann">
                    {formatDatum(h.geaendertAm.slice(0, 10))}, {formatUhrzeit(h.geaendertAm)}
                  </span>
                  <span className="zv-liste-zelle" data-label="Wer">
                    {h.geaendertVonName ?? "–"}
                  </span>
                  <span className="zv-liste-zelle" data-label="Feld">
                    {h.feldBeschriftung}
                  </span>
                  <span className="zv-liste-zelle" data-label="vorher → nachher">
                    {wertAlsText(b, h.wertAlt, namen)} → {wertAlsText(b, h.wertNeu, namen)}
                  </span>
                  <span className="zv-liste-zelle" data-label="Grund">
                    {h.grund}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
