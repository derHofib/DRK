import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { VerlaufController } from "./verlauf.controller";
import { VerlaufService } from "./verlauf.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [VerlaufController],
  providers: [VerlaufService],
})
export class VerlaufModule {}
