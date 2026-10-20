import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

/** Laengste Kante nach dem Verkleinern -- fuer Grundriss + Karten darueber reichlich. */
export const MAX_BILD_KANTE = 4000;

/**
 * Obergrenze fuer das, was ueberhaupt dekodiert wird. Schuetzt vor
 * "Dekompressionsbomben" (ein paar MB PNG, die zu Dutzenden Gigapixeln
 * aufgehen). Bewusst grosszuegig: der gemessene Fall war ein A2-Plan mit
 * 35640 x 25200 px (900 MP, 2,9 MB), den der Server in ~8 s bei ~360 MB
 * Spitzenspeicher auf 4000 px verkleinert.
 */
const MAX_EINGABE_PIXEL = 1_200_000_000;

// Hintereinander statt gleichzeitig: ein grosses Bild belegt Sekunden und
// einige hundert MB -- mehrere parallel wuerden den API-Prozess ausbremsen.
let warteschlange: Promise<unknown> = Promise.resolve();

/**
 * Verkleinert ein zu grosses Bild auf hoechstens MAX_BILD_KANTE Pixel (gleiches
 * Format, kein Hochskalieren). Bilder, die schon klein genug sind, bleiben
 * BYTEGENAU unveraendert -- kein Qualitaetsverlust durch erneutes Kodieren.
 *
 * Wird nicht verkleinert, geht EXIF-Drehung nicht verloren (der Browser wendet
 * sie selbst an); wird verkleinert, schreibt sharp keine Metadaten mehr, deshalb
 * dreht rotate() vorher auf die tatsaechliche Ausrichtung.
 */
export function verkleinereBild(
  inhalt: Buffer,
  mimeType: "image/jpeg" | "image/png" | "image/webp"
): Promise<{ inhalt: Buffer; verkleinert: boolean }> {
  const lauf = warteschlange.then(() => verkleinereBildJetzt(inhalt, mimeType));
  warteschlange = lauf.catch(() => undefined);
  return lauf;
}

async function verkleinereBildJetzt(
  inhalt: Buffer,
  mimeType: "image/jpeg" | "image/png" | "image/webp"
): Promise<{ inhalt: Buffer; verkleinert: boolean }> {
  try {
    const meta = await sharp(inhalt, { limitInputPixels: false }).metadata();
    const breite = meta.width ?? 0;
    const hoehe = meta.height ?? 0;
    if (!breite || !hoehe) throw new Error("Abmessungen unbekannt");
    if (breite * hoehe > MAX_EINGABE_PIXEL) {
      throw new BadRequestException(
        `Das Bild ist mit ${breite} × ${hoehe} Pixeln zu groß, um es zu verarbeiten. Bitte mit höchstens etwa 20000 Pixeln Kantenlänge exportieren.`
      );
    }
    if (Math.max(breite, hoehe) <= MAX_BILD_KANTE) return { inhalt, verkleinert: false };

    // PNG ist zeilenweise lesbar (geringer Speicher), JPEG braucht wegen
    // rotate() wahlfreien Zugriff -- dort spart ohnehin das Verkleinern
    // beim Laden (JPEG-Shrink-on-load) den Speicher.
    let bild = sharp(inhalt, { limitInputPixels: MAX_EINGABE_PIXEL, sequentialRead: mimeType === "image/png" });
    if (mimeType === "image/jpeg") bild = bild.rotate();
    bild = bild.resize({ width: MAX_BILD_KANTE, height: MAX_BILD_KANTE, fit: "inside", withoutEnlargement: true });
    const ausgabe =
      mimeType === "image/png"
        ? bild.png({ compressionLevel: 9 })
        : mimeType === "image/webp"
          ? bild.webp({ quality: 90 })
          : bild.jpeg({ quality: 90 });
    return { inhalt: await ausgabe.toBuffer(), verkleinert: true };
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException("Das Bild konnte nicht verarbeitet werden. Ist die Datei beschädigt?");
  }
}
