import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { SchichtuebergabeService } from "./schichtuebergabe.service";

const punkt = z.object({
  text: z.string().trim().min(1).max(1000),
  klientId: z.string().uuid().optional(),
  zimmerId: z.string().uuid().optional(),
});

const anlegenSchema = z.object({
  standortId: z.string().uuid(),
  dienst: z.enum(["frueh", "spaet", "nacht"]),
  punkte: z.array(punkt).min(1).max(50),
});

const listeSchema = z.object({
  standortId: z.string().uuid().optional(),
});

const aufgabeSchema = z.object({ zugewiesenAn: z.string().uuid().optional() });

function pruefen<T>(schema: z.ZodType<T>, daten: unknown, meldung: string): T {
  const ergebnis = schema.safeParse(daten);
  if (!ergebnis.success) throw new BadRequestException(meldung);
  return ergebnis.data;
}

@Controller("schichtuebergaben")
@Authenticated()
export class SchichtuebergabeController {
  constructor(private readonly uebergaben: SchichtuebergabeService) {}

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.uebergaben.anlegen(pruefen(anlegenSchema, body, "Bitte Standort, Dienst und mindestens einen Punkt angeben."));
  }

  @Get()
  async liste(@Query() query: unknown) {
    return this.uebergaben.liste(pruefen(listeSchema, query, "Ungültiger Standort.").standortId);
  }

  // Vor ":id", sonst faengt die Parameterroute "ungelesen" ab.
  @Get("ungelesen")
  async ungelesen() {
    return this.uebergaben.ungelesen();
  }

  @Post(":id/gelesen")
  @HttpCode(200)
  async gelesen(@Param("id", ParseUUIDPipe) id: string) {
    return this.uebergaben.gelesenMarkieren(id);
  }

  @Post(":id/nachtraege")
  async nachtrag(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.uebergaben.nachtragAnlegen(id, pruefen(punkt, body, "Bitte einen Text eingeben."));
  }

  @Post("punkte/:punktId/aufgabe")
  async aufgabe(@Param("punktId", ParseUUIDPipe) punktId: string, @Body() body: unknown) {
    return this.uebergaben.aufgabeAnlegen(punktId, pruefen(aufgabeSchema, body ?? {}, "Ungültige Zuweisung.").zugewiesenAn);
  }
}
