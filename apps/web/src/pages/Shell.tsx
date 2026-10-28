import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BenutzerListEintragDto, MandantDto, StandortDto } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";
import { akzentSetzen, dunkelGrundfarbeSetzen } from "../theme/theme";
import { WarteschlangeLeiste } from "../components/WarteschlangeLeiste";
import { ThemeToggle } from "../components/ThemeToggle";
import { MarkenIcon } from "../components/MarkenZeichen";
import { useChatEreignisse } from "../components/chat/ereignisse";
import {
  IAbmelden,
  IAnwaerter,
  IArchivieren,
  IAuszahlen,
  IAufklappen,
  IAusklappen,
  IEinklappen,
  IKlienten,
  IMehr,
  INeu,
  IStandort,
  ITagesberichte,
  ITraeger,
  IZuklappen,
} from "../components/icons";
import {
  MENUE_GRUPPEN,
  ladeMenuReihenfolge,
  reiterDerGruppe,
  speichereMenuReihenfolge,
  STANDARD_REITER,
  UNTERPUNKTE,
  hauptreiterVon,
  type HauptReiter,
  type KlientenAnsicht,
  type Tab,
  type UnterpunktEintrag,
} from "../navigation";
import { Dashboard } from "./Dashboard";
import { StandortUebersicht } from "./StandortUebersicht";
import { StandortRaeume } from "./StandortRaeume";
import { Klienten } from "./Klienten";
import { Mitarbeitende } from "./Mitarbeitende";
import { Kassenbuch } from "./Kassenbuch";
import type { UebergabeStart } from "./HzlUebergabe";
import { Befehl, Befehlspalette, zuletztLoeschen, zuletztMerken } from "../components/Befehlspalette";
import { Tagesberichte } from "./Tagesberichte";
import { Aufgaben } from "./Aufgaben";
import { Schichtuebergabe, entwurfLoeschen } from "./Schichtuebergabe";
import { Vertretung } from "./Vertretung";
import { Organigramm } from "./Organigramm";
import { Einstellungen } from "./Einstellungen";
import { Nachrichten } from "./Nachrichten";
import { Kalender } from "./Kalender";

/**
 * Die vier Punkte, die auf dem Handy immer direkt in der unteren Leiste
 * stehen (plus "Mehr"): das, was im Dienst am haeufigsten gebraucht wird.
 * Fest statt aus der einstellbaren Reihenfolge abgeleitet -- die gilt jetzt
 * je Gruppe, und eine Leiste, deren Inhalt davon abhaengt, in welcher
 * Gruppe man etwas nach oben geschoben hat, waere nicht vorhersagbar. Die
 * Sidebar zeigt weiterhin immer alle. "Bericht" ist die Kurzform von
 * Tagesberichte, damit das Wort in eine Leiste mit fuenf Feldern passt.
 */
const MOBIL_DIREKT: { wert: HauptReiter; label: string }[] = [
  { wert: "dashboard", label: "Heute" },
  { wert: "klienten", label: "Klienten" },
  { wert: "nachrichten", label: "Nachrichten" },
  { wert: "tagesberichte", label: "Bericht" },
];

/** "Anna Beispiel" -> "AB"; ein einzelnes Wort -> dessen erste zwei Buchstaben. */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "?";
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

/** Zaehler am Menuepunkt; 0 = unsichtbar. */
function NavBadge({ anzahl }: { anzahl: number }) {
  if (anzahl <= 0) return null;
  return (
    <span className="zv-nav-badge" aria-label={`${anzahl} ungelesen`}>
      {anzahl > 99 ? "99+" : anzahl}
    </span>
  );
}

/**
 * Die Unterpunkte von "Klienten" in der Sidebar -- der Hauptknopf
 * navigiert direkt auf die Standardansicht (aktive Klienten), die
 * Unterpunkte fuehren auf die beiden anderen Ansichten (siehe
 * Klienten.tsx, das selbst keine eigene Reiterleiste mehr zeigt). Nur hier
 * verdrahtet, nicht Teil der frei sortierbaren Hauptreihenfolge in
 * navigation.ts.
 */
const KLIENTEN_UNTERPUNKTE: { ansicht: KlientenAnsicht; label: string; icon: typeof IKlienten }[] = [
  { ansicht: "anwaerter", label: "Anwärter", icon: IAnwaerter },
  { ansicht: "archiv", label: "Archiv", icon: IArchivieren },
];

/**
 * Fuer das mobile Panel (kein Hauptknopf/Pfeil wie in der Sidebar, ein
 * einzelner Tastendruck muss alle drei Ansichten erreichen) -- "Klienten"
 * selbst kommt hier als erster Eintrag mit dazu.
 */
