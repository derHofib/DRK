import { BadRequestException, Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { MandantService } from "./mandant.service";

const akzentfarbeSchema = z.object({
  // Case-insensitiv annehmen, klein speichern: der CHECK in Migration 0019
  // laesst nur Kleinbuchstaben zu, ein <input type="color"> liefert aber je
  // nach Browser "#5EC4C0". Normalisieren statt ablehnen -- eine gueltige
  // Farbe soll nicht an der Schreibweise scheitern.
  akzentfarbe: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Bitte eine Farbe als Hex-Wert angeben, z. B. #5ec4c0.")
    .transform((wert) => wert.toLowerCase()),
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
  async akzentfarbeSetzen(@Body() body: unknown) {
    // Bewusst safeParse + BadRequestException statt .parse(): ein
    // durchgereichter ZodError ist fuer Nest keine HttpException und wuerde
    // als 500 mit Stacktrace herauskommen. Eine ungueltige Farbe ist aber
    // ein Eingabefehler, kein Serverfehler.
    //
    // Dass die uebrigen Controller hier .parse() benutzen, ist ein
    // bestehendes, groesseres Thema (ein globaler ZodError-Filter waere die
    // richtige Loesung) -- das gehoert nicht in diese Aenderung und wird
    // deshalb nur hier lokal richtig gemacht.
    const ergebnis = akzentfarbeSchema.safeParse(body);
    if (!ergebnis.success) {
      throw new BadRequestException(
        ergebnis.error.issues[0]?.message ?? "Ungültige Farbangabe."
      );
    }
    return this.mandant.setzeAkzentfarbe(ergebnis.data.akzentfarbe);
  }
}
