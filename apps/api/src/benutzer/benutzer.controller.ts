import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { BenutzerService } from "./benutzer.service";

const anlegenSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  rolle: z.enum(["bereichsleitung", "einrichtungsleitung", "betreuer"]),
  // Mindestlaenge wie bei jedem neu vergebenen Passwort -- die eigentliche
  // Staerkepruefung bleibt der Person ueberlassen, die es einrichtet.
  passwort: z.string().min(8),
});

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
}
