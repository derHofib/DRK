/**
 * Ausrichtung von Formular-Bausteinen (Rueckmeldung „Bausteine“, 21.11.2026):
 * eine Ueberschrift wie „Abmahnung“ soll auch mittig oder rechts stehen.
 *
 * Geprueft wird am fertigen PDF, nicht an einer Zwischenstruktur: gemessen
 * werden die x-Koordinaten der Textoperatoren (Tm) im Seiteninhalt. Fuer
 * einen Text der Breite w zwischen x0 und x1 gilt mittig x = x0 + (B - w)/2,
 * rechts x = x0 + (B - w) -- also (rechts - x0) = 2 * (mittig - x0). Das
 * laesst sich ohne Kenntnis der Glyphenbreiten pruefen.
 */
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFRef } from "pdf-lib";
import {
  formularVergleich,
  pdfGestaltungVorgabe,
  pruefeDefinition,
  type BausteinAusrichtung,
  type FormularDefinition,
  type PdfFeldstil,
} from "@zimmerakte/shared";
import { pdfBloecke, pdfExportRendern, type PdfRenderEingabe } from "../src/pdf-export/pdf-export-render";

function definition(ueberschrift: BausteinAusrichtung, feld: BausteinAusrichtung): FormularDefinition {
  return {
    bausteine: [
      {
        typ: "abschnitt",
        schluessel: "kopf",
        beschriftung: "Abmahnung",
        ausrichtung: ueberschrift,
        kinder: [
          { typ: "kurztext", schluessel: "grund", beschriftung: "Grund", ausrichtung: feld },
          { typ: "ja_nein", schluessel: "muendlich", beschriftung: "Mündlich besprochen?", ausrichtung: feld },
          { typ: "kurztext", schluessel: "ort", beschriftung: "Ort" },
        ],
      },
    ],
  };
}

function eingabe(def: FormularDefinition, feldstil: PdfFeldstil = "liste"): PdfRenderEingabe {
  return {
    gestaltung: { ...pdfGestaltungVorgabe("akte"), feldstil, ueberschriften: "balken" },
    zielgruppe: "intern",
    traegerfarbe: "#c00000",
    logo: null,
    formular: { name: "Testformular", version: 1, definition: def },
    werte: { grund: "Ruhestörung", muendlich: true, ort: "Zimmer 4" },
    anzeige: {},
    personen: {},
    platzhalter: {},
    empfaenger: null,
  };
}

/** Alle Textoperatoren der ersten Seite als "x|y|Glyphen" (Reihenfolge wie gezeichnet). */
async function texte(bytes: Uint8Array): Promise<{ x: number; y: number; g: string }[]> {
  const doc = await PDFDocument.load(bytes);
  const seite = doc.getPage(0);
  const inhalt = seite.node.Contents();
  const stroeme = inhalt instanceof PDFArray ? inhalt.asArray().map((r) => doc.context.lookup(r as PDFRef)) : [inhalt];
  let roh = "";
  for (const s of stroeme) {
    if (s instanceof PDFRawStream) roh += Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
    else if (s) roh += Buffer.from((s as unknown as { getContents(): Uint8Array }).getContents()).toString("latin1");
  }
  const out: { x: number; y: number; g: string }[] = [];
  for (const m of roh.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s+<([0-9A-Fa-f]+)> Tj/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]), g: m[3] });
  }
  return out;
}

const MM = 72 / 25.4;

describe("Ausrichtung von Formular-Bausteinen", () => {
  it("pdfBloecke tragen die Ausrichtung, ohne Angabe gilt links", () => {
    const bloecke = pdfBloecke(eingabe(definition("mitte", "rechts")));
    expect(bloecke.map((b) => b.ausrichtung)).toEqual(["mitte", "rechts", "rechts", "links"]);
  });

  it.each(["liste", "kompakt", "kaesten"] as PdfFeldstil[])("Ueberschrift und Felder stehen im PDF mittig bzw. rechts (Feldstil %s)", async (feldstil) => {
    // Verglichen wird mittig gegen rechts: gleicher Aufbau, gleiche Zeichenreihenfolge,
    // also Text fuer Text vergleichbar (die Glyphen-IDs der Teilschrift haengen an der
    // Reihenfolge des ersten Auftretens und taugen zwischen verschiedenen Aufbauten nicht).
    const mitte = await texte(await pdfExportRendern(eingabe(definition("mitte", "mitte"), feldstil)));
    const rechts = await texte(await pdfExportRendern(eingabe(definition("rechts", "rechts"), feldstil)));
    expect(rechts.length).toBe(mitte.length);
    const x0 = 22 * MM;
    let bewegt = 0;
    let fest = 0;
    mitte.forEach((m, i) => {
      const r = rechts[i];
      expect(r.g).toBe(m.g);
      if (Math.abs(r.x - m.x) < 0.01) {
        fest++;
        return;
      }
      bewegt++;
      expect(r.x).toBeGreaterThan(m.x);
      expect(m.x).toBeGreaterThan(x0 + 3 * MM);
      // Mittig x = s + (B - w)/2, rechts x = s + B - w  =>  s = 2*mittig - rechts.
      // Der so errechnete linke Rand muss ein bekannter sein: Satzspiegel,
      // Kasten-Innenabstand (1,5 mm) oder hinter dem Ueberschriftenbalken (2,6 mm).
      const s = 2 * m.x - r.x;
      const passt = [0, 1.5, 2.6].some((d) => Math.abs(s - (x0 + d * MM)) < 0.5);
      if (!passt) throw new Error(`Text ${i}: errechneter Rand ${s.toFixed(2)} pt passt zu keinem bekannten`);
    });
    // Ueberschrift, „Grund“, „Ruhestörung“, „Mündlich besprochen?“, „Ja“ (Ja/Nein als Text, Vorgabe).
    expect(bewegt).toBe(5);
    // „Ort“, „Zimmer 4“ und Kopf/Fuss sind nicht ausgerichtet und bleiben stehen.
    expect(fest).toBeGreaterThanOrEqual(2);
  });

  it("„links“ setzt jeden Text an dieselbe Stelle wie eine Definition ohne Ausrichtung", async () => {
    const ohne = definition("links", "links");
    const lauf = (b: FormularDefinition["bausteine"]): FormularDefinition["bausteine"] =>
      b.map((x) => {
        const { ausrichtung: _a, ...rest } = x;
        return (x.typ === "abschnitt" ? { ...rest, kinder: lauf(x.kinder) } : rest) as FormularDefinition["bausteine"][number];
      });
    const alt = { bausteine: lauf(ohne.bausteine) };
    expect(await texte(await pdfExportRendern(eingabe(ohne)))).toEqual(await texte(await pdfExportRendern(eingabe(alt))));
  });

  it("unbekannte Ausrichtung wird beim Veroeffentlichen abgelehnt", () => {
    const def = definition("links", "links");
    (def.bausteine[0] as { ausrichtung?: string }).ausrichtung = "oben";
    expect(pruefeDefinition(def).join(" ")).toMatch(/unbekannte Ausrichtung/);
    expect(pruefeDefinition(definition("mitte", "rechts"))).toEqual([]);
  });

  it("der Versionsvergleich nennt die Aenderung beim Namen", () => {
    const aenderungen = formularVergleich(definition("links", "links"), definition("mitte", "links"));
    expect(aenderungen).toEqual([{ art: "geaendert", text: "„Abmahnung“: Ausrichtung Links → Mitte" }]);
  });
});
