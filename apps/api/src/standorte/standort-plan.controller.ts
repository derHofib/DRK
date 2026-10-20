import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { bildAbmessungen, erkenneBildTyp } from "../common/datei";
import { leseRohKoerper } from "../common/roh-koerper";
import { StandortPlanService } from "./standort-plan.service";

const MAX_GRUNDRISS_BYTES = 8_000_000;
// Grenze der Pixelzahl, nicht nur der Bytes: ein stark komprimiertes
// Linienplan-PNG kann bei wenigen MB mehrere hundert Megapixel haben und wird
// dann von keinem Browser mehr dargestellt (gemessen: 35640 x 25200 px, 2,9 MB).
// 50 MP entsprechen etwa A3 bei 300 dpi und bleiben darstellbar.
const MAX_GRUNDRISS_PIXEL = 50_000_000;

const etageSchema = z.string().trim().min(1).max(50);

const raumAnlegenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  etage: etageSchema,
});

const raumAktualisierenSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  etage: etageSchema.optional(),
  aktiv: z.boolean().optional(),
});

const positionenSchema = z.object({
  etage: etageSchema,
  positionen: z
    .array(
      z.object({
        art: z.enum(["zimmer", "raum"]),
        id: z.string().uuid(),
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      })
    )
    .max(500),
});

const etageQuerySchema = z.object({ etage: etageSchema });

function parse<T>(schema: z.ZodType<T>, wert: unknown): T {
  const ergebnis = schema.safeParse(wert);
  if (!ergebnis.success) throw new BadRequestException(ergebnis.error.issues.map((i) => i.message).join("; "));
  return ergebnis.data;
}

/**
 * Raumplan eines Standorts: Etagen/Zimmer/Gemeinschaftsraeume, Positionen der
 * Karten auf dem Grundriss und das Grundriss-Bild selbst. Rechte- und
 * Standortpruefung liegen im Service, neben dem SQL.
 */
@Controller("standorte")
@Authenticated()
export class StandortPlanController {
  constructor(private readonly plan: StandortPlanService) {}

  @Get(":id/raumplan")
  async raumplan(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.plan.raumplan(id);
  }

  @Post(":id/raeume")
  async raumAnlegen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.plan.raumAnlegen(id, parse(raumAnlegenSchema, body));
  }

  @Patch(":id/raeume/:raumId")
  async raumAktualisieren(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("raumId", new ParseUUIDPipe()) raumId: string,
    @Body() body: unknown
  ) {
    return this.plan.raumAktualisieren(id, raumId, parse(raumAktualisierenSchema, body));
  }

  @Put(":id/raumplan/positionen")
  async positionen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const { etage, positionen } = parse(positionenSchema, body);
    await this.plan.positionenSetzen(id, etage, positionen);
    return { gespeichert: positionen.length };
  }

  // Roher Body statt JSON/Base64: siehe common/roh-koerper.ts. Der Dateiname
  // kommt im Header X-Dateiname (URL-kodiert), die Etage als Query-Parameter.
  @Put(":id/grundriss")
  async grundrissHochladen(@Param("id", new ParseUUIDPipe()) id: string, @Query() query: unknown, @Req() req: Request) {
    const { etage } = parse(etageQuerySchema, query);
    const deklariert = (req.headers["content-type"] ?? "").split(";")[0].trim();
    const inhalt = await leseRohKoerper(req, MAX_GRUNDRISS_BYTES);
    const erkannt = erkenneBildTyp(inhalt);
    if (!erkannt || erkannt !== deklariert) {
      throw new BadRequestException("Bitte ein Bild im Format JPG, PNG oder WebP hochladen.");
    }
    const masse = bildAbmessungen(inhalt, erkannt);
    if (masse && masse.breite * masse.hoehe > MAX_GRUNDRISS_PIXEL) {
      throw new BadRequestException(
        `Das Bild ist mit ${masse.breite} × ${masse.hoehe} Pixeln zu groß für die Anzeige (maximal 50 Megapixel). ` +
          "Bitte mit höchstens etwa 6000 Pixeln Kantenlänge exportieren."
      );
    }
    const roherName = String(req.headers["x-dateiname"] ?? "grundriss");
    let dateiname = "grundriss";
    try {
      dateiname = decodeURIComponent(roherName).slice(0, 200) || "grundriss";
    } catch {
      // Ungueltig kodierter Name: beim Standardnamen bleiben.
    }
    await this.plan.grundrissSetzen(id, etage, { inhalt, mimeType: erkannt, dateiname });
    return { gespeichert: true };
  }

  @Get(":id/grundriss")
  async grundriss(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Res({ passthrough: false }) res: Response
  ) {
    const { etage } = parse(etageQuerySchema, query);
    const ergebnis = await this.plan.grundrissBild(id, etage);
    if (!ergebnis) throw new NotFoundException("Für diese Etage ist kein Grundriss hinterlegt.");
    res.setHeader("Content-Type", ergebnis.mimeType);
    // Begruendung wie bei Rechnungsdokumenten (rechnung.controller.ts):
    // "attachment" + nosniff, damit der Browser den Inhalt nie im
    // Anwendungs-Origin als etwas anderes als das erklaerte Bild behandelt.
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(ergebnis.dateiname)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Datei-Hash", ergebnis.hash);
    res.send(ergebnis.inhalt);
  }

  @Delete(":id/grundriss")
  async grundrissLoeschen(@Param("id", new ParseUUIDPipe()) id: string, @Query() query: unknown) {
    const { etage } = parse(etageQuerySchema, query);
    await this.plan.grundrissLoeschen(id, etage);
    return { geloescht: true };
  }
}
