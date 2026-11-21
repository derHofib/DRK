import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { TeilnehmerAuthenticated } from "../common/authenticated.decorator";
import { KalenderService } from "./kalender.service";
import { leistungsartSchema, terminAnlegenSchema } from "./termin.schemas";

const aendernSchema = z
  .object({
    titel: z.string().trim().min(1, "Titel darf nicht leer sein.").max(200, "Titel ist zu lang (höchstens 200 Zeichen).").optional(),
    beschreibung: z.string().max(5000, "Beschreibung ist zu lang.").nullable().optional(),
    ort: z.string().max(300, "Ort ist zu lang.").nullable().optional(),
    beginn: z.string().optional(),
    ende: z.string().optional(),
    ganztaegig: z.boolean().optional(),
    typId: z.string().uuid("Unbekannter Termintyp.").optional(),
    stundenErfassen: z.boolean().optional(),
    stundenLeistungsart: leistungsartSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld muss angegeben werden.");

const antwortSchema = z.object({ antwort: z.enum(["offen", "zugesagt", "abgelehnt"]), stundenErfassen: z.boolean().optional() });
const stundenSchema = z.object({ erfassen: z.boolean() }).strict();

const zeitraumSchema = z.object({
  von: z.string({ required_error: "„von“ ist erforderlich." }),
  bis: z.string({ required_error: "„bis“ ist erforderlich." }),
});

@Controller("kalender")
@TeilnehmerAuthenticated()
export class KalenderController {
  constructor(private readonly kalender: KalenderService) {}

  @Get("termine")
  async liste(@Query() query: unknown) {
    const { von, bis } = zeitraumSchema.parse(query);
    return this.kalender.liste(von, bis);
  }

  @Get("teilnehmer-auswahl")
  async teilnehmerAuswahl() {
    return this.kalender.teilnehmerAuswahl();
  }

  @Get("termine/:id")
  async einzeln(@Param("id") id: string) {
    return this.kalender.einzeln(id);
  }

  @Get("termine/:id/ics")
  async ics(@Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const { dateiname, inhalt } = await this.kalender.ics(id);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${dateiname}"`);
    return inhalt;
  }

  @Post("termine")
  async anlegen(@Body() body: unknown) {
    return this.kalender.anlegen(terminAnlegenSchema.parse(body));
  }

  @Patch("termine/:id")
  async aendern(@Param("id") id: string, @Body() body: unknown) {
    return this.kalender.aendern(id, aendernSchema.parse(body));
  }

  // 200 statt 201: die Aktionen legen nichts Neues unter eigener URL an.
  @Post("termine/:id/absagen")
  @HttpCode(200)
  async absagen(@Param("id") id: string) {
    return this.kalender.absagen(id);
  }

  @Post("termine/:id/antwort")
  @HttpCode(200)
  async antworten(@Param("id") id: string, @Body() body: unknown) {
    const { antwort, stundenErfassen } = antwortSchema.parse(body);
    return this.kalender.antworten(id, antwort, stundenErfassen);
  }

  /** Eigene Vormerkung "Als Betreuungszeit erfassen" (migrations/0080). */
  @Post("termine/:id/stunden")
  @HttpCode(200)
  async stunden(@Param("id") id: string, @Body() body: unknown) {
    return this.kalender.stundenVormerken(id, stundenSchema.parse(body).erfassen);
  }

  @Post("termine/:id/uebernehmen")
  @HttpCode(200)
  async uebernehmen(@Param("id") id: string) {
    return this.kalender.uebernehmen(id);
  }
}
