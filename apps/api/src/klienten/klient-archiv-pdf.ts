import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { KlientKontakt, KlientStammdaten } from "./klient.service";

// A4 in PDF-Punkten (1pt = 1/72 Zoll).
const SEITE_BREITE = 595.28;
const SEITE_HOEHE = 841.89;
const RAND = 50;
const INHALT_BREITE = SEITE_BREITE - 2 * RAND;
const GRAU = rgb(0.45, 0.45, 0.45);
const HELLGRAU = rgb(0.82, 0.82, 0.82);

export interface ArchivPdfDokument {
  dateiname: string;
  mimeType: string;
  inhalt: Buffer;
}

export interface ArchivPdfInput {
  klient: {
    vorname: string;
    nachname: string;
    geburtsdatum: string | null;
    aktenzeichen: string;
    amt: string;
    aufnahmeAm: string | null;
    entlassenAm: string | null;
  };
  archiviertAm: string;
  archiviertVonName: string | null;
  stammdaten: KlientStammdaten | null;
  kontakte: KlientKontakt[];
  belegungen: { standortName: string; zimmerNummer: string; einzug: string; auszug: string | null }[];
  kostenuebernahmen: { amt: string; von: string; bis: string | null }[];
  kassenbuchungen: {
    datum: string;
    typBezeichnung: string;
    richtung: "einzahlung" | "auszahlung";
    betragCent: number;
    verwendungszweck: string;
    storniert: boolean;
  }[];
  rechnungen: {
    datum: string;
    betragCent: number;
    beschreibung: string;
    status: string;
    dokument: ArchivPdfDokument | null;
  }[];
  tagesberichte: {
    datum: string;
    autorName: string | null;
    text: string;
    dokumente: ArchivPdfDokument[];
  }[];
}

interface TocEintrag {
  ebene: 1 | 2;
  titel: string;
  seiteImContent: number; // 0-indexiert, Position innerhalb von ContentBuilder.doc
}

/**
 * Zweistufiger Aufbau, weil Seitenzahlen fuer das Inhaltsverzeichnis erst
 * feststehen, NACHDEM der gesamte Inhalt gebaut ist (Fotos/eingebettete
 * PDFs verschieben nachfolgende Kapitel um eine im Voraus nicht bekannte
 * Anzahl Seiten). ContentBuilder baut deshalb zunaechst ALLES in ein
 * eigenstaendiges Dokument und merkt sich dabei nur, auf welcher (0-
 * indexierten) Seite jedes Kapitel beginnt. Erst danach entsteht das
 * finale Dokument mit Deckblatt + Inhaltsverzeichnis davor.
 */
class ContentBuilder {
  private constructor(
    public readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly fett: PDFFont
  ) {}

  seite!: PDFPage;
  y = 0;
  readonly toc: TocEintrag[] = [];

