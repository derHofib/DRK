import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { LEISTUNGSARTEN, STUNDENBUCHUNG_MINUTEN_MAX } from "@zimmerakte/shared";
import { Authenticated } from "../common/authenticated.decorator";
import { StundenKalenderService } from "./stunden-kalender.service";
import { StundenbuchungService } from "./stundenbuchung.service";

const anlegenSchema = z.object({
  klientId: z.string().uuid(),
  mitarbeiterId: z.string().uuid().optional(),
  datum: z.string().date(),
  // Dieselben Grenzen wie der CHECK der Spalte (Migration 0072) -- sonst waere
  // ein Tippfehler ein 500 aus der Datenbank statt ein 400.
  minuten: z.number().int().min(1).max(STUNDENBUCHUNG_MINUTEN_MAX),
  leistungsart: z.enum(LEISTUNGSARTEN as [string, ...string[]]),
  notiz: z.string().trim().max(2000).optional(),
});

const eigeneEinstellungSchema = z.object({ vorauswahl: z.boolean().nullable(), vorauswahlZusage: z.boolean().nullable() }).strict();
const traegerEinstellungSchema = z.object({ erlaubt: z.boolean(), vorauswahl: z.boolean() }).strict();

const stornoSchema = z.object({ grund: z.string().trim().min(1, "Grund darf nicht leer sein.") });

const listeSchema = z
  .object({
    klientId: z.string().uuid().optional(),
    mitarbeiterId: z.string().uuid().optional(),
    herkunft: z.enum(["manuell", "kalender"]).optional(),
    von: z.string().date().optional(),
    bis: z.string().date().optional(),
  })
  .refine((q) => !q.von || !q.bis || q.von <= q.bis, { message: "„von“ darf nicht nach „bis“ liegen." });

function leseFilter(query: Record<string, unknown>) {
  const parsed = listeSchema.safeParse({
    klientId: query.klientId || undefined,
    mitarbeiterId: query.mitarbeiterId || undefined,
    herkunft: query.herkunft || undefined,
    von: query.von || undefined,
    bis: query.bis || undefined,
  });
  // safeParse statt parse, damit ein kaputter Filter ein 400 ergibt.
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(" "));
  return parsed.data;
}

@Controller("stundenbuchungen")
@Authenticated()
export class StundenbuchungController {
  constructor(
    private readonly stunden: StundenbuchungService,
    private readonly kalender: StundenKalenderService
  ) {}

  // Vor dem Lesen nachziehen: wer die Stunden oeffnet, soll die Termine sehen,
  // die seit dem letzten Besuch zu Ende gegangen sind (Konzept 3.3).
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const filter = leseFilter(query);
    await this.kalender.nachziehenStill();
    return this.stunden.findeAlle(filter);
  }

  /** Die Web-App ruft das beim Start auf -- "Heute" und Anmeldung (Konzept 3.3). */
  @Post("kalender/nachziehen")
  @HttpCode(200)
  async nachziehen() {
    return this.kalender.nachziehen();
  }

  @Get("kalender/vormerkungen")
  async vormerkungen() {
    return this.kalender.vormerkungen();
  }

  @Get("kalender/einstellungen")
  async kalenderEinstellungen() {
    return this.kalender.einstellungen();
  }

  @Put("kalender/einstellungen")
  async kalenderEinstellungenSpeichern(@Body() body: unknown) {
    const eingabe = eigeneEinstellungSchema.safeParse(body);
    if (!eingabe.success) throw new BadRequestException(eingabe.error.issues.map((i) => i.message).join(" "));
    return this.kalender.eigeneSpeichern(eingabe.data);
  }

  @Put("kalender/traeger")
  async kalenderTraegerSpeichern(@Body() body: unknown) {
    const eingabe = traegerEinstellungSchema.safeParse(body);
    if (!eingabe.success) throw new BadRequestException(eingabe.error.issues.map((i) => i.message).join(" "));
    return this.kalender.traegerSpeichern(eingabe.data);
  }

  @Get("rechte")
  async rechte() {
    return this.stunden.meineRechte();
  }

  @Get("summen")
  async summen(@Query() query: Record<string, unknown>) {
    return this.stunden.summen(leseFilter(query));
  }

  // Idempotency-Key als Header, optional -- wie beim Kassenbuch (0062).
  @Post()
  async anlegen(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotenzSchluessel: string | undefined,
    @Res({ passthrough: true }) res: Response
  ) {
    if (idempotenzSchluessel !== undefined && !z.string().uuid().safeParse(idempotenzSchluessel).success) {
      throw new BadRequestException("Idempotency-Key muss eine UUID sein.");
    }
    const eingabe = anlegenSchema.safeParse(body);
    if (!eingabe.success) throw new BadRequestException(eingabe.error.issues.map((i) => i.message).join(" "));
    const { buchung, wiederholt } = await this.stunden.anlegenIdempotent(
      eingabe.data as Parameters<StundenbuchungService["anlegenIdempotent"]>[0],
      idempotenzSchluessel
    );
    if (wiederholt) res.setHeader("Idempotency-Replayed", "true");
    return buchung;
  }

  @Post(":id/storno")
  async stornieren(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const eingabe = stornoSchema.safeParse(body);
    if (!eingabe.success) throw new BadRequestException(eingabe.error.issues.map((i) => i.message).join(" "));
    return this.stunden.stornieren(id, eingabe.data.grund);
  }
}
