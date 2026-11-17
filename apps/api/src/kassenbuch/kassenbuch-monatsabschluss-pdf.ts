import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { bettePdfSchriftEin } from "../common/pdf-schrift";

// A4 in PDF-Punkten (1pt = 1/72 Zoll).
const SEITE_BREITE = 595.28;
const SEITE_HOEHE = 841.89;
const RAND = 50;
const GRAU = rgb(0.45, 0.45, 0.45);
const HELLGRAU = rgb(0.82, 0.82, 0.82);

export interface MonatsabschlussBuchung {
  belegnummer: number;
  datum: string; // "YYYY-MM-DD"
  typBezeichnung: string;
  verwendungszweck: string;
  betragCent: number;
  storniert: boolean;
  hatUnterschrift: boolean;
}

export interface MonatsabschlussInput {
  klient: { vorname: string; nachname: string; aktenzeichen: string };
  /** "YYYY-MM" */
  monat: string;
  anfangssaldoCent: number;
  /** Chronologisch aufsteigend, inklusive stornierter Buchungen. */
  buchungen: MonatsabschlussBuchung[];
  erstelltAm: string; // "YYYY-MM-DD"
  erstelltVonName: string | null;
}

export interface MonatsabschlussSummen {
  einzahlungenCent: number;
  auszahlungenCent: number;
  endsaldoCent: number;
}

/**
 * Stornierte Buchungen stehen im Beleg (Nachvollziehbarkeit gegenueber
 * Aemtern), zaehlen aber in keiner Summe -- dieselbe Regel wie beim Saldo
 * in kassenbuchung.service.ts (NOT storniert). Eigene, reine Funktion,
 * damit der Test die Rechnung ohne PDF-Parsing pruefen kann.
 */
export function berechneSummen(anfangssaldoCent: number, buchungen: MonatsabschlussBuchung[]): MonatsabschlussSummen {
  let einzahlungenCent = 0;
  let auszahlungenCent = 0;
  for (const b of buchungen) {
    if (b.storniert) continue;
    if (b.betragCent > 0) einzahlungenCent += b.betragCent;
    else auszahlungenCent += -b.betragCent;
  }
  return { einzahlungenCent, auszahlungenCent, endsaldoCent: anfangssaldoCent + einzahlungenCent - auszahlungenCent };
}

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export function monatLesbar(monat: string): string {
  const [jahr, m] = monat.split("-");
  return `${MONATSNAMEN[Number(m) - 1]} ${jahr}`;
}

function euro(cent: number): string {
  const betrag = Math.abs(cent);
  const text = `${Math.floor(betrag / 100)},${String(betrag % 100).padStart(2, "0")}`.replace(/\B(?=(\d{3})+(?=,))/g, ".");
  return `${cent < 0 ? "-" : ""}${text} €`;
}

function datumDe(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
}

function kuerzen(text: string, font: PDFFont, groesse: number, maxBreite: number): string {
  if (font.widthOfTextAtSize(text, groesse) <= maxBreite) return text;
  let gekuerzt = text;
  while (gekuerzt.length > 1 && font.widthOfTextAtSize(`${gekuerzt}…`, groesse) > maxBreite) gekuerzt = gekuerzt.slice(0, -1);
  return `${gekuerzt}…`;
}

