import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KlientService } from "./klient.service";

const anlegenSchema = z.object({
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  geburtsdatum: z.string().date(),
  aktenzeichen: z.string().min(1),
  amt: z.string().min(1),
  hzlRhythmus: z.enum(["monatlich", "woechentlich"]).default("monatlich"),
});

@Controller("klienten")
@Authenticated()
export class KlientController {
  constructor(private readonly klienten: KlientService) {}

  @Get()
  async list() {
    return this.klienten.findeAlle();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.klienten.anlegen(anlegenSchema.parse(body));
  }

  @Get(":id")
  async eines(@Param("id") id: string) {
    return this.klienten.findeEinen(id);
  }

  @Patch(":id/anonymisieren")
  async anonymisieren(@Param("id") id: string) {
    return this.klienten.anonymisieren(id);
  }
}
