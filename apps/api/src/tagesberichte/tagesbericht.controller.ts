import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ERLAUBTE_DOKUMENT_MIME_TYPES } from "../common/datei";
import { TagesberichtService } from "./tagesbericht.service";

const dokumentSchema = z.object({
  base64: z.string(),
  dateiname: z.string().min(1),
  mimeType: z.enum(ERLAUBTE_DOKUMENT_MIME_TYPES),
});

const anlegenSchema = z.object({
  klientId: z.string().uuid(),
  datum: z.string().date(),
  text: z.string().min(1),
  tagNamen: z.array(z.string().min(1)).optional(),
  dokumente: z.array(dokumentSchema).optional(),
});

// Zeitraum als geschlossenes Intervall [von, bis]; beide Grenzen optional.
// Kein globaler ZodError-Filter: sonst wird ein kaputtes Datum zum 500er.
const listeSchema = z
  .object({
    klientId: z.string().uuid().optional(),
    von: z.string().date().optional(),
    bis: z.string().date().optional(),
  })
  .refine((q) => !q.von || !q.bis || q.von <= q.bis, { message: "„von“ darf nicht nach „bis“ liegen." });

const tagHinzufuegenSchema = z.object({
  name: z.string().min(1),
});

@Controller()
@Authenticated()
export class TagesberichtController {
  constructor(private readonly tagesberichte: TagesberichtService) {}

  @Get("tagesberichte")
  async list(@Query() query: Record<string, unknown>) {
    const parsed = listeSchema.safeParse({
      klientId: query.klientId || undefined,
      von: query.von || undefined,
      bis: query.bis || undefined,
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(" "));
    }
    return this.tagesberichte.findeAlle(parsed.data.klientId, { von: parsed.data.von, bis: parsed.data.bis });
  }

  @Post("tagesberichte")
  async anlegen(@Body() body: unknown) {
    return this.tagesberichte.anlegen(anlegenSchema.parse(body));
  }

  @Post("tagesberichte/:id/tags")
  async tagHinzufuegen(@Param("id") id: string, @Body() body: unknown) {
    const { name } = tagHinzufuegenSchema.parse(body);
    return this.tagesberichte.tagHinzufuegen(id, name);
  }

  @Delete("tagesberichte/:id/tags/:tagId")
  async tagEntfernen(@Param("id") id: string, @Param("tagId") tagId: string) {
    await this.tagesberichte.tagEntfernen(id, tagId);
    return { ok: true };
  }

  @Post("tagesberichte/:id/dokumente")
  async dokumentHinzufuegen(@Param("id") id: string, @Body() body: unknown) {
    return this.tagesberichte.dokumentHinzufuegen(id, dokumentSchema.parse(body));
  }

  @Get("tagesberichte/:id/dokumente/:dokumentId")
  async dokument(
    @Param("id") id: string,
    @Param("dokumentId") dokumentId: string,
    @Res({ passthrough: false }) res: Response
  ) {
    const ergebnis = await this.tagesberichte.dokumentBild(id, dokumentId);
    if (!ergebnis) throw new NotFoundException("Dokument nicht gefunden.");
    res.setHeader("Content-Type", ergebnis.mimeType);
    // Gleiche Verteidigungslinie wie bei Rechnungsdokumenten (siehe
    // rechnung.controller.ts): "attachment" statt "inline" plus nosniff,
    // damit selbst ein unbedacht falsch deklariertes Dokument nie im
    // Anwendungs-Origin gerendert wird.
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(ergebnis.dateiname)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Datei-Hash", ergebnis.hash);
    res.send(ergebnis.inhalt);
  }

  @Get("tags")
  async tagsListe() {
    return this.tagesberichte.tagsListe();
  }
}