export async function erzeugeMonatsabschlussPdf(input: MonatsabschlussInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const { normal: font, fett } = await bettePdfSchriftEin(doc);
  const summen = berechneSummen(input.anfangssaldoCent, input.buchungen);

  let seite!: PDFPage;
  let y = 0;
  const neueSeite = () => {
    seite = doc.addPage([SEITE_BREITE, SEITE_HOEHE]);
    y = SEITE_HOEHE - RAND;
  };
  const platz = (hoehe: number) => {
    if (y - hoehe < RAND) neueSeite();
  };
  const rechts = (text: string, xRechts: number, f: PDFFont, groesse: number, farbe = rgb(0, 0, 0)) =>
    seite.drawText(text, { x: xRechts - f.widthOfTextAtSize(text, groesse), y, size: groesse, font: f, color: farbe });
  const linie = () => {
    seite.drawLine({ start: { x: RAND, y }, end: { x: SEITE_BREITE - RAND, y }, thickness: 0.5, color: HELLGRAU });
    y -= 14;
  };

  neueSeite();
  seite.drawText("Kassenbuch – Monatsabschluss", { x: RAND, y, size: 18, font: fett });
  y -= 26;
  seite.drawText(`${input.klient.vorname} ${input.klient.nachname}`, { x: RAND, y, size: 12, font: fett });
  y -= 16;
  seite.drawText(`Aktenzeichen ${input.klient.aktenzeichen}  ·  ${monatLesbar(input.monat)}`, { x: RAND, y, size: 10, font });
  y -= 22;

  // Spalten: Beleg | Datum | Typ / Zweck | Betrag (rechtsbuendig)
  const X_BELEG = RAND;
  const X_DATUM = RAND + 42;
  const X_TEXT = RAND + 100;
  const X_BETRAG = SEITE_BREITE - RAND;
  const kopf = () => {
    seite.drawText("Beleg", { x: X_BELEG, y, size: 9, font: fett, color: GRAU });
    seite.drawText("Datum", { x: X_DATUM, y, size: 9, font: fett, color: GRAU });
    seite.drawText("Typ / Verwendungszweck", { x: X_TEXT, y, size: 9, font: fett, color: GRAU });
    rechts("Betrag", X_BETRAG, fett, 9, GRAU);
    y -= 12;
    linie();
  };

  platz(60);
  kopf();
  const zeile = (links: string[], betrag: string, f: PDFFont, farbe = rgb(0, 0, 0)) => {
    platz(14);
    seite.drawText(links[0], { x: X_BELEG, y, size: 9, font: f, color: farbe });
    seite.drawText(links[1], { x: X_DATUM, y, size: 9, font: f, color: farbe });
    seite.drawText(kuerzen(links[2], f, 9, X_BETRAG - X_TEXT - 80), { x: X_TEXT, y, size: 9, font: f, color: farbe });
    rechts(betrag, X_BETRAG, f, 9, farbe);
    y -= 13;
  };

  zeile(["", "", "Anfangssaldo (Übertrag)"], euro(input.anfangssaldoCent), fett);
  if (input.buchungen.length === 0) zeile(["", "", "Keine Buchungen in diesem Monat."], "", font, GRAU);
  for (const b of input.buchungen) {
    const text = `${b.typBezeichnung}: ${b.verwendungszweck}${b.storniert ? "  [STORNIERT – nicht summiert]" : ""}`;
    zeile([`#${b.belegnummer}`, datumDe(b.datum), text], euro(b.betragCent), font, b.storniert ? GRAU : rgb(0, 0, 0));
  }

  platz(90);
  y -= 4;
  linie();
  const summenZeile = (label: string, cent: number, f: PDFFont) => {
    seite.drawText(label, { x: X_TEXT, y, size: 10, font: f });
    rechts(euro(cent), X_BETRAG, f, 10);
    y -= 15;
  };
  summenZeile("Einzahlungen", summen.einzahlungenCent, font);
  summenZeile("Auszahlungen", -summen.auszahlungenCent, font);
  summenZeile("Endsaldo", summen.endsaldoCent, fett);

  // Unterschriftenfelder stehen zusammen auf einer Seite, nie zerrissen:
  // eine halbe Zeile "Unterschrift" auf der Folgeseite waere als Beleg wertlos.
  platz(150);
  y -= 30;
  seite.drawText("Die Richtigkeit des Kassenstands bestätigen:", { x: RAND, y, size: 10, font });
  y -= 50;
  const breite = (SEITE_BREITE - 2 * RAND - 30) / 2;
  for (const [i, beschriftung] of ["Klient:in", "Betreuung / Einrichtungsleitung"].entries()) {
    const x = RAND + i * (breite + 30);
    seite.drawLine({ start: { x, y }, end: { x: x + breite, y }, thickness: 0.6, color: rgb(0, 0, 0) });
    seite.drawText(`${beschriftung}  ·  Ort, Datum, Unterschrift`, { x, y: y - 12, size: 8, font, color: GRAU });
  }
  y -= 40;
  seite.drawText(
    `Erstellt am ${datumDe(input.erstelltAm)}${input.erstelltVonName ? ` von ${input.erstelltVonName}` : ""}.`,
    { x: RAND, y, size: 8, font, color: GRAU }
  );

  const seiten = doc.getPages();
  seiten.forEach((s, i) =>
    s.drawText(`Seite ${i + 1} von ${seiten.length}`, { x: SEITE_BREITE - RAND - 60, y: RAND / 2, size: 8, font, color: GRAU })
  );
  return Buffer.from(await doc.save());
}
