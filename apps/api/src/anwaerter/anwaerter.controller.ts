import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KlientService } from "../klienten/klient.service";
import { AnwaerterService } from "./anwaerter.service";

const statusSchema = z.enum(["offen", "angenommen", "abgelehnt"]);

const anlegenSchema = z.object({
  vorname: z.string().trim().min(1),
  nachname: z.string().trim().min(1),
  geburtsdatum: z.string().date().optional(),
  telefon: z.string().optional(),
  email: z.string().optional(),
  anfragendeStelle: z.string().optional(),
  notiz: z.string().optional(),
});

const aktualisierenSchema = z.object({
  vorname: z.string().trim().min(1).optional(),
  nachname: z.string().trim().min(1).optional(),
  geburtsdatum: z.string().date().optional(),
  telefon: z.string().optional(),
  email: z.string().optional(),
  anfragendeStelle: z.string().optional(),
  notiz: z.string().optional(),
});

const annehmenSchema = z.object({
  aktenzeichen: z.string().trim().min(1),
  amt: z.string().trim().min(1),
  hzlRhythmus: z.enum(["monatlich", "woechentlich"]).default("monatlich"),
});

const ablehnenSchema = z.object({
  grund: z.string().trim().min(1, "Ein Grund ist erforderlich."),
});

@Controller("anwaerter")
@Authenticated()
export class AnwaerterController {
  constructor(
    private readonly anwaerter: AnwaerterService,
    private readonly klienten: KlientService
  ) {}

  @Get()
  async list(@Query("status") status?: string) {
    return this.anwaerter.findeAlle(status ? statusSchema.parse(status) : undefined);
  }

  @Get(":id")
  async eines(@Param("id") id: string) {
    return this.anwaerter.findeEinen(id);
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.anwaerter.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id")
  async aktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.anwaerter.aktualisieren(id, aktualisierenSchema.parse(body));
  }

  @Delete(":id")
  async loeschen(@Param("id") id: string) {
    await this.anwaerter.loeschen(id);
    return { ok: true };
  }

  @Patch(":id/annehmen")
  async annehmen(@Param("id") id: string, @Body() body: unknown) {
    const { id: klientId } = await this.anwaerter.annehmen(id, annehmenSchema.parse(body));
    return this.klienten.findeEinen(klientId);
  }

  @Patch(":id/ablehnen")
  async ablehnen(@Param("id") id: string, @Body() body: unknown) {
    const { grund } = ablehnenSchema.parse(body);
    return this.anwaerter.ablehnen(id, grund);
  }
}
