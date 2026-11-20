import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Reiterleiste } from "../components/Reiterleiste";
import {
  ANHEFTPUNKTE,
  ZUORDNUNG_ERKLAERUNG,
  ZUORDNUNG_LABEL,
  zuordnungKenntKlient,
  ANHEFT_DARSTELLUNG_LABEL,
  FORMULAR_STATUS_LABEL,
  formularVergleich,
  pruefeVeroeffentlichung,
  type Anheftpunkt,
  type FormularAnheftung,
  type FormularDefinition,
  type FormularDetailDto,
  type FormularKennzahlenDto,
  type FormularStatus,
  type FormularVerwaltungDto,
  type StandortDto,
} from "@zimmerakte/shared";
import { api, ApiFehler } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { Filterleiste, OptionenFilter, trifftSuche } from "../components/Listenfilter";
import { FormularEditor } from "../components/FormularEditor";
import {
  IArchivieren,
  IBearbeiten,
  IBestaetigen,
  IDokument,
  IEntarchivieren,
  IFehler,
  IInfo,
  ILoeschen,
  INeu,
  ISichtbar,
  IStandort,
  ITag,
  IVerknuepft,
  IZurueck,
} from "../components/icons";
import { formatDatum, formatUhrzeit } from "../format";
import { FormularUebersicht } from "./formulare/FormularUebersicht";
import { aufbauVersionen, FormularAufbau, VersionWahl } from "./formulare/FormularAufbau";
import { FormularAnsichten } from "./formulare/FormularAnsichten";

/**
 * Formulare selbst bauen (Rueckmeldung "Formulare", Konzept
 * /mnt/project-files/formulare/konzept-formulare.md). Nur fuer das Recht
 * protokolle.formulare-verwalten -- die Pruefung, die zaehlt, sitzt im
 * Service; ohne Recht ist der Menuepunkt gar nicht da.
 */

const STATUS_PILL: Record<FormularStatus, string> = {
  in_entwicklung: "zv-pill zv-pill-frist",
  veroeffentlicht: "zv-pill zv-pill-ok",
  stillgelegt: "zv-pill",
};

const SPALTEN = {
  "--zv-liste-spalten": "minmax(0,2.2fr) minmax(150px,1.2fr) minmax(64px,0.5fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(80px,0.6fr) minmax(80px,0.6fr)",
} as CSSProperties;

function standorteText(ids: string[], standorte: StandortDto[]): string {
  if (ids.length === 0) return "Alle Standorte";
  const namen = ids.map((id) => standorte.find((s) => s.id === id)?.name ?? "unbekannt");
  return namen.length <= 2 ? namen.join(", ") : `${namen.length} Standorte`;
}

function anheftungText(a: FormularAnheftung[]): string {
  if (a.length === 0) return "–";
  return a
    .map((x) => `${ANHEFTPUNKTE[x.anheftpunkt].label.replace(" anlegen", "")} · ${x.darstellung === "ersetzt" ? "ersetzt die Standardsicht" : x.modus === "automatisch" ? (x.pflicht ? "Pflicht" : "automatisch") : "zum Dazunehmen"}`)
    .join(", ");
}

function StatusPills({ f }: { f: FormularVerwaltungDto }) {
  return (
    <span className="zv-formular-status">
      <span className={STATUS_PILL[f.status]}>{FORMULAR_STATUS_LABEL[f.status]}</span>
      {f.status === "veroeffentlicht" && f.entwurfVersion !== null && <span className="zv-pill zv-pill-frist">Änderungen in Entwicklung</span>}
    </span>
  );
}

