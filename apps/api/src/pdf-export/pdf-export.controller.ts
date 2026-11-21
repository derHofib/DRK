import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { PDF_FREI_MAX_BAUSTEINE, PDF_FREI_MIN_PT, PDF_FREI_SEITE } from "@zimmerakte/shared";
import type {
  PdfFeldstil,
  PdfFrei,
  PdfFreiBaustein,
  PdfGestaltung,
  PdfLeereFelder,
  PdfLogoPosition,
  PdfSchrift,
  PdfUeberschriften,
  PdfVorlage,
} from "@zimmerakte/shared";
import { Authenticated } from "../common/authenticated.decorator";
import { leseRohKoerper } from "../common/roh-koerper";
import { PdfExportService } from "./pdf-export.service";

// Kein globaler ZodError-Filter (CLAUDE.md): ueberall safeParse, sonst 500.
function lies<S extends z.ZodTypeAny>(schema: S, wert: unknown): z.output<S> {
  const r = schema.safeParse(wert);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" "));
  return r.data;
}

// Ein SVG ist vor dem Rastern groesser als das fertige PNG; die 2 MB gelten
// fuer das, was gespeichert wird (Service), hier nur eine Obergrenze fuers Lesen.
const MAX_UPLOAD = 5 * 1024 * 1024;

const text = (max: number) => z.string().max(max);
const optText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

// Die Grenzen sind fachlich: unter 7 pt ist ein Ausdruck nicht mehr sicher
// lesbar, ueber 30 mm frisst ein Logo den Anschriftbereich (DIN 5008 Form B
// laesst oben 45 mm).
// Freie Bausteine: Geometrie in 0,5-mm-Schritten und immer innerhalb des
// A4-Blatts. Was hier durchkommt, kann der Renderer ohne weitere Pruefung
// zeichnen. Hoechstens EIN Fliessbereich je Seitenart -- zwei waeren
// mehrdeutig (in welchen fliesst der Inhalt zuerst?).
const mm = (min: number, max: number) => z.number().min(min).max(max).refine((v) => Number.isInteger(v * 2), "Bitte in Schritten von 0,5 mm.");
const freiBausteinSchema: z.ZodType<PdfFreiBaustein> = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,24}$/),
    art: z.enum(["feld", "ankreuz", "text", "logo", "linie", "flaeche", "unterschrift", "anschrift", "fluss"]),
    x: mm(0, PDF_FREI_SEITE.b),
    y: mm(0, PDF_FREI_SEITE.h),
    b: mm(0.5, PDF_FREI_SEITE.b),
    h: mm(0.5, PDF_FREI_SEITE.h),
    feld: z.string().regex(/^([a-z][a-z0-9_]{0,62})?$/),
    text: text(4000),
    pt: z.number().min(PDF_FREI_MIN_PT, `Schrift mindestens ${PDF_FREI_MIN_PT} pt.`).max(36),
    fett: z.boolean(),
    ausrichtung: z.enum(["links", "mitte", "rechts"]),
    farbe: z.enum(["schwarz", "grau", "akzent"]),
    flaeche: z.enum(["akzent", "akzent-hell", "grau-hell"]),
    rahmen: z.enum(["keiner", "unten", "kasten"]),
    beschriftung: z.enum(["darueber", "links", "keine"]),
    staerke: z.number().min(0.25).max(4),
    gesperrt: z.boolean(),
  })
  .refine((e) => e.x + e.b <= PDF_FREI_SEITE.b + 0.001 && e.y + e.h <= PDF_FREI_SEITE.h + 0.001, "Baustein ragt über das Blatt hinaus.");
const freiSeite = z
  .array(freiBausteinSchema)
  .max(PDF_FREI_MAX_BAUSTEINE)
  .refine((l) => l.filter((e) => e.art === "fluss").length <= 1, "Höchstens ein Fließbereich je Seite.")
  .refine((l) => new Set(l.map((e) => e.id)).size === l.length, "Doppelte Baustein-Id.");
const freiSchema: z.ZodType<PdfFrei> = z.object({
  raster: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(5)]),
  hilfslinien: z.enum(["din5008b", "din5008a", "keine"]),
  erste: freiSeite,
  folge: freiSeite,
});

