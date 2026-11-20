import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { VerlaufService } from "./verlauf.service";

// Kein globaler ZodError-Filter (CLAUDE.md): safeParse + BadRequestException.
function pruefe<T>(schema: z.ZodType<T>, wert: unknown): T {
  const r = schema.safeParse(wert);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(" "));
  return r.data;
}

const textFeld = (max: number) => z.string().trim().max(max, `Höchstens ${max} Zeichen.`);

const anlegenSchema = z.object({
  art: z.enum(["notiz", "telefonat", "gespraech", "entscheidung"]),
  zeitpunkt: z.string().datetime({ offset: true }).optional(),
  text: z.string().trim().min(1, "Bitte einen Text eingeben.").max(20000),
  gegenueber: textFeld(300).optional(),
  richtung: z.enum(["eingehend", "ausgehend"]).optional(),
  dauerMinuten: z.number().int().min(1).max(1440).optional(),
  gespraechArt: z.enum(["team", "hilfeplan", "klient", "angehoerige", "schule", "amt", "sonstiges"]).optional(),
  teilnehmendeIds: z.array(z.string().uuid()).max(50).optional(),
  ergebnis: textFeld(5000).optional(),
  entschiedenVonId: z.string().uuid().optional(),
  wiedervorlageAm: z.string().date().optional(),
  naechsterSchritt: textFeld(300).optional(),
  aufgabeFaelligAm: z.union([z.string().date(), z.literal("")]).optional(),
});

const korrigierenSchema = z.object({
  text: z.string().trim().min(1, "Bitte einen Text eingeben.").max(20000),
  grund: textFeld(500).optional(),
});

const zeitraumSchema = z
  .object({ von: z.string().date().optional(), bis: z.string().date().optional() })
  .refine((q) => !q.von || !q.bis || q.von <= q.bis, { message: "„von“ darf nicht nach „bis“ liegen." });

@Controller()
@Authenticated()
export class VerlaufController {
  constructor(private readonly verlauf: VerlaufService) {}

  @Get("verlauf/rechte")
  rechte() {
    return this.verlauf.rechteFuerMich();
  }

  @Get("klienten/:id/verlauf")
  liste(@Param("id", ParseUUIDPipe) klientId: string, @Query() query: Record<string, unknown>) {
    const z2 = pruefe(zeitraumSchema, { von: query.von || undefined, bis: query.bis || undefined });
    return this.verlauf.verlauf(klientId, z2);
  }

  @Post("klienten/:id/eintraege")
  anlegen(@Param("id", ParseUUIDPipe) klientId: string, @Body() body: unknown) {
    return this.verlauf.anlegen(klientId, pruefe(anlegenSchema, body));
  }

  @Patch("klient-eintraege/:id")
  korrigieren(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.verlauf.korrigieren(id, pruefe(korrigierenSchema, body));
  }

  @Get("klient-eintraege/:id/historie")
  historie(@Param("id", ParseUUIDPipe) id: string) {
    return this.verlauf.historie(id);
  }
}
