import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  RUECKMELDUNG_STATUS_LABEL,
  type MandantDto,
  type RueckmeldungArt,
  type RueckmeldungDetailDto,
  type RueckmeldungEntscheidung,
  type RueckmeldungListeDto,
  type RueckmeldungPrioritaet,
  type RueckmeldungStatus,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { IAnpassen, IBaumAnsicht, IErfolg, IFehler, ILeerAnwaerter, IPerson, IPrioritaetHoch, ITag } from "../components/icons";
import { Filterleiste, OptionenFilter, trifftSuche } from "../components/Listenfilter";
import { Leerzustand } from "../components/Leerzustand";
import { Seitenpanel } from "../components/Seitenpanel";
import { STANDARD_REITER, UNTERPUNKTE } from "../navigation";

const PILL: Record<RueckmeldungStatus, string> = {
  neu: "zv-pill zv-pill-info",
  freigegeben: "zv-pill zv-pill-ok",
  rueckfrage: "zv-pill zv-pill-achtung",
  in_arbeit: "zv-pill zv-pill-teilweise",
  umgesetzt: "zv-pill zv-pill-erledigt",
  abgelehnt: "zv-pill zv-pill-danger",
  duplikat: "zv-pill",
};

/** Reihenfolge = Lebenslauf einer Rueckmeldung; so stehen auch die Gruppen. */
const STATUS_REIHE: RueckmeldungStatus[] = ["neu", "rueckfrage", "freigegeben", "in_arbeit", "umgesetzt", "abgelehnt", "duplikat"];
const ART_LABEL: Record<RueckmeldungArt, string> = { idee: "Idee", fehler: "Fehler" };
const PRIO_REIHE: RueckmeldungPrioritaet[] = ["blockierend", "hoch", "mittel", "niedrig"];
const PRIO_LABEL: Record<RueckmeldungPrioritaet, string> = { blockierend: "Blockierend", hoch: "Hoch", mittel: "Mittel", niedrig: "Niedrig" };

type Gruppierung = "status" | "art" | "prioritaet" | "person";
const GRUPPIERUNG_LABEL: Record<Gruppierung, string> = {
  status: "Status",
  art: "Art",
  prioritaet: "Priorität",
  person: "Gemeldet von",
};

type Sortierung = "neueste" | "aelteste" | "prioritaet";
const SORTIERUNG_LABEL: Record<Sortierung, string> = { neueste: "Neueste zuerst", aelteste: "Älteste zuerst", prioritaet: "Priorität" };

const SPALTEN = { "--zv-liste-spalten": "minmax(0,2.4fr) minmax(64px,0.7fr) minmax(84px,0.8fr) minmax(0,1.2fr) minmax(120px,1fr) minmax(110px,0.9fr)" } as CSSProperties;

/**
 * Rahmenbedingungen lesbar statt als Rohschluessel ("viewport",
 * "theme: dunkel", ISO-Zeitstempel): feste Reihenfolge, deutsche
 * Bezeichnungen, formatierte Werte. "unbekannt" und leere Werte entfallen --
 * sie sagen nichts und machten die Liste nur laenger. Unbekannte Schluessel
 * (neuere App-Version) erscheinen trotzdem, mit ihrem Rohnamen.
 */
const KONTEXT_LABEL: Record<string, string> = {
  seite: "Seite",
  rolle: "Rolle",
  zeitpunkt: "Zeitpunkt",
  theme: "Darstellung",
  viewport: "Fenstergröße",
  browser: "Browser",
  betriebssystem: "Betriebssystem",
  appVersion: "App-Version",
};
const SEITEN_LABEL: Record<string, string> = Object.fromEntries([
  ...STANDARD_REITER.map((r) => [r.wert, r.label] as const),
  ...Object.values(UNTERPUNKTE).flatMap((l) => l!.map((u) => [u.wert, u.label] as const)),
  ["rueckmeldungen", "Rückmeldungen"],
]);
function kontextZeilen(kontext: RueckmeldungDetailDto["kontext"]): [string, string][] {
  const schluessel = [...Object.keys(KONTEXT_LABEL), ...Object.keys(kontext).filter((k) => !(k in KONTEXT_LABEL))];
  return schluessel.flatMap((k): [string, string][] => {
    const roh = (kontext as Record<string, unknown>)[k];
    if (roh === undefined || roh === null || roh === "" || roh === "unbekannt") return [];
    let wert = String(roh);
    if (k === "seite") wert = SEITEN_LABEL[wert] ?? wert;
    else if (k === "theme") wert = wert === "dunkel" ? "Dunkel" : wert === "hell" ? "Hell" : wert;
    else if (k === "viewport") wert = wert.replace("x", " × ") + " px";
    else if (k === "zeitpunkt" && !Number.isNaN(Date.parse(wert))) wert = datum(wert);
    return [[KONTEXT_LABEL[k] ?? k, wert]];
  });
}

