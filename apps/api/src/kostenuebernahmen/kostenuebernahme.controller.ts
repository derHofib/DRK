import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KostenuebernahmeService } from "./kostenuebernahme.service";

const anlegenSchema = z.object({
  klientId: z.string().uuid(),
  amt: z.string().min(1),
  von: z.string().date(),
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
