import { PDFFont, PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { AccountTypDto, OrgUnitDto, PositionDto } from "./organigramm.service";

// A4 in PDF-Punkten (1pt = 1/72 Zoll) -- dieselben Masse wie
// klient-archiv-pdf.ts, damit beide PDF-Exporte im Projekt gleich aussehen.
const SEITE_BREITE = 595.28;
const SEITE_HOEHE = 841.89;
const RAND = 50;
const GRAU = rgb(0.45, 0.45, 0.45);
const HELLGRAU = rgb(0.82, 0.82, 0.82);

// Keine eigene Zeilenhoehen-/Spaltenbreiten-Klasse wie ContentBuilder in
// klient-archiv-pdf.ts -- dort rechtfertigt der zweistufige Aufbau (Inhalt
// zuerst bauen, Seitenzahlen erst danach kennen, siehe Kommentar dort) den
// Aufwand. Hier gibt es weder Inhaltsverzeichnis noch eingebettete Anhaenge,
// nur eine einzige fortlaufende Tabelle -- ein simpler Zeilenzaehler mit
// Seitenumbruch bei Bedarf reicht.
interface Spalte {
  titel: string;
  breite: number;
}

// Summe 495 (INHALT_BREITE = 595.28 - 2*50 = 495.28) -- die fehlenden 0,28pt
// gehen in keiner Spalte verloren, kuerzen() unten schneidet ohnehin pro
// Zelle ab, falls ein Wert trotz Breite nicht passt.
const SPALTEN: Spalte[] = [
  { titel: "Titel", breite: 100 },
  { titel: "Einheit", breite: 95 },
  { titel: "Typ", breite: 55 },
  { titel: "Account-Typ", breite: 90 },
  { titel: "Status", breite: 75 },
  { titel: "Besetzt mit", breite: 80 },
];

// Gespiegelt aus packages/shared (POSITION_TYP_LABEL) statt importiert: die
// API haengt bewusst nicht von @zimmerakte/shared ab (das Paket ist fuer
// Typen/Label-Maps, die Web UND API gemeinsam brauchen -- die API selbst
// braucht diese Label bisher nirgends ausser hier, ein Abhaengigkeit fuers
// gesamte Paket waere fuer zwei Textbausteine unverhaeltnismaessig).
const POSITION_TYP_LABEL: Record<PositionDto["typ"], string> = {
  linie: "Linie",
  stabsstelle: "Stabsstelle",
};

/**
 * Dieselbe Herleitung wie positionsStatus() in Organigramm.tsx (CLAUDE.md
 * Regel 4: Status wird abgeleitet, nie gespeichert) -- hier als reiner
 * Text ohne Pill-Klasse, da ein PDF keine CSS-Klassen kennt. Bewusst
 * dupliziert statt importiert: apps/web und apps/api sind getrennte
 * Build-Ziele (Browser- vs. Node-Bundle), ein Import quer darueber wuerde
 * React/DOM-Abhaengigkeiten ins API-Bundle ziehen.
 */
function positionsStatusText(p: PositionDto): string {
  if (p.istGeplant) return "Geplant (Platzhalter)";
  if (p.besetztMit.length === 0) return "Vakant";
  if (p.besetztMit.length < p.sollBesetzung) return `Besetzt ${p.besetztMit.length}/${p.sollBesetzung}`;
  return "Besetzt";
}

/**
 * Dieselbe Namensdarstellung wie KnotenBox in Organigramm.tsx: redigierte
 * Besetzungen (benutzerName=null, siehe organigramm.service.ts::zuPositionDto())
 * zeigen "Namen ausgeblendet" statt eines leeren Werts -- der Unterschied zu
 * "Derzeit nicht besetzt" (besetztMit wirklich leer) bleibt damit auch im
 * PDF erkennbar.
 */
function besetztMitText(p: PositionDto): string {
  const namen = p.besetztMit.filter((b) => b.benutzerName !== null).map((b) => b.benutzerName as string);
  if (namen.length > 0) return namen.join(", ");
  if (p.besetztMit.length > 0) return "Namen ausgeblendet";
  return "Derzeit nicht besetzt";
}

function kuerzen(text: string, font: PDFFont, groesse: number, maxBreite: number): string {
  if (font.widthOfTextAtSize(text, groesse) <= maxBreite) return text;
  let gekuerzt = text;
  while (gekuerzt.length > 1 && font.widthOfTextAtSize(`${gekuerzt}…`, groesse) > maxBreite) {
    gekuerzt = gekuerzt.slice(0, -1);
  }
  return `${gekuerzt}…`;
}

export interface OrganigrammPdfInput {
  mandantName: string;
  orgUnits: OrgUnitDto[];
  positionen: PositionDto[];
  accountTypen: AccountTypDto[];
}

/**
 * Baut aus den bereits redigierten (siehe organigramm.service.ts::exportPdf())
 * Listen eine simple, mehrseitige Tabelle -- keine eigene Datenbankabfrage
 * hier drin, CLAUDE.md Regel 6 gilt also automatisch mit: wer ohne
 * organigramm.personendaten-sehen exportiert, bekommt "Namen ausgeblendet"
 * im PDF, nicht die echten Namen.
 */
export async function erzeugeOrganigrammPdf(input: OrganigrammPdfInput): Promise<Buffer> {
  const orgUnitNamen = new Map(input.orgUnits.map((u) => [u.id, u.name]));
  const accountTypNamen = new Map(input.accountTypen.map((a) => [a.id, a.name]));
  const positionen = [...input.positionen].sort((a, b) => a.titel.localeCompare(b.titel, "de"));

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);

  let seite: PDFPage = doc.addPage([SEITE_BREITE, SEITE_HOEHE]);
  let y = SEITE_HOEHE - RAND;

  function kopfZeichnen() {
    let x = RAND;
    for (const s of SPALTEN) {
      seite.drawText(s.titel, { x, y, size: 9, font: fett, color: GRAU });
      x += s.breite;
    }
    y -= 12;
    seite.drawLine({ start: { x: RAND, y }, end: { x: SEITE_BREITE - RAND, y }, thickness: 0.5, color: HELLGRAU });
    y -= 14;
  }

  function neueSeite() {
    seite = doc.addPage([SEITE_BREITE, SEITE_HOEHE]);
    y = SEITE_HOEHE - RAND;
    kopfZeichnen();
  }

  seite.drawText(`Organigramm — ${input.mandantName}`, { x: RAND, y, size: 17, font: fett });
  y -= 30;
  kopfZeichnen();

  for (const p of positionen) {
    // Platzpruefung VOR dem Zeichnen der Zeile (Muster: klient-archiv-pdf.ts
    // platzPruefen()) -- sonst landet die letzte Zeile einer Seite unterhalb
    // des Randes.
    if (y - 13 < RAND) neueSeite();

    const zeile = [
      p.titel,
      orgUnitNamen.get(p.orgUnitId) ?? "?",
      POSITION_TYP_LABEL[p.typ],
      accountTypNamen.get(p.accountTypId) ?? "?",
      positionsStatusText(p),
      besetztMitText(p),
    ];
    let x = RAND;
    for (let i = 0; i < zeile.length; i++) {
      seite.drawText(kuerzen(zeile[i], font, 9, SPALTEN[i].breite - 8), { x, y, size: 9, font });
      x += SPALTEN[i].breite;
    }
    y -= 13;
  }

  if (positionen.length === 0) {
    seite.drawText("Keine Positionen angelegt.", { x: RAND, y, size: 10, font });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
