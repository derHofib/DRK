import { domToBlob } from "modern-screenshot";
import { ermittleMaskenfarbe, maskiereKlon } from "./maskierung";

/** Obergrenze, die auch der Server annimmt (api/src/rueckmeldung/rueckmeldung.service.ts). */
export const MAX_SCREENSHOT_BYTES = 1_500_000;

export interface MaskierterScreenshot {
  blob: Blob;
  breite: number;
  hoehe: number;
  /** Wie viele Elemente maskiert wurden. 0 auf einer Seite mit Inhalt waere ein Fehler. */
  maskiert: number;
}

async function aufnehmen(scale: number): Promise<MaskierterScreenshot> {
  const farbe = ermittleMaskenfarbe();
  const hintergrund = getComputedStyle(document.body).backgroundColor;
  let maskiert = 0;
  const blob = await domToBlob(document.documentElement, {
    type: "image/png",
    // Nur der sichtbare Ausschnitt: die Seite wird in Fenstergroesse gerendert
    // und um die Scrollposition verschoben -- nicht die ganze Dokumenthoehe.
    width: window.innerWidth,
    height: window.innerHeight,
    scale,
    backgroundColor: hintergrund && hintergrund !== "rgba(0, 0, 0, 0)" ? hintergrund : undefined,
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`, transformOrigin: "0 0" },
    // Der EINZIGE Weg zum Bild fuehrt durch die Maskierung: onCloneNode laeuft
    // mit dem fertigen Klon, bevor Bilder eingebettet und gerendert werden.
    onCloneNode: (klon) => {
      maskiert = maskiereKlon(klon, farbe).maskiert;
    },
  });
  if (!blob) throw new Error("Screenshot leer");
  return { blob, breite: Math.round(window.innerWidth * scale), hoehe: Math.round(window.innerHeight * scale), maskiert };
}

/**
 * Nimmt den sichtbaren Ausschnitt maskiert auf. Ist das PNG zu gross, wird mit
 * halber Aufloesung wiederholt; reicht auch das nicht, gibt es keinen
 * Screenshot (die Rueckmeldung geht dann ohne Bild) -- nie ein unmaskierter.
 */
export async function nimmMaskiertenScreenshot(): Promise<MaskierterScreenshot | null> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let s = await aufnehmen(dpr);
  if (s.blob.size > MAX_SCREENSHOT_BYTES) s = await aufnehmen(1);
  if (s.blob.size > MAX_SCREENSHOT_BYTES || s.breite > 4000 || s.hoehe > 4000) return null;
  return s;
}