  static async erstellen(): Promise<ContentBuilder> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fett = await doc.embedFont(StandardFonts.HelveticaBold);
    const b = new ContentBuilder(doc, font, fett);
    b.neueSeite();
    return b;
  }

  neueSeite() {
    this.seite = this.doc.addPage([SEITE_BREITE, SEITE_HOEHE]);
    this.y = SEITE_HOEHE - RAND;
  }

  private platzPruefen(hoehe: number) {
    if (this.y - hoehe < RAND) this.neueSeite();
  }

  /** ebene 1 = Kapitel (beginnt immer auf neuer Seite), ebene 2 = Jahres-Unterebene. */
  kapitel(titel: string, ebene: 1 | 2 = 1) {
    if (ebene === 1 && this.y < SEITE_HOEHE - RAND) this.neueSeite();
    else this.platzPruefen(40);
    this.toc.push({ ebene, titel, seiteImContent: this.doc.getPageCount() - 1 });
    const groesse = ebene === 1 ? 17 : 13;
    this.seite.drawText(titel, { x: RAND, y: this.y, size: groesse, font: this.fett });
    this.y -= groesse + 14;
  }

  absatz(text: string, groesse = 10, fett = false) {
    const font = fett ? this.fett : this.font;
    for (const zeile of zeilenUmbruch(text, font, groesse, INHALT_BREITE)) {
      this.platzPruefen(groesse * 1.4);
      this.seite.drawText(zeile, { x: RAND, y: this.y, size: groesse, font });
      this.y -= groesse * 1.4;
    }
  }

  feld(label: string, wert: string | null | undefined) {
    if (!wert) return;
    this.absatz(`${label}: ${wert}`);
  }

  leerzeile(hoehe = 8) {
    this.y -= hoehe;
  }

  linie() {
    this.platzPruefen(10);
    this.seite.drawLine({
      start: { x: RAND, y: this.y },
      end: { x: SEITE_BREITE - RAND, y: this.y },
      thickness: 0.5,
      color: HELLGRAU,
    });
    this.y -= 14;
  }

  tabelle(spalten: { titel: string; breite: number }[], zeilen: string[][]) {
    this.platzPruefen(24);
    let x = RAND;
    for (const s of spalten) {
      this.seite.drawText(s.titel, { x, y: this.y, size: 9, font: this.fett, color: GRAU });
      x += s.breite;
    }
    this.y -= 12;
    this.linie();
    for (const zeile of zeilen) {
      this.platzPruefen(13);
      x = RAND;
      for (let i = 0; i < zeile.length; i++) {
        this.seite.drawText(kuerzen(zeile[i] ?? "", this.font, 9, spalten[i].breite - 8), {
          x,
          y: this.y,
          size: 9,
          font: this.font,
        });
        x += spalten[i].breite;
      }
      this.y -= 13;
    }
    this.leerzeile(6);
  }

  /**
   * Bettet ein Foto auf einer eigenen Seite ein. pdf-lib kann nur PNG/JPEG
   * einbetten -- WebP (ebenfalls erlaubter Upload-Mimetyp, siehe
   * common/datei.ts) laesst sich damit nicht einbetten; in diesem Fall wird
   * nur ein Verweistext geschrieben, das Original bleibt ueber die normale
   * Dokument-Ansicht der Akte weiterhin abrufbar (Lesezugriff ist von der
   * Archivsperre nicht betroffen).
   */
  async bildSeite(bild: Buffer, mimeType: string, dateiname: string): Promise<void> {
    let eingebettet;
    try {
      if (mimeType === "image/png") eingebettet = await this.doc.embedPng(bild);
      else if (mimeType === "image/jpeg") eingebettet = await this.doc.embedJpg(bild);
    } catch {
      eingebettet = undefined;
    }
    if (!eingebettet) {
      this.absatz(`[Anhang „${dateiname}" (${mimeType}) konnte nicht eingebettet werden -- Original in der Akte.]`, 9);
      return;
    }
    this.neueSeite();
    const maxBreite = INHALT_BREITE;
    const maxHoehe = SEITE_HOEHE - 2 * RAND;
    const skala = Math.min(maxBreite / eingebettet.width, maxHoehe / eingebettet.height, 1);
    const breite = eingebettet.width * skala;
    const hoehe = eingebettet.height * skala;
    this.seite.drawImage(eingebettet, {
      x: RAND + (maxBreite - breite) / 2,
      y: RAND + (maxHoehe - hoehe) / 2,
      width: breite,
      height: hoehe,
    });
    this.neueSeite();
  }

  /** Haengt alle Seiten eines hochgeladenen PDF-Dokuments direkt an. */
  async pdfEinbetten(pdf: Buffer, dateiname: string): Promise<void> {
    try {
      const quelle = await PDFDocument.load(pdf);
      const kopiert = await this.doc.copyPages(quelle, quelle.getPageIndices());
      for (const seite of kopiert) this.doc.addPage(seite);
      this.neueSeite();
    } catch {
      this.absatz(`[Anhang „${dateiname}" (PDF) konnte nicht eingebettet werden -- beschaedigte Datei.]`, 9);
    }
  }
}

