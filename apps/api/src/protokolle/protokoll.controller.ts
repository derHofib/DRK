import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ProtokollService } from "./protokoll.service";

// Kein globaler ZodError-Filter (CLAUDE.md): ueberall safeParse, sonst 500.
function lies<T>(schema: z.ZodType<T>, wert: unknown): T {
  const r = schema.safeParse(wert);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(" "));
  return r.data;
}

// Die Feldwerte selbst prueft der gemeinsame Auswerter gegen die Definition
// (typFehler/pruefeWerte); hier nur die grobe Form, damit kein beliebiges
// JSON bis in den Service gelangt.
const feldWert = z.union([z.string().max(20000), z.number(), z.boolean(), z.array(z.string().max(200)).max(200), z.null()]);
const werteSchema = z.record(z.string().max(63), feldWert);

const anlegenSchema = z.object({ formularId: z.string().uuid(), klientId: z.string().uuid() });
const speichernSchema = z.object({ werte: werteSchema });
const korrigierenSchema = z.object({
  werte: werteSchema,
  grund: z.string().trim().min(1, "Bitte einen Grund für die Korrektur angeben.").max(1000),
});
const archivierenSchema = z.object({ archiviert: z.boolean() });
const listeSchema = z.object({ klientId: z.string().uuid().optional() });

@Controller()
@Authenticated()
export class ProtokollController {
  constructor(private readonly protokolle: ProtokollService) {}

  @Get("protokolle/rechte")
  rechte() {
    return this.protokolle.rechteFuerMich();
  }

  @Get("formulare")
  formulare() {
    return this.protokolle.formulare();
  }

  @Get("formulare/vorlagen")
  vorlagen() {
    return this.protokolle.vorlagen();
  }

  @Post("formulare/vorlagen/:schluessel")
  vorlageUebernehmen(@Param("schluessel") schluessel: string) {
    return this.protokolle.vorlageUebernehmen(schluessel);
  }

  @Post("formulare/:id/archivieren")
  archivieren(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.protokolle.formularArchivieren(id, lies(archivierenSchema, body).archiviert);
  }

  @Get("protokolle")
  liste(@Query() query: Record<string, unknown>) {
    return this.protokolle.liste(lies(listeSchema, { klientId: query.klientId || undefined }));
  }

  @Post("protokolle")
  anlegen(@Body() body: unknown) {
    return this.protokolle.anlegen(lies(anlegenSchema, body));
  }

  @Get("protokolle/:id")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.detail(id);
  }

  @Get("protokolle/:id/historie")
  historie(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.historie(id);
  }

  @Put("protokolle/:id/entwurf")
  entwurf(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.protokolle.entwurfSpeichern(id, lies(speichernSchema, body).werte);
  }

  @Post("protokolle/:id/abschliessen")
  abschliessen(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.protokolle.abschliessen(id, lies(speichernSchema, body).werte);
  }

  @Post("protokolle/:id/korrektur")
  korrigieren(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { werte, grund } = lies(korrigierenSchema, body);
    return this.protokolle.korrigieren(id, werte, grund);
  }

  @Delete("protokolle/:id")
  async loeschen(@Param("id", ParseUUIDPipe) id: string) {
    await this.protokolle.entwurfLoeschen(id);
    return { ok: true };
  }
}