const gestaltungSchema: z.ZodType<PdfGestaltung> = z.object({
  vorlage: z.enum(["akte", "brief", "frei"] as [PdfVorlage, ...PdfVorlage[]]),
  felder: z.union([z.literal("alle"), z.array(z.string().max(63)).max(500)]),
  titel: text(300),
  unterTitel: text(300),
  anrede: text(300),
  einleitung: text(4000),
  gruss: text(1000),
  unterschrift: z.enum(["linie", "name", "keine"]),
  logoPosition: z.enum(["links", "mitte", "rechts"] as [PdfLogoPosition, ...PdfLogoPosition[]]),
  logoHoehe: z.number().min(5).max(30),
  textNebenLogo: text(1000),
  trennstrich: z.boolean(),
  textRechts: text(1000),
  ruecksendezeile: text(300),
  anschriftfeld: z.boolean(),
  datumszeile: text(300),
  infospalte: text(3000),
  fusszeileLinks: text(1000),
  fusszeileRechts: text(1000),
  folgeseitenLogoHoehe: z.number().min(0).max(20),
  schrift: z.enum(["nunito", "liberation-sans", "liberation-serif"] as [PdfSchrift, ...PdfSchrift[]]),
  groesseText: z.number().min(7).max(16),
  groesseUeberschrift: z.number().min(7).max(28),
  groesseFuss: z.number().min(6).max(12),
  farbe: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Farbe bitte als #rrggbb.").nullable(),
  feldstil: z.enum(["liste", "kaesten", "kompakt"] as [PdfFeldstil, ...PdfFeldstil[]]),
  leereFelder: z.enum(["ausblenden", "strich", "platz"] as [PdfLeereFelder, ...PdfLeereFelder[]]),
  ueberschriften: z.enum(["farbig", "schwarz", "balken"] as [PdfUeberschriften, ...PdfUeberschriften[]]),
  jaNein: z.enum(["wort", "kreuz"]),
  frei: freiSchema,
});

const speichernSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(120),
  zielgruppe: z.enum(["intern", "extern"]),
  logoId: z.string().uuid().nullable(),
  gestaltung: gestaltungSchema,
});

const vorschauSchema = speichernSchema.extend({
  name: z.string().trim().max(120),
  protokollId: z.string().uuid().nullish().transform((v) => v ?? null),
  standortId: z.string().uuid().nullish().transform((v) => v ?? null),
  empfaenger: optText(1000),
});

const pruefenSchema = vorschauSchema.extend({ laengste: z.boolean() });

const anlegenSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(120),
  vorlage: z.enum(["akte", "brief", "frei"]).optional(),
  kopieVon: z.string().uuid().optional(),
});

const stilllegenSchema = z.object({ stillgelegt: z.boolean() });

// Obergrenze: ein Sammel-PDF wird im Speicher zusammengesetzt; 50 Dokumente
// sind ein Monat Teambesprechungen mehrerer Standorte, mehr ist eher ein Versehen.
const sammelSchema = z.object({
  eintraege: z
    .array(z.object({ protokollId: z.string().uuid(), exportId: z.string().uuid() }))
    .min(1)
    .max(50)
    .refine((l) => new Set(l.map((e) => e.protokollId)).size === l.length, "Jedes Dokument nur einmal."),
});

const erzeugenSchema = z.object({
  exportId: z.string().uuid(),
  empfaenger: optText(1000),
});

const angabenSchema = z.object({
  name: optText(200),
  hauptsitz: optText(300),
  telefon: optText(100),
  email: optText(200),
  website: optText(200),
  geschaeftsfuehrung: optText(300),
  registergericht: optText(200),
  registernummer: optText(100),
  steuernummer: optText(100),
  bank: optText(200),
  iban: optText(40),
  bic: optText(20),
});

function pdfSenden(res: Response, pdf: Uint8Array, dateiname: string, inline: boolean) {
  res.setHeader("Content-Type", "application/pdf");
  // Vorschau "inline" (die Oberflaeche zeigt sie im eigenen Fenster), echte
  // Exporte "attachment" -- beides mit nosniff wie bei allen Dokumenten.
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(dateiname)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(pdf));
}

