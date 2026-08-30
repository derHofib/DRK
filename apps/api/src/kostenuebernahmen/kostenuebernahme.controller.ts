import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KostenuebernahmeService } from "./kostenuebernahme.service";

const anlegenSchema = z
  .object({
    klientId: z.string().uuid(),
    amt: z.string().min(1),
    von: z.string().date(),
    // Optional: Kostenuebernahmen werden meist von vornherein fuer einen
    // festen Zeitraum bewilligt, nicht nur unbefristet ab "von" -- siehe
    // kostenuebernahme.service.ts::anlegen(). Der Stringvergleich ist hier
    // sicher, weil z.string().date() bereits das feste Format YYYY-MM-DD
    // erzwingt.
    bis: z.string().date().optional(),
  })
  .refine((v) => v.bis === undefined || v.bis > v.von, {
    message: "Das Enddatum muss nach dem Startdatum liegen.",
    path: ["bis"],
  });

const beendenSchema = z.object({
  bis: z.string().date(),
});

@Controller("kostenuebernahmen")
@Authenticated()
export class KostenuebernahmeController {
  constructor(private readonly kostenuebernahmen: KostenuebernahmeService) {}

  @Get()
  async list(@Query("klientId") klientId?: string) {
    if (!klientId) throw new BadRequestException("klientId ist erforderlich.");
    return this.kostenuebernahmen.findeAlleFuerKlient(klientId);
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.kostenuebernahmen.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id/beenden")
  async beenden(@Param("id") id: string, @Body() body: unknown) {
    const { bis } = beendenSchema.parse(body);
    return this.kostenuebernahmen.beenden(id, bis);
  }
}