const datum = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

function gruppenSchluessel(r: RueckmeldungListeDto, g: Gruppierung): string {
  if (g === "status") return r.status;
  if (g === "art") return r.art;
  if (g === "prioritaet") return r.prioritaet;
  return r.erstelltVonName;
}

function gruppenTitel(schluessel: string, g: Gruppierung): string {
  if (g === "status") return RUECKMELDUNG_STATUS_LABEL[schluessel as RueckmeldungStatus];
  if (g === "art") return ART_LABEL[schluessel as RueckmeldungArt];
  if (g === "prioritaet") return PRIO_LABEL[schluessel as RueckmeldungPrioritaet];
  return schluessel;
}

function gruppenRang(schluessel: string, g: Gruppierung): number | string {
  if (g === "status") return STATUS_REIHE.indexOf(schluessel as RueckmeldungStatus);
  if (g === "prioritaet") return PRIO_REIHE.indexOf(schluessel as RueckmeldungPrioritaet);
  return schluessel;
}

/**
 * Eingang der Rückmeldungen -- nur für Accounts mit dem Recht
 * rueckmeldungen.verwalten (Geschäftsführung). Die Freigabe hier entscheidet,
 * ob der Hersteller den Eintrag lesen darf; ob er es überhaupt darf, steht in
 * den Einstellungen (Weitergabe), und die Seite sagt offen, welcher Fall gilt.
 *
 * Liste wie Klienten/Kassenbuch: gemeinsame Filterleiste, Spaltenkopf,
 * standardmaessig ALLE Rueckmeldungen (Rueckmeldung aus dem Betrieb: der
 * fruehere Startfilter "Eingegangen" liess die Seite leer aussehen, sobald
 * alles entschieden war). Gefiltert wird im Client -- es sind wenige
 * Dutzend Eintraege, und die Gruppierung braucht ohnehin die ganze Liste.
 */
