import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ZimmerService } from "./zimmer.service";

// Obergrenze deckt sich mit dem CHECK in migrations/0032_zimmer_kapazitaet.sql
// -- so faellt eine unsinnige Eingabe schon als 400 auf, nicht erst als 500
// am DB-Constraint.
const kapazitaetSchema = z.number().int().min(1).max(12);

const anlegenSchema = z.object({
  standortId: z.string().uuid(),
  nummer: z.string().min(1),
  etage: z.string().min(1).optional(),
  kapazitaet: kapazitaetSchema.optional(),
});

const aktualisierenSchema = z.object({
  nummer: z.string().min(1),
  etage: z.string().min(1).optional(),
});

const kapazitaetAendernSchema = z.object({
  neueKapazitaet: kapazitaetSchema,
});

const kapazitaetEntscheidenSchema = z.object({
  entscheidung: z.enum(["bestaetigt", "abgelehnt"]),
  grund: z.string().min(1).optional(),
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

  @Patch(":id/kapazitaet")
  async kapazitaetAendern(@Param("id") id: string, @Body() body: unknown) {
    const { neueKapazitaet } = kapazitaetAendernSchema.parse(body);
    return this.zimmer.kapazitaetAendern(id, neueKapazitaet);
  }

  @Patch("kapazitaetsantraege/:antragId")
  async kapazitaetEntscheiden(@Param("antragId") antragId: string, @Body() body: unknown) {
    const { entscheidung, grund } = kapazitaetEntscheidenSchema.parse(body);
    return this.zimmer.kapazitaetEntscheiden(antragId, entscheidung, grund);
  }

  @Get(":id/belegungsverlauf")
  async belegungsverlauf(@Param("id") id: string) {
    return this.zimmer.belegungsverlauf(id);
  }
}