@Controller()
@Authenticated()
export class PdfExportController {
  constructor(private readonly exporte: PdfExportService) {}

  @Get("pdf-exporte/rechte")
  rechte() {
    return this.exporte.rechteFuerMich();
  }

  // --- Gemeinsame Angaben und Logos ---

  @Get("dokument-angaben")
  angaben() {
    return this.exporte.angaben();
  }

  @Put("dokument-angaben")
  angabenSpeichern(@Body() body: unknown) {
    return this.exporte.angabenSpeichern(lies(angabenSchema, body));
  }

  @Get("traeger-dateien")
  dateien() {
    return this.exporte.dateien();
  }

  // Roher Body statt JSON/Base64 (siehe common/roh-koerper.ts); der Dateiname
  // kommt URL-kodiert im Header X-Dateiname wie beim Grundriss.
  @Post("traeger-dateien/logo")
  async logoHochladen(@Req() req: Request) {
    const inhalt = await leseRohKoerper(req, MAX_UPLOAD);
    let name = "Logo";
    try {
      name = decodeURIComponent(String(req.headers["x-dateiname"] ?? "Logo")).trim().slice(0, 200) || "Logo";
    } catch {
      // Ungueltig kodierter Name: beim Standardnamen bleiben.
    }
    return this.exporte.logoHochladen(name, inhalt);
  }

  @Get("traeger-dateien/:id")
  async datei(@Param("id", new ParseUUIDPipe()) id: string, @Res({ passthrough: false }) res: Response) {
    const d = await this.exporte.datei(id);
    res.setHeader("Content-Type", d.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.name)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(d.inhalt);
  }

  @Delete("traeger-dateien/:id")
  async dateiLoeschen(@Param("id", new ParseUUIDPipe()) id: string) {
    await this.exporte.dateiLoeschen(id);
    return { geloescht: true };
  }

  // --- Exporte eines Formulars ---

  @Get("formulare/:id/pdf-exporte")
  liste(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.exporte.liste(id);
  }

  @Post("formulare/:id/pdf-exporte")
  anlegen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.exporte.anlegen(id, lies(anlegenSchema, body));
  }

  @Post("formulare/:id/pdf-exporte/vorschau")
  async vorschau(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Res({ passthrough: false }) res: Response) {
    const e = lies(vorschauSchema, body);
    const pdf = await this.exporte.vorschau(id, e);
    pdfSenden(res, pdf, "vorschau.pdf", true);
  }

  @Post("formulare/:id/pdf-exporte/pruefen")
  pruefen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.exporte.pruefen(id, lies(pruefenSchema, body));
  }

  @Get("pdf-exporte/:id")
  einzeln(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.exporte.einzeln(id);
  }

  @Put("pdf-exporte/:id")
  speichern(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.exporte.speichern(id, lies(speichernSchema, body));
  }

  @Post("pdf-exporte/:id/standard")
  alsStandard(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.exporte.alsStandard(id);
  }

  @Post("pdf-exporte/:id/stilllegen")
  stilllegen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.exporte.stilllegen(id, lies(stilllegenSchema, body).stillgelegt);
  }

  // --- Export eines ausgefuellten Protokolls ---

  @Get("protokolle/:id/pdf-exporte")
  angebot(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.exporte.angebot(id);
  }

  @Post("protokolle/sammel-pdf")
  async sammel(@Body() body: unknown, @Res({ passthrough: false }) res: Response) {
    const { eintraege } = lies(sammelSchema, body);
    const { pdf, dateiname } = await this.exporte.sammelErzeugen(eintraege);
    pdfSenden(res, pdf, dateiname, false);
  }

  @Post("protokolle/:id/pdf")
  async erzeugen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Res({ passthrough: false }) res: Response) {
    const e = lies(erzeugenSchema, body);
    const { pdf, dateiname } = await this.exporte.erzeugen(id, e.exportId, e.empfaenger);
    pdfSenden(res, pdf, dateiname, false);
  }
}

