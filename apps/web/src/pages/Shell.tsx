import { useCallback, useEffect, useState } from "react";
import type { MandantDto } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";
import { akzentSetzen } from "../theme/theme";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  IAbmelden,
  IAusklappen,
  IEinklappen,
  IEinstellungen,
  IKassenbuch,
  IKlienten,
  IMitarbeitende,
  ITagesberichte,
  ITraeger,
  IZimmer,
  type IconKomponente,
} from "../components/icons";
import { Zimmer } from "./Zimmer";
import { Klienten } from "./Klienten";
import { Mitarbeitende } from "./Mitarbeitende";
import { Kassenbuch } from "./Kassenbuch";
import { Tagesberichte } from "./Tagesberichte";
import { Einstellungen } from "./Einstellungen";

type Tab = "mitarbeitende" | "zimmer" | "klienten" | "kassenbuch" | "tagesberichte" | "einstellungen";

const REITER: { wert: Tab; label: string; icon: IconKomponente }[] = [
  { wert: "zimmer", label: "Zimmer", icon: IZimmer },
  { wert: "klienten", label: "Klienten", icon: IKlienten },
  { wert: "kassenbuch", label: "Kassenbuch", icon: IKassenbuch },
  { wert: "tagesberichte", label: "Tagesberichte", icon: ITagesberichte },
  { wert: "mitarbeitende", label: "Mitarbeitende", icon: IMitarbeitende },
  { wert: "einstellungen", label: "Einstellungen", icon: IEinstellungen },
];

/** Diese Ansichten tragen Kartenlisten/breite Inhalte und bekommen mehr Platz. */
const BREITE_REITER = new Set<Tab>(["kassenbuch", "klienten", "mitarbeitende", "tagesberichte"]);

const SIDEBAR_SPEICHER = "zimmerakte_sidebar_eingeklappt";

// Ob das Menueband eingeklappt ist, ist eine reine Anzeigepraeferenz dieses
// Geraets -- wie das Theme (siehe ThemeProvider) gehoert das bewusst nicht in
// die Datenbank und ist nach TTDSG §25 Abs. 2 einwilligungsfrei.
function ladeSidebarZustand(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_SPEICHER) === "1";
  } catch {
    return false;
  }
}

export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [mandant, setMandant] = useState<MandantDto | null>(null);
  const [tab, setTab] = useState<Tab>("zimmer");
  const [eingeklappt, setEingeklappt] = useState(ladeSidebarZustand);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_SPEICHER, eingeklappt ? "1" : "0");
    } catch {
      // Privatmodus ohne localStorage: Praeferenz gilt dann nur fuer diese Sitzung.
    }
  }, [eingeklappt]);

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
      <aside className="zv-sidebar" data-eingeklappt={eingeklappt}>
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
              onClick={() => setTab(wert)}
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

        <div className="zv-tabbar zv-tabbar-app">
          {REITER.map(({ wert, label, icon: Icon }) => (
            <button
              key={wert}
              className={tab === wert ? "active" : ""}
              onClick={() => setTab(wert)}
              aria-current={tab === wert ? "page" : undefined}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        <div className={`zv-content${BREITE_REITER.has(tab) ? " zv-content-weit" : ""}`}>
          {tab === "zimmer" && <Zimmer />}
          {tab === "klienten" && <Klienten />}
          {tab === "kassenbuch" && <Kassenbuch />}
          {tab === "tagesberichte" && <Tagesberichte />}
          {tab === "mitarbeitende" && <Mitarbeitende />}
          {tab === "einstellungen" && (
            <Einstellungen mandant={mandant} onMandantAktualisiert={setMandant} />
          )}
        </div>
      </div>
    </div>
  );
}
