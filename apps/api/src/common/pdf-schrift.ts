import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

/**
 * Schrift der serverseitigen PDFs (Klientenarchiv, Monatsabschluss,
 * Organigramm): Nunito Sans, dieselbe Schrift wie die Oberflaeche
 * (apps/web/src/styles/schrift.css). Vorher PDF-Standardschrift Helvetica;
 * umgestellt mit der Rueckmeldung "schriftart" -- ausdruecklich
 * "vollumfaenglich", also auch fuer Ausdrucke und Ablagen.
 *
 * Die TTF-Dateien liegen EINMAL in packages/shared/schriften (API und
 * Listenexport im Browser lesen dieselben). Warum nicht aus @fontsource wie
 * die Web-Schrift: dort gibt es die Schrift nur in Unicode-Teilen (latin,
 * latin-ext, ...) je als eigene Datei, und eine PDF-Textzeile hat genau eine
 * Schrift. Mit nur "latin" wurden Namen wie Łukasz oder Şahin zu leeren
 * Kaestchen (nachgemessen); mit Helvetica brach das PDF bei diesen Zeichen
 * sogar ganz ab (WinAnsi). Die vollstaendigen statischen Schnitte
 * (Google Fonts, OFL, je ~107 kB) decken Latein inkl. Erweiterungen,
 * Kyrillisch und Vietnamesisch ab. Emoji bleiben ein leeres Kaestchen --
 * das PDF entsteht trotzdem.
 *
 * subset: true -- es wird nur eingebettet, was vorkommt (Probe: 3,7 kB statt
 * 56 kB je Schnitt).
 */
let dateien: { normal: Buffer; fett: Buffer } | null = null;

function lade(): { normal: Buffer; fett: Buffer } {
  if (!dateien) {
    const datei = (name: string) => readFileSync(require.resolve(`@zimmerakte/shared/schriften/${name}`));
    dateien = { normal: datei("NunitoSans-Regular.ttf"), fett: datei("NunitoSans-Bold.ttf") };
  }
  return dateien;
}

export async function bettePdfSchriftEin(doc: PDFDocument): Promise<{ normal: PDFFont; fett: PDFFont }> {
  doc.registerFontkit(fontkit);
  const { normal, fett } = lade();
  return {
    normal: await doc.embedFont(normal, { subset: true }),
    fett: await doc.embedFont(fett, { subset: true }),
  };
}
