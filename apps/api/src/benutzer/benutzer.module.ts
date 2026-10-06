import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { BenutzerController } from "./benutzer.controller";
import { BenutzerService } from "./benutzer.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [BenutzerController],
  providers: [BenutzerService],
})
export class BenutzerModule {}
