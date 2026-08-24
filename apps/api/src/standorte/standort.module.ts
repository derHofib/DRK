import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StandortController } from "./standort.controller";
import { StandortService } from "./standort.service";

@Module({
  imports: [AuthModule],
  controllers: [StandortController],
  providers: [StandortService],
  exports: [StandortService],
})
export class StandortModule {}
