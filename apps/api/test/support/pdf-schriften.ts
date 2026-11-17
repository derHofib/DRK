import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

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
