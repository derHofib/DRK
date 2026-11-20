import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, type PDFRawStream } from "pdf-lib";

/**
 * Namen aller im PDF verwendeten Schriften (BaseFont), ohne das
 * Teilmengen-Kuerzel ("NunitoSans-Regular-1234" -> "NunitoSans-Regular").
 * Strukturell ueber pdf-lib statt per Textsuche: Schriftobjekte liegen
 * komprimiert in Objektstroemen, eine Suche in den Bytes faende nichts --
 * auch kein "Helvetica" -- und bewiese damit nichts.
 */
export async function pdfSchriften(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const namen = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const basis = obj.get(PDFName.of("BaseFont"));
    if (basis instanceof PDFName) namen.add(basis.decodeText().replace(/-\d+$/, ""));
  }
  return [...namen].sort();
}

/**
 * Glyphen ohne Umriss je eingebetteter Schrift. fontkit erzeugt beim
 * Teilmengen-Einbetten bei manchen Schriften Glyphen, die kein Viewer
 * zeichnet (gemessen bei Carlito: aus „Hausbesuch DRK Wilmersdorf" blieb
 * „H D W d" -- deshalb ist Carlito nicht dabei). Der Text bleibt dabei
 * kopierbar, eine Textsuche faellt also nicht auf; gezaehlt wird hier, was
 * der Viewer zeichnen muesste. Ein Leerzeichen hat legitim keinen Umriss.
 */
export async function leereGlyphen(bytes: Uint8Array): Promise<Record<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fontkit = require("@pdf-lib/fontkit");
  const doc = await PDFDocument.load(bytes);
  const ergebnis: Record<string, number> = {};
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("FontDescriptor")) continue;
    const datei = obj.get(PDFName.of("FontFile2"));
    const name = obj.get(PDFName.of("FontName"));
    if (!datei || !(name instanceof PDFName)) continue;
    const strom = doc.context.lookup(datei) as PDFRawStream;
    const font = fontkit.create(Buffer.from(decodePDFRawStream(strom).decode()));
    let leer = 0;
    for (let i = 1; i < font.numGlyphs; i++) {
      try {
        const g = font.getGlyph(i);
        if (g.path.commands.length === 0 && g.advanceWidth > 0) leer++;
      } catch {
        leer++;
      }
    }
    ergebnis[name.decodeText().replace(/-\d+$/, "")] = leer;
  }
  return ergebnis;
}
