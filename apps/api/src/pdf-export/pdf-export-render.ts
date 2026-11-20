import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFImage, PDFPage, rgb, type RGB } from "pdf-lib";
import {
  druckUeberschriftFarbe,
  pdfTextEinzeilig,
  pdfTextZeilen,
  werteAus,
  type Baustein,
  type FeldWert,
  type FeldWerte,
  type FormularDefinition,
  type PdfGestaltung,
  type PdfSchrift,
  type PdfZielgruppe,
} from "@zimmerakte/shared";

/**
 * Setzt ein Protokoll als PDF nach der Gestaltung EINES PDF-Exports
 * (Migration 0082). Reine Funktion: alle Daten kommen als Eingabe, nichts
 * wird nachgeladen -- deshalb erzeugen Vorschau im Editor und echtes PDF in
 * der Akte dasselbe Bild (eine Wahrheit ueber das Aussehen, Konzept
 * Protokolle 9.5).
 *
 * Aufbau: ein Seitenrahmen je Grundform ("akte" / "brief") legt je Seite
 * fest, wo Inhalt hin darf (Satzspiegel), und zeichnet Kopf, Infospalte und
 * Fuss. Der Inhalt fliesst von oben nach unten hinein und bricht um, wo der
 * Satzspiegel endet. "Seite x von y" entsteht in einem zweiten Durchgang,
 * wenn die Seitenzahl feststeht.
 *
 * Geometrie in mm nach DIN 5008 Form B (Briefkopf fuer BEW: links 22 mm,
 * Anschriftfeld 85 mm breit ab 45 mm, Infospalte rechts). Absichtlich fest:
 * ein verschiebbares Anschriftfeld passt nicht mehr ins Umschlagfenster.
 */

const MM = 72 / 25.4;
const SEITE_B = 595.28;
const SEITE_H = 841.89;
const RAND_L = 22 * MM;
const RAND_R = 22 * MM;
const FUSS_Y = 10 * MM;
const INHALT_UNTEN = 22 * MM;
const SCHWARZ = rgb(0.07, 0.07, 0.07);
const GRAU = rgb(0.3, 0.3, 0.3);
const LINIE = rgb(0.82, 0.82, 0.82);
const RAHMEN = rgb(0.55, 0.55, 0.55);

const SCHRIFT_DATEIEN: Record<PdfSchrift, [string, string]> = {
  nunito: ["NunitoSans-Regular.ttf", "NunitoSans-Bold.ttf"],
  "liberation-sans": ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"],
  "liberation-serif": ["LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf"],
};
const schriftCache = new Map<string, Buffer>();
function schriftDatei(name: string): Buffer {
  let b = schriftCache.get(name);
  if (!b) {
    b = readFileSync(require.resolve(`@zimmerakte/shared/schriften/${name}`));
    schriftCache.set(name, b);
  }
  return b;
}

export interface PdfRenderEingabe {
  gestaltung: PdfGestaltung;
  zielgruppe: PdfZielgruppe;
  /** Traegerfarbe (mandant.akzentfarbe), gilt wenn gestaltung.farbe null ist. */
  traegerfarbe: string;
  logo: { mime: string; inhalt: Buffer } | null;
  formular: { name: string; version: number; definition: FormularDefinition };
  werte: FeldWerte;
  anzeige: Record<string, string | null>;
  personen: Record<string, string>;
  /** Alle Platzhalter ausser seite, seiten und feld.* (die setzt der Renderer). */
  platzhalter: Record<string, string | null>;
  /** Anschriftfeld, mehrzeilig. */
  empfaenger: string | null;
  /** Vorschau mit erfundenen Daten: Hinweis auf jeder Seite. */
  beispiel?: boolean;
}

// --- Inhalt vorbereiten ---------------------------------------------------

type Block =
  | { art: "ueberschrift"; text: string }
  | { art: "feld"; schluessel: string; label: string; wert: string | null; lang: boolean; jaNein: boolean | null; typ: Baustein["typ"] };

function datumDe(iso: string): string {
  const [j, m, t] = iso.split("-");
  return t ? `${t}.${m}.${j}` : iso;
}