function zeilenUmbruch(text: string, font: PDFFont, groesse: number, maxBreite: number): string[] {
  const ergebnis: string[] = [];
  for (const absatz of text.split("\n")) {
    const woerter = absatz.split(/\s+/).filter(Boolean);
    if (woerter.length === 0) {
      ergebnis.push("");
      continue;
    }
    let zeile = "";
    for (const wort of woerter) {
      const kandidat = zeile ? `${zeile} ${wort}` : wort;
      if (font.widthOfTextAtSize(kandidat, groesse) > maxBreite && zeile) {
        ergebnis.push(zeile);
        zeile = wort;
      } else {
        zeile = kandidat;
      }
    }
    ergebnis.push(zeile);
  }
  return ergebnis;
}

function kuerzen(text: string, font: PDFFont, groesse: number, maxBreite: number): string {
  if (font.widthOfTextAtSize(text, groesse) <= maxBreite) return text;
  let gekuerzt = text;
  while (gekuerzt.length > 1 && font.widthOfTextAtSize(`${gekuerzt}…`, groesse) > maxBreite) {
    gekuerzt = gekuerzt.slice(0, -1);
  }
  return `${gekuerzt}…`;
}

function euro(cent: number): string {
  return `${(cent / 100).toFixed(2).replace(".", ",")} €`;
}

