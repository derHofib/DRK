import { useCallback, useEffect, useRef, useState } from "react";
import type { MandantDto } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";
import { akzentSetzen, dunkelGrundfarbeSetzen } from "../theme/theme";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  IAbmelden,
  IAnwaerter,
  IArchivieren,
  IAufklappen,
  IAusklappen,
  IEinklappen,
  IKlienten,
  IMehr,
  ITraeger,
  IZuklappen,
} from "../components/icons";
import {
  ladeMenuReihenfolge,
  reiterNachReihenfolge,
  speichereMenuReihenfolge,
  type HauptReiter,
  type KlientenAnsicht,
} from "../navigation";
import { Dashboard } from "./Dashboard";
import { Zimmer } from "./Zimmer";
import { Klienten } from "./Klienten";
import { Mitarbeitende } from "./Mitarbeitende";
import { Kassenbuch } from "./Kassenbuch";
import { Tagesberichte } from "./Tagesberichte";
import { Aufgaben } from "./Aufgaben";
import { Vertretung } from "./Vertretung";
import { Organigramm } from "./Organigramm";
import { Einstellungen } from "./Einstellungen";

type Tab = HauptReiter;

/** Nur auf der mobilen Reiterleiste relevant -- die Sidebar zeigt immer alle. */
const MOBIL_SICHTBAR_ANZAHL = 4;

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
  "zimmer",
  "kassenbuch",
  "klienten",
  "mitarbeitende",
  "tagesberichte",
  "aufgaben",
  "vertretung",
  "organigramm",
]);

const SIDEBAR_SPEICHER = "zimmerakte_sidebar_eingeklappt";
const SIDEBAR_HOVER_SPEICHER = "zimmerakte_sidebar_hover_ausklappen";
const SIDEBAR_KLIENTEN_AUFGEKLAPPT_SPEICHER = "zimmerakte_sidebar_klienten_aufgeklappt";

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