export function Formulare() {
  const [liste, setListe] = useState<FormularVerwaltungDto[] | null>(null);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenId, setOffenId] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [standortFilter, setStandortFilter] = useState("");
  const [anheftFilter, setAnheftFilter] = useState("");

  const laden = useCallback(() => {
    api
      .formulare()
      .then((l) => {
        setListe(l);
        setFehler(null);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen."));
  }, []);
  useEffect(laden, [laden]);
  useEffect(() => {
    api
      .standorteListe()
      .then((l) => setStandorte(l.filter((s) => s.aktiv)))
      .catch(() => setStandorte([]));
  }, []);

  const sichtbar = useMemo(
    () =>
      (liste ?? []).filter(
        (f) =>
          (!statusFilter ||
            (statusFilter === "aenderungen" ? f.status === "veroeffentlicht" && f.entwurfVersion !== null : f.status === statusFilter)) &&
          // "Alle Standorte" gilt auch fuer jeden einzelnen -- sonst fehlte bei Filter "Haus A" gerade das Formular, das ueberall gilt.
          (!standortFilter || f.standortIds.length === 0 || f.standortIds.includes(standortFilter)) &&
          (!anheftFilter || (anheftFilter === "keine" ? f.anheftungen.length === 0 : f.anheftungen.some((a) => a.anheftpunkt === anheftFilter))) &&
          trifftSuche(suche, [f.name, f.beschreibung]),
      ),
    [liste, statusFilter, standortFilter, anheftFilter, suche],
  );

  if (offenId) {
    return (
      <FormularDetail
        id={offenId}
        standorte={standorte}
        onZurueck={() => {
          setOffenId(null);
          laden();
        }}
      />
    );
  }

  const filterAktiv = Boolean(statusFilter || standortFilter || anheftFilter || suche.trim());

  return (
    <div>
      <div className="zv-seiten-kopf">
        <h2>Formulare</h2>
        <button type="button" className="zv-btn" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neues Formular
        </button>
      </div>
      <p className="zv-sub zv-formulare-einleitung">
        Formulare in Entwicklung sieht nur, wer sie baut. Ausgefüllt wird nur, was veröffentlicht ist: in der Klientenakte unter Protokolle und dort, wo ein Formular
        angeheftet ist.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {liste && liste.length > 0 && (
        <>
          <Filterleiste
            ariaLabel="Formulare filtern"
            suche={{ wert: suche, onChange: setSuche, placeholder: "Name, Beschreibung…", ariaLabel: "Formulare durchsuchen" }}
            aktiv={filterAktiv}
            onZuruecksetzen={() => {
              setStatusFilter("");
              setStandortFilter("");
              setAnheftFilter("");
              setSuche("");
            }}
          >
            <OptionenFilter
              icon={<ITag />}
              label="Status"
              optionen={[
                { wert: "in_entwicklung", label: FORMULAR_STATUS_LABEL.in_entwicklung },
                { wert: "veroeffentlicht", label: FORMULAR_STATUS_LABEL.veroeffentlicht },
                { wert: "aenderungen", label: "Veröffentlicht, Änderungen in Entwicklung" },
                { wert: "stillgelegt", label: FORMULAR_STATUS_LABEL.stillgelegt },
              ]}
              wert={statusFilter}
              onWaehlen={setStatusFilter}
            />
            {standorte.length > 1 && (
              <OptionenFilter
                icon={<IStandort />}
                label="Standort"
                optionen={standorte.map((s) => ({ wert: s.id, label: s.name }))}
                wert={standortFilter}
                onWaehlen={setStandortFilter}
              />
            )}
            <OptionenFilter
              icon={<IVerknuepft />}
              label="Angeheftet an"
              optionen={[
                ...(Object.keys(ANHEFTPUNKTE) as Anheftpunkt[]).map((a) => ({ wert: a, label: ANHEFTPUNKTE[a].label })),
                { wert: "keine", label: "Nirgends angeheftet" },
              ]}
              wert={anheftFilter}
              onWaehlen={setAnheftFilter}
            />
          </Filterleiste>
          <div className="zv-sub-inline" aria-live="polite" style={{ marginBottom: "var(--zv-space-3)" }}>
            {sichtbar.length} von {liste.length} {liste.length === 1 ? "Formular" : "Formularen"}
          </div>
        </>
      )}

      {liste && liste.length === 0 && !fehler && (
        <Leerzustand icon={IDokument}>Noch keine Formulare. Mit „Neues Formular“ fangen Sie mit einem leeren Formular an.</Leerzustand>
      )}
      {liste && liste.length > 0 && sichtbar.length === 0 && <Leerzustand icon={IDokument}>Kein Formular passt zu den Filtern.</Leerzustand>}

      {sichtbar.length > 0 && (
        <div className="zv-karten-liste" style={SPALTEN}>
          <div className="zv-liste-kopf">
            <span>Name</span>
            <span>Status</span>
            <span>Version</span>
            <span>Standorte</span>
            <span>Angeheftet an</span>
            <span>Protokolle</span>
            <span>30 Tage</span>
          </div>
          {sichtbar.map((f) => (
            <div
              key={f.id}
              className="zv-info-karte zv-info-karte-klickbar"
              role="button"
              tabIndex={0}
              onClick={() => setOffenId(f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOffenId(f.id);
                }
              }}
            >
              <span className="zv-liste-zelle-titel">
                {f.name}
                {f.beschreibung && <span className="zv-formular-meta">{f.beschreibung}</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <StatusPills f={f} />
              </span>
              <span className="zv-liste-zelle zv-mono" data-label="Version">
                {f.veroeffentlichteVersion ?? "–"}
                {f.entwurfVersion !== null && f.veroeffentlichteVersion !== null && <span className="zv-sub-inline"> → {f.entwurfVersion}</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Standorte">
                {standorteText(f.standortIds, standorte)}
              </span>
              <span className="zv-liste-zelle" data-label="Angeheftet an">
                {anheftungText(f.anheftungen)}
              </span>
              <span className="zv-liste-zelle zv-mono" data-label="Protokolle">
                {f.anzahlProtokolle}
              </span>
              <span className="zv-liste-zelle zv-mono" data-label="Letzte 30 Tage">
                {f.anzahl30Tage}
              </span>
            </div>
          ))}
        </div>
      )}

      {neuOffen && (
        <NeuesFormular
          onClose={() => setNeuOffen(false)}
          onAngelegt={(d) => {
            setNeuOffen(false);
            setOffenId(d.id);
          }}
        />
      )}
    </div>
  );
}

function NeuesFormular({ onClose, onAngelegt }: { onClose: () => void; onAngelegt: (d: FormularDetailDto) => void }) {
  const [name, setName] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  return (
    <Modal titel="Neues Formular" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setFehler("Bitte einen Namen eingeben.");
          setLaeuft(true);
          setFehler(null);
          try {
            onAngelegt(await api.formularAnlegen(name.trim(), beschreibung.trim() || null));
          } catch (err) {
            setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
            setLaeuft(false);
          }
        }}
      >
        <p className="zv-protokoll-modal-text zv-sub">Sie fangen mit einem leeren Formular an. Es bleibt in Entwicklung, bis Sie es veröffentlichen.</p>
        <div className="zv-field">
          <label htmlFor="zv-neues-formular-name">Name</label>
          <input id="zv-neues-formular-name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} placeholder="z. B. Nachtdienstprotokoll" />
        </div>
        <div className="zv-field">
          <label htmlFor="zv-neues-formular-beschreibung">Kurze Beschreibung</label>
          <input id="zv-neues-formular-beschreibung" value={beschreibung} maxLength={500} onChange={(e) => setBeschreibung(e.target.value)} placeholder="optional" />
        </div>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-protokoll-leiste">
          <button type="button" className="zv-btn zv-btn-still" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="zv-btn" disabled={laeuft}>
            <INeu />
            Anlegen und bauen
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ein Formular: Aufbau, Einstellungen, Versionen
// ---------------------------------------------------------------------------

type Reiter = "uebersicht" | "aufbau" | "ansichten" | "einstellungen" | "versionen";

function FormularDetail({ id, standorte, onZurueck }: { id: string; standorte: StandortDto[]; onZurueck: () => void }) {
  const [d, setD] = useState<FormularDetailDto | null>(null);
  // null bis das Formular geladen ist: ein nie veroeffentlichtes Formular oeffnet im
  // Aufbau (dort wird gearbeitet), alle anderen in der Übersicht (Konzept „Aufbau Formular“).
  const [reiterGewaehlt, setReiter] = useState<Reiter | null>(null);
  const [kennzahlen, setKennzahlen] = useState<FormularKennzahlenDto | null>(null);
  const [kennzahlenFehler, setKennzahlenFehler] = useState<string | null>(null);
  // null = Standard: der Entwurf, wenn es einen gibt, sonst die veroeffentlichte Version.
  const [aufbauVersion, setAufbauVersion] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<FormularDefinition | null>(null);
  const [speicher, setSpeicher] = useState<{ zustand: "gespeichert" | "laeuft" | "fehler"; um?: string; meldung?: string }>({ zustand: "gespeichert" });
  const [veroeffentlichenOffen, setVeroeffentlichenOffen] = useState(false);
  const [loeschenOffen, setLoeschenOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  // Letzter Stand, der noch nicht beim Server ist. Ein Ref statt State, weil
  // "jetzt sofort speichern" (vor dem Veroeffentlichen) nicht auf ein Rendern warten darf.
  const offen = useRef<FormularDefinition | null>(null);
  const timer = useRef<number | null>(null);

  const uebernehmen = useCallback((neu: FormularDetailDto) => {
    setD(neu);
    setEntwurf(neu.entwurf?.definition ?? null);
  }, []);

  useEffect(() => {
    api
      .formular(id)
      .then((neu) => {
        uebernehmen(neu);
        // Den Startreiter einmal festlegen -- sonst sprange die Seite nach dem ersten
        // Veroeffentlichen vom Aufbau in die Übersicht.
        setReiter((r) => r ?? (neu.veroeffentlichteVersion === null ? "aufbau" : "uebersicht"));
      })
      .catch((err) => setFehler(err.message));
  }, [id, uebernehmen]);

  // Neu laden, wenn sich die ausgefuellte Version aendert (Veroeffentlichen) -- die Zahlen je Version haengen daran.
  const veroeffentlichteVersion = d?.veroeffentlichteVersion;
  useEffect(() => {
    if (veroeffentlichteVersion === undefined) return;
    let aktiv = true;
    api
      .formularKennzahlen(id)
      .then((k) => {
        if (!aktiv) return;
        setKennzahlen(k);
        setKennzahlenFehler(null);
      })
      .catch((err) => aktiv && setKennzahlenFehler(err instanceof Error ? err.message : "Zahlen konnten nicht geladen werden."));
    return () => {
      aktiv = false;
    };
  }, [id, veroeffentlichteVersion]);

  const speichernJetzt = useCallback(async (): Promise<boolean> => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const def = offen.current;
    if (!def) return true;
    offen.current = null;
    setSpeicher({ zustand: "laeuft" });
    try {
      const neu = await api.formularEntwurfSpeichern(id, def);
      // Nur Kopfdaten uebernehmen: der Editor behaelt seinen eigenen, evtl. schon neueren Stand.
      setD(neu);
      setSpeicher({ zustand: "gespeichert", um: formatUhrzeit(new Date().toISOString()) });
      return true;
    } catch (err) {
      offen.current = offen.current ?? def;
      setSpeicher({ zustand: "fehler", meldung: err instanceof Error ? err.message : "Speichern fehlgeschlagen." });
      return false;
    }
  }, [id]);

  // Beim Verlassen nichts verlieren.
  useEffect(
    () => () => {
      if (offen.current) void speichernJetzt();
    },
    [speichernJetzt],
  );

  function entwurfAendern(def: FormularDefinition) {
    setEntwurf(def);
    offen.current = def;
    setSpeicher({ zustand: "laeuft" });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void speichernJetzt(), 800);
  }

  async function aktion(fn: () => Promise<FormularDetailDto>) {
    setFehler(null);
    setLaeuft(true);
    try {
      uebernehmen(await fn());
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
    } finally {
      setLaeuft(false);
    }
  }

  if (!d) {
    return (
      <div>
        <button type="button" className="zv-link-btn" onClick={onZurueck}>
          <IZurueck /> Alle Formulare
        </button>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
      </div>
    );
  }

  const stillgelegt = d.status === "stillgelegt";
  const reiter: Reiter = reiterGewaehlt ?? (d.veroeffentlichteVersion === null ? "aufbau" : "uebersicht");
  const versionen = aufbauVersionen(d);
  const standardVersion = d.entwurf && !stillgelegt ? d.entwurf.nummer : (d.veroeffentlichteVersion ?? versionen[0]?.nummer ?? 1);
  const gezeigteVersion = aufbauVersion !== null && versionen.some((v) => v.nummer === aufbauVersion) ? aufbauVersion : standardVersion;
  const imEditor = !stillgelegt && d.entwurf !== null && gezeigteVersion === d.entwurf.nummer;
  const versionAnsehen = (n: number) => {
    setAufbauVersion(n);
    setReiter("aufbau");
  };
  const speicherText =
    speicher.zustand === "laeuft" ? "Wird gespeichert…" : speicher.zustand === "fehler" ? speicher.meldung : speicher.um ? `Entwurf gespeichert ${speicher.um}` : "Entwurf gespeichert";

  return (
    <div className="zv-formular-detail">
      <button type="button" className="zv-link-btn" onClick={onZurueck}>
        <IZurueck /> Alle Formulare
      </button>
      <div className="zv-seiten-kopf zv-formular-kopf">
        <div>
          <h2>{d.name}</h2>
          <div className="zv-formular-kopf-meta">
            <StatusPills f={d} />
            {d.veroeffentlichteVersion !== null && <span className="zv-sub-inline">ausgefüllt wird Version {d.veroeffentlichteVersion}</span>}
            {d.entwurf && <span className="zv-sub-inline">in Arbeit: Version {d.entwurf.nummer}</span>}
          </div>
        </div>
        <div className="zv-aktionen-reihe">
          {!stillgelegt && d.entwurf && d.veroeffentlicht && (
            <button type="button" className="zv-btn zv-btn-still" disabled={laeuft} onClick={() => aktion(() => api.formularEntwurfVerwerfen(d.id))}>
              Änderungen verwerfen
            </button>
          )}
          {!stillgelegt && d.entwurf && (
            <button
              type="button"
              className="zv-btn"
              disabled={laeuft}
              onClick={async () => {
                if (await speichernJetzt()) setVeroeffentlichenOffen(true);
              }}
            >
              <IBestaetigen />
              Veröffentlichen
            </button>
          )}
          {!stillgelegt && !d.entwurf && (
            <button
              type="button"
              className="zv-btn"
              disabled={laeuft}
              onClick={() => {
                setReiter("aufbau");
                setAufbauVersion(null);
                void aktion(() => api.formularEntwurfStarten(d.id));
              }}
            >
              <IBearbeiten />
              Bearbeiten
            </button>
          )}
        </div>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {d.status === "in_entwicklung" && (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          In Entwicklung: wird noch nirgends zum Ausfüllen angeboten.
        </div>
      )}
      {d.status === "veroeffentlicht" && d.entwurf && (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          Ihre Änderungen sind Version {d.entwurf.nummer}. Bis Sie veröffentlichen, füllen alle weiter Version {d.veroeffentlichteVersion} aus.
        </div>
      )}
      {stillgelegt && (
        <div className="zv-hinweis zv-hinweis-info">
          <IArchivieren />
          Stillgelegt: wird nicht mehr angeboten. Vorhandene Protokolle bleiben lesbar.
        </div>
      )}

      <Reiterleiste
        label="Bereiche des Formulars"
        idPraefix="formular"
        mitPanel={false}
        aktiv={reiter}
        onWahl={setReiter}
        reiter={[
          { wert: "uebersicht", label: "Übersicht" },
          { wert: "aufbau", label: "Aufbau" },
          { wert: "ansichten", label: "Ansichten" },
          { wert: "einstellungen", label: "Einstellungen" },
          { wert: "versionen", label: "Versionen" },
        ]}
      />

      {reiter === "uebersicht" && (
        <FormularUebersicht
          d={d}
          k={kennzahlen}
          fehler={kennzahlenFehler}
          standorte={standorte}
          onVersionAnsehen={versionAnsehen}
          onEntwurfOeffnen={() => versionAnsehen(d.entwurf!.nummer)}
          onEinstellungen={() => setReiter("einstellungen")}
        />
      )}

      {reiter === "aufbau" &&
        (imEditor && entwurf ? (
          <>
            {versionen.length > 1 && (
              <div className="zv-fa-leiste">
                <div className="zv-fa-leiste-links">
                  <VersionWahl versionen={versionen} gewaehlt={gezeigteVersion} onWaehlen={setAufbauVersion} />
                  <span className="zv-sub">Ältere Versionen nur zum Ansehen</span>
                </div>
              </div>
            )}
            <p className="zv-formular-schmal-hinweis zv-hinweis zv-hinweis-info">
              <IInfo />
              Der Editor braucht einen größeren Bildschirm. Bitte am Rechner bearbeiten.
            </p>
            <FormularEditor definition={entwurf} frueher={d.frueher} onAendern={entwurfAendern} status={speicherText} />
          </>
        ) : (
          <FormularAufbau d={d} version={gezeigteVersion} onVersion={setAufbauVersion} kennzahlen={kennzahlen} />
        ))}

      {reiter === "ansichten" && <FormularAnsichten key={d.id} d={d} kennzahlen={kennzahlen} />}

      {reiter === "einstellungen" && (
        <Einstellungen
          key={`${d.id}-${d.name}`}
          d={d}
          standorte={standorte}
          onGespeichert={uebernehmen}
          onLoeschen={() => setLoeschenOffen(true)}
          onStilllegen={(archiviert) => aktion(() => api.formularArchivieren(d.id, archiviert))}
          laeuft={laeuft}
        />
      )}

      {reiter === "versionen" && <Versionen d={d} onAnsehen={versionAnsehen} />}

      {veroeffentlichenOffen && d.entwurf && (
        <Veroeffentlichen
          d={d}
          definition={entwurf ?? d.entwurf.definition}
          standorte={standorte}
          onClose={() => setVeroeffentlichenOffen(false)}
          onFertig={(neu) => {
            setVeroeffentlichenOffen(false);
            uebernehmen(neu);
          }}
        />
      )}

      {loeschenOffen && (
        <Modal titel="Formular löschen?" onClose={() => setLoeschenOffen(false)}>
          <p className="zv-protokoll-modal-text">„{d.name}“ wurde nie veröffentlicht und hat keine Protokolle. Es wird endgültig gelöscht.</p>
          <div className="zv-protokoll-leiste">
            <button type="button" className="zv-btn zv-btn-still" onClick={() => setLoeschenOffen(false)}>
              Abbrechen
            </button>
            <button
              type="button"
              className="zv-btn zv-btn-gefahr"
              onClick={async () => {
                try {
                  offen.current = null;
                  await api.formularLoeschen(d.id);
                  onZurueck();
                } catch (err) {
                  setLoeschenOffen(false);
                  setFehler(err instanceof Error ? err.message : "Löschen fehlgeschlagen.");
                }
              }}
            >
              <ILoeschen />
              Endgültig löschen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Einstellungen({
  d,
  standorte,
  onGespeichert,
  onLoeschen,
  onStilllegen,
  laeuft,
}: {
  d: FormularDetailDto;
  standorte: StandortDto[];
  onGespeichert: (d: FormularDetailDto) => void;
  onLoeschen: () => void;
  onStilllegen: (archiviert: boolean) => void;
  laeuft: boolean;
}) {
  const [name, setName] = useState(d.name);
  const [beschreibung, setBeschreibung] = useState(d.beschreibung ?? "");
  const [alle, setAlle] = useState(d.standortIds.length === 0);
  const [ids, setIds] = useState<string[]>(d.standortIds);
  const [anheftungen, setAnheftungen] = useState<FormularAnheftung[]>(d.anheftungen);
  const [aufDokumentation, setAufDokumentation] = useState(d.aufDokumentation);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const [speichert, setSpeichert] = useState(false);

  // Ein Standort, der inzwischen deaktiviert ist, bleibt sichtbar angehakt -- sonst verschwaende er beim naechsten Speichern still.
  const angezeigt = [...standorte, ...d.standortIds.filter((x) => !standorte.some((s) => s.id === x)).map((x) => ({ id: x, name: "Deaktivierter Standort" }) as StandortDto)];

  function anheftung(punkt: Anheftpunkt): FormularAnheftung | undefined {
    return anheftungen.find((a) => a.anheftpunkt === punkt);
  }
  function setzeAnheftung(punkt: Anheftpunkt, neu: FormularAnheftung | null) {
    setAnheftungen((alt) => [...alt.filter((a) => a.anheftpunkt !== punkt), ...(neu ? [neu] : [])]);
    setGespeichert(false);
  }

  async function speichern() {
    if (!name.trim()) return setFehler("Bitte einen Namen eingeben.");
    if (!alle && ids.length === 0) return setFehler("Bitte mindestens einen Standort wählen oder „Alle Standorte“.");
    setFehler(null);
    setSpeichert(true);
    try {
      const neu = await api.formularEinstellungen(d.id, {
        name: name.trim(),
        beschreibung: beschreibung.trim() || null,
        standortIds: alle ? [] : ids,
        // Anheften an den Tagesbericht gibt es nur fuer Klienten-Formulare (ladeAngebot filtert sie sonst ohnehin heraus).
        anheftungen: zuordnungKenntKlient(d.zuordnung) ? anheftungen : [],
        aufDokumentation,
      });
      onGespeichert(neu);
      setGespeichert(true);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSpeichert(false);
    }
  }

  const geaendert = () => setGespeichert(false);

  return (
    <div className="zv-formular-einstellungen">
      {/* Speichern oben und mitlaufend: unten zwischen Anheftungen und Stilllegen wurde der Knopf leicht uebersehen (Rueckmeldung „Aufbau Formular“). */}
      <div className="zv-fe-speichernleiste">
        <span>Wirkt sofort und braucht keine neue Version: es ändert nicht, was gefragt wird, sondern wo das Formular angeboten wird.</span>
        <span className="zv-fe-speichernleiste-rechts">
          {gespeichert && (
            <span className="zv-protokoll-status">
              <IBestaetigen size={14} /> Gespeichert
            </span>
          )}
          <button type="button" className="zv-btn zv-btn-klein" disabled={speichert} onClick={speichern}>
            Einstellungen speichern
          </button>
        </span>
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-fe-spalten">
      <div className="zv-fe-spalte">
      <section className="zv-fo-karte">
        <h3>Allgemein</h3>
        <div className="zv-field">
          <label htmlFor="zv-fe-name">Name</label>
          <input id="zv-fe-name" value={name} maxLength={120} onChange={(e) => (setName(e.target.value), geaendert())} />
        </div>
        <div className="zv-field">
          <label htmlFor="zv-fe-beschreibung">Beschreibung</label>
          <input id="zv-fe-beschreibung" value={beschreibung} maxLength={500} onChange={(e) => (setBeschreibung(e.target.value), geaendert())} />
        </div>
      </section>

      <section className="zv-fo-karte">
        <h3>Standorte</h3>
        <p className="zv-sub">Maßgeblich ist der Standort, an dem die Klient:in gerade wohnt. Ohne aktuelle Belegung gibt es nur Formulare für alle Standorte.</p>
        <label className="zv-checkbox-zeile">
          <input type="radio" name="zv-fe-standorte" checked={alle} onChange={() => (setAlle(true), geaendert())} />
          Alle Standorte, auch künftige
        </label>
        <label className="zv-checkbox-zeile">
          <input type="radio" name="zv-fe-standorte" checked={!alle} onChange={() => (setAlle(false), geaendert())} />
          Nur ausgewählte
        </label>
        {!alle && (
          <div className="zv-formular-standorte">
            {angezeigt.map((s) => (
              <label key={s.id} className="zv-checkbox-zeile">
                <input
                  type="checkbox"
                  checked={ids.includes(s.id)}
                  onChange={(e) => {
                    setIds((alt) => (e.target.checked ? [...alt, s.id] : alt.filter((x) => x !== s.id)));
                    geaendert();
                  }}
                />
                {s.name}
              </label>
            ))}
            <span className="zv-sub-inline">
              {ids.length} von {standorte.length} ausgewählt
            </span>
          </div>
        )}
      </section>

      <section className="zv-fo-karte">
        <h3>Zuordnung und Dokumentation</h3>
        <p>
          <strong>{ZUORDNUNG_LABEL[d.zuordnung]}</strong>
          <span className="zv-formular-meta">{ZUORDNUNG_ERKLAERUNG[d.zuordnung]}</span>
        </p>
        <p className="zv-sub">Die Zuordnung ist Teil der Version und wird im Reiter „Aufbau“ geändert.</p>
        <label className="zv-checkbox-zeile">
          <input type="checkbox" checked={aufDokumentation} onChange={(e) => (setAufDokumentation(e.target.checked), geaendert())} />
          <span>
            <strong>Auf der Seite Dokumentation zum Ausfüllen anbieten</strong>
            <span className="zv-formular-meta">Im Knopf „Formular ausfüllen“. Klienten-Formulare bleiben in der Akte immer ausfüllbar.</span>
          </span>
        </label>
      </section>

      </div>
      <div className="zv-fe-spalte">
      {zuordnungKenntKlient(d.zuordnung) ? (
      <section className="zv-fo-karte">
        <h3>Angeheftet an</h3>
        <p className="zv-sub">In der Klientenakte unter Protokolle ist jedes veröffentlichte Formular immer dabei. Zusätzlich lässt es sich hier an Abläufe heften.</p>
        {(Object.keys(ANHEFTPUNKTE) as Anheftpunkt[]).map((punkt) => {
          const a = anheftung(punkt);
          return (
            <div key={punkt} className="zv-formular-anheftung">
              <label className="zv-checkbox-zeile">
                <input type="checkbox" checked={!!a} onChange={(e) => setzeAnheftung(punkt, e.target.checked ? { anheftpunkt: punkt, modus: "automatisch", pflicht: false, darstellung: "ergaenzt" } : null)} />
                <span>
                  <strong>{ANHEFTPUNKTE[punkt].label}</strong>
                  <span className="zv-formular-meta">{ANHEFTPUNKTE[punkt].beschreibung}</span>
                </span>
              </label>
              {a && (
                <div className="zv-formular-anheftung-optionen">
                  <label className="zv-checkbox-zeile">
                    <input type="radio" name={`zv-fe-modus-${punkt}`} checked={a.modus === "automatisch"} onChange={() => setzeAnheftung(punkt, { ...a, modus: "automatisch" })} />
                    Automatisch dabei
                  </label>
                  <label className="zv-checkbox-zeile zv-formular-einrueck">
                    <input
                      type="checkbox"
                      // Ersetzt das Formular die Standardsicht, ist es immer Pflicht (CHECK in 0077).
                      disabled={a.modus !== "automatisch" || a.darstellung === "ersetzt"}
                      checked={a.pflicht}
                      onChange={(e) => setzeAnheftung(punkt, { ...a, pflicht: e.target.checked })}
                    />
                    Pflicht: speichern erst, wenn das Formular vollständig ist
                  </label>
                  {punkt === "tagesbericht" && a.modus === "automatisch" && (
                    <fieldset className="zv-formular-darstellung zv-formular-einrueck">
                      <legend>Darstellung im Tagesbericht</legend>
                      <label className="zv-checkbox-zeile">
                        <input
                          type="radio"
                          name={`zv-fe-darstellung-${punkt}`}
                          checked={a.darstellung !== "ersetzt"}
                          onChange={() => setzeAnheftung(punkt, { ...a, darstellung: "ergaenzt" })}
                        />
                        <span>
                          {ANHEFT_DARSTELLUNG_LABEL.ergaenzt}
                          <span className="zv-formular-meta">Freitext bleibt Pflicht, das Formular kommt darunter.</span>
                        </span>
                      </label>
                      <label className="zv-checkbox-zeile">
                        <input
                          type="radio"
                          name={`zv-fe-darstellung-${punkt}`}
                          checked={a.darstellung === "ersetzt"}
                          onChange={() => setzeAnheftung(punkt, { ...a, darstellung: "ersetzt", pflicht: true })}
                        />
                        <span>
                          {ANHEFT_DARSTELLUNG_LABEL.ersetzt}
                          <span className="zv-formular-meta">Das Formular ist der Tagesbericht. Freitext nur noch als optionale Bemerkung.</span>
                        </span>
                      </label>
                    </fieldset>
                  )}
                  <label className="zv-checkbox-zeile">
                    <input
                      type="radio"
                      name={`zv-fe-modus-${punkt}`}
                      checked={a.modus === "dazunehmen"}
                      onChange={() => setzeAnheftung(punkt, { ...a, modus: "dazunehmen", pflicht: false, darstellung: "ergaenzt" })}
                    />
                    Zum Dazunehmen per Knopf
                  </label>
                </div>
              )}
            </div>
          );
        })}
        <p className="zv-protokoll-hilfe">Weitere Stellen wie Einzug, Auszug oder Termin erledigt kommen später dazu.</p>
      </section>
      ) : (
      <section className="zv-fo-karte">
        <h3>Angeheftet an</h3>
        <p className="zv-sub">An den Tagesbericht heften lassen sich nur Formulare, die zu einer Klient:in gehören.</p>
      </section>
      )}
      </div>
      </div>

      <section className="zv-fo-karte zv-formular-gefahr">
        <h3>{d.veroeffentlichteVersion === null ? "Löschen" : d.status === "stillgelegt" ? "Wieder aktivieren" : "Stilllegen"}</h3>
        {d.veroeffentlichteVersion === null ? (
          <>
            <p className="zv-sub">Solange ein Formular nie veröffentlicht war, gibt es keine Protokolle dazu. Danach lässt es sich nur noch stilllegen.</p>
            <button type="button" className="zv-btn zv-btn-gefahr zv-btn-klein" onClick={onLoeschen}>
              <ILoeschen />
              Formular löschen
            </button>
          </>
        ) : d.status === "stillgelegt" ? (
          <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" disabled={laeuft} onClick={() => onStilllegen(false)}>
            <IEntarchivieren />
            Wieder aktivieren
          </button>
        ) : (
          <>
            <p className="zv-sub">Stillgelegt wird es nirgends mehr angeboten. Die {d.anzahlProtokolle} vorhandenen Protokolle bleiben lesbar.</p>
            <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" disabled={laeuft} onClick={() => onStilllegen(true)}>
              <IArchivieren />
              Stilllegen
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function Versionen({ d, onAnsehen }: { d: FormularDetailDto; onAnsehen: (nummer: number) => void }) {
  return (
    <div
      className="zv-karten-liste"
      style={{ "--zv-liste-spalten": "minmax(64px,0.4fr) minmax(0,1.4fr) minmax(0,1.4fr) minmax(80px,0.6fr) minmax(220px,1fr)" } as CSSProperties}
    >
      <div className="zv-liste-kopf">
        <span>Version</span>
        <span>Veröffentlicht</span>
        <span>von</span>
        <span>Protokolle</span>
        <span />
      </div>
      {d.versionen.map((v) => (
        <div key={v.nummer} className="zv-info-karte">
          <span className="zv-liste-zelle-titel zv-mono">{v.nummer}</span>
          <span className="zv-liste-zelle" data-label="Veröffentlicht">
            {v.veroeffentlichtAm ? `${formatDatum(v.veroeffentlichtAm.slice(0, 10))}, ${formatUhrzeit(v.veroeffentlichtAm)}` : <span className="zv-pill zv-pill-frist">in Entwicklung</span>}
          </span>
          <span className="zv-liste-zelle" data-label="von">
            {v.veroeffentlichtVonName ?? "–"}
          </span>
          <span className="zv-liste-zelle zv-mono" data-label="Protokolle">
            {v.anzahlProtokolle}
          </span>
          <span className="zv-liste-zelle zv-formular-versions-knoepfe">
            <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => onAnsehen(v.nummer)}>
              <ISichtbar size={14} />
              {v.veroeffentlichtAm === null ? "Bearbeiten" : "Ansehen"}
            </button>
            {/* Die Markierung der Aenderungen ist im Aufbau standardmaessig an: "Ansehen" ist damit zugleich der Vergleich. */}
            {d.versionen.some((x) => x.nummer < v.nummer) && v.veroeffentlichtAm !== null && (
              <span className="zv-sub-inline">mit Änderungen zu {d.versionen.find((x) => x.nummer < v.nummer)!.nummer}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function Veroeffentlichen({
  d,
  definition,
  standorte,
  onClose,
  onFertig,
}: {
  d: FormularDetailDto;
  definition: FormularDefinition;
  standorte: StandortDto[];
  onClose: () => void;
  onFertig: (d: FormularDetailDto) => void;
}) {
  const vergleich = useMemo(() => formularVergleich(d.veroeffentlicht?.definition ?? null, definition), [d, definition]);
  const lokal = useMemo(() => pruefeVeroeffentlichung(definition, d.frueher), [definition, d.frueher]);
  const [serverPruefung, setServerPruefung] = useState<string[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const pruefung = serverPruefung ?? lokal;
  const nummer = d.entwurf!.nummer;

  return (
    <Modal titel={`Version ${nummer} veröffentlichen`} onClose={onClose}>
      <div className="zv-formular-veroeffentlichen">
        <h4>{d.veroeffentlicht ? `Was ist neu gegenüber Version ${d.veroeffentlicht.nummer}` : "Was veröffentlicht wird"}</h4>
        {vergleich.length === 0 ? (
          <p className="zv-sub">Keine Änderungen.</p>
        ) : (
          <ul className="zv-formular-aenderungen">
            {vergleich.map((a, i) => (
              <li key={i}>
                <span className={`zv-pill${a.art === "neu" ? " zv-pill-ok" : a.art === "entfernt" ? " zv-pill-danger" : a.art === "ausgeblendet" ? "" : " zv-pill-frist"}`}>
                  {a.art === "neu" ? "neu" : a.art === "entfernt" ? "entfernt" : a.art === "ausgeblendet" ? "ausgeblendet" : "geändert"}
                </span>
                {a.text}
              </li>
            ))}
          </ul>
        )}

        <h4>Prüfung</h4>
        {pruefung.length === 0 ? (
          <p className="zv-formular-pruefung-ok">
            <IBestaetigen size={14} /> Keine Fehler gefunden.
          </p>
        ) : (
          <ul className="zv-formular-pruefung">
            {pruefung.map((p) => (
              <li key={p}>
                <IFehler size={14} />
                {p}
              </li>
            ))}
          </ul>
        )}

        <h4>Ab sofort angeboten</h4>
        <p className="zv-sub">
          {standorteText(d.standortIds, standorte)} · in der Klientenakte unter Protokolle
          {d.anheftungen.length > 0 && ` · ${anheftungText(d.anheftungen)}`}
        </p>
        {d.offeneEntwuerfe > 0 && (
          <p className="zv-hinweis zv-hinweis-info">
            <IInfo />
            {d.offeneEntwuerfe === 1 ? "Ein angefangenes Protokoll bleibt" : `${d.offeneEntwuerfe} angefangene Protokolle bleiben`} auf Version {d.veroeffentlichteVersion}.
          </p>
        )}
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-protokoll-leiste">
          <button type="button" className="zv-btn zv-btn-still" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="zv-btn"
            disabled={laeuft || pruefung.length > 0}
            onClick={async () => {
              setLaeuft(true);
              setFehler(null);
              try {
                onFertig(await api.formularVeroeffentlichen(d.id));
              } catch (err) {
                if (err instanceof ApiFehler && err.zusatz.pruefung?.length) setServerPruefung(err.zusatz.pruefung);
                else setFehler(err instanceof Error ? err.message : "Veröffentlichen fehlgeschlagen.");
                setLaeuft(false);
              }
            }}
          >
            <IBestaetigen />
            Veröffentlichen
          </button>
        </div>
      </div>
    </Modal>
  );
}
