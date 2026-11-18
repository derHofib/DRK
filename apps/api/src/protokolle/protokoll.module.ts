import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { ProtokollController } from "./protokoll.controller";
import { ProtokollService } from "./protokoll.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [ProtokollController],
  providers: [ProtokollService],
})
export class ProtokollModule {}
