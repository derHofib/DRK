import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { SucheService } from "./suche.service";

// Mindestens 2 Zeichen: ein einzelner Buchstabe trifft fast jede Person und
// waere nur Last ohne Nutzen. Die Obergrenze verhindert absichtlich lange Muster.
const sucheSchema = z.object({ q: z.string().trim().min(2).max(80) });

const zuletztSchema = z.object({
  eintraege: z
    .array(z.object({ gruppe: z.enum(["klienten", "zimmer", "mitarbeitende", "belege"]), id: z.string().uuid() }))
    .max(8),
});

@Controller("suche")
@Authenticated()
export class SucheController {
  constructor(private readonly suche: SucheService) {}

  @Get()
  async suchen(@Query() query: unknown) {
    const geprueft = sucheSchema.safeParse(query);
    if (!geprueft.success) throw new BadRequestException("Bitte mindestens 2 Zeichen eingeben.");
    return this.suche.suchen(geprueft.data.q);
  }

  // POST statt GET, damit die IDs nicht in Zugriffsprotokollen der URL landen.
  @Post("zuletzt")
  @HttpCode(200)
  async zuletzt(@Body() body: unknown) {
    const geprueft = zuletztSchema.safeParse(body);
    if (!geprueft.success) throw new BadRequestException("Ungültige Anfrage.");
    return this.suche.zuletztGeoeffnet(geprueft.data.eintraege);
  }
}
