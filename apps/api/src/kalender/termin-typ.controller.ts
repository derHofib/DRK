import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { TERMIN_TYP_BETREUUNGSZEITEN, TERMIN_TYP_FARBEN, type TerminTypBetreuungszeit, type TerminTypFarbe } from "@zimmerakte/shared";
import { Authenticated } from "../common/authenticated.decorator";
import { leistungsartSchema } from "./termin.schemas";
import { TerminTypService } from "./termin-typ.service";

const bezeichnungSchema = z
  .string()
  .trim()
  .min(1, "Bezeichnung darf nicht leer sein.")
  .max(60, "Bezeichnung ist zu lang (höchstens 60 Zeichen).");
const farbeSchema = z.enum(TERMIN_TYP_FARBEN as unknown as [TerminTypFarbe, ...TerminTypFarbe[]], {
  errorMap: () => ({ message: "Unbekannte Farbe." }),
});
const betreuungszeitSchema = z.enum(TERMIN_TYP_BETREUUNGSZEITEN as unknown as [TerminTypBetreuungszeit, ...TerminTypBetreuungszeit[]]);

const anlegenSchema = z
  .object({
    bezeichnung: bezeichnungSchema,
    farbe: farbeSchema,
    betreuungszeit: betreuungszeitSchema,
    leistungsart: leistungsartSchema.nullable(),
  })
  .strict();

const aendernSchema = z
  .object({
    bezeichnung: bezeichnungSchema.optional(),
    farbe: farbeSchema.optional(),
    betreuungszeit: betreuungszeitSchema.optional(),
    leistungsart: leistungsartSchema.nullable().optional(),
    aktiv: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld muss angegeben werden.");

const reihenfolgeSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict();

/**
 * Nur Mitarbeitende: Klient:innen waehlen keinen Typ (ihre Termine bekommen
 * den Standardtyp, migrations/0085) und brauchen die Liste nicht.
 */
@Controller("kalender/typen")
@Authenticated()
export class TerminTypController {
  constructor(private readonly typen: TerminTypService) {}

  @Get()
  async liste() {
    return this.typen.liste();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.typen.anlegen(anlegenSchema.parse(body));
  }

  // Vor ":id", sonst faengt PATCH/PUT ":id" "reihenfolge" als ID ab.
  @Put("reihenfolge")
  async reihenfolge(@Body() body: unknown) {
    return this.typen.reihenfolge(reihenfolgeSchema.parse(body).ids);
  }

  @Patch(":id")
  async aendern(@Param("id") id: string, @Body() body: unknown) {
    return this.typen.aendern(z.string().uuid("Ungültiger Termintyp.").parse(id), aendernSchema.parse(body));
  }

  @Delete(":id")
  @HttpCode(204)
  async loeschen(@Param("id") id: string) {
    await this.typen.loeschen(z.string().uuid("Ungültiger Termintyp.").parse(id));
  }
}
