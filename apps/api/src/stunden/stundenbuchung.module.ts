import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { StundenKalenderService } from "./stunden-kalender.service";
import { StundenbuchungController } from "./stundenbuchung.controller";
import { StundenbuchungService } from "./stundenbuchung.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [StundenbuchungController],
  providers: [StundenbuchungService, StundenKalenderService],
  exports: [StundenKalenderService],
})
export class StundenbuchungModule {}
