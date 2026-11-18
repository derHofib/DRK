import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { ProtokollController } from "./protokoll.controller";
import { ProtokollService } from "./protokoll.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [ProtokollController],
  providers: [ProtokollService],
  // Der Tagesbericht schliesst angeheftete Formulare in seiner Transaktion ab.
  exports: [ProtokollService],
})
export class ProtokollModule {}
