import { AKZENTFARBE_STANDARD } from "@zimmerakte/shared";
import { akzentAbleiten, akzentAnwenden, type AkzentHC } from "./farbe";

export type ThemeModus = "hell" | "dunkel" | "system";

const THEME_KEY = "zimmerakte_theme";
/**
 * Bewusst der BEREITS ABGELEITETE Wert ("H C") und nicht der Hex: so braucht
 * das Inline-Skript im <head> keine OKLCH-Mathematik, nur zwei
 * setProperty-Aufrufe. Siehe index.html.
 */
const AKZENT_KEY = "zimmerakte_akzent_hc";

export const THEME_MODI: { wert: ThemeModus; label: string }[] = [
  { wert: "system", label: "System" },
  { wert: "hell", label: "Hell" },
  { wert: "dunkel", label: "Dunkel" },
];

export function gelesenerModus(): ThemeModus {
  try {
    const wert = localStorage.getItem(THEME_KEY);
    if (wert === "hell" || wert === "dunkel" || wert === "system") return wert;
  } catch {
    // Privatmodus ohne localStorage -- dann eben Systemvorgabe.
  }
  return "system";
}

export function themeAnwenden(modus: ThemeModus): void {
  const wurzel = document.documentElement;
  if (modus === "system") {
    // Attribut entfernen statt auf "system" setzen: dann greift wieder
    // color-scheme: light dark aus tokens.css, also die Systemvorgabe.
    delete wurzel.dataset.theme;
  } else {
    wurzel.dataset.theme = modus;
  }
  try {
    localStorage.setItem(THEME_KEY, modus);
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern.
  }
  metaThemeColorAktualisieren();
}

export function gecachterAkzentAngewendet(): void {
  try {
    const roh = localStorage.getItem(AKZENT_KEY);
    if (!roh) return;
    const [h, c] = roh.split(" ");
    if (!h || !c) return;
    document.documentElement.style.setProperty("--zv-accent-h", h);
    document.documentElement.style.setProperty("--zv-accent-c", c);
  } catch {
    /* siehe oben */
  }
}

/**
 * Setzt die Akzentfarbe und merkt sie sich fuer den naechsten Kaltstart.
 * `merken: false` fuer die Live-Vorschau im Einstellungsformular -- dort
 * soll ein Herumprobieren, das nicht gespeichert wird, auch den Cache nicht
 * verstellen.
 */
export function akzentSetzen(hex: string, merken = true): AkzentHC | null {
  const hc = akzentAnwenden(hex);
  if (hc && merken) {
    try {
      localStorage.setItem(AKZENT_KEY, `${hc.h} ${hc.c.toFixed(4)}`);
    } catch {
      /* siehe oben */
    }
  }
  metaThemeColorAktualisieren();
  return hc;
}

export function akzentZuruecksetzen(): void {
  akzentSetzen(AKZENTFARBE_STANDARD);
}

/**
 * Faerbt die Browser-Oberflaeche (Adressleiste auf Android, Statusleiste in
 * der installierten PWA) passend zum aktuellen Theme ein.
 *
 * Bewusst der aufgeloeste backgroundColor des <body> und nicht der
 * Custom-Property-Wert: letzterer ist ein oklch()-String, den nicht jeder
 * Browser in <meta name="theme-color"> akzeptiert. getComputedStyle liefert
 * hier immer ein rgb().
 */
export function metaThemeColorAktualisieren(): void {
  const marke = document.querySelector('meta[name="theme-color"]');
  if (!marke) return;
  const farbe = getComputedStyle(document.body).backgroundColor;
  if (farbe) marke.setAttribute("content", farbe);
}

export { akzentAbleiten };
