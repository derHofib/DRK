import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFImage, PDFPage, rgb, type RGB } from "pdf-lib";
import {
  ausrichtungVon,
  druckUeberschriftFarbe,
  PDF_FREI_MIN_PT,
  PDF_FREI_SEITE,
  pdfTextEinzeilig,
  pdfTextZeilen,
  werteAus,
  type Baustein,
  type BausteinAusrichtung,
  type FeldWert,
  type FeldWerte,
  type FormularDefinition,
  type PdfFreiBaustein,
  type PdfFreiSeitenart,
  type PdfFreiTextfarbe,
  type PdfGestaltung,
  type PdfSchrift,
  type PdfZielgruppe,
  type UnterschriftPlatz,
  platzBeschriftung,
  unterschriftZeilen,
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
  /**
   * Stand der Unterschriftsplaetze, Schluessel "<baustein>:<platz>"
   * (Migration 0086). Fehlt ein Platz, bleibt nur die Rolle unter der Linie.
   */
  unterschriften?: Record<string, PdfUnterschriftStand>;
}

export interface PdfUnterschriftStand {
  /** Vorgesehener bzw. unterschreibender Name. */
  name: string | null;
  /** Nur geleistet: */
  bild: Buffer | null;
  ort: string | null;
  datum: string | null;
  pruefnummer: string | null;
}

// --- Inhalt vorbereiten ---------------------------------------------------

type Block =
  | { art: "ueberschrift"; text: string; ausrichtung: BausteinAusrichtung }
  | {
      art: "feld";
      schluessel: string;
      label: string;
      wert: string | null;
      lang: boolean;
      jaNein: boolean | null;
      typ: Baustein["typ"];
      ausrichtung: BausteinAusrichtung;
    }
  // ausrichtung nur der Einheitlichkeit halber: die Plaetze stehen im Raster
  // (unterschriftZeilen), eine Ausrichtung des ganzen Blocks waere dort sinnlos.
  | { art: "unterschriften"; schluessel: string; label: string; spalten: number; plaetze: UnterschriftPlatz[]; ausrichtung: BausteinAusrichtung };

/** x einer Zeile der Breite w zwischen x0 und x1. */
function ausgerichtetX(ausrichtung: BausteinAusrichtung, x0: number, x1: number, w: number): number {
  if (ausrichtung === "rechts") return x1 - w;
  if (ausrichtung === "mitte") return x0 + (x1 - x0 - w) / 2;
  return x0;
}

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
        if (kinder.length > 0) out.push({ art: "ueberschrift", text: b.beschriftung, ausrichtung: ausrichtungVon(b) }, ...kinder);
        continue;
      }
      if (b.typ === "hinweis") continue;
      if (b.typ === "unterschriften") {
        // Auch in externen Exporten: die Unterschriften sind der Zweck des
        // Dokuments. Abwaehlbar wie ein Feld ueber die Feldauswahl.
        if (auswahl && !auswahl.has(b.schluessel)) continue;
        if (!Array.isArray(b.plaetze) || b.plaetze.length === 0) continue;
        out.push({ art: "unterschriften", schluessel: b.schluessel, label: b.beschriftung, spalten: b.spalten, plaetze: b.plaetze, ausrichtung: "links" });
        continue;
      }
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
      out.push({ art: "feld", schluessel: b.schluessel, label: b.beschriftung, wert, lang, jaNein, typ: b.typ, ausrichtung: ausrichtungVon(b) });
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
  /** Unterkante; fehlt sie, gilt der feste Fussbereich der Grundformen. */
  unten?: number;
}

class Setzer {
  seiten: PDFPage[] = [];
  seite!: PDFPage;
  y = 0;
  spiegel!: Satzspiegel;
  readonly linie: RGB;
  readonly ueberschrift: RGB;

  /** Unterschriftsplaetze "<baustein>:<platz>" mit Stand und Bild -- vorab eingebettet, denn embedPng ist async, der Setzer nicht. */
  unterschriftDaten: Map<string, PlatzDaten> = new Map();

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

  get unten() {
    return this.spiegel.unten ?? INHALT_UNTEN;
  }

  platz(hoehe: number): void {
    if (this.y - hoehe < this.unten) this.neueSeite();
  }

  text(
    zeilen: string[],
    opt: { x?: number; x1?: number; ausrichtung?: BausteinAusrichtung; groesse?: number; font?: PDFFont; farbe?: RGB; zeilenabstand?: number; rechts?: number }
  ) {
    const groesse = opt.groesse ?? this.g.groesseText;
    const lh = groesse * (opt.zeilenabstand ?? 1.35);
    for (const z of zeilen) {
      this.platz(lh);
      this.y -= lh;
      const font = opt.font ?? this.normal;
      const w = font.widthOfTextAtSize(z, groesse);
      // Grenzen erst nach platz() lesen: ein Seitenwechsel kann den Satzspiegel aendern.
      const x =
        opt.rechts !== undefined
          ? opt.rechts - w
          : ausgerichtetX(opt.ausrichtung ?? "links", opt.x ?? this.spiegel.x0, opt.x1 ?? this.spiegel.x1, w);
      this.seite.drawText(z, { x, y: this.y + groesse * 0.25, size: groesse, font, color: opt.farbe ?? SCHWARZ });
    }
  }

