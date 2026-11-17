/**
 * CSV- und PDF-Export fuer Listenansichten.
 *
 * Bewusst im Browser statt ueber einen Server-Endpunkt: exportiert wird genau
 * das, was die Person gerade sieht -- also nach Filterleiste, Suche und
 * Sortierung, und mit den Daten, die die API ihr ohnehin schon ausgeliefert
 * hat (Rechtepruefung und Anonymisierung beim Lesen, CLAUDE.md Regel 6, haben
 * dort schon stattgefunden). Ein zweiter, serverseitiger Lesepfad mit
 * nachgebauter Filterlogik waere eine zweite Stelle, an der Rechte und Filter
 * auseinanderlaufen koennen.
 */

export interface ExportSpalte {
  titel: string;
  /** Relative Breite im PDF (Gewicht, keine Punkte) -- die Summe wird auf die Seitenbreite skaliert. */
  breite: number;
}

export interface ListenExport {
  /** Ueberschrift im PDF, z. B. "Tagesberichte". */
  titel: string;
  /** Dateiname ohne Endung; Datum und Endung haengt der Export an. */
  dateiname: string;
  /** Lesbare Zusammenfassung der aktiven Filter, z. B. "Zeitraum: Dieser Monat · Standort: Nord". */
  filterText?: string;
  spalten: ExportSpalte[];
  zeilen: string[][];
}

// ---------------------------------------------------------------- CSV

/**
 * Felder, die mit =, +, -, @ oder Tab/CR beginnen, wertet Excel als Formel
 * aus (CSV-Injection). Tagesberichte sind Freitext von Mitarbeitenden -- ein
 * Bericht, der mit "=HYPERLINK(...)" beginnt, wuerde sonst beim Oeffnen der
 * Datei ausgefuehrt. Das vorangestellte Hochkomma macht es zu Text.
 */
