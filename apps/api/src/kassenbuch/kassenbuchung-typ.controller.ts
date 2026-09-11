import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KassenbuchungTypService } from "./kassenbuchung-typ.service";

const anlegenSchema = z.object({
  bezeichnung: z.string().trim().min(1, "Bezeichnung darf nicht leer sein."),
  kommentarPflicht: z.boolean(),
});

const aktualisierenSchema = z.object({
  bezeichnung: z.string().trim().min(1, "Bezeichnung darf nicht leer sein.").optional(),
  kommentarPflicht: z.boolean().optional(),
  aktiv: z.boolean().optional(),
});

@Controller("kassenbuchungstypen")
@Authenticated()
export class KassenbuchungTypController {
  constructor(private readonly typen: KassenbuchungTypService) {}

  @Get()
  async list() {
    return this.typen.findeAlle();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.typen.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id")
  async aktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.typen.aktualisieren(id, aktualisierenSchema.parse(body));
  }
}
