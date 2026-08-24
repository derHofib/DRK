import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";

const loginSchema = z.object({
  mandantSlug: z.string().min(1),
  email: z.string().email(),
  passwort: z.string().min(1),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  async login(@Body() body: unknown) {
    const { mandantSlug, email, passwort } = loginSchema.parse(body);
    return this.auth.login(mandantSlug, email, passwort);
  }
}
