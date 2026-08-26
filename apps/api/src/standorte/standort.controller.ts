import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { StandortService } from "./standort.service";

const anlegenSchema = z.object({
  name: z.string().min(1),
  adresse: z.string().min(1),
});

const aktualisierenSchema = z.object({
  name: z.string().min(1).optional(),
  adresse: z.string().min(1).optional(),
  aktiv: z.boolean().optional(),
});

@Controller("standorte")
@Authenticated()
export class StandortController {
  constructor(private readonly standorte: StandortService) {}

  @Get()
  async list() {
    return this.standorte.findeAlle();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.standorte.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id")
  async aktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.standorte.aktualisieren(id, aktualisierenSchema.parse(body));
  }
}
