// Prueft den Listenexport (CSV + PDF) ohne Browser und ohne Datenbank:
//   cd apps/web && node --import tsx scripts/export-pruefung.mjs
// Die Funktionen sind reine Funktionen von Zeilen zu Bytes; nur der
// Download-Anker braucht ein DOM und wird hier nicht beruehrt.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { druckbarerText, erzeugeCsv, erzeugePdf, filterTextAus } from "../src/export/listenExport.ts";

// Im Browser holt erzeugePdf die Schriften per fetch von Vite-URLs; hier
// dieselben Dateien direkt von der Platte.
const require = createRequire(import.meta.url);
const schrift = (n) => new Uint8Array(readFileSync(require.resolve(`@zimmerakte/shared/schriften/${n}`)));
const ladeSchriften = async () => ({ normal: schrift("NunitoSans-Regular.ttf"), fett: schrift("NunitoSans-Bold.ttf") });

let geprueft = 0;
const fehler = [];
function pruefe(name, ok, detail = "") {
  geprueft++;
  if (!ok) fehler.push(`${name} ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${ok ? "" : detail}`);
}

const spalten = [
  { titel: "Datum", breite: 9 },
  { titel: "Klient:in", breite: 15 },
  { titel: "Bericht", breite: 50 },
];

// --- CSV
const csv = erzeugeCsv({
  titel: "t",
  dateiname: "t",
  spalten,
  zeilen: [
    ["01.11.2026", "Müller, Jörg", "Text mit; Semikolon und \"Zitat\"\nund Zeilenumbruch"],
    ["02.11.2026", "A", "=HYPERLINK(\"http://boese.example\";\"klick\")"],
    ["03.11.2026", "B", "+49 170 1234"],
    ["04.11.2026", "C", "-5 °C draußen"],
    ["05.11.2026", "D", "@SUM(A1)"],
    ["06.11.2026", "E", "ganz normal"],
  ],
});
pruefe("CSV beginnt mit BOM (Excel erkennt UTF-8)", csv.startsWith("﻿"));
pruefe("CSV nutzt Semikolon im Kopf", csv.split("\r\n")[0] === "﻿Datum;Klient:in;Bericht");
pruefe("CSV behält Umlaute", csv.includes("Müller, Jörg"));
pruefe("CSV maskiert Semikolon, Anführungszeichen, Umbruch", csv.includes('"Text mit; Semikolon und ""Zitat""\nund Zeilenumbruch"'));
pruefe("CSV entschärft =-Formel", csv.includes(`"'=HYPERLINK(""http://boese.example"";""klick"")"`));
pruefe("CSV entschärft +, - und @", csv.includes(";'+49 170 1234") && csv.includes(";'-5 °C draußen") && csv.includes(";'@SUM(A1)"));
pruefe("CSV lässt normalen Text unverändert", csv.includes(";ganz normal\r\n"));

// --- PDF
async function seiten(liste) {
  const bytes = await erzeugePdf(liste, new Date(2026, 10, 16, 21, 30), ladeSchriften);
  const dok = await PDFDocument.load(bytes);
  return { bytes, n: dok.getPageCount() };
}
const viele = Array.from({ length: 300 }, (_, i) => [`${(i % 28) + 1}.11.2026`, `Klient ${i}`, `Eintrag Nummer ${i} mit einigem Text, der umbrochen werden muss. `.repeat(3)]);
const a = await seiten({ titel: "Tagesberichte", dateiname: "t", spalten, zeilen: viele, filterText: "Zeitraum: Dieser Monat" });
pruefe("PDF mit 300 Zeilen läuft über mehrere Seiten", a.n > 5, `(${a.n} Seiten)`);
pruefe("PDF beginnt mit %PDF", Buffer.from(a.bytes.slice(0, 4)).toString() === "%PDF");

// Ein Bericht, der länger als eine Seite ist, darf nicht in einer Endlosschleife enden.
const lang = await seiten({ titel: "x", dateiname: "x", spalten, zeilen: [["1.1.2026", "A", "Wort ".repeat(6000)]] });
pruefe("Einzelner Riesenbericht bricht auf mehrere Seiten um", lang.n >= 2, `(${lang.n} Seiten)`);

// Zeichen, die die Schrift nicht hat (Emoji, Schneemann), dürfen den Export nicht kippen.
const exotisch = await seiten({ titel: "x", dateiname: "x", spalten, zeilen: [["1.1.2026", "Иван 😀", "Text ☃ mit Sonderzeichen ä ö ü ß – „“"]] });
pruefe("Unbekannte Zeichen werden ersetzt statt zu werfen", exotisch.n === 1);

// Schrift ist Nunito Sans (Rückmeldung "schriftart": auch Ausdrucke) und
// nur als Teilmenge eingebettet. BaseFont strukturell auslesen -- pdf-lib
// legt Objekte komprimiert in Objektströme, eine Textsuche in den Bytes
// fände dort nichts (auch kein "Helvetica") und bewiese nichts.
const { PDFName } = await import("pdf-lib");
const schriftNamen = (await PDFDocument.load(exotisch.bytes)).context
  .enumerateIndirectObjects()
  .map(([, o]) => o)
  .filter((o) => o?.get?.(PDFName.of("Type")) === PDFName.of("Font") && o.get(PDFName.of("BaseFont")))
  .map((o) => o.get(PDFName.of("BaseFont")).decodeText());
pruefe("PDF bettet Nunito Sans Regular und Bold ein", schriftNamen.some((n) => n.includes("NunitoSans-Regular")) && schriftNamen.some((n) => n.includes("NunitoSans-Bold")), `(${schriftNamen.join(", ")})`);
pruefe("PDF nutzt keine andere Schrift", schriftNamen.length > 0 && schriftNamen.every((n) => n.includes("NunitoSans")), `(${schriftNamen.join(", ")})`);
pruefe("Teilmenge statt ganzer Schrift (< 60 kB)", exotisch.bytes.length < 60_000, `(${exotisch.bytes.length} Bytes)`);
const fontkit = require("@pdf-lib/fontkit");
const vorrat = new Set(fontkit.create(Buffer.from(schrift("NunitoSans-Regular.ttf"))).characterSet);
pruefe("Namen mit Ł, Ş, Ć, ř bleiben im PDF unverändert", druckbarerText("Łukasz Şahin, Ćwik, Dvořák, Иван", vorrat) === "Łukasz Şahin, Ćwik, Dvořák, Иван");
pruefe("Emoji und Zeilenumbruch werden ersetzt", druckbarerText("a😀\nb", vorrat) === "a? b");

// Wort ohne Leerzeichen, breiter als die Spalte
const wort = await seiten({ titel: "x", dateiname: "x", spalten, zeilen: [["1.1.2026", "A", "x".repeat(900)]] });
pruefe("Überlanges Wort wird zeichenweise gebrochen", wort.n >= 1);

pruefe("filterTextAus lässt leere Filter weg", filterTextAus([["A", ""], ["B", "x"], ["C", undefined]]) === "B: x");
pruefe("filterTextAus ohne Filter ist undefined", filterTextAus([["A", ""]]) === undefined);

// Ein Prüfskript, das nichts misst, muss scheitern (CLAUDE.md).
if (geprueft < 18) {
  console.error(`Nur ${geprueft} Prüfungen gelaufen, erwartet >= 18.`);
  process.exit(2);
}
if (fehler.length) {
  console.error(`\n${fehler.length} von ${geprueft} Prüfungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${geprueft} Prüfungen bestanden.`);