const KLIENTEN_MOBIL_PANEL: { ansicht: KlientenAnsicht; label: string; icon: typeof IKlienten }[] = [
  { ansicht: "aktiv", label: "Klienten", icon: IKlienten },
  ...KLIENTEN_UNTERPUNKTE,
];

/** Diese Ansichten tragen Kartenlisten/breite Inhalte und bekommen mehr Platz. */
const BREITE_REITER = new Set<Tab>([
  "dashboard",
  "standorte",
  "kassenbuch",
  "hzl",
  "klienten",
  "nachrichten",
  "kalender",
  "mitarbeitende",
  "tagesberichte",
  "aufgaben",
  "vertretung",
  "organigramm",
]);

const SIDEBAR_SPEICHER = "zimmerakte_sidebar_eingeklappt";
const SIDEBAR_HOVER_SPEICHER = "zimmerakte_sidebar_hover_ausklappen";
const SIDEBAR_KLIENTEN_AUFGEKLAPPT_SPEICHER = "zimmerakte_sidebar_klienten_aufgeklappt";
const sidebarGruppeSpeicher = (haupt: HauptReiter) => `zimmerakte_sidebar_${haupt}_aufgeklappt`;

// Reine Anzeigepraeferenzen dieses Geraets -- wie das Theme (siehe
// ThemeProvider) gehoert das bewusst nicht in die Datenbank und ist nach
// TTDSG §25 Abs. 2 einwilligungsfrei.
function ladeBoolean(schluessel: string): boolean {
  try {
    return localStorage.getItem(schluessel) === "1";
  } catch {
    return false;
  }
}

/** Wie ladeBoolean(), nur dass ein noch nie gespeicherter Wert als "an" gilt. */
function ladeBooleanDefaultAn(schluessel: string): boolean {
  try {
    const wert = localStorage.getItem(schluessel);
    return wert === null ? true : wert === "1";
  } catch {
    return true;
  }
}

function speichereBoolean(schluessel: string, wert: boolean) {
  try {
    localStorage.setItem(schluessel, wert ? "1" : "0");
  } catch {
    // Privatmodus ohne localStorage: Praeferenz gilt dann nur fuer diese Sitzung.
  }
}

