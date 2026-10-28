import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardDto, StandortDto, TerminDto } from "@zimmerakte/shared";
import { DIENST_LABEL, dienstNachUhrzeit } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Seitenpanel } from "../components/Seitenpanel";
import { StandortReiter } from "../components/StandortReiter";
import {
  IAnpassen,
  IFehler,
  ILeerAufgaben,
  INeu,
  ISuche,
  IZuruecksetzen,
} from "../components/icons";
import {
  formatBetrag,
  formatDatum,
  formatTerminUhrzeit,
  kontextzeile,
  lokalesDatum,
  terminTag,
} from "../format";
import {
  geleseneSichtbarkeit,
  sichtbarkeitSpeichern,
  sichtbarkeitZuruecksetzen,
  standardSichtbarkeit,
  WIDGET_LABEL,
  WIDGET_REIHENFOLGE,
  type WidgetId,
} from "../dashboard/sichtbarkeit";
import type { Tab } from "../navigation";

/**
 * Reine Anzeigepraeferenz dieses Geraets, genau wie die Widget-Sichtbarkeit
 * (siehe dashboard/sichtbarkeit.ts) -- deshalb localStorage, nicht die
 * Datenbank. Eine gespeicherte ID, die es in der aktuellen Liste nicht mehr
 * gibt (Standort deaktiviert, Zuordnung geaendert), faellt beim Laden still
 * auf "Alle Standorte" zurueck statt einen Fehler zu zeigen.
 */
const STANDORT_AUSWAHL_KEY = "zimmerakte_dashboard_standort";

function geleseneStandortAuswahl(): string | null {
  try {
    return localStorage.getItem(STANDORT_AUSWAHL_KEY);
  } catch {
    return null;
  }
}

function standortAuswahlSpeichern(standortId: string | null): void {
  try {
    if (standortId) localStorage.setItem(STANDORT_AUSWAHL_KEY, standortId);
    else localStorage.removeItem(STANDORT_AUSWAHL_KEY);
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern.
  }
}

export interface DashboardNavigation {
  zu: (
    ziel: Tab,
    extra?: { klientId?: string; neueBuchung?: boolean; tagesberichtKlientId?: string },
  ) => void;
  suche: () => void;
}

type Zustaendigkeit = "meine" | "ohne";
type Gruppe = "heute" | "woche" | "spaeter";
type Filter = "alle" | Zustaendigkeit;

const FILTER_LABEL: Record<Filter, string> = {
  alle: "Alle",
  meine: "Mir zugewiesen",
  ohne: "Ohne Zuständigkeit",
};

const GRUPPE_LABEL: Record<Gruppe, string> = {
  heute: "Heute fällig",
  woche: "Diese Woche",
  spaeter: "Später",
};

interface Eintrag {
  schluessel: string;
  /** Welches Widget (Sichtbarkeit) den Eintrag liefert -- nur zur Gruppierung der Tags. */
  art: string;
  titel: string;
  meta: string;
  /** ISO-Datum; null = ohne feste Frist. */
  frist: string | null;
  fristText: string;
  zustaendigkeit: Zustaendigkeit;
  aktion: { label: string; ausfuehren: () => void | Promise<void> };
}

function tageZwischen(von: string, bis: string): number {
  const [j1, m1, t1] = von.split("-").map(Number);
  const [j2, m2, t2] = bis.split("-").map(Number);
  return Math.round((Date.UTC(j2, m2 - 1, t2) - Date.UTC(j1, m1 - 1, t1)) / 86_400_000);
}

/**
 * Frist -> Gruppe. Einträge ohne feste Frist (Storno-Anträge, Rechnungen,
 * HZL) landen bewusst in "Diese Woche" statt in "Heute fällig": sie warten
 * auf eine Entscheidung, nicht auf einen Termin, und würden die Gruppe
 * "Heute fällig" sonst jeden Tag mit Dingen füllen, die gar nicht heute
 * fällig sind -- dann liest niemand mehr, was wirklich heute dran ist.
 */
function gruppeVon(frist: string | null, heute: string): Gruppe {
  if (!frist) return "woche";
  const tage = tageZwischen(heute, frist);
  if (tage <= 0) return "heute";
  if (tage <= 7) return "woche";
  return "spaeter";
}

