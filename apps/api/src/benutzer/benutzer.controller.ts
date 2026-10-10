import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { BenutzerService } from "./benutzer.service";

const anlegenSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  // Mindestlaenge wie bei jedem neu vergebenen Passwort -- die eigentliche
  // Staerkepruefung bleibt der Person ueberlassen, die es einrichtet.
  passwort: z.string().min(8),
});

const standorteSetzenSchema = z.object({
  standortIds: z.array(z.string().uuid()),
});

const aktivSetzenSchema = z.object({ aktiv: z.boolean() });

@Controller("benutzer")
@Authenticated()
export class BenutzerController {
  constructor(private readonly benutzer: BenutzerService) {}

  @Get()
  async list() {
    return this.benutzer.findeAlleImEigenenMandanten();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.benutzer.anlegen(anlegenSchema.parse(body));
  }

  @Post(":id/passwort-reset")
  async passwortResetErstellen(@Param("id") id: string) {
    return this.benutzer.passwortResetErstellen(id);
  }

  @Put(":id/standorte")
  async standorteSetzen(@Param("id") id: string, @Body() body: unknown) {
    const { standortIds } = standorteSetzenSchema.parse(body);
    return this.benutzer.standorteSetzen(id, standortIds);
  }

  @Patch(":id/aktiv")
  async aktivSetzen(@Param("id") id: string, @Body() body: unknown) {
    // safeParse statt parse: es gibt keinen globalen ZodError-Filter, ein
    // durchgereichter ZodError waere ein 500 (siehe CLAUDE.md).
    const eingabe = aktivSetzenSchema.safeParse(body);
    if (!eingabe.success) {
      throw new BadRequestException("Erwartet { aktiv: true | false }.");
    }
    return this.benutzer.aktivSetzen(id, eingabe.data.aktiv);
  }
}
