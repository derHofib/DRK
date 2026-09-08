import { useCallback, useEffect, useRef, useState } from "react";
import type { MandantDto } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";
import { akzentSetzen, dunkelGrundfarbeSetzen } from "../theme/theme";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  IAbmelden,
  IAufgaben,
  IAusklappen,
  IDashboard,
  IEinklappen,
  IEinstellungen,
  IKassenbuch,
  IKlienten,
  IMehr,
  IMitarbeitende,
  ITagesberichte,
  ITraeger,
  IZimmer,
  type IconKomponente,
} from "../components/icons";
import { Dashboard } from "./Dashboard";
import { Zimmer } from "./Zimmer";
import { Klienten } from "./Klienten";
import { Mitarbeitende } from "./Mitarbeitende";
import { Kassenbuch } from "./Kassenbuch";
import { Tagesberichte } from "./Tagesberichte";
import { Aufgaben } from "./Aufgaben";
import { Einstellungen } from "./Einstellungen";

type Tab =
  | "dashboard"
  | "mitarbeitende"
  | "zimmer"
  | "klienten"
  | "kassenbuch"
  | "tagesberichte"
  | "aufgaben"
  | "einstellungen";

/**
 * Reihenfolge ist die EINE Quelle fuer Sidebar (Desktop, zeigt immer alle)
 * UND mobile Reiterleiste (zeigt nur die ersten vier direkt, der Rest
 * wandert dort ins Sammelmenue) -- siehe SICHTBAR_MOBIL/MEHR_MOBIL unten.
 * Kriterium fuer die Reihenfolge: Aufrufhaeufigkeit im Tagesbetrieb, nicht
 * Wichtigkeit. Klienten/Tagesberichte/Kassenbuch/Aufgaben sind das
 * Tagesgeschaeft einer Schicht; Dashboard ist eher "einmal pro Schicht
 * ansehen", Zimmer aendert sich nur bei Ein-/Auszug oder Bauzustand,
 * Mitarbeitende/Einstellungen sind administrativ und selten.
 */
const REITER: { wert: Tab; label: string; icon: IconKomponente }[] = [
  { wert: "klienten", label: "Klienten", icon: IKlienten },
  { wert: "tagesberichte", label: "Tagesberichte", icon: ITagesberichte },
  { wert: "kassenbuch", label: "Kassenbuch", icon: IKassenbuch },
  { wert: "aufgaben", label: "Aufgaben", icon: IAufgaben },
  { wert: "dashboard", label: "Dashboard", icon: IDashboard },
  { wert: "zimmer", label: "Zimmer", icon: IZimmer },
  { wert: "mitarbeitende", label: "Mitarbeitende", icon: IMitarbeitende },
  { wert: "einstellungen", label: "Einstellungen", icon: IEinstellungen },
];

/** Nur auf der mobilen Reiterleiste relevant -- die Sidebar zeigt immer alle. */
const MOBIL_SICHTBAR_ANZAHL = 4;
const REITER_MOBIL_SICHTBAR = REITER.slice(0, MOBIL_SICHTBAR_ANZAHL);
const REITER_MOBIL_MEHR = REITER.slice(MOBIL_SICHTBAR_ANZAHL);

/** Diese Ansichten tragen Kartenlisten/breite Inhalte und bekommen mehr Platz. */
const BREITE_REITER = new Set<Tab>([
  "dashboard",
  "zimmer",
  "kassenbuch",
  "klienten",
  "mitarbeitende",
  "tagesberichte",
  "aufgaben",
]);

const SIDEBAR_SPEICHER = "zimmerakte_sidebar_eingeklappt";
const SIDEBAR_HOVER_SPEICHER = "zimmerakte_sidebar_hover_ausklappen";

// Beides reine Anzeigepraeferenzen dieses Geraets -- wie das Theme (siehe
// ThemeProvider) gehoert das bewusst nicht in die Datenbank und ist nach
// TTDSG §25 Abs. 2 einwilligungsfrei.
function ladeBoolean(schluessel: string): boolean {
  try {
    return localStorage.getItem(schluessel) === "1";
  } catch {
    return false;
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

  useEffect(() => speichereBoolean(SIDEBAR_SPEICHER, eingeklappt), [eingeklappt]);
  useEffect(() => speichereBoolean(SIDEBAR_HOVER_SPEICHER, hoverAusklappen), [hoverAusklappen]);

  // Sammelmenue ("Mehr") -- reines Mobile-Muster, siehe app.css. Die
  // Sidebar (Desktop) kennt dieses Konzept nicht, sie zeigt immer alle
  // Eintraege direkt.
  const [mehrOffen, setMehrOffen] = useState(false);
  const mehrKnopfRef = useRef<HTMLButtonElement>(null);
  const mehrPanelRef = useRef<HTMLDivElement>(null);
  const aktuelleRouteImMehr = REITER_MOBIL_MEHR.some((r) => r.wert === tab);

  function mehrSchliessen() {
    setMehrOffen(false);
    mehrKnopfRef.current?.focus();
  }

  function tabWaehlen(wert: Tab) {
    setTab(wert);
    if (mehrOffen) mehrSchliessen();
  }

  // Escape schliesst, Klick ausserhalb schliesst, Tab haelt den Fokus im
  // Panel gefangen, solange es offen ist -- alles nur aktiv, waehrend
  // mehrOffen true ist, damit ausserhalb davon kein Listener herumhaengt.
  useEffect(() => {
    if (!mehrOffen) return;
    mehrPanelRef.current?.querySelector<HTMLElement>("button")?.focus();

    function beiEscape(e: KeyboardEvent) {
      if (e.key === "Escape") mehrSchliessen();
    }
    function beiAussenklick(e: MouseEvent) {
      const ziel = e.target as Node;
      if (mehrPanelRef.current?.contains(ziel) || mehrKnopfRef.current?.contains(ziel)) return;
      setMehrOffen(false);
    }
    function beiTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !mehrPanelRef.current) return;
      const fokussierbar = mehrPanelRef.current.querySelectorAll<HTMLElement>("button");
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
  }, [mehrOffen]);

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
            {REITER.map(({ wert, label, icon: Icon }) => (
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
            ))}
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

        {mehrOffen && (
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
              className={tab === wert ? "active" : ""}
              onClick={() => tabWaehlen(wert)}
              aria-current={tab === wert ? "page" : undefined}
            >
              <Icon />
              {label}
            </button>
          ))}
          <button
            ref={mehrKnopfRef}
            className={aktuelleRouteImMehr ? "active" : ""}
            aria-expanded={mehrOffen}
            aria-controls="zv-sammelmenue-panel"
            aria-current={aktuelleRouteImMehr ? "page" : undefined}
            onClick={() => setMehrOffen((v) => !v)}
          >
            <IMehr />
            Mehr
          </button>
        </div>

        <div className={`zv-content${BREITE_REITER.has(tab) ? " zv-content-weit" : ""}`}>
          {tab === "dashboard" && <Dashboard />}
          {tab === "zimmer" && <Zimmer />}
          {tab === "klienten" && <Klienten />}
          {tab === "kassenbuch" && <Kassenbuch />}
          {tab === "tagesberichte" && <Tagesberichte />}
          {tab === "aufgaben" && <Aufgaben />}
          {tab === "mitarbeitende" && <Mitarbeitende />}
          {tab === "einstellungen" && (
            <Einstellungen
              mandant={mandant}
              onMandantAktualisiert={setMandant}
              hoverAusklappen={hoverAusklappen}
              onHoverAusklappenAendern={setHoverAusklappen}
            />
          )}
        </div>
      </div>
    </div>
  );
}
