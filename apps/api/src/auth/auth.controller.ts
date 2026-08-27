import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
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

const passwortAendernSchema = z.object({
  aktuellesPasswort: z.string().min(1),
  neuesPasswort: z.string().min(8),
});

const passwortResetEinloesenSchema = z.object({
  token: z.string().min(1),
  neuesPasswort: z.string().min(8),
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

  @Throttle(RATEN_SCHRANKE)
  @Patch("passwort")
  @Authenticated()
  async passwortAendern(@Body() body: unknown) {
    const { aktuellesPasswort, neuesPasswort } = passwortAendernSchema.parse(body);
    await this.auth.passwortAendern(aktuellesPasswort, neuesPasswort);
    return { ok: true };
  }

  // Bewusst OHNE @Authenticated(): wer diesen Endpunkt aufruft, ist per
  // Definition ausgesperrt und kann sich nicht erst einloggen. Der Schutz
  // liegt im Token selbst (256 Bit, siehe common/reset-token.ts) und in der
  // engen Raten-Schranke -- derselbe Grundsatz wie beim Login.
  @Throttle(RATEN_SCHRANKE)
  @Post("passwort-reset/einloesen")
  async passwortResetEinloesen(@Body() body: unknown) {
    const { token, neuesPasswort } = passwortResetEinloesenSchema.parse(body);
    await this.auth.passwortZuruecksetzenEinloesen(token, neuesPasswort);
    return { ok: true };
  }
}
