import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";

// Derselbe Wert, der frueher als stiller Fallback diente -- hier nur noch
// als Erkennungsmerkmal, um auch ein versehentlich aus .env.example
// kopiertes Secret abzulehnen, nicht nur ein fehlendes.
const DEV_DEFAULT = "dev_only_change_me_in_production";

function jwtSecret(): string {
  const wert = process.env.JWT_SECRET;
  if (!wert || wert === DEV_DEFAULT) {
    throw new Error(
      "JWT_SECRET ist nicht gesetzt oder verwendet den Dev-Default -- siehe .env.example. " +
        "Ohne echtes Secret koennte jeder, der dieses Repository kennt, gueltige Zugriffstoken faelschen."
    );
  }
  if (wert.length < 32) {
    throw new Error("JWT_SECRET ist kuerzer als 32 Zeichen -- zu leicht zu erraten/brute-forcen.");
  }
  return wert;
}

@Module({
  imports: [
    // registerAsync statt register: der Factory-Aufruf laeuft bei der
    // DI-Instanziierung (also sicher NACH loadEnvFromRepoRoot() in
    // main.ts), nicht beim Modul-Import wie ein Literal-Objekt in
    // register(). Genau die Verzoegerung, die DatabaseService fuer
    // APP_DATABASE_URL schon immer per Konstruktor hatte.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: { expiresIn: "8h" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthGuard, JwtModule],
})
export class AuthModule {}
