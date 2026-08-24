import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { MandantModule } from "./mandanten/mandant.module";
import { BenutzerModule } from "./benutzer/benutzer.module";

@Module({
  imports: [DatabaseModule, AuthModule, MandantModule, BenutzerModule],
})
export class AppModule {}
