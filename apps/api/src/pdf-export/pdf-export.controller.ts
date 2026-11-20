import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import type {
  PdfFeldstil,
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
const gestaltungSchema: z.ZodType<PdfGestaltung> = z.object({
  vorlage: z.enum(["akte", "brief"] as [PdfVorlage, ...PdfVorlage[]]),
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

const anlegenSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(120),
  vorlage: z.enum(["akte", "brief"]).optional(),
  kopieVon: z.string().uuid().optional(),
});

const stilllegenSchema = z.object({ stillgelegt: z.boolean() });

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

  @Post("protokolle/:id/pdf")
  async erzeugen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Res({ passthrough: false }) res: Response) {
    const e = lies(erzeugenSchema, body);
    const { pdf, dateiname } = await this.exporte.erzeugen(id, e.exportId, e.empfaenger);
    pdfSenden(res, pdf, dateiname, false);
  }
}

