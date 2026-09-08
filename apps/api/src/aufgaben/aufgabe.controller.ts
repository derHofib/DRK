import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { AufgabePrioritaet, AufgabeService } from "./aufgabe.service";

const prioritaetSchema = z.enum(["niedrig", "normal", "hoch"]);

const anlegenSchema = z.object({
  // .trim() VOR .min(1): sonst zaehlt reines Leerraum-Padding als
  // gueltiger Inhalt und legt eine fachlich leere Aufgabe an.
  titel: z.string().trim().min(1, "Titel darf nicht leer sein."),
  beschreibung: z.string().trim().min(1, "Beschreibung darf nicht leer sein.").optional(),
  prioritaet: prioritaetSchema.optional(),
  faelligAm: z.string().date().optional(),
  zimmerId: z.string().uuid().optional(),
  zugewiesenAn: z.string().uuid().optional(),
});

const aktualisierenSchema = z
  .object({
    titel: z.string().trim().min(1, "Titel darf nicht leer sein.").optional(),
    beschreibung: z.string().trim().min(1, "Beschreibung darf nicht leer sein.").nullable().optional(),
    prioritaet: prioritaetSchema.optional(),
    faelligAm: z.string().date().nullable().optional(),
    zugewiesenAn: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld muss angegeben werden.");

@Controller()
@Authenticated()
export class AufgabeController {
  constructor(private readonly aufgaben: AufgabeService) {}

  @Get("aufgaben")
  async liste(
    @Query("zimmerId") zimmerId?: string,
    @Query("zugewiesenAn") zugewiesenAn?: string,
    @Query("nurEigene") nurEigene?: string,
    @Query("offen") offen?: string,
    @Query("faelligBis") faelligBis?: string,
    @Query("prioritaet") prioritaet?: string,
    @Query("sortierung") sortierung?: string
  ) {
    const prioritaetGeprueft = prioritaetSchema.safeParse(prioritaet);
    return this.aufgaben.findeAlle({
      zimmerId,
      zugewiesenAn,
      nurEigene: nurEigene === "true",
      offen: offen === "true" ? true : offen === "false" ? false : undefined,
      faelligBis,
      prioritaet: prioritaetGeprueft.success ? (prioritaetGeprueft.data as AufgabePrioritaet) : undefined,
      sortierung: sortierung === "prioritaet" ? "prioritaet" : "faelligkeit",
    });
  }

  @Get("aufgaben/anzahl-offen")
  async anzahlOffen() {
    return this.aufgaben.zaehleOffene();
  }

  @Post("aufgaben")
  async anlegen(@Body() body: unknown) {
    return this.aufgaben.anlegen(anlegenSchema.parse(body));
  }

  @Patch("aufgaben/:id")
  async aktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.aufgaben.aktualisieren(id, aktualisierenSchema.parse(body));
  }

  // Bewusst kein @Body() hier: erledigt_am/erledigt_von werden ausschliesslich
  // serverseitig gesetzt (siehe aufgabe.service.ts), ein manipulierter
  // Body wird nicht nur ignoriert, sondern gar nicht erst gelesen.
  @Patch("aufgaben/:id/erledigen")
  async erledigen(@Param("id") id: string) {
    return this.aufgaben.erledigen(id);
  }

  @Delete("aufgaben/:id")
  async loeschen(@Param("id") id: string) {
    await this.aufgaben.loeschen(id);
    return { ok: true };
  }
}
