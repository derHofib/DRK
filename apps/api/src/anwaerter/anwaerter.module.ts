import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KlientModule } from "../klienten/klient.module";
import { RechteModule } from "../rechte/rechte.module";
import { AnwaerterController } from "./anwaerter.controller";
import { AnwaerterService } from "./anwaerter.service";

@Module({
  imports: [AuthModule, KlientModule, RechteModule],
  controllers: [AnwaerterController],
  providers: [AnwaerterService],
})
export class AnwaerterModule {}