/** Gruppiert nach Kalenderjahr (Datumsangaben als "YYYY-MM-DD"), aufsteigend. */
function nachJahrGruppieren<T>(eintraege: T[], datum: (e: T) => string): Map<string, T[]> {
  const gruppen = new Map<string, T[]>();
  for (const e of eintraege) {
    const jahr = datum(e).slice(0, 4);
    if (!gruppen.has(jahr)) gruppen.set(jahr, []);
    gruppen.get(jahr)!.push(e);
  }
  return new Map([...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

const STAMMDATEN_ABSCHNITTE: { titel: string; felder: [string, keyof KlientStammdaten][] }[] = [
  {
    titel: "Schnelle Informationen",
    felder: [
      ["Geburtsort", "geburtsort"],
      ["Nationalität", "nationalitaet"],
      ["Sorgeberechtigt", "sorgeberechtigt"],
      ["Bezugsbetreuung", "bezugsbetreuerName"],
      ["Betreuungsstunden", "betreuungsstunden"],
      ["Telefon", "telefon"],
      ["Sprachen", "sprachen"],
    ],
  },
  {
    titel: "Weitere Informationen",
    felder: [
      ["Anmerkungen", "anmerkungen"],
      ["Personaldokumente", "personaldokumente"],
      ["Bankkonto", "bankkonto"],
      ["IBAN", "iban"],
    ],
  },
  {
    titel: "Kontakt / Betreuung (Amt)",
    felder: [
      ["Jugendamt Adresse", "jugendamtAdresse"],
      ["Jugendamt Sachbearbeitung", "jugendamtSachbearbeiter"],
      ["Jugendamt Stellenzeichen", "jugendamtStellenzeichen"],
      ["Jugendamt Telefon", "jugendamtTelefon"],
      ["Jugendamt E-Mail", "jugendamtEmail"],
      ["WJH Name", "wjhName"],
      ["WJH Telefon", "wjhTelefon"],
      ["WJH E-Mail", "wjhEmail"],
      ["Personensorgeberechtigte", "personensorgeberechtigte"],
      ["Besuchskontakte", "besuchskontakte"],
    ],
  },
  {
    titel: "Gesundheit",
    felder: [
      ["Krankenkasse", "krankenkasse"],
      ["Versichertennummer", "versichertennummer"],
      ["Medikamente", "medikamente"],
      ["Diagnosen", "diagnosen"],
      ["Allergien", "allergien"],
      ["Besonderheiten (gesundheitlich)", "besonderheitenGesundheitlich"],
      ["Besonderheiten (psychisch)", "besonderheitenPsychisch"],
    ],
  },
  {
    titel: "Bildung / Ausbildung",
    felder: [
      ["Schule", "schule"],
      ["Klassenstufe", "klassenstufe"],
      ["Schulabschlüsse", "schulabschluesse"],
      ["Förderbedarfe", "foerderbedarfe"],
    ],
  },
  {
    titel: "Vorherige Einrichtung",
    felder: [
      ["Träger", "vorherigeEinrichtungTraeger"],
      ["Kontakt", "vorherigeEinrichtungKontakt"],
      ["Anfrage am", "vorherigeEinrichtungAnfrageAm"],
      ["Einzug am", "vorherigeEinrichtungEinzugAm"],
      ["Auszug am", "vorherigeEinrichtungAuszugAm"],
    ],
  },
];

async function baueInhalt(input: ArchivPdfInput): Promise<ContentBuilder> {
  const b = await ContentBuilder.erstellen();

  // 1. Stammdaten
  b.kapitel("1. Stammdaten");
  if (!input.stammdaten) {
    b.absatz("Keine Stammdaten erfasst.");
  } else {
    for (const abschnitt of STAMMDATEN_ABSCHNITTE) {
      const hatInhalt = abschnitt.felder.some(([, feld]) => input.stammdaten![feld]);
      if (!hatInhalt) continue;
      b.absatz(abschnitt.titel, 12, true);
      for (const [label, feld] of abschnitt.felder) {
        b.feld(label, input.stammdaten[feld] as string | null);
      }
      b.leerzeile();
    }
  }

  // 2. Kontakte
  b.kapitel("2. Kontakte");
  if (input.kontakte.length === 0) {
    b.absatz("Keine Kontakte erfasst.");
  } else {
    b.tabelle(
      [
        { titel: "Beziehung", breite: 90 },
        { titel: "Name", breite: 120 },
        { titel: "Adresse", breite: 130 },
        { titel: "Telefon", breite: 80 },
        { titel: "E-Mail", breite: 75 },
      ],
      input.kontakte.map((k) => [k.beziehung ?? "–", k.name, k.adresse ?? "–", k.telefon ?? "–", k.email ?? "–"])
    );
  }

  // 3. Unterbringungshistorie
  b.kapitel("3. Unterbringungshistorie");
  if (input.belegungen.length === 0) {
    b.absatz("Keine Unterbringung erfasst.");
  } else {
    b.tabelle(
      [
        { titel: "Standort", breite: 160 },
        { titel: "Zimmer", breite: 90 },
        { titel: "Einzug", breite: 90 },
        { titel: "Auszug", breite: 90 },
      ],
      input.belegungen.map((bel) => [bel.standortName, bel.zimmerNummer, bel.einzug, bel.auszug ?? "laufend"])
    );
  }

  // 4. Finanzielle Dokumentation
  b.kapitel("4. Finanzielle Dokumentation");

  // 4.1 Kostenübernahmen
  b.kapitel("4.1 Kostenübernahmen", 2);
  if (input.kostenuebernahmen.length === 0) {
    b.absatz("Keine Kostenübernahmen erfasst.");
  } else {
    b.tabelle(
      [
        { titel: "Amt", breite: 260 },
        { titel: "Von", breite: 90 },
        { titel: "Bis", breite: 90 },
      ],
      input.kostenuebernahmen.map((k) => [k.amt, k.von, k.bis ?? "offen"])
    );
  }

  // 4.2 Kassenbuch (nach Jahr gruppiert, sobald mehr als ein Jahr vorkommt --
  // in diesem Fall traegt jedes Jahr seinen eigenen Inhaltsverzeichnis-
  // Eintrag, die uebergreifende Ueberschrift entfiele sonst als Dublette
  // auf derselben Seite wie das erste Jahr).
  const kassenbuchJahre = nachJahrGruppieren(input.kassenbuchungen, (k) => k.datum);
  const kassenbuchMehrereJahre = kassenbuchJahre.size > 1;
  if (!kassenbuchMehrereJahre) b.kapitel("4.2 Kassenbuch", 2);
  if (input.kassenbuchungen.length === 0) {
    b.absatz("Keine Kassenbuchungen erfasst.");
  } else {
    for (const [jahr, buchungen] of kassenbuchJahre) {
      if (kassenbuchMehrereJahre) b.kapitel(`4.2 Kassenbuch — ${jahr}`, 2);
      b.tabelle(
        [
          { titel: "Datum", breite: 65 },
          { titel: "Typ", breite: 90 },
          { titel: "Richtung", breite: 60 },
          { titel: "Betrag", breite: 65 },
          { titel: "Verwendungszweck/Kommentar", breite: 150 },
        ],
        buchungen.map((k) => [
          k.datum,
          k.typBezeichnung,
          k.richtung === "einzahlung" ? "Einzahlung" : "Auszahlung",
          `${k.storniert ? "storniert · " : ""}${euro(k.betragCent)}`,
          k.verwendungszweck,
        ])
      );
    }
  }

  // 4.3 Rechnungen (nach Jahr gruppiert, Dokument direkt danach eingebettet)
  const rechnungJahre = nachJahrGruppieren(input.rechnungen, (r) => r.datum);
  const rechnungMehrereJahre = rechnungJahre.size > 1;
  if (!rechnungMehrereJahre) b.kapitel("4.3 Rechnungen", 2);
  if (input.rechnungen.length === 0) {
    b.absatz("Keine Rechnungen erfasst.");
  } else {
    for (const [jahr, rechnungen] of rechnungJahre) {
      if (rechnungMehrereJahre) b.kapitel(`4.3 Rechnungen — ${jahr}`, 2);
      for (const r of rechnungen) {
        b.absatz(`${r.datum} · ${euro(r.betragCent)} · ${r.status}`, 10, true);
        b.absatz(r.beschreibung);
        if (r.dokument) {
          if (r.dokument.mimeType === "application/pdf") await b.pdfEinbetten(r.dokument.inhalt, r.dokument.dateiname);
          else await b.bildSeite(r.dokument.inhalt, r.dokument.mimeType, r.dokument.dateiname);
        }
        b.leerzeile();
      }
    }
  }

  // 5. Tagesberichte (nach Jahr gruppiert, Anhänge direkt nach ihrem Eintrag)
  const berichtJahre = nachJahrGruppieren(input.tagesberichte, (t) => t.datum);
  const berichtMehrereJahre = berichtJahre.size > 1;
  b.kapitel("5. Tagesberichte");
  if (input.tagesberichte.length === 0) {
    b.absatz("Keine Tagesberichte erfasst.");
  } else {
    for (const [jahr, berichte] of berichtJahre) {
      if (berichtMehrereJahre) b.kapitel(jahr, 2);
      for (const t of berichte) {
        b.absatz(`${t.datum}${t.autorName ? ` · ${t.autorName}` : ""}`, 10, true);
        b.absatz(t.text);
        for (const dok of t.dokumente) {
          if (dok.mimeType === "application/pdf") await b.pdfEinbetten(dok.inhalt, dok.dateiname);
          else await b.bildSeite(dok.inhalt, dok.mimeType, dok.dateiname);
        }
        b.leerzeile();
      }
    }
  }

  return b;
}

const TOC_ZEILEN_PRO_SEITE = 30;
const TOC_ZEILENHOEHE = 18;

function tocSeitenzahlBerechnen(anzahlEintraege: number): number {
  return Math.max(1, Math.ceil(anzahlEintraege / TOC_ZEILEN_PRO_SEITE));
}

function deckblattZeichnen(seite: PDFPage, font: PDFFont, fett: PDFFont, input: ArchivPdfInput) {
  let y = SEITE_HOEHE - 100;
  seite.drawText("Zimmerakte — Archiv-Auszug", { x: RAND, y, size: 22, font: fett });
  y -= 44;
  seite.drawText(`${input.klient.vorname} ${input.klient.nachname}`, { x: RAND, y, size: 18, font });
  y -= 40;

  const zeile = (label: string, wert: string | null) => {
    if (!wert) return;
    seite.drawText(`${label}: ${wert}`, { x: RAND, y, size: 11, font });
    y -= 20;
  };
  zeile("Aktenzeichen", input.klient.aktenzeichen);
  zeile("Amt", input.klient.amt);
  zeile("Geburtsdatum", input.klient.geburtsdatum);
  zeile("Aufnahme am", input.klient.aufnahmeAm);
  zeile("Entlassen am", input.klient.entlassenAm);
  y -= 20;
  zeile("Archiviert am", input.archiviertAm.slice(0, 10));
  zeile("Archiviert von", input.archiviertVonName);

  y = 130;
  seite.drawLine({ start: { x: RAND, y: y + 20 }, end: { x: SEITE_BREITE - RAND, y: y + 20 }, thickness: 0.5, color: HELLGRAU });
  for (const zl of zeilenUmbruch(
    "Vertraulich — enthält besondere Kategorien personenbezogener Daten (Art. 9 DSGVO, Sozialdaten nach SGB X). " +
      "Nur zur internen Aktenführung bestimmt.",
    font,
    9,
    INHALT_BREITE
  )) {
    seite.drawText(zl, { x: RAND, y, size: 9, font, color: GRAU });
    y -= 13;
  }
}

function tocZeichnen(seiten: PDFPage[], font: PDFFont, fett: PDFFont, eintraege: TocEintrag[], seitenOffset: number) {
  let seitenIndex = 0;
  let y = SEITE_HOEHE - RAND - 20;
  seiten[0].drawText("Inhaltsverzeichnis", { x: RAND, y, size: 17, font: fett });
  y -= 34;

  for (const eintrag of eintraege) {
    if (y < RAND) {
      seitenIndex++;
      y = SEITE_HOEHE - RAND;
    }
    const seite = seiten[seitenIndex];
    const x = RAND + (eintrag.ebene === 2 ? 18 : 0);
    const groesse = eintrag.ebene === 2 ? 10 : 11.5;
    const schrift = eintrag.ebene === 2 ? font : fett;
    const seitenzahl = String(seitenOffset + eintrag.seiteImContent + 1);
    const seitenzahlBreite = font.widthOfTextAtSize(seitenzahl, groesse);
    const titelMaxBreite = INHALT_BREITE - (eintrag.ebene === 2 ? 18 : 0) - seitenzahlBreite - 14;
    const titel = kuerzen(eintrag.titel, schrift, groesse, titelMaxBreite);

    seite.drawText(titel, { x, y, size: groesse, font: schrift });
    const punktStart = x + schrift.widthOfTextAtSize(titel, groesse) + 6;
    const punktEnde = SEITE_BREITE - RAND - seitenzahlBreite - 6;
    if (punktEnde > punktStart) {
      const punktBreite = font.widthOfTextAtSize(".", 9);
      const anzahl = Math.max(0, Math.floor((punktEnde - punktStart) / punktBreite));
      seite.drawText(".".repeat(anzahl), { x: punktStart, y, size: 9, font, color: GRAU });
    }
    seite.drawText(seitenzahl, { x: SEITE_BREITE - RAND - seitenzahlBreite, y, size: groesse, font });
    y -= TOC_ZEILENHOEHE;
  }
}

export async function erzeugeArchivPdf(input: ArchivPdfInput): Promise<Buffer> {
  const inhalt = await baueInhalt(input);

  const finalDoc = await PDFDocument.create();
  const font = await finalDoc.embedFont(StandardFonts.Helvetica);
  const fett = await finalDoc.embedFont(StandardFonts.HelveticaBold);

  const deckblatt = finalDoc.addPage([SEITE_BREITE, SEITE_HOEHE]);
  deckblattZeichnen(deckblatt, font, fett, input);

  const tocSeitenzahl = tocSeitenzahlBerechnen(inhalt.toc.length);
  const tocSeiten = Array.from({ length: tocSeitenzahl }, () => finalDoc.addPage([SEITE_BREITE, SEITE_HOEHE]));

  const kopiert = await finalDoc.copyPages(inhalt.doc, inhalt.doc.getPageIndices());
  for (const seite of kopiert) finalDoc.addPage(seite);

  // Offset = Deckblatt (1 Seite) + Inhaltsverzeichnis-Seiten -- danach
  // beginnt der aus ContentBuilder kopierte Inhalt.
  tocZeichnen(tocSeiten, font, fett, inhalt.toc, 1 + tocSeitenzahl);

  const bytes = await finalDoc.save();
  return Buffer.from(bytes);
}
