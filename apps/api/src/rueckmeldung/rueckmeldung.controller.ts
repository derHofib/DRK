import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { RUECKMELDUNG_ENTSCHEIDUNGEN } from "@zimmerakte/shared";
import { Authenticated } from "../common/authenticated.decorator";
import { leseRohKoerper } from "../common/roh-koerper";
import { MAX_SCREENSHOT_BYTES, RueckmeldungService } from "./rueckmeldung.service";

const kurz = (max: number) => z.string().trim().max(max).optional();

const meldenSchema = z.object({
  art: z.enum(["idee", "fehler"]),
  titel: z.string().trim().min(1, "Bitte einen Titel angeben.").max(200),
  beschreibung: z.string().trim().min(1, "Bitte beschreiben, worum es geht.").max(5000),
  erwartet: z.string().trim().max(3000).optional().transform((v) => v || undefined),
  prioritaet: z.enum(["niedrig", "mittel", "hoch", "blockierend"]).default("mittel"),
  // Whitelist: unbekannte Felder fallen weg (zod entfernt sie), statt als
  // Freitext-Schlupfloch fuer Personendaten im Kontext zu dienen.
  kontext: z
    .object({
      seite: kurz(300),
      appVersion: kurz(60),
      browser: kurz(120),
      betriebssystem: kurz(120),
      viewport: kurz(30),
      theme: kurz(20),
      rolle: kurz(120),
      zeitpunkt: kurz(40),
    })
    .default({}),
}).refine((v) => v.art === "fehler" || v.prioritaet !== "blockierend", "Blockierend gibt es nur bei Fehlern.");

const entscheidenSchema = z.object({
  status: z.enum(RUECKMELDUNG_ENTSCHEIDUNGEN),
  notiz: z.string().trim().max(2000).optional(),
});

const listeSchema = z.object({
  status: z.enum(["neu", "freigegeben", "rueckfrage", "abgelehnt", "duplikat", "in_arbeit", "umgesetzt"]).optional(),
  art: z.enum(["idee", "fehler"]).optional(),
});

@Controller("rueckmeldungen")
@Authenticated()
export class RueckmeldungController {
  constructor(private readonly rueckmeldungen: RueckmeldungService) {}

  @Post()
  async melden(@Body() body: unknown) {
    return this.rueckmeldungen.melden(meldenSchema.parse(body));
  }

  @Get("meine")
  async meine() {
    return this.rueckmeldungen.meine();
  }

  @Get("berechtigung")
  async berechtigung() {
    return this.rueckmeldungen.berechtigung();
  }

  @Get()
  async liste(@Query() query: unknown) {
    return this.rueckmeldungen.liste(listeSchema.parse(query));
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    return this.rueckmeldungen.detail(id);
  }

  // Roher PNG-Body (siehe common/roh-koerper.ts): als Base64-JSON waere er
  // ein Drittel groesser und wuerde das 100-kB-JSON-Limit sprengen.
  @Put(":id/screenshot")
  @HttpCode(204)
  async screenshotAnhaengen(@Param("id") id: string, @Req() req: Request) {
    await this.rueckmeldungen.screenshotAnhaengen(id, await leseRohKoerper(req, MAX_SCREENSHOT_BYTES));
  }

  @Get(":id/screenshot")
  async screenshot(@Param("id") id: string, @Res() res: Response) {
    const daten = await this.rueckmeldungen.bild(id);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(daten);
  }

  @Delete(":id/screenshot")
  @HttpCode(204)
  async screenshotLoeschen(@Param("id") id: string) {
    await this.rueckmeldungen.bildLoeschen(id);
  }

  @Patch(":id")
  async entscheiden(@Param("id") id: string, @Body() body: unknown) {
    const { status, notiz } = entscheidenSchema.parse(body);
    return this.rueckmeldungen.entscheiden(id, status, notiz);
  }
}
