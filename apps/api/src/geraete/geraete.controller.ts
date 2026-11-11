import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { GeraeteService } from "./geraete.service";

const einloesenSchema = z.object({
  token: z.string().min(1).max(200),
  geraeteName: z.string().trim().min(1).max(80),
  plattform: z.literal("ios"),
});

// Apple-Tokens sind hexadezimal, 32 Byte; Spielraum, weil Apple die Laenge ausdruecklich nicht zusichert.
const pushTokenSchema = z.object({ apnsToken: z.string().regex(/^[0-9a-fA-F]{32,200}$/) });

function lesen<T>(schema: z.ZodType<T>, body: unknown): T {
  const ergebnis = schema.safeParse(body);
  if (!ergebnis.success) throw new BadRequestException("Ungültige Eingabe.");
  return ergebnis.data;
}

@Controller()
export class GeraeteController {
  constructor(private readonly geraete: GeraeteService) {}

  // Eng gedrosselt wie der Login: der Token ist hochentropisch, aber das ist
  // ein Endpunkt ohne Sitzung.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("auth/geraet/einloesen")
  @HttpCode(200)
  async einloesen(@Body() body: unknown) {
    const { token, geraeteName, plattform } = lesen(einloesenSchema, body);
    return this.geraete.kopplungEinloesen(token, geraeteName, plattform);
  }

  @Post("geraete/kopplung")
  @Authenticated()
  async kopplungErstellen() {
    return this.geraete.kopplungErstellen();
  }

  @Get("geraete")
  @Authenticated()
  async liste() {
    return this.geraete.eigeneGeraete();
  }

  @Post("geraete/:id/sperren")
  @Authenticated()
  @HttpCode(204)
  async sperren(@Param("id", ParseUUIDPipe) id: string) {
    await this.geraete.sperren(id);
  }

  @Post("geraete/push-token")
  @Authenticated()
  @HttpCode(204)
  async pushToken(@Req() req: Request, @Body() body: unknown) {
    const { apnsToken } = lesen(pushTokenSchema, body);
    await this.geraete.pushTokenSetzen(req.benutzer?.geraetId, apnsToken);
  }
}