export function Rueckmeldungen({ mandant, onGeaendert }: { mandant: MandantDto | null; onGeaendert: () => void }) {
  const [liste, setListe] = useState<RueckmeldungListeDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenId, setOffenId] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [artFilter, setArtFilter] = useState("");
  const [prioFilter, setPrioFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [gruppierung, setGruppierung] = useState<Gruppierung | "">("");
  const [sortierung, setSortierung] = useState<Sortierung>("neueste");

  const laden = useCallback(() => {
    api
      .rueckmeldungListe()
      .then((l) => {
        setListe(l);
        setFehler(null);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen."));
  }, []);

  useEffect(laden, [laden]);

  const personen = useMemo(() => [...new Set((liste ?? []).map((r) => r.erstelltVonName))].sort((a, b) => a.localeCompare(b, "de")), [liste]);

  const sichtbar = useMemo(() => {
    const l = (liste ?? []).filter(
      (r) =>
        (!statusFilter || r.status === statusFilter) &&
        (!artFilter || r.art === artFilter) &&
        (!prioFilter || r.prioritaet === prioFilter) &&
        (!personFilter || r.erstelltVonName === personFilter) &&
        trifftSuche(suche, [r.titel, r.erstelltVonName]),
    );
    return l.sort((a, b) =>
      sortierung === "prioritaet"
        ? PRIO_REIHE.indexOf(a.prioritaet) - PRIO_REIHE.indexOf(b.prioritaet) || b.erstelltAm.localeCompare(a.erstelltAm)
        : sortierung === "aelteste"
          ? a.erstelltAm.localeCompare(b.erstelltAm)
          : b.erstelltAm.localeCompare(a.erstelltAm),
    );
  }, [liste, statusFilter, artFilter, prioFilter, personFilter, suche, sortierung]);

  const gruppen: [string, RueckmeldungListeDto[]][] = useMemo(() => {
    if (!gruppierung) return [["", sichtbar]];
    const m = new Map<string, RueckmeldungListeDto[]>();
    for (const r of sichtbar) {
      const k = gruppenSchluessel(r, gruppierung);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const ra = gruppenRang(a, gruppierung);
      const rb = gruppenRang(b, gruppierung);
      return typeof ra === "number" && typeof rb === "number" ? ra - rb : String(ra).localeCompare(String(rb), "de");
    });
  }, [sichtbar, gruppierung]);

  const filterAktiv = Boolean(statusFilter || artFilter || prioFilter || personFilter || suche.trim() || gruppierung);

  return (
    <div>
      <div className="zv-seiten-kopf">
        <h2>Rückmeldungen</h2>
      </div>

      {mandant && !mandant.rueckmeldungWeitergabe && (
        <div className="zv-hinweis zv-hinweis-info">
          Die Weitergabe an den Hersteller ist ausgeschaltet: auch freigegebene Rückmeldungen bleiben bei Ihnen. Sie
          schalten sie in den Einstellungen ein.
        </div>
      )}
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {liste && liste.length > 0 && (
        <>
          <Filterleiste
            ariaLabel="Rückmeldungen filtern, gruppieren und sortieren"
            suche={{ wert: suche, onChange: setSuche, placeholder: "Titel, gemeldet von…", ariaLabel: "Rückmeldungen durchsuchen" }}
            zusatz={[
              {
                id: "prioritaet",
                label: "Priorität",
                icon: <IPrioritaetHoch />,
                wert: prioFilter ? PRIO_LABEL[prioFilter as RueckmeldungPrioritaet] : null,
                optionen: PRIO_REIHE.map((p) => ({ wert: p, label: PRIO_LABEL[p] })),
                gewaehlt: prioFilter || null,
                onWaehlen: setPrioFilter,
                onEntfernen: () => setPrioFilter(""),
              },
              {
                id: "person",
                label: "Gemeldet von",
                icon: <IPerson />,
                wert: personFilter || null,
                optionen: personen.map((p) => ({ wert: p, label: p })),
                gewaehlt: personFilter || null,
                onWaehlen: setPersonFilter,
                onEntfernen: () => setPersonFilter(""),
              },
            ]}
            sortierung={{
              optionen: (Object.keys(SORTIERUNG_LABEL) as Sortierung[]).map((o) => ({ wert: o, label: SORTIERUNG_LABEL[o] })),
              wert: sortierung,
              onWaehlen: (o) => setSortierung(o as Sortierung),
            }}
            aktiv={filterAktiv}
            onZuruecksetzen={() => {
              setStatusFilter("");
              setArtFilter("");
              setPrioFilter("");
              setPersonFilter("");
              setSuche("");
              setGruppierung("");
            }}
          >
            <OptionenFilter
              icon={<ITag />}
              label="Status"
              optionen={STATUS_REIHE.map((st) => ({ wert: st, label: RUECKMELDUNG_STATUS_LABEL[st] }))}
              wert={statusFilter}
              onWaehlen={setStatusFilter}
            />
            <OptionenFilter
              icon={<IAnpassen />}
              label="Art"
              optionen={(Object.keys(ART_LABEL) as RueckmeldungArt[]).map((a) => ({ wert: a, label: ART_LABEL[a] }))}
              wert={artFilter}
              onWaehlen={setArtFilter}
            />
            <OptionenFilter
              icon={<IBaumAnsicht />}
              label="Gruppieren"
              optionen={(Object.keys(GRUPPIERUNG_LABEL) as Gruppierung[]).map((g) => ({ wert: g, label: GRUPPIERUNG_LABEL[g] }))}
              wert={gruppierung}
              onWaehlen={(g) => setGruppierung(g as Gruppierung | "")}
            />
          </Filterleiste>
          <div className="zv-sub-inline" aria-live="polite" style={{ marginBottom: "var(--zv-space-3)" }}>
            {sichtbar.length} von {liste.length} {liste.length === 1 ? "Rückmeldung" : "Rückmeldungen"} · {SORTIERUNG_LABEL[sortierung]}
            {gruppierung && ` · gruppiert nach ${GRUPPIERUNG_LABEL[gruppierung]}`}
          </div>
        </>
      )}

      {liste && liste.length === 0 && !fehler && <Leerzustand icon={ILeerAnwaerter}>Noch keine Rückmeldungen eingegangen.</Leerzustand>}
      {liste && liste.length > 0 && sichtbar.length === 0 && <Leerzustand icon={ILeerAnwaerter}>Keine Rückmeldung passt zu den Filtern.</Leerzustand>}

      {sichtbar.length > 0 &&
        gruppen.map(([schluessel, eintraege]) => (
          <section key={schluessel || "alle"} style={{ marginBottom: "var(--zv-space-5)" }} aria-label={gruppierung ? gruppenTitel(schluessel, gruppierung) : "Rückmeldungen"}>
            {gruppierung && (
              <h3 className="zv-etagen-kopf">
                {gruppenTitel(schluessel, gruppierung)} <span className="zv-sub-inline">{eintraege.length}</span>
              </h3>
            )}
            <div className="zv-karten-liste" style={SPALTEN}>
              <div className="zv-liste-kopf">
                <span>Titel</span>
                <span>Art</span>
                <span>Priorität</span>
                <span>Gemeldet von</span>
                <span>Eingang</span>
                <span>Status</span>
              </div>
              {eintraege.map((r) => (
                <div
                  key={r.id}
                  className={`zv-info-karte zv-info-karte-klickbar${offenId === r.id ? " zv-info-karte-aktiv" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOffenId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOffenId(r.id);
                    }
                  }}
                >
                  <span className="zv-liste-zelle-titel">
                    {r.titel}
                    {r.hatBild && <span className="zv-sub-inline"> · Screenshot</span>}
                  </span>
                  <span className="zv-liste-zelle" data-label="Art">
                    {ART_LABEL[r.art]}
                  </span>
                  <span className="zv-liste-zelle" data-label="Priorität">
                    {PRIO_LABEL[r.prioritaet]}
                  </span>
                  <span className="zv-liste-zelle" data-label="Gemeldet von">
                    {r.erstelltVonName}
                  </span>
                  <span className="zv-liste-zelle zv-mono" data-label="Eingang">
                    {datum(r.erstelltAm)}
                  </span>
                  <span className="zv-liste-zelle" data-label="Status">
                    <span className={PILL[r.status]}>{RUECKMELDUNG_STATUS_LABEL[r.status]}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}

      <Seitenpanel offen={offenId !== null} onSchliessen={() => setOffenId(null)}>
        {offenId && (
          <Detail
            key={offenId}
            id={offenId}
            weitergabe={mandant?.rueckmeldungWeitergabe ?? false}
            onGeaendert={() => {
              laden();
              onGeaendert();
            }}
          />
        )}
      </Seitenpanel>
    </div>
  );
}

function Detail({ id, weitergabe, onGeaendert }: { id: string; weitergabe: boolean; onGeaendert: () => void }) {
  const [r, setR] = useState<RueckmeldungDetailDto | null>(null);
  const [bildUrl, setBildUrl] = useState<string | null>(null);
  const [bildFehler, setBildFehler] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [notiz, setNotiz] = useState("");
  const [arbeitet, setArbeitet] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    let url: string | null = null;
    api
      .rueckmeldungDetail(id)
      .then(async (d) => {
        if (abgebrochen) return;
        setR(d);
        setNotiz(d.entscheidungsnotiz ?? "");
        if (d.hatBild) {
          url = await api.rueckmeldungBildUrl(id).catch(() => null);
          if (!abgebrochen) {
            setBildUrl(url);
            setBildFehler(url === null);
          }
        }
      })
      .catch((err) => !abgebrochen && setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen."));
    return () => {
      abgebrochen = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  async function entscheiden(status: RueckmeldungEntscheidung) {
    if (arbeitet) return;
    setArbeitet(true);
    setFehler(null);
    try {
      setR(await api.rueckmeldungEntscheiden(id, status, notiz.trim() || undefined));
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setArbeitet(false);
    }
  }

  async function bildVerwerfen() {
    if (arbeitet) return;
    setArbeitet(true);
    try {
      await api.rueckmeldungBildVerwerfen(id);
      setBildUrl(null);
      setR((alt) => (alt ? { ...alt, hatBild: false } : alt));
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Verwerfen fehlgeschlagen.");
    } finally {
      setArbeitet(false);
    }
  }

  if (!r) {
    return fehler ? (
      <div className="zv-hinweis zv-hinweis-fehler">
        <IFehler />
        {fehler}
      </div>
    ) : (
      <p className="zv-sub">Lädt…</p>
    );
  }

  const gesperrt = r.status === "umgesetzt";
  const kontext = kontextZeilen(r.kontext);
  return (
    <div className="zv-rm-detail">
      <header className="zv-rm-detail-kopf">
        <h3>{r.titel}</h3>
        <div className="zv-rm-detail-pillen">
          <span className={PILL[r.status]}>{RUECKMELDUNG_STATUS_LABEL[r.status]}</span>
          <span className="zv-pill">{ART_LABEL[r.art]}</span>
          <span className={`zv-pill${r.prioritaet === "blockierend" || r.prioritaet === "hoch" ? " zv-pill-achtung" : ""}`}>
            Priorität {PRIO_LABEL[r.prioritaet]}
          </span>
        </div>
        <p className="zv-sub-inline">
          Gemeldet von {r.erstelltVonName} am {datum(r.erstelltAm)}
          {r.freigegebenAm && ` · freigegeben ${r.freigegebenVonName ? `von ${r.freigegebenVonName} ` : ""}am ${datum(r.freigegebenAm)}`}
        </p>
      </header>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <section className="zv-rm-detail-abschnitt">
        <h4>{r.art === "idee" ? "Was soll sich ändern?" : "Was ist passiert?"}</h4>
        <p className="zv-rm-detail-text">{r.beschreibung}</p>
        {r.erwartet && (
          <>
            <h4>{r.art === "idee" ? "Warum?" : "Erwartet"}</h4>
            <p className="zv-rm-detail-text">{r.erwartet}</p>
          </>
        )}
      </section>

      {r.hatBild && (
        <section className="zv-rm-detail-abschnitt">
          <h4>Screenshot</h4>
          {bildUrl ? (
            <a className="zv-rm-detail-bild" href={bildUrl} target="_blank" rel="noreferrer noopener" title="In voller Größe öffnen">
              {/* Laesst sich das Bild nicht dekodieren, lieber ein Satz als das
                  kaputte Bild-Symbol des Browsers. */}
              <img
                src={bildUrl}
                alt="Screenshot der Seite, Texte sind unkenntlich gemacht"
                onError={() => {
                  setBildUrl(null);
                  setBildFehler(true);
                }}
              />
            </a>
          ) : (
            <p className="zv-sub-inline">{bildFehler ? "Der Screenshot konnte nicht geladen werden." : "Lädt…"}</p>
          )}
          {!gesperrt && (
            <p className="zv-rm-detail-hinweis">
              <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={bildVerwerfen} disabled={arbeitet}>
                Screenshot verwerfen
              </button>
              <span className="zv-sub-inline">Falls doch etwas Personenbezogenes zu erkennen ist.</span>
            </p>
          )}
        </section>
      )}

      {kontext.length > 0 && (
        <section className="zv-rm-detail-abschnitt">
          <h4>Rahmenbedingungen</h4>
          <dl className="zv-kontext-raster">
            {kontext.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(r.bearbeitungsnotiz || r.prUrl) && (
        <section className="zv-rm-detail-abschnitt">
          <h4>Umsetzung</h4>
          {r.bearbeitungsnotiz && <p className="zv-rm-detail-text">{r.bearbeitungsnotiz}</p>}
          {r.prUrl && (
            <p>
              <a href={r.prUrl} target="_blank" rel="noreferrer noopener">
                Umsetzung ansehen
              </a>
            </p>
          )}
        </section>
      )}

      <section className="zv-rm-detail-abschnitt zv-rm-detail-entscheidung">
        {gesperrt ? (
          <div className="zv-hinweis zv-hinweis-erfolg">
            <IErfolg />
            Umgesetzt – abgeschlossen.
          </div>
        ) : (
          <>
            <h4>Entscheidung</h4>
            <div className="zv-field">
              <label htmlFor="rueckmeldung-notiz">Notiz an die meldende Person bzw. den Hersteller (bei Rückfrage und Ablehnung Pflicht)</label>
              <textarea id="rueckmeldung-notiz" rows={3} maxLength={2000} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
            </div>
            {r.status !== "freigegeben" && r.status !== "in_arbeit" && (
              <p className="zv-sub-inline">
                {weitergabe
                  ? "Mit der Freigabe darf der Hersteller diese Rückmeldung lesen und umsetzen."
                  : "Die Freigabe bleibt intern, solange die Weitergabe an den Hersteller ausgeschaltet ist."}
              </p>
            )}
            <div className="zv-aktionszeile">
              {r.status !== "freigegeben" && r.status !== "in_arbeit" && (
                <button type="button" className="zv-btn" onClick={() => entscheiden("freigegeben")} disabled={arbeitet}>
                  Freigeben
                </button>
              )}
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => entscheiden("rueckfrage")} disabled={arbeitet || !notiz.trim()}>
                Rückfrage
              </button>
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => entscheiden("duplikat")} disabled={arbeitet}>
                Duplikat
              </button>
              <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => entscheiden("abgelehnt")} disabled={arbeitet || !notiz.trim()}>
                Ablehnen
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
