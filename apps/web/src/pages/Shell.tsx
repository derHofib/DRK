import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BenutzerListEintragDto, EinstellungenRechteDto, MandantDto, RueckmeldungBerechtigungDto, StandortDto } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";
import { akzentSetzen, dunkelGrundfarbeSetzen } from "../theme/theme";
import { WarteschlangeLeiste } from "../components/WarteschlangeLeiste";
import { ThemeToggle } from "../components/ThemeToggle";
import { MarkenIcon } from "../components/MarkenZeichen";
import { DeineSicht, StandortZeile, sichtKurztext, vertretungKurztext } from "../components/StandortSicht";
import { useChatEreignisse } from "../components/chat/ereignisse";
import { initialen, ungelesenAnzeige } from "../format";
import {
  IAbmelden,
  IAnwaerter,
  IArchivieren,
  IAuszahlen,
  IAusklappen,
  IEinklappen,
  IKlienten,
  ILeerStandorte,
  IMehr,
  INeu,
  IRueckmeldung,
  IRueckmeldungen,
  IStandort,
  ITagesberichte,
  ITraeger,
  IAufklappen,
  IZuklappen,
  IOrdner,
  IOrdnerOffen,
} from "../components/icons";
import {
  MENUE_GRUPPEN,
  ORGANISATORISCH,
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
import { Leerzustand } from "../components/Leerzustand";
import { StandortRaeume } from "./StandortRaeume";
import { Klienten } from "./Klienten";
import { Mitarbeitende } from "./Mitarbeitende";
import { Kassenbuch } from "./Kassenbuch";
import type { UebergabeStart } from "./HzlUebergabe";
import { Befehl, Befehlspalette, zuletztLoeschen, zuletztMerken } from "../components/Befehlspalette";
import { terminTypenVergessen } from "../kalender/terminTypen";
import { NeuerEintragFenster } from "../components/NeuerEintrag";
import { Dokumentation } from "./Dokumentation";
import { Stunden } from "./Stunden";
import { Aufgaben } from "./Aufgaben";
import { Vertretung } from "./Vertretung";
import { Organigramm } from "./Organigramm";
import { Einstellungen } from "./Einstellungen";
import { Nachrichten } from "./Nachrichten";
import { Kalender } from "./Kalender";
import { Rueckmeldungen } from "./Rueckmeldungen";
import { Formulare } from "./Formulare";
import { Standorte } from "./Standorte";
import { TypenUndListen } from "./TypenUndListen";
import { RueckmeldungDialog } from "../components/RueckmeldungDialog";
import { ProtokollSprungKontext, type ProtokollSprung } from "../components/ProtokollSprung";
import { SICHTBAR_ATTRIBUT } from "../rueckmeldung/maskierung";
import { nimmMaskiertenScreenshot, type MaskierterScreenshot } from "../rueckmeldung/screenshot";

/**
 * Die vier Punkte, die auf dem Handy immer direkt in der unteren Leiste
 * stehen (plus "Mehr"): das, was im Dienst am haeufigsten gebraucht wird.
 * Fest statt aus der einstellbaren Reihenfolge abgeleitet -- die gilt jetzt
 * je Gruppe, und eine Leiste, deren Inhalt davon abhaengt, in welcher
 * Gruppe man etwas nach oben geschoben hat, waere nicht vorhersagbar. Die
 * Sidebar zeigt weiterhin immer alle. "Doku" ist die Kurzform von
 * Dokumentation, damit das Wort in eine Leiste mit fuenf Feldern passt.
 */
const MOBIL_DIREKT: { wert: HauptReiter; label: string }[] = [
  { wert: "dashboard", label: "Heute" },
  { wert: "klienten", label: "Klienten" },
  { wert: "nachrichten", label: "Nachrichten" },
  { wert: "tagesberichte", label: "Doku" },
];


/**
 * Rahmen fuer Seiten, die aus den Einstellungen nach "Organisatorisch"
 * umgezogen sind: dort lieferten die Einstellungen Titel und Beschreibung,
 * die Seiten selbst haben keinen eigenen Kopf.
 */
function OrganisatorischSeite({ eintrag, children }: { eintrag: Tab; children: ReactNode }) {
  const e = ORGANISATORISCH.find((o) => o.wert === eintrag);
  return (
    <div>
      <div className="zv-seiten-kopf">
        <div>
          <h2>{e?.label}</h2>
          <p className="zv-sub">{e?.beschreibung}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Zaehler am Menuepunkt; 0 = unsichtbar. */
function NavBadge({ anzahl }: { anzahl: number }) {
  if (anzahl <= 0) return null;
  return (
    <span className="zv-nav-badge" aria-label={ungelesenAnzeige(anzahl).label}>
      {ungelesenAnzeige(anzahl).text}
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
  // Einstellungen: Menuespalte + Kartenraster brauchen die Breite (Einstellungen.tsx).
  "einstellungen",
  "standorte",
  "kassenbuch",
  "hzl",
  "klienten",
  "nachrichten",
  "kalender",
  "mitarbeitende",
  "tagesberichte",
  "stunden",
  "aufgaben",
  "vertretung",
  "organigramm",
  "rueckmeldungen",
  "formulare",
  "standorte-verwalten",
  "buchungstypen",
]);

const SIDEBAR_SPEICHER = "zimmerakte_sidebar_eingeklappt";
const SIDEBAR_HOVER_SPEICHER = "zimmerakte_sidebar_hover_ausklappen";
const SIDEBAR_KLIENTEN_AUFGEKLAPPT_SPEICHER = "zimmerakte_sidebar_klienten_aufgeklappt";
const sidebarGruppeSpeicher = (haupt: HauptReiter) => `zimmerakte_sidebar_${haupt}_aufgeklappt`;
// Anders als die uebrigen Gruppen standardmaessig ZU (ladeBoolean, nicht
// ...DefaultAn): Organisatorisches braucht man selten, es soll im Alltag
// nicht auffallen (Rueckmeldung "Formulare", Wunsch "Aktenlippe").
const SIDEBAR_ORGANISATORISCH_SPEICHER = "zimmerakte_sidebar_organisatorisch_aufgeklappt";

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
  // "Deine Sicht" (Standort unter dem Namen, Migration 0084).
  const [sichtOffen, setSichtOffen] = useState(false);
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
  // Stunden aus dem Kalender (migrations/0080): beim Start der App -- also nach
  // dem Anmelden und auf "Heute" -- die seit dem letzten Besuch beendeten
  // eigenen Termine buchen. Kein Hintergrundlauf auf dem Server (Konzept 3.3);
  // Fehler sind hier egal, die Stundenseite zieht beim Oeffnen erneut nach.
  useEffect(() => {
    api.stundenKalenderNachziehen().catch(() => undefined);
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
  const [standorteGeladen, setStandorteGeladen] = useState(false);
  // Welcher Standort unter "Standorte > Belegung" offen ist; null = noch keiner
  // gewaehlt, dann der erste. Hier statt im Tab-Wert, damit "Belegung" in der
  // Seitenleiste ein einziger Eintrag bleibt.
  // Leere Liste = alle Standorte (gruppiert), siehe StandortMehrfachFilter.
  const [belegungStandortIds, setBelegungStandortIds] = useState<string[]>([]);
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
  const aktuelleRouteImMehr =
    REITER_MOBIL_MEHR.some((r) => r.wert === hauptreiterVon(tab)) || ORGANISATORISCH.some((o) => o.wert === tab);

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
      .catch(() => {})
      .finally(() => setStandorteGeladen(true));
  }, [inEinstellungen]);

  useEffect(() => {
    api
      .benutzerIch()
      .then(setIch)
      .catch(() => {});
  }, []);

  // --- Rueckmeldungen ---------------------------------------------------
  // Ohne Recht liefert die API verwalten=false (keine Fehlermeldung): der
  // Menuepunkt erscheint nur fuer die Geschaeftsfuehrung. Die Pruefung, die
  // zaehlt, sitzt im Service -- das hier blendet nur aus.
  const [rmRecht, setRmRecht] = useState<RueckmeldungBerechtigungDto>({ verwalten: false, anzahlNeu: 0 });
  const rmRechtLaden = useCallback(() => {
    api
      .rueckmeldungBerechtigung()
      .then(setRmRecht)
      .catch(() => {});
  }, []);
  useEffect(rmRechtLaden, [rmRechtLaden]);

  // --- Organisatorisch ---------------------------------------------------
  // Wie bei den Rueckmeldungen nur Ausblenden: die API lehnt ohne Recht ab.
  // Die Rechte fuer Standorte, Buchungstypen und Formulare liefert derselbe
  // Aufruf wie fuer die Einstellungen (mandant.service.ts, einstellungenRechte);
  // Rueckmeldungen haengen an ihrem eigenen Recht (rmRecht oben).
  const [traegerRechte, setTraegerRechte] = useState<EinstellungenRechteDto | null>(null);
  useEffect(() => {
    api
      .einstellungenRechte()
      .then(setTraegerRechte)
      .catch(() => {});
  }, []);
  const organisatorisch = ORGANISATORISCH.filter((o) =>
    o.recht === "rueckmeldungen"
      ? rmRecht.verwalten
      : o.recht === "typen"
        ? !!(traegerRechte?.kassenbuch || traegerRechte?.termintypen)
        : !!traegerRechte?.[o.recht]
  );
  const [organisatorischOffen, setOrganisatorischOffen] = useState(() => ladeBoolean(SIDEBAR_ORGANISATORISCH_SPEICHER));
  useEffect(() => speichereBoolean(SIDEBAR_ORGANISATORISCH_SPEICHER, organisatorischOffen), [organisatorischOffen]);
  // Wer ueber die Befehlspalette auf eine Seite darin springt, soll sehen, wo sie wohnt.
  const inOrganisatorisch = ORGANISATORISCH.some((o) => o.wert === tab);
  useEffect(() => {
    if (inOrganisatorisch) setOrganisatorischOffen(true);
  }, [inOrganisatorisch]);

  // Der Screenshot entsteht VOR dem Oeffnen des Dialogs, damit dieser nicht
  // selbst im Bild landet; er ist beim Entstehen schon maskiert.
  const [rmDialog, setRmDialog] = useState<{ screenshot: MaskierterScreenshot | null; seite: string } | null>(null);
  const [rmAufnahme, setRmAufnahme] = useState(false);
  async function rueckmeldungStarten() {
    if (rmAufnahme) return;
    setRmAufnahme(true);
    const seite = tab;
    try {
      // Scheitert die Aufnahme, geht die Rueckmeldung ohne Bild -- nie mit einem unmaskierten.
      const screenshot = await nimmMaskiertenScreenshot().catch(() => null);
      setRmDialog({ screenshot, seite });
    } finally {
      setRmAufnahme(false);
    }
  }

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
  // "Telefonat erfassen" aus der Palette: das Fenster steht hier, nicht in
  // der Akte -- wer gerade woanders ist, soll dort bleiben koennen.
  const [darfVerlaufAnlegen, setDarfVerlaufAnlegen] = useState(false);
  const [telefonatKlient, setTelefonatKlient] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    api
      .verlaufRechte()
      .then((r) => setDarfVerlaufAnlegen(r.anlegen))
      .catch(() => setDarfVerlaufAnlegen(false));
  }, []);
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
    protokollSprung?: ProtokollSprung;
    /** Organisatorisch > Standorte: gleich diesen Steckbrief oeffnen. */
    standortId?: string;
    /** Nachrichten: gleich diesen Chat oeffnen (z. B. aus den Team-Karten des Steckbriefs). */
    chatId?: string;
  }>({ nonce: 0 });

  const geheZu = useCallback((ziel: Tab, extra: Omit<typeof navZiel, "nonce"> = {}) => {
    setNavZiel((alt) => ({ nonce: alt.nonce + 1, ...extra }));
    setTab(ziel);
    setOffenesPanel(null);
  }, []);

  // Variante B (Konzept protokoll-ansicht): ausserhalb der Akte gibt es kein
  // Panel, in dem das Protokoll aufgehen koennte -- „In der Akte öffnen“
  // springt dorthin, wo Korrigieren und Historie liegen.
  const protokollSprungWege = useMemo(
    () => ({ inAkteOeffnen: (s: ProtokollSprung) => geheZu("klienten", { klientId: s.klientId, protokollSprung: s }) }),
    [geheZu],
  );

  const belegungOeffnen = useCallback(
    (standortId: string | null) => {
      // "Standorte" ist seit der Zusammenlegung mit Heute (siehe
      // dashboard/standortKacheln.tsx) direkt die Belegung. Ein Sprung von
      // einem bestimmten Standort aus zeigt genau diesen; ohne Angabe bleibt
      // die zuletzt gewaehlte Auswahl (anfangs: alle).
      if (standortId) setBelegungStandortIds([standortId]);
      geheZu("standorte");
    },
    [geheZu],
  );

  const dashboardNavigation = useMemo(
    () => ({ zu: geheZu, suche: paletteOeffnen, belegung: belegungOeffnen }),
    [geheZu, paletteOeffnen, belegungOeffnen],
  );

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
    ...organisatorisch.map((o) => ({ schluessel: `nav:${o.wert}`, titel: o.label, hinweis: "Organisatorisch", icon: o.icon, ausfuehren: () => geheZu(o.wert) })),
    ...standorte.map((st) => ({
      schluessel: `nav:standort:${st.id}`,
      titel: `Belegung: ${st.name}`,
      hinweis: "Standort wechseln",
      icon: IStandort,
      ausfuehren: () => belegungOeffnen(st.id),
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
    terminTypenVergessen();
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

          <nav className="zv-sidebar-nav zv-sidebar-nav-haupt" aria-label="Hauptmenü" {...{ [SICHTBAR_ATTRIBUT]: "" }}>
            {MENUE_GRUPPEN.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`zv-gruppe-${g.id}`} className="zv-sidebar-gruppenblock">
                <div className="zv-gruppenlabel" id={`zv-gruppe-${g.id}`}>
                  {g.label}
                </div>
                {reiterDerGruppe(menuReihenfolge, g.id).map(renderReiter)}
              </div>
            ))}
          </nav>

          {organisatorisch.length > 0 && (
            // Die "Aktenlippe": eine kleine, blasse Karteilasche LINKS auf der
            // Trennlinie zum Fuss. Aufgeklappt bilden Lasche und Inhalt EINE
            // Karteikarte (gleiche Flaeche, gemeinsamer Rahmen, kein Strich
            // dazwischen) und der Inhalt steht UNTER der Lasche -- vorher stand
            // er ohne Rahmen darueber, und man sah nicht, woraus er kam
            // (Rueckmeldung "Organisatorisch Reiter links im Menue").
            <div className="zv-aktenlippe" data-offen={organisatorischOffen} {...{ [SICHTBAR_ATTRIBUT]: "" }}>
              <button
                type="button"
                className="zv-aktenlippe-lasche"
                onClick={() => setOrganisatorischOffen((v) => !v)}
                aria-expanded={organisatorischOffen}
                aria-controls="zv-organisatorisch"
                title={organisatorischOffen ? "Organisatorisch einklappen" : "Organisatorisch ausklappen"}
              >
                {organisatorischOffen ? <IOrdnerOffen aria-hidden="true" /> : <IOrdner aria-hidden="true" />}
                <span className="zv-sidebar-label">Organisatorisch</span>
                {!organisatorischOffen && rmRecht.anzahlNeu > 0 && (
                  <span className="zv-aktenlippe-punkt" aria-label={`${rmRecht.anzahlNeu} neue Rückmeldungen`} />
                )}
              </button>
              {organisatorischOffen && (
                <nav id="zv-organisatorisch" className="zv-sidebar-nav zv-aktenlippe-inhalt" aria-label="Organisatorisch">
                  {organisatorisch.map((o) => (
                    <button
                      key={o.wert}
                      className={tab === o.wert ? "active" : ""}
                      onClick={() => tabWaehlen(o.wert)}
                      aria-current={tab === o.wert ? "page" : undefined}
                      title={o.label}
                    >
                      <o.icon />
                      <span className="zv-sidebar-label">{o.label}</span>
                      {o.wert === "rueckmeldungen" && <NavBadge anzahl={rmRecht.anzahlNeu} />}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          )}

          <div className="zv-sidebar-foot">
            <nav className="zv-sidebar-nav" aria-label="Einstellungen" {...{ [SICHTBAR_ATTRIBUT]: "" }}>
              {STANDARD_REITER.filter((r) => r.wert === "einstellungen").map(renderReiter)}
            </nav>
            <div
              className="zv-benutzerblock"
              data-mit-standort={ich && !ich.sicht.alle ? "" : undefined}
              title={ich ? [ich.name, sichtKurztext(ich.sicht), vertretungKurztext(ich.sicht)].filter(Boolean).join(" · ") : undefined}
            >
              <span className="zv-benutzer-kachel" aria-hidden="true">
                {ich ? initialen(ich.name) : "·"}
                {/* Nur im eingeklappten Menueband sichtbar (app.css): dort fehlt die Pille. */}
                {ich && vertretungKurztext(ich.sicht) && <span className="zv-benutzer-kachel-punkt" />}
              </span>
              <span className="zv-benutzer-text zv-sidebar-label">
                <span className="zv-benutzer-name">{ich?.name ?? "…"}</span>
                <span className="zv-benutzer-rolle">{ich ? (ich.positionen[0]?.titel ?? "Keine Position") : ""}</span>
                {ich && <StandortZeile sicht={ich.sicht} onOeffnen={() => setSichtOffen((v) => !v)} />}
              </span>
            </div>
            <div className="zv-sidebar-foot-icons">
              <ThemeToggle />
              <button
                type="button"
                className="zv-icon-btn"
                onClick={rueckmeldungStarten}
                disabled={rmAufnahme}
                aria-label="Rückmeldung geben: Idee oder Fehler melden"
                title="Rückmeldung geben"
              >
                <IRueckmeldung />
              </button>
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

      {/* Ausserhalb der Seitenleiste: am Handy ist sie ausgeblendet, das Blatt
          muss trotzdem erscheinen (app.css, .zv-sicht-blatt). */}
      {sichtOffen && ich && (
        <DeineSicht
          sicht={ich.sicht}
          onClose={() => setSichtOffen(false)}
          onBelegung={(id) => {
            setSichtOffen(false);
            belegungOeffnen(id);
          }}
        />
      )}

      <div className="zv-shell-app">
        <div className="zv-topbar">
          <div className="zv-topbar-marke">
            <MarkenIcon groesse={20} />
            <strong>hecaso</strong>
            {mandant && (ich === null || ich.sicht.alle) && (
              <span>
                <ITraeger style={{ verticalAlign: "-3px", marginRight: 4 }} />
                {mandant.name}
              </span>
            )}
            {/* Am Handy gibt es keinen Namensblock: wer eingeschraenkt ist, sieht
                seinen Standort dort, wo sonst der Traeger steht (Traeger klein darueber). */}
            {mandant && ich && !ich.sicht.alle && (
              <span className="zv-topbar-ort">
                <small>
                  <ITraeger />
                  {mandant.name}
                </small>
                <button type="button" data-sicht-ausloeser="" onClick={() => setSichtOffen((v) => !v)} aria-label={`Deine Sicht: ${sichtKurztext(ich.sicht)}`}>
                  <IStandort />
                  {sichtKurztext(ich.sicht)}
                </button>
              </span>
            )}
          </div>
          <div className="zv-topbar-aktionen">
            <ThemeToggle />
            {rmRecht.verwalten && (
              <button type="button" className="zv-icon-btn" onClick={() => tabWaehlen("rueckmeldungen")} aria-label="Rückmeldungen ansehen" title="Rückmeldungen">
                <IRueckmeldungen />
              </button>
            )}
            <button
              type="button"
              className="zv-icon-btn"
              onClick={rueckmeldungStarten}
              disabled={rmAufnahme}
              aria-label="Rückmeldung geben: Idee oder Fehler melden"
              title="Rückmeldung geben"
            >
              <IRueckmeldung />
            </button>
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
            {...{ [SICHTBAR_ATTRIBUT]: "" }}
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
            {organisatorisch.length > 0 && (
              <>
                <div className="zv-sammelmenue-trenner" role="presentation">
                  Organisatorisch
                </div>
                {organisatorisch.map((o) => (
                  <button
                    key={o.wert}
                    role="menuitem"
                    className={tab === o.wert ? "active" : ""}
                    onClick={() => tabWaehlen(o.wert)}
                    aria-current={tab === o.wert ? "page" : undefined}
                  >
                    <o.icon />
                    {o.label}
                    {o.wert === "rueckmeldungen" && <NavBadge anzahl={rmRecht.anzahlNeu} />}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {offenesPanel === "klienten" && (
          <div
            id="zv-klienten-panel"
            className="zv-sammelmenue"
            {...{ [SICHTBAR_ATTRIBUT]: "" }}
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
            {...{ [SICHTBAR_ATTRIBUT]: "" }}
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

        <div className="zv-tabbar zv-tabbar-app" {...{ [SICHTBAR_ATTRIBUT]: "" }}>
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
          className={`zv-content${BREITE_REITER.has(tab) ? " zv-content-weit" : ""}${tab === "nachrichten" ? " zv-content-voll" : ""}`}
        >
          <WarteschlangeLeiste />
          {tab === "dashboard" && <Dashboard navigation={dashboardNavigation} nutzerId={ich?.id ?? "unbekannt"} sicht={ich?.sicht ?? null} />}
          {tab === "standorte" && standorteGeladen && standorte.length === 0 && (
            <Leerzustand icon={ILeerStandorte}>Ihnen ist kein Standort zugeordnet.</Leerzustand>
          )}
          {tab === "standorte" && standorte.length > 0 && (
            <StandortRaeume
              standortIds={belegungStandortIds}
              onStandorteWaehlen={setBelegungStandortIds}
              onChatOeffnen={(chatId) => geheZu("nachrichten", { chatId })}
            />
          )}
          {tab === "klienten" && <Klienten key={navZiel.nonce} ansicht={klientenAnsicht} onAnsichtChange={setKlientenAnsicht} oeffneKlientId={navZiel.klientId} oeffneProtokoll={navZiel.protokollSprung} />}
          {tab === "kassenbuch" && <Kassenbuch key={navZiel.nonce} ansicht="buchungen" startFilterKlientId={navZiel.kassenbuchKlientId} startNeueBuchung={navZiel.neueBuchung} />}
          {tab === "hzl" && <Kassenbuch ansicht="hzl" onUebergabeStarten={onUebergabeStarten} />}
          {tab === "stunden" && <Stunden key={navZiel.nonce} />}
          {tab === "tagesberichte" && (
            <ProtokollSprungKontext.Provider value={protokollSprungWege}>
              <Dokumentation key={navZiel.nonce} startKlientId={navZiel.tagesberichtKlientId} />
            </ProtokollSprungKontext.Provider>
          )}
          {tab === "nachrichten" && <Nachrichten key={navZiel.nonce} startChatId={navZiel.chatId} />}
          {tab === "kalender" && <Kalender />}
          {tab === "aufgaben" && <Aufgaben />}
          {tab === "mitarbeitende" && (
            <Mitarbeitende
              onKlientOeffnen={(klientId) => geheZu("klienten", { klientId })}
              onChatOeffnen={(chatId) => geheZu("nachrichten", { chatId })}
            />
          )}
          {tab === "vertretung" && <Vertretung />}
          {tab === "organigramm" && <Organigramm />}
          {tab === "formulare" && <Formulare />}
          {tab === "standorte-verwalten" && (
            <OrganisatorischSeite eintrag="standorte-verwalten">
              <Standorte
                key={navZiel.nonce}
                oeffneStandortId={navZiel.standortId}
                onOrganigramm={() => geheZu("organigramm")}
                onChatOeffnen={(chatId) => geheZu("nachrichten", { chatId })}
              />
            </OrganisatorischSeite>
          )}
          {tab === "buchungstypen" && (
            <OrganisatorischSeite eintrag="buchungstypen">
              <TypenUndListen rechte={traegerRechte} />
            </OrganisatorischSeite>
          )}
          {tab === "rueckmeldungen" && <Rueckmeldungen mandant={mandant} onGeaendert={rmRechtLaden} />}
          {tab === "einstellungen" && (
            <Einstellungen
              mandant={mandant}
              onMandantAktualisiert={setMandant}
              hoverAusklappen={hoverAusklappen}
              onHoverAusklappenAendern={setHoverAusklappen}
              menuReihenfolge={menuReihenfolge}
              onMenuReihenfolgeAendern={setMenuReihenfolge}
              onOrganisatorischOeffnen={tabWaehlen}
            />
          )}
        </div>
      </div>
      {rmDialog && (
        <RueckmeldungDialog
          screenshot={rmDialog.screenshot}
          seite={rmDialog.seite}
          rolle={ich?.positionen[0]?.titel}
          onClose={() => {
            setRmDialog(null);
            rmRechtLaden();
          }}
        />
      )}
      {telefonatKlient && (
        <NeuerEintragFenster
          klientId={telefonatKlient.id}
          klientName={telefonatKlient.name}
          startArt="telefonat"
          onSchliessen={() => setTelefonatKlient(null)}
          onAngelegt={() => setTelefonatKlient(null)}
        />
      )}
      <Befehlspalette
        offen={paletteOffen}
        oeffnungNr={paletteNr}
        onSchliessen={() => setPaletteOffen(false)}
        navigation={paletteNavigation}
        aktionen={paletteAktionen}
        tagesberichtFuer={(t) => geheZu("tagesberichte", { tagesberichtKlientId: t.id })}
        telefonatFuer={darfVerlaufAnlegen ? (t) => setTelefonatKlient({ id: t.id, name: t.titel }) : undefined}
        onTreffer={(t) => {
          zuletztMerken({ gruppe: t.gruppe, id: t.id });
          if (t.gruppe === "klienten") geheZu("klienten", { klientId: t.id });
          else if (t.gruppe === "zimmer") belegungOeffnen(t.standortId ?? null);
          else if (t.gruppe === "mitarbeitende") geheZu("mitarbeitende");
          else geheZu("kassenbuch");
        }}
      />
    </div>
  );
}
