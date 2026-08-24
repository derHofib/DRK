import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BenutzerController } from "./benutzer.controller";
import { BenutzerService } from "./benutzer.service";

@Module({
  imports: [AuthModule],
  controllers: [BenutzerController],
  providers: [BenutzerService],
})
export class BenutzerModule {}
