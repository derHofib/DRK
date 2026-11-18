import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { AbwesenheitService } from "./abwesenheit.service";

const anlegenSchema = z
  .object({
    benutzerId: z.string().uuid("Ungültige Person.").optional(),
    art: z.enum(["urlaub", "krank", "frei", "fortbildung"], { errorMap: () => ({ message: "Unbekannte Art der Abwesenheit." }) }),
    von: z.string(),
    bis: z.string(),
    notiz: z.string().max(500, "Notiz ist zu lang (höchstens 500 Zeichen).").nullable().optional(),
  })
  .strict();

const zeitraumSchema = z.object({ von: z.string(), bis: z.string() });

/**
 * Bewusst @Authenticated (nur Mitarbeitende), nicht @TeilnehmerAuthenticated
 * wie die Termine: Klient:innen haben an Abwesenheiten des Teams nichts zu
 * sehen. Die RLS-Policy (0074) sperrt sie zusaetzlich aus.
 */
@Controller("kalender/abwesenheiten")
@Authenticated()
export class AbwesenheitController {
  constructor(private readonly abwesenheiten: AbwesenheitService) {}

  @Get()
  async liste(@Query() query: unknown) {
    const ergebnis = zeitraumSchema.safeParse(query);
    if (!ergebnis.success) throw new BadRequestException("„von“ und „bis“ sind erforderlich.");
    return this.abwesenheiten.liste(ergebnis.data.von, ergebnis.data.bis);
  }

  @Get("rechte")
  async rechte() {
    return this.abwesenheiten.meineRechte();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    const ergebnis = anlegenSchema.safeParse(body);
    if (!ergebnis.success) throw new BadRequestException(ergebnis.error.issues[0]?.message ?? "Ungültige Eingabe.");
    return this.abwesenheiten.anlegen(ergebnis.data);
  }

  @Post(":id/stornieren")
  @HttpCode(200)
  async stornieren(@Param("id") id: string) {
    await this.abwesenheiten.stornieren(id);
    return { ok: true };
  }
}
