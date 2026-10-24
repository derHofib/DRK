import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { SucheController } from "./suche.controller";
import { SucheService } from "./suche.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [SucheController],
  providers: [SucheService],
})
export class SucheModule {}