function fristAnzeige(frist: string | null, heute: string, ohne: string): { text: string; ueberfaellig: boolean } {
  if (!frist) return { text: ohne, ueberfaellig: false };
  const tage = tageZwischen(heute, frist);
  if (tage < 0) return { text: `seit ${-tage} ${tage === -1 ? "Tag" : "Tagen"}`, ueberfaellig: true };
  if (tage === 0) return { text: "heute", ueberfaellig: false };
  if (tage === 1) return { text: "morgen", ueberfaellig: false };
  return { text: formatDatum(frist), ueberfaellig: false };
}

export function Dashboard({ navigation }: { navigation: DashboardNavigation }) {
  // Frueher ein Rollen-Hinweis (Bereichs-/Einrichtungsleitung sehen mehr
  // Widgets per Default) -- ohne feste Rollen gibt es dafuer keine Grundlage
  // mehr, also zeigt der Standard jetzt fuer alle den volleren Satz. Wer
  // einzelne Widgets nicht braucht, blendet sie ueber "Anpassen" aus.
  const istLeitung = true;
  const [daten, setDaten] = useState<DashboardDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [sichtbarkeit, setSichtbarkeit] = useState(() => geleseneSichtbarkeit(istLeitung));
  const [anpassenOffen, setAnpassenOffen] = useState(false);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [standortAuswahl, setStandortAuswahl] = useState<string | null>(() => geleseneStandortAuswahl());
  const [standorteBereit, setStandorteBereit] = useState(false);
  const [wirdGeladen, setWirdGeladen] = useState(false);
  const [filter, setFilter] = useState<Filter>("alle");
  const [termine, setTermine] = useState<TerminDto[]>([]);
  const [ichId, setIchId] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const neuRef = useRef<HTMLDivElement>(null);
  const [jetzt, setJetzt] = useState(() => new Date());

  useEffect(() => {
    api
      .standorteListe()
      .then((liste) => {
        const aktive = liste.filter((s) => s.aktiv);
        setStandorte(aktive);
        setStandortAuswahl((vorher) => (vorher && !aktive.some((s) => s.id === vorher) ? null : vorher));
      })
      .catch((err) => setFehler(err.message))
      .finally(() => setStandorteBereit(true));
    api.benutzerIch().then((b) => setIchId(b.id)).catch(() => {});
    // Minutentakt reicht, um "naechster Termin" und die Kontextzeile
    // nachzufuehren, ohne bei jedem Tick Daten nachzuladen.
    const takt = window.setInterval(() => setJetzt(new Date()), 60_000);
    return () => window.clearInterval(takt);
  }, []);

  const laden = useCallback(() => {
    setWirdGeladen(true);
    api
      .dashboard(standortAuswahl ?? undefined)
      .then((d) => {
        setDaten(d);
        setFehler(null);
      })
      .catch((err) => setFehler(err.message))
      .finally(() => setWirdGeladen(false));
  }, [standortAuswahl]);

  useEffect(() => {
    // Erst laden, wenn die Standortliste die gespeicherte Auswahl geprueft
    // hat -- sonst ginge kurz eine Anfrage mit einer inzwischen ungueltigen
    // ID raus, bevor der Rueckfall auf "Alle Standorte" greift.
    if (!standorteBereit) return;
    laden();
  }, [standorteBereit, laden]);

  useEffect(() => {
    // Einen Tag Puffer beidseitig: Zeitpunkt-Termine sind UTC gespeichert,
    // "heute" ist lokal (gleiches Vorgehen wie in Kalender.tsx).
    const heute = new Date();
    const gestern = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 1);
    const morgen = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + 1);
    api
      .termine(lokalesDatum(gestern), lokalesDatum(morgen))
      .then(setTermine)
      .catch(() => setTermine([]));
  }, []);

  useEffect(() => {
    if (!neuOffen) return;
    function aussen(e: MouseEvent) {
      if (neuRef.current && !neuRef.current.contains(e.target as Node)) setNeuOffen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setNeuOffen(false);
    }
    document.addEventListener("mousedown", aussen);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", aussen);
      document.removeEventListener("keydown", esc);
    };
  }, [neuOffen]);

  function standortWaehlen(id: string | null) {
    setStandortAuswahl(id);
    standortAuswahlSpeichern(id);
  }

  function sichtbarkeitAendern(id: WidgetId, sichtbar: boolean) {
    setSichtbarkeit((vorher) => {
      const naechste = { ...vorher, [id]: sichtbar };
      sichtbarkeitSpeichern(naechste, istLeitung);
      return naechste;
    });
  }

  function zuruecksetzen() {
    sichtbarkeitZuruecksetzen();
    setSichtbarkeit(standardSichtbarkeit(istLeitung));
  }

  const heute = lokalesDatum(jetzt);

  const eintraege = useMemo<Eintrag[]>(() => {
    if (!daten) return [];
    const liste: Eintrag[] = [];
    const nach = navigation.zu;
    if (sichtbarkeit.meineAufgaben) {
      for (const a of daten.meineOffenenAufgaben) {
        liste.push({
          schluessel: `aufgabe:${a.id}`,
          art: "Aufgabe",
          titel: a.titel,
          meta: a.zimmerNummer ? `${a.standortName}, Zimmer ${a.zimmerNummer}` : "Persönliche Aufgabe",
          frist: a.faelligAm,
          fristText: "ohne Termin",
          zustaendigkeit: "meine",
          aktion: {
            label: "Erledigen",
            ausfuehren: async () => {
              await api.aufgabeErledigen(a.id);
              laden();
            },
          },
        });
      }
    }
    if (sichtbarkeit.unzugewieseneAufgaben) {
      for (const a of daten.unzugewieseneZimmeraufgaben) {
        liste.push({
          schluessel: `zimmeraufgabe:${a.id}`,
          art: "Aufgabe",
          titel: a.titel,
          meta: `${a.standortName}, Zimmer ${a.zimmerNummer}`,
          frist: a.faelligAm,
          fristText: "ohne Termin",
          zustaendigkeit: "ohne",
          aktion: {
            label: "Übernehmen",
            ausfuehren: async () => {
              if (!ichId) return;
              await api.aufgabeAktualisieren(a.id, { zugewiesenAn: ichId });
              laden();
            },
          },
        });
      }
    }
    if (sichtbarkeit.hzl && daten.hzlWoche.gesamt > daten.hzlWoche.bezahlt) {
      const offen = daten.hzlWoche.gesamt - daten.hzlWoche.bezahlt;
      liste.push({
        schluessel: "hzl",
        art: "HZL",
        titel: `HZL KW ${daten.hzlWoche.isoWoche}: ${offen} ${offen === 1 ? "Auszahlung" : "Auszahlungen"} offen`,
        meta: `${daten.hzlWoche.bezahlt} von ${daten.hzlWoche.gesamt} ausgezahlt`,
        frist: null,
        fristText: "diese Woche",
        zustaendigkeit: "ohne",
        aktion: { label: "Auszahlen", ausfuehren: () => nach("hzl") },
      });
    }
    if (sichtbarkeit.tagesberichte) {
      for (const k of daten.klientenOhneTagesbericht) {
        liste.push({
          schluessel: `bericht:${k.klientId}`,
          art: "Bericht",
          titel: `Tagesbericht fehlt: ${k.klientName}`,
          meta: `${k.standortName}, Zimmer ${k.zimmerNummer} · ${
            k.tageSeitLetztem === null
              ? "noch nie ein Bericht"
              : `letzter vor ${k.tageSeitLetztem} ${k.tageSeitLetztem === 1 ? "Tag" : "Tagen"}`
          }`,
          // Der Bericht ist taeglich faellig; wer seit N Tagen keinen hat,
          // ist N Tage ueber. Ohne Bericht je: heute.
          frist: k.tageSeitLetztem === null ? heute : tageVor(heute, k.tageSeitLetztem),
          fristText: "heute",
          zustaendigkeit: "ohne",
          aktion: { label: "Schreiben", ausfuehren: () => nach("tagesberichte", { tagesberichtKlientId: k.klientId }) },
        });
      }
    }
    if (sichtbarkeit.kostenuebernahmen) {
      for (const k of daten.kostenuebernahmenBaldEndend) {
        liste.push({
          schluessel: `ku:${k.klientId}:${k.bis}`,
          art: "Kostenübernahme",
          titel: `Kostenübernahme endet: ${k.klientName}`,
          meta: `${k.amt} · bis ${formatDatum(k.bis)}`,
          frist: k.bis.slice(0, 10),
          fristText: "",
          zustaendigkeit: "ohne",
          aktion: { label: "Öffnen", ausfuehren: () => nach("klienten", { klientId: k.klientId }) },
        });
      }
    }
    if (sichtbarkeit.stornoantraege && daten.offeneStornoantraege.anzahl > 0) {
      const n = daten.offeneStornoantraege.anzahl;
      liste.push({
        schluessel: "storno",
        art: "Storno",
        titel: `${n} ${n === 1 ? "Storno-Antrag wartet" : "Storno-Anträge warten"} auf Bewilligung`,
        meta: "Kassenbuch",
        frist: null,
        fristText: "offen",
        zustaendigkeit: "ohne",
        aktion: { label: "Prüfen", ausfuehren: () => nach("kassenbuch") },
      });
    }
    if (sichtbarkeit.rechnungen && daten.offeneRechnungen.anzahl > 0) {
      const n = daten.offeneRechnungen.anzahl;
      liste.push({
        schluessel: "rechnungen",
        art: "Rechnung",
        titel: `${n} ${n === 1 ? "Rechnung wartet" : "Rechnungen warten"} auf Genehmigung`,
        meta: formatBetrag(daten.offeneRechnungen.summeCent),
        frist: null,
        fristText: "offen",
        zustaendigkeit: "ohne",
        aktion: { label: "Prüfen", ausfuehren: () => nach("klienten") },
      });
    }
    return liste;
  }, [daten, sichtbarkeit, ichId, heute, laden, navigation.zu]);

  const gefiltert = eintraege.filter((e) => filter === "alle" || e.zustaendigkeit === filter);
  const gruppen = (["heute", "woche", "spaeter"] as Gruppe[])
    .map((g) => ({
      gruppe: g,
      eintraege: gefiltert
        .filter((e) => gruppeVon(e.frist, heute) === g)
        .sort((a, b) => (a.frist ?? "9999").localeCompare(b.frist ?? "9999")),
    }))
    .filter((g) => g.eintraege.length > 0);

  const heutigeTermine = termine
    .filter((t) => !t.abgesagtAm)
    .filter((t) => terminTag(t.beginn, t.ganztaegig) <= heute && terminTag(t.ende, t.ganztaegig) >= heute)
    .sort((a, b) => Number(b.ganztaegig) - Number(a.ganztaegig) || a.beginn.localeCompare(b.beginn));
  const naechsterTermin = heutigeTermine.find((t) => !t.ganztaegig && new Date(t.ende) > jetzt);

  const lageSpalten: { schluessel: string; label: string; wert: string; folge: string; achtung?: boolean }[] = [];
  if (daten) {
    if (sichtbarkeit.zimmer) {
      lageSpalten.push({
        schluessel: "zimmer",
        label: "Plätze belegt",
        wert: `${daten.zimmer.gesamt - daten.zimmer.frei} / ${daten.zimmer.gesamt}`,
        folge: daten.zimmer.frei === 0 ? "Haus voll" : `${daten.zimmer.frei} frei`,
      });
    }
    if (sichtbarkeit.hzl) {
      const offen = daten.hzlWoche.gesamt - daten.hzlWoche.bezahlt;
      lageSpalten.push({
        schluessel: "hzl",
        label: `HZL KW ${daten.hzlWoche.isoWoche}`,
        wert: `${daten.hzlWoche.bezahlt} / ${daten.hzlWoche.gesamt}`,
        folge: offen === 0 ? "alle ausgezahlt" : `${offen} offen`,
        achtung: offen > 0,
      });
    }
    if (sichtbarkeit.rechnungen) {
      lageSpalten.push({
        schluessel: "rechnungen",
        label: "Offene Rechnungen",
        wert: String(daten.offeneRechnungen.anzahl),
        folge: daten.offeneRechnungen.anzahl === 0 ? "nichts offen" : formatBetrag(daten.offeneRechnungen.summeCent),
      });
    }
    if (sichtbarkeit.stornoantraege) {
      lageSpalten.push({
        schluessel: "storno",
        label: "Storno-Anträge",
        wert: String(daten.offeneStornoantraege.anzahl),
        folge: daten.offeneStornoantraege.anzahl === 0 ? "nichts wartet" : "warten auf Bewilligung",
        achtung: daten.offeneStornoantraege.anzahl > 0,
      });
    }
  }

  const neuEintraege: { label: string; ausfuehren: () => void }[] = [
    { label: "Neue Buchung", ausfuehren: () => navigation.zu("kassenbuch", { neueBuchung: true }) },
    { label: "Tagesbericht schreiben", ausfuehren: () => navigation.zu("tagesberichte") },
    { label: "Aufgabe anlegen", ausfuehren: () => navigation.zu("aufgaben") },
    { label: "Termin anlegen", ausfuehren: () => navigation.zu("kalender") },
  ];

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <div>
          <p className="zv-kontextzeile">{kontextzeile(jetzt, DIENST_LABEL[dienstNachUhrzeit(jetzt)])}</p>
          <h2>Heute im Haus</h2>
        </div>
        <div className="zv-kopf-aktionen">
          <button type="button" className="zv-suchfeld" onClick={navigation.suche} aria-label="Suchen oder Befehl ausführen">
            <ISuche />
            <span>Suchen …</span>
            <kbd className="zv-mono">Strg K</kbd>
          </button>
          <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setAnpassenOffen(true)}>
            <IAnpassen />
            Anpassen
          </button>
          <div className="zv-neu-menue" ref={neuRef}>
            <button
              type="button"
              className="zv-btn"
              aria-haspopup="menu"
              aria-expanded={neuOffen}
              onClick={() => setNeuOffen((o) => !o)}
            >
              <INeu />
              Neu
            </button>
            {neuOffen && (
              <div className="zv-neu-liste" role="menu">
                {neuEintraege.map((n) => (
                  <button
                    key={n.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNeuOffen(false);
                      n.ausfuehren();
                    }}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <StandortReiter
        eintraege={[{ id: null, label: "Alle Standorte" }, ...standorte.map((s) => ({ id: s.id, label: s.name }))]}
        aktiv={standortAuswahl}
        onWaehle={standortWaehlen}
      />

      {daten && (
        <div className="zv-heute" style={{ opacity: wirdGeladen ? 0.6 : 1 }}>
          {lageSpalten.length > 0 && (
            <section className="zv-lage" aria-label="Lage">
              {lageSpalten.map((sp) => (
                <div key={sp.schluessel} className="zv-lage-spalte">
                  <p className="zv-lage-label">{sp.label}</p>
                  <p className="zv-lage-wert zv-mono">{sp.wert}</p>
                  <p className={`zv-lage-folge${sp.achtung ? " zv-lage-folge-achtung" : ""}`}>{sp.folge}</p>
                </div>
              ))}
            </section>
          )}

          <div className="zv-heute-spalten">
            <section className="zv-heute-haupt" aria-label="Zu erledigen">
              <div className="zv-abschnittskopf">
                <h3>Zu erledigen</h3>
                <div className="zv-segmented" role="group" aria-label="Filter">
                  {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={filter === f ? "active" : ""}
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                    >
                      {FILTER_LABEL[f]}
                    </button>
                  ))}
                </div>
              </div>

              {gruppen.length === 0 ? (
                <Leerzustand
                  icon={ILeerAufgaben}
                  aktion={
                    <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => navigation.zu("aufgaben")}>
                      Aufgabe anlegen
                    </button>
                  }
                >
                  {filter === "alle" ? "Nichts offen." : "Für diesen Filter ist nichts offen."}
                </Leerzustand>
              ) : (
                gruppen.map((g) => (
                  <div key={g.gruppe} className="zv-todo-gruppe">
                    <h4 className="zv-gruppenlabel-inline">
                      {GRUPPE_LABEL[g.gruppe]} <span className="zv-mono">{g.eintraege.length}</span>
                    </h4>
                    <ul className="zv-todo-liste">
                      {g.eintraege.map((e) => {
                        const f = fristAnzeige(e.frist, heute, e.fristText);
                        return (
                          <li key={e.schluessel} className="zv-todo-zeile">
                            <span className="zv-pill">{e.art}</span>
                            <span className="zv-todo-text">
                              <span className="zv-todo-titel">{e.titel}</span>
                              <span className="zv-todo-meta">{e.meta}</span>
                            </span>
                            <span className={`zv-todo-frist zv-mono${f.ueberfaellig ? " zv-todo-frist-achtung" : ""}`}>
                              {f.text}
                            </span>
                            <button
                              type="button"
                              className="zv-btn zv-btn-sekundaer zv-btn-klein"
                              onClick={() => {
                                void Promise.resolve(e.aktion.ausfuehren()).catch((err) => setFehler(err.message));
                              }}
                            >
                              {e.aktion.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <aside className="zv-heute-rand">
              <section aria-label="Termine heute">
                <div className="zv-abschnittskopf">
                  <h3>Termine heute</h3>
                  <button type="button" className="zv-link-btn" onClick={() => navigation.zu("kalender")}>
                    Kalender
                  </button>
                </div>
                {heutigeTermine.length === 0 ? (
                  <p className="zv-rand-leer">Heute keine Termine.</p>
                ) : (
                  <ol className="zv-zeitleiste">
                    {heutigeTermine.map((t) => {
                      const vorbei = !t.ganztaegig && new Date(t.ende) <= jetzt;
                      const naechster = naechsterTermin?.id === t.id;
                      return (
                        <li
                          key={t.id}
                          className={`${vorbei ? "zv-zeit-vorbei" : ""}${naechster ? " zv-zeit-naechster" : ""}`}
                        >
                          <span className="zv-zeit-punkt" aria-hidden="true" />
                          <span className="zv-zeit-uhr zv-mono">{formatTerminUhrzeit(t)}</span>
                          <span className="zv-zeit-titel">{t.titel}</span>
                          {t.ort && <span className="zv-todo-meta">{t.ort}</span>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <section aria-label="Freie Zimmer">
                <div className="zv-abschnittskopf">
                  <h3>Freie Zimmer</h3>
                  <button type="button" className="zv-link-btn" onClick={() => navigation.zu("standorte")}>
                    Belegung
                  </button>
                </div>
                {daten.freieZimmer.length === 0 ? (
                  <p className="zv-rand-leer">Kein Platz frei.</p>
                ) : (
                  <ul className="zv-rand-liste">
                    {daten.freieZimmer.map((z) => (
                      <li key={z.zimmerId}>
                        <span className="zv-mono zv-rand-nummer">{z.nummer}</span>
                        <span className="zv-todo-text">
                          <span className="zv-todo-titel">{z.standortName}</span>
                          <span className="zv-todo-meta">
                            {z.etage ? `${z.etage} · ` : ""}
                            {z.freiePlaetze} {z.freiePlaetze === 1 ? "Platz" : "Plätze"} frei
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {sichtbarkeit.mitarbeitende && (
                <section aria-label="Mitarbeitende">
                  <div className="zv-abschnittskopf">
                    <h3>Mitarbeitende</h3>
                    <button type="button" className="zv-link-btn" onClick={() => navigation.zu("mitarbeitende")}>
                      Öffnen
                    </button>
                  </div>
                  <p className="zv-rand-leer">
                    <span className="zv-mono">{daten.mitarbeitende.aktiv}</span> aktiv
                    {daten.mitarbeitende.ausstehendeResets > 0 &&
                      ` · ${daten.mitarbeitende.ausstehendeResets} Passwort-Reset(s) ausstehend`}
                  </p>
                </section>
              )}
            </aside>
          </div>
        </div>
      )}

      <Seitenpanel offen={anpassenOffen} onSchliessen={() => setAnpassenOffen(false)}>
        <h3 style={{ marginTop: 0 }}>Widgets anpassen</h3>
        <p className="zv-sub">Gilt nur für dich, auf diesem Gerät.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {WIDGET_REIHENFOLGE.map((id) => (
            <label key={id} className="zv-checkbox-zeile">
              <input type="checkbox" checked={sichtbarkeit[id]} onChange={(e) => sichtbarkeitAendern(id, e.target.checked)} />
              {WIDGET_LABEL[id]}
            </label>
          ))}
        </div>
        <button className="zv-btn zv-btn-still" onClick={zuruecksetzen} style={{ marginTop: 20 }}>
          <IZuruecksetzen />
          Zurücksetzen
        </button>
      </Seitenpanel>
    </div>
  );
}

function tageVor(datum: string, tage: number): string {
  const [j, m, t] = datum.split("-").map(Number);
  return lokalesDatum(new Date(j, m - 1, t - tage));
}
