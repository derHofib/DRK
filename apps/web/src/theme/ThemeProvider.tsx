import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  akzentSetzen,
  gelesenerModus,
  metaThemeColorAktualisieren,
  themeAnwenden,
  type ThemeModus,
} from "./theme";

interface ThemeKontextWert {
  modus: ThemeModus;
  setModus: (modus: ThemeModus) => void;
  /** Live-Vorschau: faerbt sofort, ohne den Kaltstart-Cache zu verstellen. */
  akzentVorschau: (hex: string) => void;
  /** Uebernimmt eine Farbe dauerhaft (nach erfolgreichem Speichern). */
  akzentUebernehmen: (hex: string) => void;
}

const ThemeKontext = createContext<ThemeKontextWert | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [modus, setModusState] = useState<ThemeModus>(gelesenerModus);

  useEffect(() => {
    themeAnwenden(modus);
  }, [modus]);

  /**
   * Im Modus "system" erledigt color-scheme den Themewechsel von allein,
   * wenn das Betriebssystem waehrend der Sitzung umschaltet -- die
   * <meta name="theme-color"> zieht dabei aber nicht mit. Deshalb hier
   * nachfuehren.
   */
  useEffect(() => {
    const abfrage = window.matchMedia("(prefers-color-scheme: dark)");
    const bei = () => metaThemeColorAktualisieren();
    abfrage.addEventListener("change", bei);
    return () => abfrage.removeEventListener("change", bei);
  }, []);

  const setModus = useCallback((neu: ThemeModus) => setModusState(neu), []);
  const akzentVorschau = useCallback((hex: string) => {
    akzentSetzen(hex, false);
  }, []);
  const akzentUebernehmen = useCallback((hex: string) => {
    akzentSetzen(hex, true);
  }, []);

  const wert = useMemo(
    () => ({ modus, setModus, akzentVorschau, akzentUebernehmen }),
    [modus, setModus, akzentVorschau, akzentUebernehmen]
  );

  return <ThemeKontext.Provider value={wert}>{children}</ThemeKontext.Provider>;
}

export function useTheme(): ThemeKontextWert {
  const wert = useContext(ThemeKontext);
  if (!wert) throw new Error("useTheme braucht einen <ThemeProvider> weiter oben im Baum.");
  return wert;
}
