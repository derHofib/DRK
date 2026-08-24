import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { MandantModule } from "./mandanten/mandant.module";
import { BenutzerModule } from "./benutzer/benutzer.module";
import { StandortModule } from "./standorte/standort.module";
import { ZimmerModule } from "./zimmer/zimmer.module";
import { KlientModule } from "./klienten/klient.module";
import { BelegungModule } from "./belegungen/belegung.module";
import { KassenbuchungModule } from "./kassenbuch/kassenbuchung.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    MandantModule,
    BenutzerModule,
    StandortModule,
    ZimmerModule,
    KlientModule,
    BelegungModule,
    KassenbuchungModule,
  ],
})
export class AppModule {}