/** Voller Wert fuer das PDF (nicht die gekuerzte Listenform). */
export function pdfWertText(b: Baustein, w: FeldWert, personen: Record<string, string>): string {
  switch (b.typ) {
    case "ja_nein":
      return w ? "Ja" : "Nein";
    case "datum":
      return datumDe(String(w));
    case "auswahl":
      return b.optionen.find((o) => o.wert === w)?.label ?? String(w);
    case "mehrfachauswahl":
      return (w as string[]).map((x) => b.optionen.find((o) => o.wert === x)?.label ?? x).join(", ");
    case "mitarbeitende":
      return (w as string[]).map((id) => personen[id] ?? "unbekannt").join(", ");
    case "zahl":
    case "berechnung":
      return `${String(w).replace(".", ",")}${b.einheit ? ` ${b.einheit}` : ""}`;
    case "skala":
      return `${w} von ${b.max}`;
    default:
      return String(w);
  }
}

/**
 * Welche Felder ins PDF kommen. Interne Felder NIE in einen externen Export,
 * egal was die Auswahl sagt -- die Auswahl kommt aus einer gespeicherten
 * Definition, die jemand mit genug Rechten auch von Hand bauen koennte.
 */
export function pdfBloecke(eingabe: Pick<PdfRenderEingabe, "gestaltung" | "zielgruppe" | "formular" | "werte" | "anzeige" | "personen">): Block[] {
  const { gestaltung: g, zielgruppe, formular } = eingabe;
  const { sichtbar, werte } = werteAus(formular.definition, eingabe.werte);
  const auswahl = g.felder === "alle" ? null : new Set(g.felder);
  const lauf = (liste: Baustein[]): Block[] => {
    const out: Block[] = [];
    for (const b of liste) {
      if (!sichtbar.has(b.schluessel)) continue;
      if (b.typ === "abschnitt") {
        const kinder = lauf(b.kinder);
        if (kinder.length > 0) out.push({ art: "ueberschrift", text: b.beschriftung }, ...kinder);
        continue;
      }
      if (b.typ === "hinweis") continue;
      if (zielgruppe === "extern" && "intern" in b && b.intern) continue;
      if (auswahl && !auswahl.has(b.schluessel)) continue;
      let wert: string | null;
      let jaNein: boolean | null = null;
      if (b.typ === "anzeige") {
        wert = eingabe.anzeige[b.schluessel] ?? null;
      } else {
        const w = werte[b.schluessel] ?? eingabe.werte[b.schluessel];
        const leer = w === undefined || w === null || w === "" || (Array.isArray(w) && w.length === 0);
        wert = leer ? null : pdfWertText(b, w as FeldWert, eingabe.personen);
        if (b.typ === "ja_nein" && !leer) jaNein = Boolean(w);
      }
      if (wert === null && g.leereFelder === "ausblenden") continue;
      const lang = b.typ === "langtext" || (wert !== null && (wert.length > 42 || wert.includes("\n")));
      out.push({ art: "feld", schluessel: b.schluessel, label: b.beschriftung, wert, lang, jaNein, typ: b.typ });
    }
    return out;
  };
  return lauf(formular.definition.bausteine);
}

/** Feldwerte als Platzhalter {feld.<schluessel>} -- mit derselben Intern-Sperre wie die Bloecke. */
function feldPlatzhalter(eingabe: PdfRenderEingabe): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const g = { ...eingabe.gestaltung, felder: "alle" as const, leereFelder: "ausblenden" as const };
  for (const b of pdfBloecke({ ...eingabe, gestaltung: g })) {
    if (b.art === "feld") out[`feld.${b.schluessel}`] = b.wert;
  }
  return out;
}

// --- Setzen ---------------------------------------------------------------

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function saeubern(t: string): string {
  return t.replace(/\r/g, "").replace(/\t/g, " ");
}