export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [mandant, setMandant] = useState<MandantDto | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
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
  // Reihenfolge der Hauptmenuepunkte -- frei einstellbar (Einstellungen >
  // Darstellung), siehe navigation.ts.
  const [menuReihenfolge, setMenuReihenfolge] = useState<HauptReiter[]>(() => ladeMenuReihenfolge());
  const REITER = reiterNachReihenfolge(menuReihenfolge);
  const REITER_MOBIL_SICHTBAR = REITER.slice(0, MOBIL_SICHTBAR_ANZAHL);
  const REITER_MOBIL_MEHR = REITER.slice(MOBIL_SICHTBAR_ANZAHL);

  useEffect(() => speichereBoolean(SIDEBAR_SPEICHER, eingeklappt), [eingeklappt]);
  useEffect(() => speichereBoolean(SIDEBAR_HOVER_SPEICHER, hoverAusklappen), [hoverAusklappen]);
  useEffect(
    () => speichereBoolean(SIDEBAR_KLIENTEN_AUFGEKLAPPT_SPEICHER, klientenUnterpunkteOffen),
    [klientenUnterpunkteOffen]
  );
  useEffect(() => speichereMenuReihenfolge(menuReihenfolge), [menuReihenfolge]);

  // Ueberlagerndes Panel auf dem Handy -- entweder das Sammelmenue ("Mehr")
  // oder, seit Klienten.tsx keine eigene Reiterleiste mehr zeigt, das
  // Ansichten-Panel von "Klienten" (Aktiv/Anwärter/Archiv). Ein
  // gemeinsamer Zustand statt zwei Booleans, damit nie beide gleichzeitig
  // offen sind. Die Sidebar (Desktop) kennt dieses Konzept nicht, sie
  // zeigt immer alle Eintraege direkt.
  const [offenesPanel, setOffenesPanel] = useState<"mehr" | "klienten" | null>(null);
  const mehrKnopfRef = useRef<HTMLButtonElement>(null);
  const mehrPanelRef = useRef<HTMLDivElement>(null);
  const klientenKnopfRef = useRef<HTMLButtonElement>(null);
  const klientenPanelRef = useRef<HTMLDivElement>(null);
  const aktuelleRouteImMehr = REITER_MOBIL_MEHR.some((r) => r.wert === tab);

  function panelSchliessen() {
    const vorheriges = offenesPanel;
    setOffenesPanel(null);
    if (vorheriges === "mehr") mehrKnopfRef.current?.focus();
    if (vorheriges === "klienten") klientenKnopfRef.current?.focus();
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
  function reiterKlick(wert: Tab) {
    if (wert === "klienten") {
      setOffenesPanel((p) => (p === "klienten" ? null : "klienten"));
    } else {
      tabWaehlen(wert);
    }
  }

  // Escape schliesst, Klick ausserhalb schliesst, Tab haelt den Fokus im
  // Panel gefangen, solange eins offen ist.
  useEffect(() => {
    if (!offenesPanel) return;
    const panelRef = offenesPanel === "mehr" ? mehrPanelRef : klientenPanelRef;
    const knopfRef = offenesPanel === "mehr" ? mehrKnopfRef : klientenKnopfRef;
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

  const logout = useCallback(() => {
    clearToken();
    onLoggedOut();
  }, [onLoggedOut]);

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
            <span className="zv-brand-mark">ZA</span>
            <div className="zv-brand-text">
              <strong>Zimmerakte</strong>
              {mandant && <span>{mandant.name}</span>}
            </div>
          </div>

          <nav className="zv-sidebar-nav">
            {REITER.map(({ wert, label, icon: Icon }) => {
              if (wert !== "klienten") {
                return (
                  <button
                    key={wert}
                    className={tab === wert ? "active" : ""}
                    onClick={() => tabWaehlen(wert)}
                    aria-current={tab === wert ? "page" : undefined}
                    title={label}
                  >
                    <Icon />
                    <span className="zv-sidebar-label">{label}</span>
                  </button>
                );
              }
              // "Klienten" bekommt einen aufklappbaren Unterpunkt
              // "Anwärter" (siehe navigation.ts/Klienten.tsx) -- der
              // Pfeil klappt nur die Unterzeilen ein/aus, der Hauptknopf
              // navigiert weiterhin direkt auf die Klienten-Seite.
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
                      aria-label={
                        klientenUnterpunkteOffen
                          ? "Unterpunkte von Klienten einklappen"
                          : "Unterpunkte von Klienten ausklappen"
                      }
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
            })}
          </nav>

          <div className="zv-sidebar-foot">
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
            <strong>Zimmerakte</strong>
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
                ref={wert === "klienten" ? klientenKnopfRef : undefined}
                role="menuitem"
                className={tab === wert ? "active" : ""}
                onClick={() => reiterKlick(wert)}
                aria-current={tab === wert ? "page" : undefined}
                // In diesem Zweig ist offenesPanel immer "mehr" (TS narrowt das),
                // das Klienten-Panel also nie gleichzeitig offen -- daher hier
                // schlicht false statt eines Vergleichs mit demselben Ergebnis.
                aria-expanded={wert === "klienten" ? false : undefined}
              >
                <Icon />
                {label}
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

        <div className="zv-tabbar zv-tabbar-app">
          {REITER_MOBIL_SICHTBAR.map(({ wert, label, icon: Icon }) => (
            <button
              key={wert}
              ref={wert === "klienten" ? klientenKnopfRef : undefined}
              className={tab === wert ? "active" : ""}
              onClick={() => reiterKlick(wert)}
              aria-current={tab === wert ? "page" : undefined}
              aria-expanded={wert === "klienten" ? offenesPanel === "klienten" : undefined}
            >
              <Icon />
              {label}
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
          </button>
        </div>

        <div className={`zv-content${BREITE_REITER.has(tab) ? " zv-content-weit" : ""}`}>
          {tab === "dashboard" && <Dashboard />}
          {tab === "zimmer" && <Zimmer />}
          {tab === "klienten" && <Klienten ansicht={klientenAnsicht} onAnsichtChange={setKlientenAnsicht} />}
          {tab === "kassenbuch" && <Kassenbuch />}
          {tab === "tagesberichte" && <Tagesberichte />}
          {tab === "aufgaben" && <Aufgaben />}
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
    </div>
  );
}
