import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { RechteModule } from "../rechte/rechte.module";
import { StandortController } from "./standort.controller";
import { StandortService } from "./standort.service";
import { StandortPlanController } from "./standort-plan.controller";
import { StandortPlanService } from "./standort-plan.service";
import { StandortKontaktVereinbarungService } from "./standort-kontakt-vereinbarung.service";
import { StandortVereinbarungErinnerungService } from "./standort-vereinbarung-erinnerung.service";

@Module({
  imports: [AuthModule, RechteModule, AuditModule],
  controllers: [StandortController, StandortPlanController],
  providers: [StandortService, StandortPlanService, StandortKontaktVereinbarungService, StandortVereinbarungErinnerungService],
  exports: [StandortService],
})
export class StandortModule {}