  absatz(text: string, opt: { groesse?: number; font?: PDFFont; abstandDanach?: number } = {}) {
    const groesse = opt.groesse ?? this.g.groesseText;
    this.text(umbrechen(text, opt.font ?? this.normal, groesse, this.breite), opt);
    this.y -= opt.abstandDanach ?? groesse * 0.6;
  }

  abschnitt(text: string, ausrichtung: BausteinAusrichtung = "links") {
    const g = this.g;
    const groesse = g.ueberschriften === "farbig" ? Math.max(g.groesseText - 1, 7.5) : g.groesseText + 1;
    const vor = g.groesseText * 1.1;
    // Ueberschrift nie allein am Seitenende.
    this.platz(vor + groesse * 1.4 + g.groesseText * 2.6);
    this.y -= vor;
    const t = g.ueberschriften === "farbig" ? text.toLocaleUpperCase("de-DE") : text;
    const balken = g.ueberschriften === "balken" ? 2.6 * MM : 0;
    const x = this.spiegel.x0 + balken;
    const zeilen = umbrechen(t, this.fett, groesse, this.spiegel.x1 - x);
    if (balken) {
      // Der Balken gehoert zur Ueberschrift, nicht an den Seitenrand: mittig/rechts steht er direkt vor der ersten Zeile.
      const erste = ausgerichtetX(ausrichtung, x, this.spiegel.x1, this.fett.widthOfTextAtSize(zeilen[0] ?? "", groesse));
      this.seite.drawRectangle({ x: erste - balken, y: this.y - groesse * 1.15, width: 1.2 * MM, height: groesse * 1.15, color: this.linie });
    }
    this.text(zeilen, { x, ausrichtung, groesse, font: this.fett, farbe: g.ueberschriften === "farbig" ? this.ueberschrift : SCHWARZ, zeilenabstand: 1.3 });
    this.y -= groesse * 0.35;
  }

