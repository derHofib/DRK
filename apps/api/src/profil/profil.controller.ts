import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { z } from "zod";
import { Authenticated, TeilnehmerAuthenticated } from "../common/authenticated.decorator";
import { ProfilService } from "./profil.service";

// Leere Eingabe heisst "nicht angegeben" -- die Spalten sind NULL oder gefuellt, nie "".
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === "" ? null : v));

const freigabe = z.object({ zugeordnet: z.boolean(), andere: z.boolean() });

const speichernSchema = z
  .object({
    telefon: text(40),
    bevorzugteKontaktart: z.enum(["telefon", "chat", "email"]).nullable(),
    erreichbarkeit: text(200),
    emailDienstlich: text(200).refine((v) => v === null || v.length >= 3, "Ungültige E-Mail-Adresse.").refine(
      (v) => v === null || z.string().email().safeParse(v).success,
      "Ungültige E-Mail-Adresse."
    ),
    ueberMich: text(1000),
    sichtbarkeit: z.object({ telefon: freigabe, kontakt: freigabe, email: freigabe, ueberMich: freigabe }),
  })
  .refine(
    (v) => Object.values(v.sichtbarkeit).every((f) => !f.andere || f.zugeordnet),
    "Was alle Klient:innen sehen dürfen, muss auch die Bezugsbetreuung sehen dürfen."
  );

/** Mitarbeitende: eigenes Profil pflegen, Profile der Kolleg:innen ansehen. */
@Controller("profil")
@Authenticated()
export class ProfilController {
  constructor(private readonly profil: ProfilService) {}

  @Get("ich")
  async ich() {
    return this.profil.eigenes();
  }

  @Put("ich")
  async ichSpeichern(@Body() body: unknown) {
    // safeParse statt parse: kein globaler ZodError-Filter, sonst waere das ein 500.
    const eingabe = speichernSchema.safeParse(body);
    if (!eingabe.success) throw new BadRequestException(eingabe.error.issues[0]?.message ?? "Ungültige Eingabe.");
    return this.profil.eigenesSpeichern(eingabe.data);
  }

  @Get("kollegen")
  async kollegen() {
    return this.profil.alleKollegen();
  }

  @Get("kollegen/:id")
  async kollege(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.profil.vonKollege(id);
  }
}

/** Klient:innen: das freigegebene Profil einer Mitarbeiter:in, die sie ohnehin sehen koennen. */
@Controller("mitarbeiter-profil")
@TeilnehmerAuthenticated()
export class MitarbeiterProfilKlientController {
  constructor(private readonly profil: ProfilService) {}

  @Get(":id")
  async fuerKlient(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.profil.fuerKlient(id);
  }
}