/** Zeilenumbruch nach Breite; ueberlange Woerter werden hart getrennt. */
export function umbrechen(text: string, font: PDFFont, groesse: number, breite: number): string[] {
  const zeilen: string[] = [];
  for (const absatz of saeubern(text).split("\n")) {
    const woerter = absatz.split(/ +/);
    let zeile = "";
    for (let wort of woerter) {
      while (font.widthOfTextAtSize(wort, groesse) > breite && wort.length > 1) {
        if (zeile) {
          zeilen.push(zeile);
          zeile = "";
        }
        let n = wort.length - 1;
        while (n > 1 && font.widthOfTextAtSize(wort.slice(0, n), groesse) > breite) n--;
        zeilen.push(wort.slice(0, n));
        wort = wort.slice(n);
      }
      const probe = zeile ? `${zeile} ${wort}` : wort;
      if (font.widthOfTextAtSize(probe, groesse) <= breite) zeile = probe;
      else {
        zeilen.push(zeile);
        zeile = wort;
      }
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

function kuerzen(text: string, font: PDFFont, groesse: number, breite: number): string {
  if (font.widthOfTextAtSize(text, groesse) <= breite) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, groesse) > breite) t = t.slice(0, -1);
  return `${t}…`;
}

interface Satzspiegel {
  x0: number;
  x1: number;
  /** Oberkante des Inhalts (PDF-Koordinaten, y nach oben). */
  oben: number;
}

class Setzer {
  seiten: PDFPage[] = [];
  seite!: PDFPage;
  y = 0;
  spiegel!: Satzspiegel;
  readonly linie: RGB;
  readonly ueberschrift: RGB;

  constructor(
    readonly doc: PDFDocument,
    readonly g: PdfGestaltung,
    readonly normal: PDFFont,
    readonly fett: PDFFont,
    farbe: string,
    readonly rahmen: (s: Setzer, nr: number) => Satzspiegel
  ) {
    this.linie = hexRgb(farbe);
    this.ueberschrift = hexRgb(druckUeberschriftFarbe(farbe));
  }

  neueSeite() {
    this.seite = this.doc.addPage([SEITE_B, SEITE_H]);
    this.seiten.push(this.seite);
    this.spiegel = this.rahmen(this, this.seiten.length);
    this.y = this.spiegel.oben;
  }

  get breite() {
    return this.spiegel.x1 - this.spiegel.x0;
  }

  platz(hoehe: number): void {
    if (this.y - hoehe < INHALT_UNTEN) this.neueSeite();
  }

  text(zeilen: string[], opt: { x?: number; groesse?: number; font?: PDFFont; farbe?: RGB; zeilenabstand?: number; rechts?: number }) {
    const groesse = opt.groesse ?? this.g.groesseText;
    const lh = groesse * (opt.zeilenabstand ?? 1.35);
    for (const z of zeilen) {
      this.platz(lh);
      this.y -= lh;
      const font = opt.font ?? this.normal;
      const x = opt.rechts !== undefined ? opt.rechts - font.widthOfTextAtSize(z, groesse) : (opt.x ?? this.spiegel.x0);
      this.seite.drawText(z, { x, y: this.y + groesse * 0.25, size: groesse, font, color: opt.farbe ?? SCHWARZ });
    }
  }

  absatz(text: string, opt: { groesse?: number; font?: PDFFont; abstandDanach?: number } = {}) {
    const groesse = opt.groesse ?? this.g.groesseText;
    this.text(umbrechen(text, opt.font ?? this.normal, groesse, this.breite), opt);
    this.y -= opt.abstandDanach ?? groesse * 0.6;
  }

  abschnitt(text: string) {
    const g = this.g;
    const groesse = g.ueberschriften === "farbig" ? Math.max(g.groesseText - 1, 7.5) : g.groesseText + 1;
    const vor = g.groesseText * 1.1;
    // Ueberschrift nie allein am Seitenende.
    this.platz(vor + groesse * 1.4 + g.groesseText * 2.6);
    this.y -= vor;
    const t = g.ueberschriften === "farbig" ? text.toLocaleUpperCase("de-DE") : text;
    let x = this.spiegel.x0;
    if (g.ueberschriften === "balken") {
      this.seite.drawRectangle({ x, y: this.y - groesse * 1.15, width: 1.2 * MM, height: groesse * 1.15, color: this.linie });
      x += 2.6 * MM;
    }
    const zeilen = umbrechen(t, this.fett, groesse, this.spiegel.x1 - x);
    this.text(zeilen, { x, groesse, font: this.fett, farbe: g.ueberschriften === "farbig" ? this.ueberschrift : SCHWARZ, zeilenabstand: 1.3 });
    this.y -= groesse * 0.35;
  }

  /** Ja/Nein als Ankreuzfelder: gezeichnet, nicht als Zeichen -- nicht jede Schrift hat ☒. */
  kreuze(x: number, yGrund: number, wert: boolean | null, groesse: number) {
    const k = groesse * 0.8;
    let cx = x;
    for (const [label, an] of [["Ja", wert === true], ["Nein", wert === false]] as const) {
      this.seite.drawRectangle({ x: cx, y: yGrund, width: k, height: k, borderColor: SCHWARZ, borderWidth: 0.6 });
      if (an) {
        this.seite.drawLine({ start: { x: cx + 1, y: yGrund + 1 }, end: { x: cx + k - 1, y: yGrund + k - 1 }, thickness: 0.8, color: SCHWARZ });
        this.seite.drawLine({ start: { x: cx + 1, y: yGrund + k - 1 }, end: { x: cx + k - 1, y: yGrund + 1 }, thickness: 0.8, color: SCHWARZ });
      }
      this.seite.drawText(label, { x: cx + k + 3, y: yGrund + 0.5, size: groesse, font: this.normal, color: SCHWARZ });
      cx += k + 3 + this.normal.widthOfTextAtSize(label, groesse) + 10;
    }
  }

  wertText(b: Extract<Block, { art: "feld" }>): string {
    if (b.wert === null) return this.g.leereFelder === "strich" ? "–" : "";
    return b.wert;
  }

  /** Stil "liste": Beschriftung links, Wert rechts, Linie darunter. Lange Werte laufen ueber Seiten weiter. */
  listenZeile(b: Extract<Block, { art: "feld" }>, x0 = this.spiegel.x0, x1 = this.spiegel.x1) {
    const g = this.g;
    const gr = g.groesseText;
    const lh = gr * 1.35;
    const pad = 1.2 * MM;
    const labelB = (x1 - x0) * 0.38;
    const wertX = x0 + labelB + 3 * MM;
    const label = umbrechen(b.label, this.normal, gr, labelB - 2);
    const kreuz = g.jaNein === "kreuz" && b.typ === "ja_nein";
    let wert = kreuz ? [""] : umbrechen(this.wertText(b), this.normal, gr, x1 - wertX);
    if (b.wert === null && g.leereFelder === "platz") wert = b.typ === "langtext" ? ["", "", ""] : [""];
    const n = Math.max(label.length, wert.length);
    this.platz(pad + Math.min(n, 3) * lh + pad);
    this.y -= pad;
    for (let i = 0; i < n; i++) {
      if (this.y - lh < INHALT_UNTEN) {
        this.neueSeite();
        this.y -= pad;
      }
      this.y -= lh;
      const yt = this.y + gr * 0.25;
      if (label[i]) this.seite.drawText(label[i], { x: x0, y: yt, size: gr, font: this.normal, color: GRAU });
      if (kreuz && i === 0) this.kreuze(wertX, yt - 0.5, b.jaNein, gr);
      else if (wert[i]) this.seite.drawText(wert[i], { x: wertX, y: yt, size: gr, font: this.normal, color: SCHWARZ });
    }
    this.y -= pad;
    this.seite.drawLine({ start: { x: x0, y: this.y }, end: { x: x1, y: this.y }, thickness: 0.4, color: LINIE });
  }

  /** Stil "kaesten": Beschriftung klein darueber, Wert im Rahmen. */
  kasten(b: Extract<Block, { art: "feld" }>, x0: number, x1: number, oben: number): number {
    const g = this.g;
    const gr = g.groesseText;
    const klein = Math.max(gr - 2, 7);
    const pad = 1.5 * MM;
    const label = kuerzen(b.label, this.normal, klein, x1 - x0);
    const kreuz = g.jaNein === "kreuz" && b.typ === "ja_nein";
    const wert = kreuz ? [""] : umbrechen(this.wertText(b), this.normal, gr, x1 - x0 - 2 * pad);
    const minZeilen = b.wert === null && g.leereFelder === "platz" ? (b.typ === "langtext" ? 4 : 1) : 1;
    const zeilen = Math.max(wert.length, minZeilen);
    let y = oben - klein * 1.3;
    this.seite.drawText(label, { x: x0, y: y + klein * 0.25, size: klein, font: this.normal, color: GRAU });
    const boxH = zeilen * gr * 1.35 + 2 * pad;
    y -= 0.8 * MM;
    this.seite.drawRectangle({ x: x0, y: y - boxH, width: x1 - x0, height: boxH, borderColor: RAHMEN, borderWidth: 0.6 });
    let yt = y - pad;
    if (kreuz) this.kreuze(x0 + pad, yt - gr * 1.1, b.jaNein, gr);
    for (const z of wert) {
      yt -= gr * 1.35;
      if (z) this.seite.drawText(z, { x: x0 + pad, y: yt + gr * 0.3, size: gr, font: this.normal, color: SCHWARZ });
    }
    return oben - (y - boxH) + 2 * MM;
  }

  kastenHoehe(b: Extract<Block, { art: "feld" }>, breite: number): number {
    const g = this.g;
    const gr = g.groesseText;
    const klein = Math.max(gr - 2, 7);
    const pad = 1.5 * MM;
    const kreuz = g.jaNein === "kreuz" && b.typ === "ja_nein";
    const wert = kreuz ? [""] : umbrechen(this.wertText(b), this.normal, gr, breite - 2 * pad);
    const minZeilen = b.wert === null && g.leereFelder === "platz" ? (b.typ === "langtext" ? 4 : 1) : 1;
    return klein * 1.3 + 0.8 * MM + Math.max(wert.length, minZeilen) * gr * 1.35 + 2 * pad + 2 * MM;
  }

  felder(bloecke: Block[]) {
    const g = this.g;
    let i = 0;
    while (i < bloecke.length) {
      const b = bloecke[i];
      if (b.art === "ueberschrift") {
        this.abschnitt(b.text);
        i++;
        continue;
      }
      const naechster = bloecke[i + 1];
      const paar = g.feldstil !== "liste" && !b.lang && naechster?.art === "feld" && !naechster.lang ? naechster : null;
      if (g.feldstil === "liste") {
        this.listenZeile(b);
        i++;
      } else if (g.feldstil === "kaesten") {
        const gap = 4 * MM;
        const halb = (this.breite - gap) / 2;
        if (paar) {
          const h = Math.max(this.kastenHoehe(b, halb), this.kastenHoehe(paar, halb));
          this.platz(h);
          this.kasten(b, this.spiegel.x0, this.spiegel.x0 + halb, this.y);
          this.kasten(paar, this.spiegel.x0 + halb + gap, this.spiegel.x1, this.y);
          this.y -= h;
          i += 2;
        } else {
          const h = this.kastenHoehe(b, this.breite);
          if (h > this.spiegel.oben - INHALT_UNTEN) {
            // Laenger als eine Seite: als Liste weiter, statt aus der Seite zu laufen.
            this.listenZeile(b);
          } else {
            this.platz(h);
            this.kasten(b, this.spiegel.x0, this.spiegel.x1, this.y);
            this.y -= h;
          }
          i++;
        }
      } else {
        // kompakt: kurze Felder zu zweit nebeneinander, lange ueber die ganze Breite.
        if (paar) {
          const gap = 6 * MM;
          const halb = (this.breite - gap) / 2;
          const start = this.y;
          const seiteVorher = this.seiten.length;
          this.listenZeile(b, this.spiegel.x0, this.spiegel.x0 + halb);
          const nachLinks = this.y;
          if (this.seiten.length !== seiteVorher) {
            this.listenZeile(paar);
          } else {
            this.y = start;
            this.listenZeile(paar, this.spiegel.x0 + halb + gap, this.spiegel.x1);
            this.y = Math.min(this.y, nachLinks);
          }
          i += 2;
        } else {
          this.listenZeile(b);
          i++;
        }
      }
    }
  }
}

// --- Seitenrahmen -----------------------------------------------------------

type Logo = { art: "bild"; bild: PDFImage } | { art: "seite"; seite: PDFEmbeddedPage };

function logoGroesse(logo: Logo, hoeheMm: number): { b: number; h: number } {
  const h = hoeheMm * MM;
  const quelle = logo.art === "bild" ? logo.bild : logo.seite;
  return { b: (quelle.width / quelle.height) * h, h };
}

function logoZeichnen(seite: PDFPage, logo: Logo, x: number, yOben: number, hoeheMm: number) {
  const { b, h } = logoGroesse(logo, hoeheMm);
  if (logo.art === "bild") seite.drawImage(logo.bild, { x, y: yOben - h, width: b, height: h });
  else seite.drawPage(logo.seite, { x, y: yOben - h, width: b, height: h });
}

/**
 * Kopfgruppe [Logo | Strich | Text] an der gewaehlten Position. Liefert die
 * Unterkante, damit der Inhalt darunter beginnen kann.
 */
function kopfGruppe(
  s: Setzer,
  logo: Logo | null,
  hoeheMm: number,
  textZeilen: { text: string; fett: boolean }[],
  yOben: number,
  links: number,
  rechts: number
): number {
  const g = s.g;
  const gr = hoeheMm >= 11 ? 10 : 8.5;
  const lh = gr * 1.2;
  const logoM = logo ? logoGroesse(logo, hoeheMm) : { b: 0, h: 0 };
  const textB = Math.max(0, ...textZeilen.map((z) => (z.fett ? s.fett : s.normal).widthOfTextAtSize(z.text, gr)));
  const mitText = textZeilen.length > 0;
  const strich = g.trennstrich && logo && mitText;
  const abstand = mitText && logo ? (strich ? 6 * MM : 3 * MM) : 0;
  const gesamt = logoM.b + abstand + textB;
  const x = g.logoPosition === "rechts" ? rechts - gesamt : g.logoPosition === "mitte" ? (SEITE_B - gesamt) / 2 : links;
  const hoehe = Math.max(logoM.h, textZeilen.length * lh);
  if (logo) logoZeichnen(s.seite, logo, x, yOben, hoeheMm);
  if (strich) {
    const sx = x + logoM.b + 3 * MM;
    s.seite.drawLine({ start: { x: sx, y: yOben - logoM.h * 0.08 }, end: { x: sx, y: yOben - logoM.h * 0.92 }, thickness: 0.8, color: SCHWARZ });
  }
  const tx = x + logoM.b + abstand;
  const tOben = yOben - (hoehe - textZeilen.length * lh) / 2;
  textZeilen.forEach((z, i) => {
    s.seite.drawText(z.text, { x: tx, y: tOben - (i + 1) * lh + gr * 0.25, size: gr, font: z.fett ? s.fett : s.normal, color: SCHWARZ });
  });
  return yOben - hoehe;
}

function blockRechts(s: Setzer, zeilen: { text: string; fett: boolean }[], yOben: number, rechts: number, groesse: number): number {
  let y = yOben;
  for (const z of zeilen) {
    y -= groesse * 1.35;
    if (!z.text) continue;
    const font = z.fett ? s.fett : s.normal;
    s.seite.drawText(z.text, { x: rechts - font.widthOfTextAtSize(z.text, groesse), y: y + groesse * 0.25, size: groesse, font, color: GRAU });
  }
  return y;
}

// --- Einstieg ---------------------------------------------------------------

export async function pdfExportRendern(e: PdfRenderEingabe): Promise<Uint8Array> {
  const g = e.gestaltung;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [n, f] = SCHRIFT_DATEIEN[g.schrift];
  const normal = await doc.embedFont(schriftDatei(n), { subset: true });
  const fett = await doc.embedFont(schriftDatei(f), { subset: true });

  let logo: Logo | null = null;
  if (e.logo) {
    if (e.logo.mime === "image/png") logo = { art: "bild", bild: await doc.embedPng(e.logo.inhalt) };
    else if (e.logo.mime === "image/jpeg") logo = { art: "bild", bild: await doc.embedJpg(e.logo.inhalt) };
    else if (e.logo.mime === "application/pdf") {
      const [seite] = await doc.embedPdf(e.logo.inhalt, [0]);
      logo = { art: "seite", seite };
    }
  }

  const werte: Record<string, string | null> = { ...e.platzhalter, ...feldPlatzhalter(e), seite: "\u0000S", seiten: "\u0000N" };
  const zeilen = (t: string) => pdfTextZeilen(t, werte);
  const einzeilig = (t: string) => pdfTextEinzeilig(t, werte);
  const farbe = g.farbe ?? e.traegerfarbe;
  const brief = g.vorlage === "brief";
  const mitInfospalte = brief && g.infospalte.trim() !== "";

  const rahmen = (s: Setzer, nr: number): Satzspiegel => {
    const yOben = SEITE_H - (brief ? 10 : 12) * MM;
    const hoehe = nr === 1 ? g.logoHoehe : g.folgeseitenLogoHoehe;
    const neben = zeilen(g.textNebenLogo);
    const rechtsKante = brief ? SEITE_B - 10 * MM : SEITE_B - RAND_R;
    const unterKopf = kopfGruppe(s, logo, hoehe, neben, yOben, RAND_L, rechtsKante);
    let unten = unterKopf;
    if (!brief && g.textRechts.trim() && g.logoPosition !== "rechts") {
      unten = Math.min(unten, blockRechts(s, zeilen(g.textRechts), yOben + 1, SEITE_B - RAND_R, 7.5));
    }
    if (brief && nr === 1) {
      const x1 = mitInfospalte ? 148 * MM : SEITE_B - RAND_R;
      if (mitInfospalte) {
        const gr = Math.max(7.5, g.groesseFuss);
        let y = SEITE_H - 50 * MM;
        const breite = 46 * MM;
        for (const z of zeilen(g.infospalte)) {
          if (!z.text) {
            y -= gr * 0.7;
            continue;
          }
          for (const t of umbrechen(z.text, z.fett ? fett : normal, gr, breite)) {
            y -= gr * 1.3;
            s.seite.drawText(t, { x: 154 * MM, y: y + gr * 0.25, size: gr, font: z.fett ? fett : normal, color: SCHWARZ });
          }
        }
      }
      if (g.ruecksendezeile.trim()) {
        const t = kuerzen(einzeilig(g.ruecksendezeile), normal, 7, 85 * MM);
        const y = SEITE_H - 49 * MM;
        s.seite.drawText(t, { x: RAND_L, y, size: 7, font: normal, color: SCHWARZ });
        s.seite.drawLine({ start: { x: RAND_L, y: y - 1.2 }, end: { x: RAND_L + normal.widthOfTextAtSize(t, 7), y: y - 1.2 }, thickness: 0.4, color: SCHWARZ });
      }
      if (g.anschriftfeld && e.empfaenger) {
        let y = SEITE_H - 52 * MM;
        for (const t of saeubern(e.empfaenger).split("\n").slice(0, 6)) {
          y -= 10 * 1.35;
          s.seite.drawText(kuerzen(t, normal, 10, 85 * MM), { x: RAND_L, y: y + 2.5, size: 10, font: normal, color: SCHWARZ });
        }
      }
      let y = SEITE_H - 97 * MM;
      if (g.datumszeile.trim()) {
        const t = einzeilig(g.datumszeile);
        if (t) s.seite.drawText(t, { x: x1 - normal.widthOfTextAtSize(t, g.groesseText), y, size: g.groesseText, font: normal, color: SCHWARZ });
      }
      y -= 5 * MM;
      return { x0: RAND_L, x1, oben: Math.min(y, unten - 6 * MM) };
    }
    return { x0: RAND_L, x1: SEITE_B - RAND_R, oben: unten - (nr === 1 ? 7 : 6) * MM };
  };

  const s = new Setzer(doc, g, normal, fett, farbe, rahmen);
  s.neueSeite();

  // Titel bzw. Betreff
  const titel = einzeilig(g.titel);
  const unterTitel = einzeilig(g.unterTitel);
  if (brief) {
    if (titel) s.absatz(titel, { font: fett, groesse: g.groesseText + 0.5, abstandDanach: 0 });
    if (unterTitel) s.absatz(unterTitel, { abstandDanach: 0 });
    s.y -= g.groesseText * 1.4;
  } else {
    if (titel) s.absatz(titel, { font: fett, groesse: g.groesseUeberschrift + 4, abstandDanach: 1 });
    if (unterTitel) s.text(umbrechen(unterTitel, normal, g.groesseText - 1, s.breite), { groesse: g.groesseText - 1, farbe: GRAU });
    s.y -= 2.5 * MM;
    s.seite.drawRectangle({ x: s.spiegel.x0, y: s.y - 0.6 * MM, width: s.breite, height: 0.6 * MM, color: s.linie });
    s.y -= 3 * MM;
  }
  if (g.anrede.trim()) s.absatz(einzeilig(g.anrede));
  if (g.einleitung.trim()) for (const z of zeilen(g.einleitung)) z.text ? s.absatz(z.text, { font: z.fett ? fett : normal }) : (s.y -= g.groesseText * 0.6);

  s.felder(pdfBloecke(e));

  if (g.gruss.trim()) {
    s.y -= g.groesseText * 1.6;
    s.absatz(einzeilig(g.gruss), { abstandDanach: 0 });
  }
  const name = e.platzhalter["benutzer.name"] ?? "";
  if (g.unterschrift === "linie") {
    s.platz(20 * MM);
    s.y -= 14 * MM;
    s.seite.drawLine({ start: { x: s.spiegel.x0, y: s.y }, end: { x: s.spiegel.x0 + 65 * MM, y: s.y }, thickness: 0.5, color: SCHWARZ });
    s.text([name ? `${name}, ${e.platzhalter.datum ?? ""}` : "Datum, Unterschrift"], { groesse: Math.max(g.groesseText - 1.5, 7), farbe: GRAU });
  } else if (g.unterschrift === "name" && name) {
    s.platz(14 * MM);
    s.y -= 9 * MM;
    s.text([name], { font: fett });
  }

  // Zweiter Durchgang: Fusszeile mit Seitenzahlen.
  const gesamt = s.seiten.length;
  s.seiten.forEach((seite, i) => {
    const fill = (t: string) => einzeilig(t).replace("\u0000S", String(i + 1)).replace("\u0000N", String(gesamt));
    const gr = g.groesseFuss;
    const links = fill(g.fusszeileLinks);
    const rechts = fill(g.fusszeileRechts);
    const x1 = SEITE_B - RAND_R;
    if (links || rechts) {
      seite.drawLine({ start: { x: RAND_L, y: FUSS_Y + gr * 1.6 }, end: { x: x1, y: FUSS_Y + gr * 1.6 }, thickness: 0.4, color: LINIE });
    }
    const rB = rechts ? normal.widthOfTextAtSize(rechts, gr) : 0;
    if (links) seite.drawText(kuerzen(links, normal, gr, x1 - RAND_L - rB - 6 * MM), { x: RAND_L, y: FUSS_Y, size: gr, font: normal, color: GRAU });
    if (rechts) seite.drawText(rechts, { x: x1 - rB, y: FUSS_Y, size: gr, font: normal, color: GRAU });
    if (e.beispiel) {
      const t = "Vorschau mit Beispieldaten · nicht zur Weitergabe";
      seite.drawText(t, { x: (SEITE_B - normal.widthOfTextAtSize(t, 7)) / 2, y: FUSS_Y - 9, size: 7, font: normal, color: rgb(0.6, 0.6, 0.6) });
    }
  });

  doc.setTitle(titel || e.formular.name);
  doc.setCreator("Zimmerakte");
  doc.setProducer("Zimmerakte");
  return doc.save();
}