export function Shell({ onLoggedOut, onUebergabeStarten }: { onLoggedOut: () => void; onUebergabeStarten: (start: UebergabeStart) => void }) {
  const [mandant, setMandant] = useState<MandantDto | null>(null);
  const [ich, setIch] = useState<BenutzerListEintragDto | null>(null);
  const { badge: chatBadge } = useChatEreignisse();
  const badgeFuer = (w: HauptReiter) => (w === "nachrichten" ? chatBadge : 0);
  // Nach dem Uebergabemodus (ersetzt die Shell, siehe App.tsx) zurueck dorthin, wo man war.
  const [tab, setTab] = useState<Tab>(() => {
    try {
      // Nur lesen: der React-StrictMode ruft Initialisierer doppelt auf, ein
      // Entfernen hier ginge im zweiten Aufruf ins Leere (siehe Effekt unten).
      if (sessionStorage.getItem("zv-nach-uebergabe-tab") === "hzl") return "hzl";
    } catch {
      // egal
    }
    return "dashboard";
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem("zv-nach-uebergabe-tab");
    } catch {
      // egal
    }
  }, []);
  const [eingeklappt, setEingeklappt] = useState(() => ladeBoolean(SIDEBAR_SPEICHER));
  // "Beim Ueberfahren ausklappen" wirkt nur, solange das Menueband
  // eingeklappt ist -- greift also erst zusammen mit eingeklappt=true (siehe
  // app.css, [data-eingeklappt="true"][data-hover-ausklappen="true"]).
  const [hoverAusklappen, setHoverAusklappen] = useState(() => ladeBoolean(SIDEBAR_HOVER_SPEICHER));
  // Welche Ansicht "Klienten" zeigt -- liegt hier statt lokal in Klienten.tsx,
  // damit der Unterpunkt "Anwärter" in der Sidebar sie mitsteuern kann.
  const [klientenAnsicht, setKlientenAnsicht] = useState<KlientenAnsicht>("aktiv");
  const [klientenUnterpunkteOffen, setKlientenUnterpunkteOffen] = useState(() =>
    ladeBooleanDefaultAn(SIDEBAR_KLIENTEN_AUFGEKLAPPT_SPEICHER)
  );
  // Auf-/Zuklappzustand der uebrigen Gruppen (Dashboard, Mitarbeitende),
  // je Gruppe getrennt gemerkt wie bei Klienten.
  const [gruppeOffen, setGruppeOffen] = useState<Partial<Record<HauptReiter, boolean>>>(() =>
    Object.fromEntries(
      ([...Object.keys(UNTERPUNKTE), "standorte"] as HauptReiter[]).map((h) => [h, ladeBooleanDefaultAn(sidebarGruppeSpeicher(h))])
    )
  );
  // Reihenfolge der Hauptmenuepunkte -- frei einstellbar (Einstellungen >
  // Darstellung), siehe navigation.ts.
  const [menuReihenfolge, setMenuReihenfolge] = useState<HauptReiter[]>(() => ladeMenuReihenfolge());
  // Die dem Konto zugeordneten, aktiven Standorte -- die Unterpunkte unter
  // "Standorte". Serverseitig schon auf die erlaubten gefiltert
  // (StandortService.findeAlle), hier kommt nichts dazu.
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const unterpunkteVon = (haupt: HauptReiter): UnterpunktEintrag[] | undefined => UNTERPUNKTE[haupt];
  // Alle Hauptpunkte in Menuereihenfolge (Gruppen nacheinander, Einstellungen
  // zuletzt) -- Grundlage fuer "Mehr" auf dem Handy und fuer Panel-Titel.
  const REITER = [
    ...MENUE_GRUPPEN.flatMap((g) => reiterDerGruppe(menuReihenfolge, g.id)),
    ...STANDARD_REITER.filter((r) => r.wert === "einstellungen"),
  ];
  const REITER_MOBIL_SICHTBAR = MOBIL_DIREKT.map((m) => ({
    ...REITER.find((r) => r.wert === m.wert)!,
    label: m.label,
  }));
  const REITER_MOBIL_MEHR = REITER.filter((r) => !MOBIL_DIREKT.some((m) => m.wert === r.wert));

  useEffect(() => speichereBoolean(SIDEBAR_SPEICHER, eingeklappt), [eingeklappt]);
  useEffect(() => speichereBoolean(SIDEBAR_HOVER_SPEICHER, hoverAusklappen), [hoverAusklappen]);
  useEffect(
    () => speichereBoolean(SIDEBAR_KLIENTEN_AUFGEKLAPPT_SPEICHER, klientenUnterpunkteOffen),
    [klientenUnterpunkteOffen]
  );
  useEffect(() => {
    for (const [h, offen] of Object.entries(gruppeOffen)) speichereBoolean(sidebarGruppeSpeicher(h as HauptReiter), !!offen);
  }, [gruppeOffen]);
  useEffect(() => speichereMenuReihenfolge(menuReihenfolge), [menuReihenfolge]);

  // Ueberlagerndes Panel auf dem Handy -- entweder das Sammelmenue ("Mehr")
  // oder, seit Klienten.tsx keine eigene Reiterleiste mehr zeigt, das
  // Ansichten-Panel von "Klienten" (Aktiv/Anwärter/Archiv). Ein
  // gemeinsamer Zustand statt zwei Booleans, damit nie beide gleichzeitig
  // offen sind. Die Sidebar (Desktop) kennt dieses Konzept nicht, sie
  // zeigt immer alle Eintraege direkt.
  const [offenesPanel, setOffenesPanel] = useState<"mehr" | "klienten" | HauptReiter | null>(null);
  const mehrKnopfRef = useRef<HTMLButtonElement>(null);
  const mehrPanelRef = useRef<HTMLDivElement>(null);
  const klientenKnopfRef = useRef<HTMLButtonElement>(null);
  const klientenPanelRef = useRef<HTMLDivElement>(null);
  // Gruppen mit Unterpunkten (Dashboard, Mitarbeitende) auf dem Handy: es ist
  // immer nur ein Panel offen, daher genuegt EIN Panel-Ref; die Knoepfe
  // brauchen je Gruppe einen eigenen (Fokus zurueck beim Schliessen).
  const gruppenKnopfRefs = useRef<Partial<Record<HauptReiter, HTMLButtonElement | null>>>({});
  const gruppenPanelRef = useRef<HTMLDivElement>(null);
  const aktuelleRouteImMehr = REITER_MOBIL_MEHR.some((r) => r.wert === hauptreiterVon(tab));

  function panelSchliessen() {
    const vorheriges = offenesPanel;
    setOffenesPanel(null);
    if (vorheriges === "mehr") mehrKnopfRef.current?.focus();
    if (vorheriges === "klienten") klientenKnopfRef.current?.focus();
    if (vorheriges && vorheriges !== "mehr" && vorheriges !== "klienten") gruppenKnopfRefs.current[vorheriges]?.focus();
  }

  function tabWaehlen(wert: Tab) {
    setTab(wert);
    if (offenesPanel) panelSchliessen();
  }

  /**
   * Klick auf einen Reiter in der mobilen Leiste/im Sammelmenue --
   * "Klienten" oeffnet dort (anders als in der Sidebar, die einen Pfeil
   * dafuer hat) direkt sein eigenes Ansichten-Panel statt sofort zu
   * navigieren, weil ein einzelner Tastendruck sonst keinen Weg zu
   * Archiv/Anwärter haette.
   */
  function reiterKlick(wert: HauptReiter) {
    if (wert === "klienten" || unterpunkteVon(wert)) {
      setOffenesPanel((p) => (p === wert ? null : wert));
    } else {
      tabWaehlen(wert);
    }
  }

  // Escape schliesst, Klick ausserhalb schliesst, Tab haelt den Fokus im
  // Panel gefangen, solange eins offen ist.
  useEffect(() => {
    if (!offenesPanel) return;
    const panelRef =
      offenesPanel === "mehr" ? mehrPanelRef : offenesPanel === "klienten" ? klientenPanelRef : gruppenPanelRef;
    const knopfRef =
      offenesPanel === "mehr"
        ? mehrKnopfRef
        : offenesPanel === "klienten"
          ? klientenKnopfRef
          : { current: gruppenKnopfRefs.current[offenesPanel] ?? null };
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    function beiEscape(e: KeyboardEvent) {
      if (e.key === "Escape") panelSchliessen();
    }
    function beiAussenklick(e: MouseEvent) {
      const ziel = e.target as Node;
      if (panelRef.current?.contains(ziel) || knopfRef.current?.contains(ziel)) return;
      setOffenesPanel(null);
    }
    function beiTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const fokussierbar = panelRef.current.querySelectorAll<HTMLElement>("button");
      if (fokussierbar.length === 0) return;
      const erster = fokussierbar[0];
      const letzter = fokussierbar[fokussierbar.length - 1];
      if (e.shiftKey && document.activeElement === erster) {
        e.preventDefault();
        letzter.focus();
      } else if (!e.shiftKey && document.activeElement === letzter) {
        e.preventDefault();
        erster.focus();
      }
    }
    document.addEventListener("keydown", beiEscape);
    document.addEventListener("mousedown", beiAussenklick);
    document.addEventListener("keydown", beiTab);
    return () => {
      document.removeEventListener("keydown", beiEscape);
      document.removeEventListener("mousedown", beiAussenklick);
      document.removeEventListener("keydown", beiTab);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offenesPanel]);

  // Neu laden, sobald man die Einstellungen verlaesst oder betritt: dort
  // werden Standorte angelegt, umbenannt und deaktiviert -- sonst bliebe das
  // Menue bis zum naechsten Seitenaufruf veraltet.
  const inEinstellungen = tab === "einstellungen";
  useEffect(() => {
    api
      .standorteListe()
      .then((liste) => setStandorte(liste.filter((s) => s.aktiv)))
      .catch(() => {});
  }, [inEinstellungen]);

  useEffect(() => {
    api
      .benutzerIch()
      .then(setIch)
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .eigenerMandant()
      .then((m) => {
        setMandant(m);
        // Die Traegerfarbe ist die Autoritaet -- der localStorage-Wert aus
        // dem Inline-Skript war nur die Ueberbrueckung bis hierher. Ein
        // Wechsel (anderer Traeger, anderswo geaenderte Farbe) korrigiert
        // sich damit spaetestens beim naechsten Laden.
        if (m?.akzentfarbe) akzentSetzen(m.akzentfarbe);
        if (m?.dunkelGrundfarbe) dunkelGrundfarbeSetzen(m.dunkelGrundfarbe);
      })
      .catch(() => {});
  }, []);

  // --- Befehlspalette --------------------------------------------------
  // Ziel einer Palette-Auswahl fuer die Seite, die danach aufgeht. `nonce`
  // im key, damit auch ein erneutes Waehlen auf derselben Seite sie neu
  // aufbaut (die Seiten lesen das Ziel nur beim Einhaengen).
  const [paletteOffen, setPaletteOffen] = useState(false);
  // Zaehlt jedes Oeffnen mit: Esc und Strg+K binnen eines Renderdurchgangs
  // ergaeben sonst "true -> false -> true" ohne sichtbare Aenderung, und die
  // Palette bliebe mit dem alten Suchtext stehen. Strg+K oeffnet deshalb immer
  // frisch statt umzuschalten. (Per Browserpruefung nicht reproduzierbar --
  // Vorsorge, keine gemessene Korrektur.)
  const [paletteNr, setPaletteNr] = useState(0);
  const paletteOeffnen = useCallback(() => {
    setPaletteOffen(true);
    setPaletteNr((n) => n + 1);
  }, []);
  const [navZiel, setNavZiel] = useState<{
    nonce: number;
    klientId?: string;
    kassenbuchKlientId?: string;
    neueBuchung?: boolean;
    tagesberichtKlientId?: string;
  }>({ nonce: 0 });

  const geheZu = useCallback((ziel: Tab, extra: Omit<typeof navZiel, "nonce"> = {}) => {
    setNavZiel((alt) => ({ nonce: alt.nonce + 1, ...extra }));
    setTab(ziel);
    setOffenesPanel(null);
  }, []);

  const dashboardNavigation = useMemo(() => ({ zu: geheZu, suche: paletteOeffnen }), [geheZu, paletteOeffnen]);

  useEffect(() => {
    function taste(e: globalThis.KeyboardEvent) {
      const ziel = e.target instanceof HTMLElement ? e.target : null;
      const inEingabe =
        ziel !== null &&
        (ziel.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(ziel.tagName));
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        paletteOeffnen();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !inEingabe) {
        e.preventDefault();
        paletteOeffnen();
      }
    }
    document.addEventListener("keydown", taste);
    return () => document.removeEventListener("keydown", taste);
  }, [paletteOeffnen]);

  const paletteNavigation: Befehl[] = [
    ...STANDARD_REITER.map((r) => ({ schluessel: `nav:${r.wert}`, titel: r.label, icon: r.icon, ausfuehren: () => geheZu(r.wert) })),
    ...Object.values(UNTERPUNKTE)
      .flat()
      .map((u) => ({ schluessel: `nav:${u.wert}`, titel: u.label, icon: u.icon, ausfuehren: () => geheZu(u.wert) })),
    ...standorte.map((st) => ({
      schluessel: `nav:standort:${st.id}`,
      titel: `Belegung: ${st.name}`,
      hinweis: "Standort wechseln",
      icon: IStandort,
      ausfuehren: () => geheZu(`standort:${st.id}`),
    })),
  ];
  const paletteAktionen: Befehl[] = [
    { schluessel: "aktion:buchung", titel: "Neue Buchung", icon: INeu, ausfuehren: () => geheZu("kassenbuch", { neueBuchung: true }) },
    { schluessel: "aktion:tagesbericht", titel: "Tagesbericht schreiben", icon: ITagesberichte, ausfuehren: () => geheZu("tagesberichte") },
    { schluessel: "aktion:hzl", titel: "HZL auszahlen", icon: IAuszahlen, ausfuehren: () => geheZu("hzl") },
  ];

  const logout = useCallback(() => {
    clearToken();
    zuletztLoeschen();
    entwurfLoeschen();
    onLoggedOut();
  }, [onLoggedOut]);

  /** Ein Hauptpunkt der Seitenleiste -- mit Unterpunkten, Klienten-Ansichten oder schlicht. */
  function renderReiter({ wert, label, icon: Icon }: { wert: HauptReiter; label: string; icon: (typeof STANDARD_REITER)[number]["icon"] }) {
    const aktiv = hauptreiterVon(tab) === wert;
    const unterpunkte = unterpunkteVon(wert);
    if (unterpunkte) {
      const offen = gruppeOffen[wert] ?? true;
      return (
        <div key={wert} className="zv-sidebar-gruppe">
          <div className="zv-sidebar-gruppe-zeile">
            <button
              className={tab === wert ? "active" : ""}
              onClick={() => tabWaehlen(wert)}
              aria-current={tab === wert ? "page" : undefined}
              title={label}
            >
              <Icon />
              <span className="zv-sidebar-label">{label}</span>
            </button>
            <button
              type="button"
              className="zv-icon-btn zv-sidebar-gruppe-pfeil"
              onClick={() => setGruppeOffen((g) => ({ ...g, [wert]: !offen }))}
              aria-expanded={offen}
              aria-label={offen ? `Unterpunkte von ${label} einklappen` : `Unterpunkte von ${label} ausklappen`}
              title={offen ? "Einklappen" : "Ausklappen"}
            >
              {offen ? <IZuklappen /> : <IAufklappen />}
            </button>
          </div>
          {offen && (
            <div className="zv-sidebar-unterpunkte">
              {unterpunkte.map((u) => (
                <button
                  key={u.wert}
                  className={tab === u.wert ? "active" : ""}
                  onClick={() => tabWaehlen(u.wert)}
                  aria-current={tab === u.wert ? "page" : undefined}
                  title={u.label}
                >
                  <u.icon />
                  <span className="zv-sidebar-label">{u.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (wert !== "klienten") {
      return (
        <button
          key={wert}
          className={aktiv ? "active" : ""}
          onClick={() => tabWaehlen(wert)}
          aria-current={aktiv ? "page" : undefined}
          title={label}
        >
          <Icon />
          <span className="zv-sidebar-label">{label}</span>
          <NavBadge anzahl={badgeFuer(wert)} />
        </button>
      );
    }
    // "Klienten" bekommt aufklappbare Unterpunkte "Anwärter" und "Archiv"
    // (siehe Klienten.tsx) -- der Pfeil klappt nur die Unterzeilen ein/aus,
    // der Hauptknopf navigiert weiterhin direkt auf die Klienten-Seite.
    return (
      <div key={wert} className="zv-sidebar-gruppe">
        <div className="zv-sidebar-gruppe-zeile">
          <button
            className={tab === "klienten" ? "active" : ""}
            onClick={() => {
              tabWaehlen("klienten");
              setKlientenAnsicht("aktiv");
            }}
            aria-current={tab === "klienten" ? "page" : undefined}
            title={label}
          >
            <Icon />
            <span className="zv-sidebar-label">{label}</span>
          </button>
          <button
            type="button"
            className="zv-icon-btn zv-sidebar-gruppe-pfeil"
            onClick={() => setKlientenUnterpunkteOffen((v) => !v)}
            aria-expanded={klientenUnterpunkteOffen}
            aria-label={klientenUnterpunkteOffen ? "Unterpunkte von Klienten einklappen" : "Unterpunkte von Klienten ausklappen"}
            title={klientenUnterpunkteOffen ? "Einklappen" : "Ausklappen"}
          >
            {klientenUnterpunkteOffen ? <IZuklappen /> : <IAufklappen />}
          </button>
        </div>
        {klientenUnterpunkteOffen && (
          <div className="zv-sidebar-unterpunkte">
            {KLIENTEN_UNTERPUNKTE.map((u) => (
              <button
                key={u.ansicht}
                className={tab === "klienten" && klientenAnsicht === u.ansicht ? "active" : ""}
                onClick={() => {
                  tabWaehlen("klienten");
                  setKlientenAnsicht(u.ansicht);
                }}
                aria-current={tab === "klienten" && klientenAnsicht === u.ansicht ? "page" : undefined}
                title={u.label}
              >
                <u.icon />
                <span className="zv-sidebar-label">{u.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="zv-app-layout">
      {/* Nur ab einer bestimmten Breite sichtbar (app.css) -- auf dem Handy
          uebernimmt weiterhin .zv-tabbar-app ganz unten, siehe dort fuer die
          Begruendung (kein position:fixed, echte Mobilbrowser-Tests). */}
      <aside
        className="zv-sidebar"
        data-eingeklappt={eingeklappt}
        data-hover-ausklappen={hoverAusklappen}
        onMouseLeave={(e) => {
          // Chromium fokussiert einen <button> nach einem Mausklick (anders
          // als Firefox/Safari) -- ohne dieses Blur bliebe die
          // Hover-Ausklappen-Ueberlagerung (:focus-within, siehe app.css)
          // sichtbar haengen, nachdem man z.B. einen Navigationspunkt
          // angeklickt hat und die Maus danach wegbewegt. Tastaturnutzung
          // (Tab durch die Navigation) loest kein mouseleave aus und bleibt
          // davon unberuehrt -- genau dort soll :focus-within weiter greifen.
          if (e.currentTarget.contains(document.activeElement)) {
            (document.activeElement as HTMLElement | null)?.blur();
          }
        }}
      >
        <div className="zv-sidebar-inner">
          <div className="zv-sidebar-brand">
            <span className="zv-brand-mark">
              <MarkenIcon groesse={24} />
            </span>
            <div className="zv-brand-text">
              <strong>hecaso</strong>
            </div>
          </div>
          {mandant && (
            // Bewusst kein Knopf mit Pfeil: es gibt (noch) keinen Traegerwechsel,
            // eine Schaltflaeche ohne Wirkung waere eine Attrappe.
            <div className="zv-mandant-zeile" title={mandant.name}>
              <ITraeger />
              <span className="zv-sidebar-label">{mandant.name}</span>
            </div>
          )}

          <nav className="zv-sidebar-nav zv-sidebar-nav-haupt" aria-label="Hauptmenü">
            {MENUE_GRUPPEN.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`zv-gruppe-${g.id}`} className="zv-sidebar-gruppenblock">
                <div className="zv-gruppenlabel" id={`zv-gruppe-${g.id}`}>
                  {g.label}
                </div>
                {reiterDerGruppe(menuReihenfolge, g.id).map(renderReiter)}
              </div>
            ))}
          </nav>

          <div className="zv-sidebar-foot">
            <nav className="zv-sidebar-nav" aria-label="Einstellungen">
              {STANDARD_REITER.filter((r) => r.wert === "einstellungen").map(renderReiter)}
            </nav>
            <div className="zv-benutzerblock" title={ich ? `${ich.name}` : undefined}>
              <span className="zv-benutzer-kachel" aria-hidden="true">
                {ich ? initialen(ich.name) : "·"}
              </span>
              <span className="zv-benutzer-text zv-sidebar-label">
                <span className="zv-benutzer-name">{ich?.name ?? "…"}</span>
                <span className="zv-benutzer-rolle">{ich ? (ich.positionen[0]?.titel ?? "Keine Position") : ""}</span>
              </span>
            </div>
            <div className="zv-sidebar-foot-icons">
              <ThemeToggle />
              <button
                type="button"
                className="zv-icon-btn"
                onClick={() => setEingeklappt((v) => !v)}
                aria-label={eingeklappt ? "Menüband ausklappen" : "Menüband einklappen"}
                title={eingeklappt ? "Menüband ausklappen" : "Menüband einklappen"}
              >
                {eingeklappt ? <IAusklappen /> : <IEinklappen />}
              </button>
            </div>
            <button
              className="zv-btn zv-btn-still zv-btn-klein zv-btn-block"
              onClick={logout}
              aria-label="Abmelden"
              title="Abmelden"
            >
              <IAbmelden />
              <span className="zv-sidebar-label">Abmelden</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="zv-shell-app">
        <div className="zv-topbar">
          <div className="zv-topbar-marke">
            <MarkenIcon groesse={20} />
            <strong>hecaso</strong>
            {mandant && (
              <span>
                <ITraeger style={{ verticalAlign: "-3px", marginRight: 4 }} />
                {mandant.name}
              </span>
            )}
          </div>
          <div className="zv-topbar-aktionen">
            <ThemeToggle />
            <button className="zv-btn zv-btn-still zv-btn-klein" onClick={logout}>
              <IAbmelden />
              Abmelden
            </button>
          </div>
        </div>

        {offenesPanel === "mehr" && (
          <div
            id="zv-sammelmenue-panel"
            className="zv-sammelmenue"
            ref={mehrPanelRef}
            role="menu"
            aria-label="Weitere Bereiche"
          >
            {REITER_MOBIL_MEHR.map(({ wert, label, icon: Icon }) => (
              <button
                key={wert}
                ref={wert === "klienten" ? klientenKnopfRef : (el) => void (gruppenKnopfRefs.current[wert] = el)}
                role="menuitem"
                className={hauptreiterVon(tab) === wert ? "active" : ""}
                onClick={() => reiterKlick(wert)}
                aria-current={hauptreiterVon(tab) === wert ? "page" : undefined}
                // In diesem Zweig ist offenesPanel immer "mehr" (TS narrowt das),
                // das Klienten-Panel also nie gleichzeitig offen -- daher hier
                // schlicht false statt eines Vergleichs mit demselben Ergebnis.
                aria-expanded={wert === "klienten" || unterpunkteVon(wert) ? false : undefined}
              >
                <Icon />
                {label}
                <NavBadge anzahl={badgeFuer(wert)} />
              </button>
            ))}
          </div>
        )}

        {offenesPanel === "klienten" && (
          <div
            id="zv-klienten-panel"
            className="zv-sammelmenue"
            ref={klientenPanelRef}
            role="menu"
            aria-label="Klienten-Ansichten"
          >
            {KLIENTEN_MOBIL_PANEL.map((u) => (
              <button
                key={u.ansicht}
                role="menuitem"
                className={tab === "klienten" && klientenAnsicht === u.ansicht ? "active" : ""}
                onClick={() => {
                  tabWaehlen("klienten");
                  setKlientenAnsicht(u.ansicht);
                }}
                aria-current={tab === "klienten" && klientenAnsicht === u.ansicht ? "page" : undefined}
              >
                <u.icon />
                {u.label}
              </button>
            ))}
          </div>
        )}

        {offenesPanel && offenesPanel !== "mehr" && offenesPanel !== "klienten" && unterpunkteVon(offenesPanel) && (
          <div
            className="zv-sammelmenue"
            ref={gruppenPanelRef}
            role="menu"
            aria-label={`${REITER.find((r) => r.wert === offenesPanel)?.label ?? ""}: Bereiche`}
          >
            {[
              REITER.find((r) => r.wert === offenesPanel)!,
              ...unterpunkteVon(offenesPanel)!.map((u) => ({ wert: u.wert, label: u.label, icon: u.icon })),
            ].map(({ wert, label, icon: Icon }) => (
              <button
                key={wert}
                role="menuitem"
                className={tab === wert ? "active" : ""}
                onClick={() => tabWaehlen(wert)}
                aria-current={tab === wert ? "page" : undefined}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="zv-tabbar zv-tabbar-app">
          {REITER_MOBIL_SICHTBAR.map(({ wert, label, icon: Icon }) => (
            <button
              key={wert}
              ref={wert === "klienten" ? klientenKnopfRef : (el) => void (gruppenKnopfRefs.current[wert] = el)}
              className={hauptreiterVon(tab) === wert ? "active" : ""}
              onClick={() => reiterKlick(wert)}
              aria-current={hauptreiterVon(tab) === wert ? "page" : undefined}
              aria-expanded={wert === "klienten" || unterpunkteVon(wert) ? offenesPanel === wert : undefined}
            >
              <Icon />
              {label}
              <NavBadge anzahl={badgeFuer(wert)} />
            </button>
          ))}
          <button
            ref={mehrKnopfRef}
            className={aktuelleRouteImMehr ? "active" : ""}
            aria-expanded={offenesPanel === "mehr"}
            aria-controls="zv-sammelmenue-panel"
            aria-current={aktuelleRouteImMehr ? "page" : undefined}
            onClick={() => setOffenesPanel((p) => (p === "mehr" ? null : "mehr"))}
          >
            <IMehr />
            Mehr
            {REITER_MOBIL_MEHR.some((r) => badgeFuer(r.wert) > 0) && <span className="zv-nav-badge zv-nav-badge-punkt" aria-hidden="true" />}
          </button>
        </div>

        <div
          className={`zv-content${BREITE_REITER.has(tab) || tab.startsWith("standort:") ? " zv-content-weit" : ""}${tab === "nachrichten" ? " zv-content-voll" : ""}`}
        >
          <WarteschlangeLeiste />
          {tab === "dashboard" && <Dashboard navigation={dashboardNavigation} />}
          {tab === "standorte" && <StandortUebersicht onBelegungOeffnen={(id) => geheZu(`standort:${id}`)} />}
          {tab.startsWith("standort:") && (
            <StandortRaeume key={tab} standortId={tab.slice("standort:".length)} onStandortWaehlen={(id) => geheZu(id ? `standort:${id}` : "standorte")} />
          )}
          {tab === "klienten" && <Klienten key={navZiel.nonce} ansicht={klientenAnsicht} onAnsichtChange={setKlientenAnsicht} oeffneKlientId={navZiel.klientId} />}
          {tab === "kassenbuch" && <Kassenbuch key={navZiel.nonce} ansicht="buchungen" startFilterKlientId={navZiel.kassenbuchKlientId} startNeueBuchung={navZiel.neueBuchung} />}
          {tab === "hzl" && <Kassenbuch ansicht="hzl" onUebergabeStarten={onUebergabeStarten} />}
          {tab === "tagesberichte" && <Tagesberichte key={navZiel.nonce} startKlientId={navZiel.tagesberichtKlientId} />}
          {tab === "nachrichten" && <Nachrichten />}
          {tab === "kalender" && <Kalender />}
          {tab === "aufgaben" && <Aufgaben />}
          {tab === "schichtuebergabe" && <Schichtuebergabe />}
          {tab === "mitarbeitende" && <Mitarbeitende />}
          {tab === "vertretung" && <Vertretung />}
          {tab === "organigramm" && <Organigramm />}
          {tab === "einstellungen" && (
            <Einstellungen
              mandant={mandant}
              onMandantAktualisiert={setMandant}
              hoverAusklappen={hoverAusklappen}
              onHoverAusklappenAendern={setHoverAusklappen}
              menuReihenfolge={menuReihenfolge}
              onMenuReihenfolgeAendern={setMenuReihenfolge}
            />
          )}
        </div>
      </div>
      <Befehlspalette
        offen={paletteOffen}
        oeffnungNr={paletteNr}
        onSchliessen={() => setPaletteOffen(false)}
        navigation={paletteNavigation}
        aktionen={paletteAktionen}
        tagesberichtFuer={(t) => geheZu("tagesberichte", { tagesberichtKlientId: t.id })}
        onTreffer={(t) => {
          zuletztMerken({ gruppe: t.gruppe, id: t.id });
          if (t.gruppe === "klienten") geheZu("klienten", { klientId: t.id });
          else if (t.gruppe === "zimmer") geheZu(t.standortId ? `standort:${t.standortId}` : "standorte");
          else if (t.gruppe === "mitarbeitende") geheZu("mitarbeitende");
          else geheZu("kassenbuch");
        }}
      />
    </div>
  );
}