  /** Breite der Ja/Nein-Ankreuzfelder, damit sie sich mittig/rechts ausrichten lassen. */
  kreuzeBreite(groesse: number): number {
    const k = groesse * 0.8;
    return k + 3 + this.normal.widthOfTextAtSize("Ja", groesse) + 10 + k + 3 + this.normal.widthOfTextAtSize("Nein", groesse);
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
      if (this.y - lh < this.unten) {
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
    const a = b.ausrichtung;
    let y = oben - klein * 1.3;
    this.seite.drawText(label, { x: ausgerichtetX(a, x0, x1, this.normal.widthOfTextAtSize(label, klein)), y: y + klein * 0.25, size: klein, font: this.normal, color: GRAU });
    const boxH = zeilen * gr * 1.35 + 2 * pad;
    y -= 0.8 * MM;
    this.seite.drawRectangle({ x: x0, y: y - boxH, width: x1 - x0, height: boxH, borderColor: RAHMEN, borderWidth: 0.6 });
    let yt = y - pad;
    if (kreuz) this.kreuze(ausgerichtetX(a, x0 + pad, x1 - pad, this.kreuzeBreite(gr)), yt - gr * 1.1, b.jaNein, gr);
    for (const z of wert) {
      yt -= gr * 1.35;
      if (z) this.seite.drawText(z, { x: ausgerichtetX(a, x0 + pad, x1 - pad, this.normal.widthOfTextAtSize(z, gr)), y: yt + gr * 0.3, size: gr, font: this.normal, color: SCHWARZ });
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

  /**
   * Unterschriften im Fluss: Zeilen wie im Formular angeordnet. Eine Zeile
   * wird nie ueber einen Seitenwechsel geteilt, und der ganze Block bleibt
   * zusammen, solange er auf eine Seite passt -- eine Unterschrift allein
   * oben auf der naechsten Seite, getrennt vom Inhalt, waere wertlos.
   */
  unterschriften(b: Extract<Block, { art: "unterschriften" }>) {
    const g = this.g;
    const gap = 8 * MM;
    const zeilen = unterschriftZeilen(b.plaetze, b.spalten);
    const spalten = Math.max(1, Math.min(4, b.spalten));
    const breite = (this.breite - (spalten - 1) * gap) / spalten;
    // Untereinander nicht ueber die volle Breite: eine 17 cm lange Linie sieht nach Formularfehler aus.
    const platzB = spalten === 1 ? Math.min(this.breite, 85 * MM) : breite;
    const daten = (p: UnterschriftPlatz) => this.unterschriftDaten.get(`${b.schluessel}:${p.id}`);
    const hoehen = zeilen.map((z) => Math.max(...z.map((p) => platzHoehe(this, p, daten(p)))) + 5 * MM);
    const titelH = b.label.trim() ? g.groesseText * 4 : 0;
    const gesamt = titelH + hoehen.reduce((a, h) => a + h, 0);
    if (gesamt <= this.spiegel.oben - this.unten) this.platz(gesamt);
    if (b.label.trim()) this.abschnitt(b.label);
    else this.y -= 3 * MM;
    zeilen.forEach((z, i) => {
      this.platz(hoehen[i]);
      z.forEach((p, j) => {
        const x0 = this.spiegel.x0 + j * (breite + gap);
        // Gleiche Linienhoehe fuer die ganze Zeile, auch wenn ein Platz mehr Textzeilen hat.
        platzZeichnen(this, this.seite, p, daten(p), x0, x0 + platzB, this.y, SIGNATUR_H, g.groesseText);
      });
      this.y -= hoehen[i];
    });
  }

  /**
   * Stil "liste"/"kompakt" fuer ein mittig oder rechts ausgerichtetes Feld:
   * Beschriftung ueber dem Wert, beides ueber die volle Breite ausgerichtet.
   * Neben einer Beschriftungsspalte haette "mittig" keine erkennbare Mitte.
   */
  ausgerichteteZeile(b: Extract<Block, { art: "feld" }>) {
    const g = this.g;
    const gr = g.groesseText;
    const lh = gr * 1.35;
    const pad = 1.2 * MM;
    const label = umbrechen(b.label, this.normal, gr, this.breite);
    const kreuz = g.jaNein === "kreuz" && b.typ === "ja_nein";
    let wert = kreuz ? [] : umbrechen(this.wertText(b), this.normal, gr, this.breite);
    if (b.wert === null && g.leereFelder === "platz") wert = b.typ === "langtext" ? ["", "", ""] : [""];
    // Beschriftung nie allein am Seitenende.
    this.platz(pad + (label.length + 1) * lh + pad);
    this.y -= pad;
    this.text(label, { ausrichtung: b.ausrichtung, groesse: gr, farbe: GRAU });
    if (kreuz) {
      this.platz(lh);
      this.y -= lh;
      this.kreuze(ausgerichtetX(b.ausrichtung, this.spiegel.x0, this.spiegel.x1, this.kreuzeBreite(gr)), this.y + gr * 0.25 - 0.5, b.jaNein, gr);
    } else {
      this.text(wert, { ausrichtung: b.ausrichtung, groesse: gr });
    }
    this.y -= pad;
    this.seite.drawLine({ start: { x: this.spiegel.x0, y: this.y }, end: { x: this.spiegel.x1, y: this.y }, thickness: 0.4, color: LINIE });
  }

  felder(bloecke: Block[]) {
    const g = this.g;
    let i = 0;
    while (i < bloecke.length) {
      const b = bloecke[i];
      if (b.art === "ueberschrift") {
        this.abschnitt(b.text, b.ausrichtung);
        i++;
        continue;
      }
      if (b.art === "unterschriften") {
        this.unterschriften(b);
        i++;
        continue;
      }
      if (b.ausrichtung !== "links" && g.feldstil !== "kaesten") {
        this.ausgerichteteZeile(b);
        i++;
        continue;
      }
      const naechster = bloecke[i + 1];
      // Ausgerichtete Felder stehen allein in ihrer Zeile -- auch im Kastenstil.
      const paar =
        g.feldstil !== "liste" && !b.lang && b.ausrichtung === "links" && naechster?.art === "feld" && !naechster.lang && naechster.ausrichtung === "links"
          ? naechster
          : null;
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
          if (h > this.spiegel.oben - this.unten) {
            // Laenger als eine Seite: als Liste weiter, statt aus der Seite zu laufen.
            if (b.ausrichtung === "links") this.listenZeile(b);
            else this.ausgerichteteZeile(b);
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

// --- Unterschriften ---------------------------------------------------------

interface PlatzDaten {
  stand: PdfUnterschriftStand | null;
  bild: PDFImage | null;
}

const SIGNATUR_H = 14 * MM;

function platzTextZeilen(p: UnterschriftPlatz, d: PlatzDaten | undefined): { teile: { text: string; fett: boolean }[] }[] {
  const stand = d?.stand ?? null;
  const rolle = platzBeschriftung(p);
  const name = p.ohneName ? null : stand?.name ?? null;
  const zeilen: { teile: { text: string; fett: boolean }[] }[] = [];
  zeilen.push({ teile: name ? [{ text: name, fett: true }, { text: `, ${rolle}`, fett: false }] : [{ text: rolle, fett: false }] });
  if (stand?.bild) {
    const wo = [stand.ort, stand.datum].filter(Boolean).join(", ");
    if (!p.ohneOrtDatum && wo) zeilen.push({ teile: [{ text: wo, fett: false }] });
    if (stand.pruefnummer) zeilen.push({ teile: [{ text: `elektronisch unterschrieben · Prüfnr. ${stand.pruefnummer}`, fett: false }] });
  } else if (!p.ohneOrtDatum) {
    zeilen.push({ teile: [{ text: "Ort, Datum ____________________", fett: false }] });
  }
  return zeilen;
}

function platzHoehe(s: Setzer, p: UnterschriftPlatz, d: PlatzDaten | undefined): number {
  const klein = Math.max(s.g.groesseText - 1.5, 7);
  return SIGNATUR_H + platzTextZeilen(p, d).length * klein * 1.3 + 1.5 * MM;
}

/**
 * Ein Platz: Unterschriftsbild (falls in der App geleistet) auf der Linie,
 * darunter Name und Rolle, dann Ort/Datum bzw. die Leerzeile fuer Papier.
 * yOben und signaturH in PDF-Punkten; die Linie liegt signaturH unter yOben.
 */
function platzZeichnen(
  s: { normal: PDFFont; fett: PDFFont },
  seite: PDFPage,
  p: UnterschriftPlatz,
  d: PlatzDaten | undefined,
  x0: number,
  x1: number,
  yOben: number,
  signaturH: number,
  pt: number
) {
  const klein = Math.max(pt - 1.5, 7);
  const zeilen = platzTextZeilen(p, d);
  const yLinie = yOben - signaturH;
  if (d?.bild) {
    const verfuegbarH = yOben - yLinie - 0.5 * MM;
    const f = Math.min((x1 - x0) / d.bild.width, verfuegbarH / d.bild.height);
    seite.drawImage(d.bild, { x: x0, y: yLinie - 0.5 * MM, width: d.bild.width * f, height: d.bild.height * f });
  }
  seite.drawLine({ start: { x: x0, y: yLinie }, end: { x: x1, y: yLinie }, thickness: 0.6, color: SCHWARZ });
  let y = yLinie;
  zeilen.forEach((z, i) => {
    y -= klein * 1.3;
    let x = x0;
    for (const t of z.teile) {
      const font = t.fett ? s.fett : s.normal;
      const text = kuerzen(t.text, font, klein, Math.max(0, x1 - x));
      if (!text) break;
      seite.drawText(text, { x, y: y + klein * 0.3, size: klein, font, color: i === 0 && t.fett ? SCHWARZ : GRAU });
      x += font.widthOfTextAtSize(text, klein);
    }
  });
}

/** Bilder vorab einbetten (embedPng ist async, der Setzer nicht). */
async function unterschriftBilder(doc: PDFDocument, e: PdfRenderEingabe): Promise<Map<string, PlatzDaten>> {
  const out = new Map<string, PlatzDaten>();
  for (const [k, stand] of Object.entries(e.unterschriften ?? {})) {
    let bild: PDFImage | null = null;
    if (stand.bild) {
      try {
        bild = await doc.embedPng(stand.bild);
      } catch {
        // Ein unlesbares Bild darf das ganze PDF nicht verhindern; der Platz bleibt dann leer zum Unterschreiben.
        bild = null;
      }
    }
    out.set(k, { stand: bild ? stand : { ...stand, bild: null, ort: null, datum: null, pruefnummer: null }, bild });
  }
  return out;
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

async function dokumentVorbereiten(e: PdfRenderEingabe) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [n, f] = SCHRIFT_DATEIEN[e.gestaltung.schrift];
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
  return { doc, normal, fett, logo };
}

/** Ergebnis mit Pruefbericht: welche festen Bausteine (Grundform "frei") nicht passten. */
export interface PdfRenderBericht {
  pdf: Uint8Array;
  seiten: number;
  /** "erste:<id>" bzw. "folge:<id>" der Bausteine, deren Text in den Anhang "Fortsetzung" musste. */
  ueberlauf: string[];
}

export async function pdfExportRendern(e: PdfRenderEingabe): Promise<Uint8Array> {
  return (await pdfExportRendernMitBericht(e)).pdf;
}

export async function pdfExportRendernMitBericht(e: PdfRenderEingabe): Promise<PdfRenderBericht> {
  if (e.gestaltung.vorlage === "frei") return freiRendern(e);
  const g = e.gestaltung;
  const { doc, normal, fett, logo } = await dokumentVorbereiten(e);
  const unterschriftDaten = await unterschriftBilder(doc, e);

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
  s.unterschriftDaten = unterschriftDaten;
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
  return { pdf: await doc.save(), seiten: gesamt, ueberlauf: [] };
}

// --- Grundform "frei" -------------------------------------------------------

/**
 * Freier Designer (Konzept pdf-designer). Zwei Arten von Inhalt:
 *
 * - Feste Bausteine stehen auf den Millimeter dort, wo sie im Designer
 *   liegen. Passt ein Text nicht, wird er schrittweise bis 7 pt verkleinert;
 *   reicht das nicht, endet der Kasten mit "→ Fortsetzung" und der VOLLE Text
 *   steht im Anhang. Still abgeschnitten wird nie -- bei einem Bericht ans Amt
 *   waere ein fehlender Satz nicht erkennbar.
 * - Der Fliessbereich (hoechstens einer je Seitenart) nimmt alle Felder auf,
 *   die nicht frei platziert sind, im gewaehlten Feldstil, und bricht auf
 *   Folgeseiten um. Das ist derselbe Setzer wie bei Akte und Brief.
 *
 * Feste Bausteine werden beim Anlegen der Seite gezeichnet, also UNTER den
 * Fliesstext (eine Flaeche darf ihn nicht verdecken). Nur Texte mit {seite}
 * oder {seiten} kommen im zweiten Durchgang, wenn die Seitenzahl feststeht.
 */

const SEITE_NR = "\u0001";
const SEITEN_NR = "\u0002";
const ZEILENABSTAND = 1.2;
const MIN_FLUSS_HOEHE = 15;

type Gesetzt = { pt: number; zeilen: { text: string; fett: boolean }[]; abgeschnitten: boolean };

function messText(t: string): string {
  return t.replaceAll(SEITE_NR, "00").replaceAll(SEITEN_NR, "00");
}

/** Zeilen in eine Box setzen: kleiner werden bis 7 pt, dann kuerzen und markieren. */
function einpassen(
  quelle: { text: string; fett: boolean }[],
  fonts: { normal: PDFFont; fett: PDFFont },
  allesFett: boolean,
  startPt: number,
  breite: number,
  hoehe: number,
  /** Platz, der je Schriftgroesse vorab abgeht (Beschriftung ueber dem Wert). */
  vorab: (pt: number) => number = () => 0
): Gesetzt {
  const umbr = (pt: number) =>
    quelle.flatMap((z) => {
      if (!z.text) return [{ text: "", fett: false }];
      const font = z.fett || allesFett ? fonts.fett : fonts.normal;
      // Gemessen wird mit "00" statt der Seitenzahl, gezeichnet mit der echten.
      return umbrechen(messText(z.text), font, pt, breite).map((t, i, arr) => ({
        text: arr.length === 1 ? z.text : t,
        fett: z.fett,
      }));
    });
  for (let pt = startPt; pt >= PDF_FREI_MIN_PT; pt -= 0.5) {
    const zeilen = umbr(pt);
    if (zeilen.length * pt * ZEILENABSTAND <= hoehe - vorab(pt) + 0.01) return { pt, zeilen, abgeschnitten: false };
  }
  const pt = PDF_FREI_MIN_PT;
  const passen = Math.max(1, Math.floor((hoehe - vorab(pt) + 0.01) / (pt * ZEILENABSTAND)));
  const zeilen = umbr(pt).slice(0, passen);
  const letzte = zeilen[zeilen.length - 1];
  const font = letzte.fett || allesFett ? fonts.fett : fonts.normal;
  zeilen[zeilen.length - 1] = { text: kuerzenMitHinweis(letzte.text, font, pt, breite), fett: letzte.fett };
  return { pt, zeilen, abgeschnitten: true };
}

function kuerzenMitHinweis(text: string, font: PDFFont, groesse: number, breite: number): string {
  const hinweis = " … → Fortsetzung";
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}${hinweis}`, groesse) > breite) t = t.slice(0, -1);
  return `${t.trimEnd()}${hinweis}`;
}

async function freiRendern(e: PdfRenderEingabe): Promise<PdfRenderBericht> {
  const g = e.gestaltung;
  const frei = g.frei;
  const { doc, normal, fett, logo } = await dokumentVorbereiten(e);
  const unterschriftDaten = await unterschriftBilder(doc, e);
  const fonts = { normal, fett };
  const werte: Record<string, string | null> = { ...e.platzhalter, ...feldPlatzhalter(e), seite: SEITE_NR, seiten: SEITEN_NR };
  const farbe = g.farbe ?? e.traegerfarbe;
  const akzentLinie = hexRgb(farbe);
  const akzentText = hexRgb(druckUeberschriftFarbe(farbe));
  const akzentHell = rgb(1 - (1 - akzentLinie.red) * 0.14, 1 - (1 - akzentLinie.green) * 0.14, 1 - (1 - akzentLinie.blue) * 0.14);
  const textFarbe = (f: PdfFreiTextfarbe): RGB => (f === "akzent" ? akzentText : f === "grau" ? GRAU : SCHWARZ);
  const linienFarbe = (f: PdfFreiTextfarbe): RGB => (f === "akzent" ? akzentLinie : f === "grau" ? GRAU : SCHWARZ);

  // Feldwerte mit derselben Intern-Sperre wie ueberall: ein internes Feld in
  // einem externen Export fehlt hier und wird damit auch als Baustein nie gezeichnet.
  const alleFelder = new Map<string, Extract<Block, { art: "feld" }>>();
  for (const b of pdfBloecke({ ...e, gestaltung: { ...g, felder: "alle", leereFelder: "platz" } })) {
    if (b.art === "feld") alleFelder.set(b.schluessel, b);
  }
  const platziert = new Set(
    [...frei.erste, ...frei.folge].filter((x) => x.art === "feld" || x.art === "ankreuz").map((x) => x.feld)
  );
  // Unterschriftsplaetze, die einzeln aufs Blatt gesetzt sind, fehlen im
  // Fliessbereich; die uebrigen laufen dort mit -- so geht keiner verloren.
  const alleUnterschriften = new Map<string, Extract<Block, { art: "unterschriften" }>>();
  for (const b of pdfBloecke({ ...e, gestaltung: { ...g, felder: "alle" } })) if (b.art === "unterschriften") alleUnterschriften.set(b.schluessel, b);
  const gesetztePlaetze = new Set(
    [...frei.erste, ...frei.folge].filter((x) => x.art === "unterschrift" && x.platz).map((x) => `${x.feld}:${x.platz}`)
  );
  const flussRoh = pdfBloecke(e)
    .map((b) => (b.art === "unterschriften" ? { ...b, plaetze: b.plaetze.filter((p) => !gesetztePlaetze.has(`${b.schluessel}:${p.id}`)) } : b))
    .filter((b) => (b.art !== "feld" || !platziert.has(b.schluessel)) && (b.art !== "unterschriften" || b.plaetze.length > 0));
  // Abschnittsueberschrift ohne Feld danach entfaellt (alle Felder des Abschnitts sind frei platziert).
  const fluss = flussRoh.filter((b, i) => b.art !== "ueberschrift" || flussRoh[i + 1]?.art === "feld" || flussRoh[i + 1]?.art === "unterschriften");

  const anhang: { label: string; text: string }[] = [];
  const ueberlauf: string[] = [];
  const nachgereicht: { seite: PDFPage; zeichnen: (seite: string, seiten: string) => void }[] = [];

  const wertText = (b: Extract<Block, { art: "feld" }>) => (b.wert === null ? (g.leereFelder === "strich" ? "–" : "") : b.wert);

  /** Text zeilenweise in eine Box zeichnen (Koordinaten in pt, y = Oberkante). */
  const zeilenZeichnen = (
    seite: PDFPage,
    gs: Gesetzt,
    el: PdfFreiBaustein,
    x0: number,
    x1: number,
    yOben: number,
    farbeRgb: RGB,
    ersetzen?: (t: string) => string
  ) => {
    let y = yOben;
    for (const z of gs.zeilen) {
      y -= gs.pt * ZEILENABSTAND;
      if (!z.text) continue;
      const t = ersetzen ? ersetzen(z.text) : z.text;
      const font = z.fett || el.fett ? fett : normal;
      const w = font.widthOfTextAtSize(t, gs.pt);
      const x = el.ausrichtung === "rechts" ? x1 - w : el.ausrichtung === "mitte" ? (x0 + x1 - w) / 2 : x0;
      seite.drawText(t, { x, y: y + gs.pt * 0.27, size: gs.pt, font, color: farbeRgb });
    }
  };

  const kreuzeZeichnen = (seite: PDFPage, x: number, yGrund: number, wert: boolean | null, groesse: number) => {
    const k = groesse * 0.8;
    let cx = x;
    for (const [label, an] of [["Ja", wert === true], ["Nein", wert === false]] as const) {
      seite.drawRectangle({ x: cx, y: yGrund, width: k, height: k, borderColor: SCHWARZ, borderWidth: 0.6 });
      if (an) {
        seite.drawLine({ start: { x: cx + 1, y: yGrund + 1 }, end: { x: cx + k - 1, y: yGrund + k - 1 }, thickness: 0.8, color: SCHWARZ });
        seite.drawLine({ start: { x: cx + 1, y: yGrund + k - 1 }, end: { x: cx + k - 1, y: yGrund + 1 }, thickness: 0.8, color: SCHWARZ });
      }
      seite.drawText(label, { x: cx + k + 3, y: yGrund + 0.5, size: groesse, font: normal, color: SCHWARZ });
      cx += k + 3 + normal.widthOfTextAtSize(label, groesse) + 10;
    }
  };

  // Ueberlauf je Baustein nur einmal melden, auch wenn er auf jeder Folgeseite steht.
  const gemeldet = new Set<string>();
  const melden = (art: PdfFreiSeitenart, el: PdfFreiBaustein, label: string, text: string) => {
    const k = `${art}:${el.id}`;
    if (gemeldet.has(k)) return;
    gemeldet.add(k);
    ueberlauf.push(k);
    anhang.push({ label, text });
  };

  const bausteinZeichnen = (seite: PDFPage, art: PdfFreiSeitenart, el: PdfFreiBaustein) => {
    const x0 = el.x * MM;
    const x1 = (el.x + el.b) * MM;
    const yOben = SEITE_H - el.y * MM;
    const yUnten = SEITE_H - (el.y + el.h) * MM;
    const b = x1 - x0;
    const h = yOben - yUnten;
    const pad = el.rahmen === "kasten" ? 1.2 * MM : 0;

    switch (el.art) {
      case "fluss":
        return;
      case "flaeche":
        seite.drawRectangle({
          x: x0,
          y: yUnten,
          width: b,
          height: h,
          color: el.flaeche === "akzent" ? akzentLinie : el.flaeche === "akzent-hell" ? akzentHell : rgb(0.94, 0.94, 0.94),
        });
        return;
      case "linie":
        if (el.b >= el.h) {
          const y = (yOben + yUnten) / 2;
          seite.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: el.staerke, color: linienFarbe(el.farbe) });
        } else {
          const x = (x0 + x1) / 2;
          seite.drawLine({ start: { x, y: yOben }, end: { x, y: yUnten }, thickness: el.staerke, color: linienFarbe(el.farbe) });
        }
        return;
      case "logo": {
        if (!logo) return;
        const q = logo.art === "bild" ? logo.bild : logo.seite;
        const faktor = Math.min(b / q.width, h / q.height);
        const lb = q.width * faktor;
        const lh = q.height * faktor;
        const x = el.ausrichtung === "rechts" ? x1 - lb : el.ausrichtung === "mitte" ? x0 + (b - lb) / 2 : x0;
        if (logo.art === "bild") seite.drawImage(logo.bild, { x, y: yOben - lh, width: lb, height: lh });
        else seite.drawPage(logo.seite, { x, y: yOben - lh, width: lb, height: lh });
        return;
      }
    }

    if (el.rahmen === "kasten") seite.drawRectangle({ x: x0, y: yUnten, width: b, height: h, borderColor: RAHMEN, borderWidth: el.staerke });
    if (el.rahmen === "unten") seite.drawLine({ start: { x: x0, y: yUnten }, end: { x: x1, y: yUnten }, thickness: el.staerke, color: LINIE });
    const ix0 = x0 + pad;
    const ix1 = x1 - pad;
    const iOben = yOben - pad;
    const iH = h - 2 * pad;

    if (el.art === "text") {
      const quelle = pdfTextZeilen(el.text, werte);
      if (quelle.length === 0) return;
      const mitSeite = el.text.includes("{seite}") || el.text.includes("{seiten}");
      const gs = einpassen(quelle, fonts, el.fett, el.pt, ix1 - ix0, iH);
      if (gs.abgeschnitten) melden(art, el, "Text", quelle.map((z) => z.text).join("\n"));
      if (mitSeite) {
        nachgereicht.push({
          seite,
          zeichnen: (s1, s2) => zeilenZeichnen(seite, gs, el, ix0, ix1, iOben, textFarbe(el.farbe), (t) => t.replaceAll(SEITE_NR, s1).replaceAll(SEITEN_NR, s2)),
        });
      } else {
        zeilenZeichnen(seite, gs, el, ix0, ix1, iOben, textFarbe(el.farbe));
      }
      return;
    }

    if (el.art === "anschrift") {
      if (!e.empfaenger) return;
      const quelle = saeubern(e.empfaenger)
        .split("\n")
        .slice(0, 6)
        .map((t) => ({ text: t, fett: false }));
      const gs = einpassen(quelle, fonts, el.fett, el.pt, ix1 - ix0, iH);
      if (gs.abgeschnitten) melden(art, el, "Anschrift", e.empfaenger);
      zeilenZeichnen(seite, gs, el, ix0, ix1, iOben, SCHWARZ);
      return;
    }

    if (el.art === "unterschrift" && el.platz) {
      const block = alleUnterschriften.get(el.feld);
      const platz = block?.plaetze.find((p) => p.id === el.platz);
      if (!platz) return;
      const d = unterschriftDaten.get(`${el.feld}:${el.platz}`);
      const klein = Math.max(el.pt, 7);
      const textH = platzTextZeilen(platz, d).length * klein * 1.3;
      platzZeichnen(fonts, seite, platz, d, ix0, ix1, iOben, Math.max(iH - textH, 6 * MM), el.pt + 1.5);
      return;
    }

    if (el.art === "unterschrift") {
      const name = e.platzhalter["benutzer.name"] ?? "";
      const klein = Math.max(PDF_FREI_MIN_PT, el.pt - 1.5);
      const yLinie = yUnten + klein * 1.6;
      seite.drawLine({ start: { x: ix0, y: yLinie }, end: { x: ix1, y: yLinie }, thickness: 0.5, color: SCHWARZ });
      const t = kuerzen(name ? `${name}, ${e.platzhalter.datum ?? ""}` : "Datum, Unterschrift", normal, klein, ix1 - ix0);
      seite.drawText(t, { x: ix0, y: yLinie - klein * 1.15, size: klein, font: normal, color: GRAU });
      return;
    }

    // feld und ankreuz
    const block = alleFelder.get(el.feld);
    if (!block) return;
    const kreuz = block.typ === "ja_nein" && (el.art === "ankreuz" || g.jaNein === "kreuz");
    const wert = kreuz ? "" : wertText(block);
    if (block.wert === null && g.leereFelder === "ausblenden") return;
    // Beschriftung und Wert werden GEMEINSAM verkleinert: die Beschriftung
    // ist 1,5 pt kleiner als der Wert und nimmt ihre Zeile vom Kasten weg.
    const labelPt = (pt: number) => Math.max(PDF_FREI_MIN_PT, pt - 1.5);
    const labelH = (pt: number) => (el.beschriftung === "darueber" ? labelPt(pt) * 1.25 : 0);
    let wx0 = ix0;
    if (el.beschriftung === "links") {
      const lb = (ix1 - ix0) * 0.38;
      // Eine zu lange Beschriftung wird nur gekuerzt, nicht in den Anhang gemeldet: sie steht im Formular.
      const gl = einpassen([{ text: block.label, fett: false }], fonts, false, el.pt, lb - 2, iH);
      zeilenZeichnen(seite, gl, { ...el, fett: false, ausrichtung: "links" }, ix0, ix0 + lb, iOben, GRAU);
      wx0 = ix0 + lb + 2 * MM;
    }
    const beschriftungZeichnen = (pt: number) => {
      if (el.beschriftung !== "darueber") return;
      const lp = labelPt(pt);
      seite.drawText(kuerzen(block.label, normal, lp, ix1 - ix0), { x: ix0, y: iOben - lp * 0.95, size: lp, font: normal, color: GRAU });
    };
    if (kreuz) {
      // Kreuze brauchen eine Zeile; die Groesse folgt dem Platz, nicht umgekehrt.
      let pt = el.pt;
      while (pt > PDF_FREI_MIN_PT && labelH(pt) + pt * ZEILENABSTAND > iH) pt -= 0.5;
      beschriftungZeichnen(pt);
      kreuzeZeichnen(seite, wx0, iOben - labelH(pt) - pt * 0.95, block.jaNein, pt);
      return;
    }
    if (!wert) {
      beschriftungZeichnen(el.pt);
      return;
    }
    const quelle = saeubern(wert)
      .split("\n")
      .map((t) => ({ text: t, fett: false }));
    const gs = einpassen(quelle, fonts, el.fett, el.pt, ix1 - wx0, iH, labelH);
    if (gs.abgeschnitten) melden(art, el, block.label, wert);
    beschriftungZeichnen(gs.pt);
    zeilenZeichnen(seite, gs, { ...el, ausrichtung: el.beschriftung === "links" ? "links" : el.ausrichtung }, wx0, ix1, iOben - labelH(gs.pt), textFarbe(el.farbe));
  };

  const flussErste = frei.erste.find((x) => x.art === "fluss") ?? null;
  const flussFolge = frei.folge.find((x) => x.art === "fluss") ?? null;
  const spiegelAus = (el: PdfFreiBaustein | null): Satzspiegel => {
    if (!el) return { x0: 20 * MM, x1: SEITE_B - 20 * MM, oben: SEITE_H - 20 * MM, unten: 20 * MM };
    const h = Math.max(el.h, MIN_FLUSS_HOEHE);
    const yOben = Math.min(el.y, PDF_FREI_SEITE.h - h);
    return { x0: el.x * MM, x1: (el.x + el.b) * MM, oben: SEITE_H - yOben * MM, unten: SEITE_H - (yOben + h) * MM };
  };

  const rahmen = (s: Setzer, nr: number): Satzspiegel => {
    // Schutz gegen eine Endlosschleife bei absurd kleinem Fliessbereich.
    if (nr > 500) throw new Error("Das PDF hätte mehr als 500 Seiten. Bitte den Fließbereich größer machen.");
    const art: PdfFreiSeitenart = nr === 1 ? "erste" : "folge";
    for (const el of frei[art]) bausteinZeichnen(s.seite, art, el);
    return spiegelAus(nr === 1 ? flussErste : flussFolge);
  };

  const s = new Setzer(doc, g, normal, fett, farbe, rahmen);
  s.unterschriftDaten = unterschriftDaten;
  s.neueSeite();

  if (flussErste) {
    if (g.anrede.trim()) s.absatz(pdfTextEinzeilig(g.anrede, werte));
    if (g.einleitung.trim()) {
      for (const z of pdfTextZeilen(g.einleitung, werte)) z.text ? s.absatz(z.text, { font: z.fett ? fett : normal }) : (s.y -= g.groesseText * 0.6);
    }
    s.felder(fluss);
    if (g.gruss.trim()) {
      s.y -= g.groesseText * 1.6;
      s.absatz(pdfTextEinzeilig(g.gruss, werte), { abstandDanach: 0 });
    }
    const name = e.platzhalter["benutzer.name"] ?? "";
    if (g.unterschrift === "linie") {
      s.platz(20 * MM);
      s.y -= 14 * MM;
      s.seite.drawLine({ start: { x: s.spiegel.x0, y: s.y }, end: { x: s.spiegel.x0 + Math.min(65 * MM, s.breite), y: s.y }, thickness: 0.5, color: SCHWARZ });
      s.text([name ? `${name}, ${e.platzhalter.datum ?? ""}` : "Datum, Unterschrift"], { groesse: Math.max(g.groesseText - 1.5, 7), farbe: GRAU });
    } else if (g.unterschrift === "name" && name) {
      s.platz(14 * MM);
      s.y -= 9 * MM;
      s.text([name], { font: fett });
    }
  }

  if (anhang.length > 0) {
    s.neueSeite();
    s.abschnitt("Fortsetzung");
    for (const a of anhang) {
      s.absatz(a.label, { font: fett, abstandDanach: 1 });
      for (const z of saeubern(a.text).split("\n")) z ? s.absatz(z, { abstandDanach: 1 }) : (s.y -= g.groesseText * 0.6);
      s.y -= g.groesseText * 0.8;
    }
  }

  const gesamt = s.seiten.length;
  for (const n of nachgereicht) n.zeichnen(String(s.seiten.indexOf(n.seite) + 1), String(gesamt));
  if (e.beispiel) {
    for (const seite of s.seiten) {
      const t = "Vorschau mit Beispieldaten · nicht zur Weitergabe";
      seite.drawText(t, { x: (SEITE_B - normal.widthOfTextAtSize(t, 7)) / 2, y: 3.5 * MM, size: 7, font: normal, color: rgb(0.6, 0.6, 0.6) });
    }
  }

  doc.setTitle(pdfTextEinzeilig(g.titel, werte) || e.formular.name);
  doc.setCreator("Zimmerakte");
  doc.setProducer("Zimmerakte");
  return { pdf: await doc.save(), seiten: gesamt, ueberlauf };
}