function csvFeld(wert: string): string {
  const sicher = /^[=+\-@\t\r]/.test(wert) ? `'${wert}` : wert;
  return /[;"\r\n]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}

/**
 * Semikolon als Trennzeichen und UTF-8-BOM: ein deutsches Excel erwartet per
 * Locale das Semikolon und erkennt UTF-8 ohne BOM nicht -- Umlaute kaemen
 * sonst als Zeichensalat an. CRLF nach RFC 4180.
 */
export function erzeugeCsv(liste: ListenExport): string {
  const kopf = liste.spalten.map((s) => s.titel);
  return "﻿" + [kopf, ...liste.zeilen].map((z) => z.map(csvFeld).join(";")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Download

function blobHerunterladen(blob: Blob, dateiname: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dateinameMitDatum(basis: string, endung: string, jetzt: Date): string {
  const t = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}-${String(jetzt.getDate()).padStart(2, "0")}`;
  return `${basis}-${t}.${endung}`;
}

export function csvHerunterladen(liste: ListenExport, jetzt: Date = new Date()) {
  blobHerunterladen(
    new Blob([erzeugeCsv(liste)], { type: "text/csv;charset=utf-8;" }),
    dateinameMitDatum(liste.dateiname, "csv", jetzt)
  );
}

// ---------------------------------------------------------------- PDF

// A4 quer: Listen haben oft sechs und mehr Spalten, im Hochformat blieben
// fuer Freitextspalten (Tagesbericht) nur wenige Zeichen pro Zeile.
const SEITE_BREITE = 841.89;
const SEITE_HOEHE = 595.28;
const RAND = 40;
const SCHRIFT = 8.5;
const ZEILENHOEHE = 11.5;
const KOPF_SCHRIFT = 8.5;
const ZELLEN_RAND = 4;

/**
 * Ersetzt jedes Zeichen, das nicht im Zeichenvorrat der Schrift liegt, durch
 * "?", und Steuerzeichen (Zeilenumbruch, Tab) durch ein Leerzeichen.
 * Exportiert fuer scripts/export-pruefung.mjs.
 */
export function druckbarerText(text: string, vorrat: ReadonlySet<number>): string {
  return Array.from(text.replace(/[\r\n\t]+/g, " "))
    .map((z) => (vorrat.has(z.codePointAt(0)!) ? z : "?"))
    .join("");
}

/** Die beiden Schnitte als TrueType-Bytes. */
export interface PdfSchriften {
  normal: Uint8Array;
  fett: Uint8Array;
}

/**
 * Nunito Sans wie in der Oberflaeche und in den Server-PDFs (dieselben
 * Dateien aus packages/shared/schriften, Begruendung dort in
 * apps/api/src/common/pdf-schrift.ts). Erst beim Klick geladen (~2 x 107 kB):
 * die meisten Seitenaufrufe exportieren nie etwas.
 */
async function schriftenAusBundle(): Promise<PdfSchriften> {
  const [{ default: normalUrl }, { default: fettUrl }] = await Promise.all([
    import("@zimmerakte/shared/schriften/NunitoSans-Regular.ttf?url"),
    import("@zimmerakte/shared/schriften/NunitoSans-Bold.ttf?url"),
  ]);
  const hole = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Schrift für den PDF-Export nicht ladbar (${r.status}).`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const [normal, fett] = await Promise.all([hole(normalUrl), hole(fettUrl)]);
  return { normal, fett };
}

/**
 * pdf-lib wird erst beim Klick nachgeladen: es ist gross (~500 kB) und wird
 * von den allerwenigsten Seitenaufrufen gebraucht -- im Hauptbundle waere es
 * Ballast fuer jede Anmeldung, auch auf dem Mobilnetz.
 *
 * `ladeSchriften` ist austauschbar, damit scripts/export-pruefung.mjs ohne
 * Browser (ohne fetch auf Vite-URLs) dieselbe Funktion pruefen kann.
 */
export async function erzeugePdf(
  liste: ListenExport,
  jetzt: Date = new Date(),
  ladeSchriften: () => Promise<PdfSchriften> = schriftenAusBundle,
): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, { default: fontkit }, schriften] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
    ladeSchriften(),
  ]);
  const dok = await PDFDocument.create();
  dok.registerFontkit(fontkit);
  const normal = await dok.embedFont(schriften.normal, { subset: true });
  const fett = await dok.embedFont(schriften.fett, { subset: true });
  dok.setTitle(liste.titel);
  dok.setCreator("Zimmerakte");

  // Zeichen, die die Schrift nicht hat (Emoji, Symbole), wuerden als leeres
  // Kaestchen gedruckt -- encodeText wirft bei eingebetteten Schriften
  // nicht mehr wie frueher bei Helvetica, also wird gegen den Zeichenvorrat
  // der Schrift geprueft und genau dieses Zeichen durch "?" ersetzt.
  // Steuerzeichen (Zeilenumbruch, Tab) werden vorher zu Leerzeichen.
  const vorrat = new Set(normal.getCharacterSet().filter((c) => fett.getCharacterSet().includes(c)));
  const bereinige = (text: string) => druckbarerText(text, vorrat);

  const gesamt = liste.spalten.reduce((s, c) => s + c.breite, 0);
  const nutzbreite = SEITE_BREITE - 2 * RAND;
  const breiten = liste.spalten.map((c) => (c.breite / gesamt) * nutzbreite);

  function umbrechen(text: string, font: typeof normal, groesse: number, maxBreite: number): string[] {
    const sauber = bereinige(text).trim();
    if (!sauber) return [""];
    const zeilen: string[] = [];
    let aktuell = "";
    for (const wort of sauber.split(/ +/)) {
      const probe = aktuell ? `${aktuell} ${wort}` : wort;
      if (font.widthOfTextAtSize(probe, groesse) <= maxBreite) {
        aktuell = probe;
        continue;
      }
      if (aktuell) zeilen.push(aktuell);
      // Ein einzelnes Wort, das allein nicht in die Spalte passt (lange
      // Aktenzeichen, URLs): zeichenweise brechen statt abschneiden.
      let rest = wort;
      while (font.widthOfTextAtSize(rest, groesse) > maxBreite && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), groesse) > maxBreite) n--;
        zeilen.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      aktuell = rest;
    }
    if (aktuell) zeilen.push(aktuell);
    return zeilen;
  }

  const seiten: ReturnType<typeof dok.addPage>[] = [];
  const GRAU = rgb(0.4, 0.4, 0.4);
  const LINIE = rgb(0.82, 0.82, 0.82);
  let seite = dok.addPage([SEITE_BREITE, SEITE_HOEHE]);
  seiten.push(seite);
  let y = SEITE_HOEHE - RAND;

  // Titelblock nur auf der ersten Seite.
  seite.drawText(bereinige(liste.titel), { x: RAND, y: y - 14, size: 15, font: fett });
  y -= 22;
  const zeitpunkt = `${String(jetzt.getDate()).padStart(2, "0")}.${String(jetzt.getMonth() + 1).padStart(2, "0")}.${jetzt.getFullYear()}, ${String(jetzt.getHours()).padStart(2, "0")}:${String(jetzt.getMinutes()).padStart(2, "0")} Uhr`;
  const meta = [
    `${liste.zeilen.length} ${liste.zeilen.length === 1 ? "Eintrag" : "Einträge"}`,
    `erstellt am ${zeitpunkt}`,
    liste.filterText ? `Filter: ${liste.filterText}` : "Ohne Filter",
  ].join(" · ");
  for (const z of umbrechen(meta, normal, SCHRIFT, nutzbreite)) {
    seite.drawText(z, { x: RAND, y: y - SCHRIFT, size: SCHRIFT, font: normal, color: GRAU });
    y -= ZEILENHOEHE;
  }
  y -= 8;

  function kopfzeile() {
    const hoehe = ZEILENHOEHE + 2 * ZELLEN_RAND - 2;
    seite.drawRectangle({ x: RAND, y: y - hoehe, width: nutzbreite, height: hoehe, color: rgb(0.94, 0.94, 0.94) });
    let x = RAND;
    liste.spalten.forEach((s, i) => {
      seite.drawText(umbrechen(s.titel, fett, KOPF_SCHRIFT, breiten[i] - 2 * ZELLEN_RAND)[0] ?? "", {
        x: x + ZELLEN_RAND,
        y: y - ZELLEN_RAND - KOPF_SCHRIFT,
        size: KOPF_SCHRIFT,
        font: fett,
      });
      x += breiten[i];
    });
    y -= hoehe;
  }
  kopfzeile();

  const untereGrenze = RAND + 18; // Platz fuer die Fusszeile
  for (const zeile of liste.zeilen) {
    const zellen = zeile.map((t, i) => umbrechen(t, normal, SCHRIFT, breiten[i] - 2 * ZELLEN_RAND));
    const anzahl = Math.max(...zellen.map((z) => z.length));
    // Zeilenweise statt zeilenweise-als-Ganzes: ein langer Tagesbericht darf
    // ueber den Seitenrand laufen, sonst passte er bei mehr als einer
    // Seitenhoehe nie auf eine Seite und der Export bliebe in einer
    // Endlosschleife haengen.
    for (let l = 0; l < anzahl; l++) {
      if (y - ZEILENHOEHE < untereGrenze) {
        seite = dok.addPage([SEITE_BREITE, SEITE_HOEHE]);
        seiten.push(seite);
        y = SEITE_HOEHE - RAND;
        kopfzeile();
      }
      let x = RAND;
      zellen.forEach((z, i) => {
        if (z[l]) seite.drawText(z[l], { x: x + ZELLEN_RAND, y: y - SCHRIFT - 1, size: SCHRIFT, font: normal });
        x += breiten[i];
      });
      y -= ZEILENHOEHE;
    }
    seite.drawLine({ start: { x: RAND, y: y - 2 }, end: { x: RAND + nutzbreite, y: y - 2 }, thickness: 0.5, color: LINIE });
    y -= 4;
  }

  // Fusszeile erst jetzt, weil die Gesamtseitenzahl vorher nicht feststeht.
  seiten.forEach((s, i) => {
    s.drawText("Zimmerakte · vertraulich – enthält Sozialdaten, nur für den Dienstgebrauch", {
      x: RAND,
      y: RAND - 6,
      size: 7.5,
      font: normal,
      color: GRAU,
    });
    const text = `Seite ${i + 1} von ${seiten.length}`;
    s.drawText(text, {
      x: SEITE_BREITE - RAND - normal.widthOfTextAtSize(text, 7.5),
      y: RAND - 6,
      size: 7.5,
      font: normal,
      color: GRAU,
    });
  });

  return dok.save();
}

export async function pdfHerunterladen(liste: ListenExport, jetzt: Date = new Date()) {
  const bytes = await erzeugePdf(liste, jetzt);
  blobHerunterladen(new Blob([bytes as BlobPart], { type: "application/pdf" }), dateinameMitDatum(liste.dateiname, "pdf", jetzt));
}

/** Fasst gesetzte Filter zu einer Zeile zusammen ("Amt: X · Suche: Y"); leere Werte entfallen. */
export function filterTextAus(paare: [string, string | null | undefined][]): string | undefined {
  const text = paare
    .filter(([, wert]) => wert && wert.trim())
    .map(([name, wert]) => `${name}: ${wert}`)
    .join(" · ");
  return text || undefined;
}
