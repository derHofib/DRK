import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ZimmerService } from "./zimmer.service";

const anlegenSchema = z.object({
  standortId: z.string().uuid(),
  nummer: z.string().min(1),
  etage: z.string().min(1).optional(),
});

const aktualisierenSchema = z.object({
  nummer: z.string().min(1),
  etage: z.string().min(1).optional(),
});

@Controller("zimmer")
@Authenticated()
export class ZimmerController {
  constructor(private readonly zimmer: ZimmerService) {}

  @Get()
  async list() {
    return this.zimmer.findeAlle();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.zimmer.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id")
  async aktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.zimmer.aktualisieren(id, aktualisierenSchema.parse(body));
  }

  @Patch(":id/deaktivieren")
  async deaktivieren(@Param("id") id: string) {
    return this.zimmer.deaktivieren(id);
  }

  @Get(":id/belegungsverlauf")
  async belegungsverlauf(@Param("id") id: string) {
    return this.zimmer.belegungsverlauf(id);
  }
}
