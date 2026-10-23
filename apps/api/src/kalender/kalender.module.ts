import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KalenderController } from "./kalender.controller";
import { KalenderService } from "./kalender.service";

@Module({
  imports: [AuthModule],
  controllers: [KalenderController],
  providers: [KalenderService],
})
export class KalenderModule {}
