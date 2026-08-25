import { Body, Controller, Get, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { AuthService } from "./auth.service";

// Enger als die globale Schranke (100/min, app.module.ts) -- das hier sind
// die Endpunkte, an denen ein Angreifer tatsaechlich etwas erraten koennte
// (Passwort, TOTP-Code). 10/min laesst normales Vertippen zu, macht
// Durchprobieren aber unwirtschaftlich langsam.
const RATEN_SCHRANKE = { default: { limit: 10, ttl: 60_000 } };

const loginSchema = z.object({
  mandantSlug: z.string().min(1),
  email: z.string().email(),
  passwort: z.string().min(1),
});

const totpVerifizierenSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(6).max(8),
});

const totpCodeSchema = z.object({
  code: z.string().min(6).max(8),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(RATEN_SCHRANKE)
  @Post("login")
  async login(@Body() body: unknown) {
    const { mandantSlug, email, passwort } = loginSchema.parse(body);
    return this.auth.login(mandantSlug, email, passwort);
  }

  @Throttle(RATEN_SCHRANKE)
  @Post("login/totp")
  async loginTotp(@Body() body: unknown) {
    const { pendingToken, code } = totpVerifizierenSchema.parse(body);
    return this.auth.totpVerifizieren(pendingToken, code);
  }

  @Get("totp/status")
  @Authenticated()
  async totpStatus() {
    return this.auth.status();
  }

  @Post("totp/einrichten")
  @Authenticated()
  async totpEinrichten() {
    return this.auth.einrichten();
  }

  @Throttle(RATEN_SCHRANKE)
  @Post("totp/aktivieren")
  @Authenticated()
  async totpAktivieren(@Body() body: unknown) {
    const { code } = totpCodeSchema.parse(body);
    await this.auth.aktivieren(code);
    return { aktiviert: true };
  }

  @Throttle(RATEN_SCHRANKE)
  @Post("totp/deaktivieren")
  @Authenticated()
  async totpDeaktivieren(@Body() body: unknown) {
    const { code } = totpCodeSchema.parse(body);
    await this.auth.deaktivieren(code);
    return { aktiviert: false };
  }
}
