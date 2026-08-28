/**
 * Farbableitung fuer die einstellbare Akzentfarbe.
 *
 * DIE ENTSCHEIDUNG, DIE ALLES TRAEGT
 * ----------------------------------
 * Kontrast haengt ausschliesslich an der Helligkeit. Dieses Modul liefert
 * deshalb NUR Farbton und Buntheit -- alle Helligkeitswerte stehen fest in
 * tokens.css, je Theme. Dadurch kann Kontrast konstruktiv nicht brechen,
 * egal welche Farbe ein Traeger einstellt.
 *
 * Warum OKLCH und nicht HSL: In HSL haben hsl(60 100% 50%) (Gelb) und
 * hsl(240 100% 50%) (Blau) dieselbe "Lightness" bei voellig
 * unterschiedlicher Leuchtdichte. Das ist exakt der Fehlermodus "bei
 * Tuerkis geht's, bei Gelb ist der Knopf unlesbar". OKLCHs L ist
 * perzeptuell und ueber den Farbkreis nahezu leuchtdichtekonstant.
 */

/** sRGB-Kanal (0..1) -> linearer Wert. Standard-Transferfunktion. */
function srgbZuLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * sRGB-Hex -> OKLCH. Matrizen aus Björn Ottossons Originalarbeit zu OKLab
 * (2020). Bewusst von Hand statt per Bibliothek: es sind zwei
 * Matrixmultiplikationen, und eine Farbbibliothek waere fuer diese eine
 * Umrechnung deutlich mehr Bundle als der gesamte Icon-Satz.
 */
export function hexZuOklch(hex: string): { l: number; c: number; h: number } {
  const treffer = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!treffer) throw new Error(`Kein gültiger Hex-Farbwert: ${hex}`);
  const n = parseInt(treffer[1], 16);

  const r = srgbZuLinear(((n >> 16) & 255) / 255);
  const g = srgbZuLinear(((n >> 8) & 255) / 255);
  const b = srgbZuLinear((n & 255) / 255);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { l: L, c: Math.hypot(a, bb), h };
}

/**
 * Untergrenze: verhindert, dass eine fast-graue Wahl das ganze System
 * entfaerbt und die Pastellflaechen unsichtbar macht.
 * Obergrenze: verhindert Neon. Oberhalb ~0.13 liegt bei den in tokens.css
 * benutzten Helligkeiten fast jeder Farbton ausserhalb von sRGB und wuerde
 * ohnehin zurueckgemappt -- nur eben unkontrolliert.
 */
const CHROMA_MIN = 0.05;
const CHROMA_MAX = 0.125;

/**
 * Wer bewusst Graphit/Anthrazit als Hausfarbe hat, soll das auch bekommen:
 * unterhalb dieser Schwelle wird NICHT auf CHROMA_MIN hochgeklemmt,
 * sondern es bleibt echt grau (siehe Palette "Graphit").
 *
 * Der Wert ist gemessen, nicht geschaetzt: die Palette "Graphit" (#8e96a3)
 * hat c = 0.0213. Eine Schwelle darunter (der erste Ansatz war 0.012) haette
 * genau die Farbe, fuer die dieser Pfad existiert, auf CHROMA_MIN
 * HOCHgeklemmt und damit eingefaerbt statt entfaerbt. Zu den echten
 * Buntfarben ist trotzdem reichlich Abstand: die uebrigen acht Paletten
 * liegen alle bei c >= 0.09.
 */
const ACHROMATISCH = 0.03;

export interface AkzentHC {
  h: number;
  c: number;
}

export function akzentAbleiten(hex: string): AkzentHC {
  const { c, h } = hexZuOklch(hex);
  if (c < ACHROMATISCH) return { h: 0, c: 0 };
  return {
    h: Math.round(h * 10) / 10,
    c: Math.min(CHROMA_MAX, Math.max(CHROMA_MIN, c)),
  };
}

/**
 * Schreibt Farbton und Buntheit auf <html>. Ab hier rechnet ausschliesslich
 * CSS weiter -- dieses Modul kennt keinen einzigen Helligkeitswert.
 */
export function akzentAnwenden(hex: string): AkzentHC | null {
  let hc: AkzentHC;
  try {
    hc = akzentAbleiten(hex);
  } catch {
    // Eine unlesbare Farbe darf die Anwendung nicht anhalten -- dank
    // @property faellt CSS dann auf die initial-values zurueck.
    return null;
  }
  const wurzel = document.documentElement;
  wurzel.style.setProperty("--zv-accent-h", String(hc.h));
  wurzel.style.setProperty("--zv-accent-c", hc.c.toFixed(4));
  return hc;
}

/**
 * Obergrenze fuer die dunkle Grundfarbe (Hintergrund/Flaechen im
 * Dunkelmodus, --zv-dunkel-h/-c) -- bewusst deutlich niedriger als
 * CHROMA_MAX oben: eine Grundflaeche soll "dezent" bleiben, keine zweite
 * Markenfarbe werden.
 *
 * Anders als bei akzentAbleiten() gibt es HIER keine Untergrenze: echtes
 * Grau/Schwarz ist fuer eine Grundfarbe eine vollkommen legitime Wahl
 * (siehe Palette "Kohle"), waehrend eine fast-graue AKZENTfarbe das
 * Pastellsystem entfaerben wuerde -- die beiden Faelle sind nicht
 * dasselbe Problem.
 */
const GRUNDFARBE_CHROMA_MAX = 0.035;

export function grundfarbeAbleiten(hex: string): AkzentHC {
  const { c, h } = hexZuOklch(hex);
  return {
    h: Math.round(h * 10) / 10,
    c: Math.min(GRUNDFARBE_CHROMA_MAX, c),
  };
}

/**
 * Schreibt Farbton und Buntheit der dunklen Grundfarbe auf <html> --
 * Gegenstueck zu akzentAnwenden(), fuer die von der Akzentfarbe
 * unabhaengige Hintergrund-/Flaechentonleiter im Dunkelmodus.
 */
export function grundfarbeAnwenden(hex: string): AkzentHC | null {
  let hc: AkzentHC;
  try {
    hc = grundfarbeAbleiten(hex);
  } catch {
    return null;
  }
  const wurzel = document.documentElement;
  wurzel.style.setProperty("--zv-dunkel-h", String(hc.h));
  wurzel.style.setProperty("--zv-dunkel-c", hc.c.toFixed(4));
  return hc;
}
