import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { DatabaseModule } from "./database/database.module";
import { ZodExceptionFilter } from "./common/zod-exception.filter";
import { PostgresExceptionFilter } from "./common/postgres-exception.filter";
import { AuthModule } from "./auth/auth.module";
import { MandantModule } from "./mandanten/mandant.module";
import { BenutzerModule } from "./benutzer/benutzer.module";
import { StandortModule } from "./standorte/standort.module";
import { ZimmerModule } from "./zimmer/zimmer.module";
import { KlientModule } from "./klienten/klient.module";
import { BelegungModule } from "./belegungen/belegung.module";
import { KassenbuchungModule } from "./kassenbuch/kassenbuchung.module";
import { KostenuebernahmeModule } from "./kostenuebernahmen/kostenuebernahme.module";
import { RechnungModule } from "./rechnungen/rechnung.module";
import { TagesberichtModule } from "./tagesberichte/tagesbericht.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { AufgabeModule } from "./aufgaben/aufgabe.module";

@Module({
  imports: [
    // Globale Grundschranke gegen automatisiertes Durchprobieren -- die
    // deutlich engere Schranke fuer Login/TOTP sitzt direkt an den
    // betroffenen Endpunkten (auth.controller.ts), per @Throttle
    // ueberschrieben. Ohne diese Grundschranke waere jeder andere
    // Endpunkt (z.B. GET /klienten) ungebremst automatisiert abfragbar.
    //
    // skipIf: die e2e-Specs bauen AppModule direkt (Test.createTestingModule)
    // und loggen sich dabei in schneller Folge dutzendfach ein (siehe
    // mandant-branding.e2e-spec.ts) -- das ist legitime Testlast, kein
    // Angriff, wuerde aber gegen dieselbe Schranke laufen wie ein echter
    // Client. Per Default (Jest setzt NODE_ENV=test) bleibt die Schranke
    // deshalb im Testlauf aus. rate-limit.e2e-spec.ts schaltet sie ueber
    // RATE_LIMIT_TESTEN=1 gezielt fuer sich selbst wieder ein -- das ist der
    // einzige Ort, an dem die Schranke tatsaechlich gegen echte Anfragen
    // geprueft wird ("Pruefen statt behaupten").
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === "test" && process.env.RATE_LIMIT_TESTEN !== "1",
    }),
    DatabaseModule,
    AuthModule,
    MandantModule,
    BenutzerModule,
    StandortModule,
    ZimmerModule,
    KlientModule,
    BelegungModule,
    KassenbuchungModule,
    KostenuebernahmeModule,
    RechnungModule,
    TagesberichtModule,
    DashboardModule,
    AufgabeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Reihenfolge wichtig -- und zwar GENAU ANDERSHERUM als man erwarten
    // wuerde: Nest loest mehrere APP_FILTER-Provider in umgekehrter
    // Registrierungsreihenfolge auf (empirisch mit einer Gegenprobe
    // bestaetigt, nicht angenommen). PostgresExceptionFilter (@Catch() ohne
    // Typ, matcht alles) muss deshalb ZUERST hier stehen, damit
    // ZodExceptionFilter (spezifisch fuer ZodError) am Ende der intern
    // aufgebauten Liste landet und zuerst geprueft wird.
    { provide: APP_FILTER, useClass: PostgresExceptionFilter },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
export class AppModule {}
