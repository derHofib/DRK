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

// Klient:in ODER Standort ODER nichts -- welches passt, entscheidet die
// Zuordnung des Formulars im Service (und der Trigger aus 0083).
const anlegenSchema = z.object({
  formularId: z.string().uuid(),
  klientId: z.string().uuid().nullish(),
  standortId: z.string().uuid().nullish(),
});
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
  // Default fuer aeltere Oberflaechen, die das Feld noch nicht schicken.
  aufDokumentation: z.boolean().default(true),
});
const angebotSchema = z.object({ klientId: z.string().uuid(), anheftpunkt: anheftpunktSchema.optional() });
// Die Base64-Grenze liegt ueber dem Bildlimit im Service (300 KB -> ~400 KB Base64).
const unterschreibenSchema = z.object({
  baustein: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Ungültiger Baustein."),
  platz: z.string().regex(/^[a-z0-9]{1,24}$/, "Ungültiger Platz."),
  bild: z.string().min(1, "Bitte unterschreiben.").max(420_000, "Die Unterschrift ist zu groß."),
  ort: z.string().trim().max(80, "Der Ort ist zu lang.").nullish(),
  name: z.string().trim().max(120, "Der Name ist zu lang.").nullish(),
});
const listeSchema = z.object({ klientId: z.string().uuid().optional(), formularId: z.string().uuid().optional() });

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

  @Get("formulare/dokumentation")
  dokumentationsAngebot() {
    return this.protokolle.dokumentationsAngebot();
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
      aufDokumentation: e.aufDokumentation ?? true,
      anheftungen: e.anheftungen.map((a) => ({ ...a, darstellung: a.darstellung ?? "ergaenzt" })),
    });
  }

  @Post("formulare/:id/archivieren")
  archivieren(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.protokolle.formularArchivieren(id, lies(archivierenSchema, body).archiviert);
  }

  @Get("protokolle")
  liste(@Query() query: Record<string, unknown>) {
    return this.protokolle.liste(
      lies(listeSchema, { klientId: query.klientId || undefined, formularId: query.formularId || undefined })
    );
  }

  @Post("protokolle")
  anlegen(@Body() body: unknown) {
    return this.protokolle.anlegen(lies(anlegenSchema, body));
  }

  // Vor protokolle/:id, sonst faengt die UUID-Route diesen Pfad.
  @Get("protokolle/zu-unterschreiben")
  zuUnterschreiben() {
    return this.protokolle.zuUnterschreiben();
  }

  @Post("protokolle/:id/unterschriften")
  unterschreiben(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const u = lies(unterschreibenSchema, body);
    return this.protokolle.unterschreiben(id, { baustein: u.baustein, platz: u.platz, bildBase64: u.bild, ort: u.ort || null, name: u.name || null });
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
