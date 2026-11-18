import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { ANHEFTPUNKTE, type Anheftpunkt, type FormularDefinition } from "@zimmerakte/shared";
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
const anlegenFormularSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(120),
  beschreibung: z.string().trim().max(500).nullish(),
});
// Die Definition prueft der Service (strukturFehler, beim Veroeffentlichen
// pruefeDefinition); hier nur, dass es ueberhaupt ein Objekt ist.
const definitionSchema = z.object({ definition: z.object({ bausteine: z.array(z.unknown()) }).passthrough() });
const anheftpunktSchema = z.enum(Object.keys(ANHEFTPUNKTE) as [Anheftpunkt, ...Anheftpunkt[]]);
const einstellungenSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(120),
  beschreibung: z.string().trim().max(500).nullish(),
  standortIds: z.array(z.string().uuid()).max(200),
  anheftungen: z
    .array(z.object({
        anheftpunkt: anheftpunktSchema,
        modus: z.enum(["automatisch", "dazunehmen"]),
        pflicht: z.boolean(),
        // Default fuer aeltere Oberflaechen, die das Feld noch nicht schicken.
        darstellung: z.enum(["ergaenzt", "ersetzt"]).default("ergaenzt"),
      }))
    .max(20),
});
const angebotSchema = z.object({ klientId: z.string().uuid(), anheftpunkt: anheftpunktSchema.optional() });
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
    return this.protokolle.verwaltungsListe();
  }

  @Post("formulare")
  formularAnlegen(@Body() body: unknown) {
    const { name, beschreibung } = lies(anlegenFormularSchema, body);
    return this.protokolle.formularAnlegen({ name, beschreibung: beschreibung || null });
  }

  @Get("formulare/angebot")
  angebot(@Query() query: Record<string, unknown>) {
    return this.protokolle.angebot(lies(angebotSchema, { klientId: query.klientId, anheftpunkt: query.anheftpunkt || undefined }));
  }

  @Get("formulare/:id")
  formular(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.verwaltungsDetail(id);
  }

  @Get("formulare/:id/kennzahlen")
  kennzahlen(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.kennzahlen(id);
  }

  @Delete("formulare/:id")
  async formularLoeschen(@Param("id", ParseUUIDPipe) id: string) {
    await this.protokolle.formularLoeschen(id);
    return { ok: true };
  }

  @Post("formulare/:id/entwurf")
  entwurfStarten(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.entwurfStarten(id);
  }

  @Put("formulare/:id/entwurf")
  formularEntwurf(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.protokolle.formularEntwurfSpeichern(id, lies(definitionSchema, body).definition as unknown as FormularDefinition);
  }

  @Delete("formulare/:id/entwurf")
  entwurfVerwerfen(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.entwurfVerwerfen(id);
  }

  @Post("formulare/:id/veroeffentlichen")
  veroeffentlichen(@Param("id", ParseUUIDPipe) id: string) {
    return this.protokolle.veroeffentlichen(id);
  }

  @Put("formulare/:id/einstellungen")
  einstellungen(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const e = lies(einstellungenSchema, body);
    return this.protokolle.einstellungenSpeichern(id, {
      ...e,
      beschreibung: e.beschreibung || null,
      anheftungen: e.anheftungen.map((a) => ({ ...a, darstellung: a.darstellung ?? "ergaenzt" })),
    });
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
