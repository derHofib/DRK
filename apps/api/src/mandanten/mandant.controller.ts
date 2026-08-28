import { Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { MandantService } from "./mandant.service";

// Case-insensitiv annehmen, klein speichern: der CHECK in Migration 0019/
// 0029 laesst nur Kleinbuchstaben zu, ein <input type="color"> liefert aber
// je nach Browser "#5EC4C0". Normalisieren statt ablehnen -- eine gueltige
// Farbe soll nicht an der Schreibweise scheitern.
const hexFarbe = (beispiel: string) =>
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, `Bitte eine Farbe als Hex-Wert angeben, z. B. ${beispiel}.`)
    .transform((wert) => wert.toLowerCase());

// Beide Felder optional, aber mindestens eins muss da sein -- die
// Traegerfarbe und die dunkle Grundfarbe werden im Einstellungsformular
// unabhaengig voneinander gespeichert (siehe Einstellungen.tsx), teilen
// sich aber denselben Endpunkt und dieselbe Rollenpruefung.
const erscheinungsbildSchema = z
  .object({
    akzentfarbe: hexFarbe("#e3000f").optional(),
    dunkelGrundfarbe: hexFarbe("#10131a").optional(),
  })
  .refine((wert) => wert.akzentfarbe !== undefined || wert.dunkelGrundfarbe !== undefined, {
    message: "Mindestens akzentfarbe oder dunkelGrundfarbe angeben.",
  });

@Controller("mandant")
@Authenticated()
export class MandantController {
  constructor(private readonly mandant: MandantService) {}

  @Get("me")
  async me() {
    return this.mandant.findEigenenMandanten();
  }

  /**
   * Die Rollenpruefung sitzt bewusst im Service, nicht hier: dort liegt sie
   * neben dem SQL, das sie schuetzt, und gilt auch fuer jeden kuenftigen
   * Aufrufer, der nicht ueber diesen Controller kommt.
   */
  @Patch("me")
  async erscheinungsbildAendern(@Body() body: unknown) {
    // .parse() statt safeParse(): ein durchgereichter ZodError wird global
    // von ZodExceptionFilter (common/zod-exception.filter.ts) in ein 400
    // uebersetzt, wie fuer jeden anderen Controller auch. Vor dessen
    // Einfuehrung war das hier lokal mit safeParse + BadRequestException
    // geloest -- siehe Commit-Historie, falls das Muster woanders noch
    // gebraucht wird.
    const patch = erscheinungsbildSchema.parse(body);
    return this.mandant.aktualisiereErscheinungsbild(patch);
  }
}
