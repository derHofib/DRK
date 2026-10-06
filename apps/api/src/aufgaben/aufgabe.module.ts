import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { AufgabeController } from "./aufgabe.controller";
import { AufgabeService } from "./aufgabe.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [AufgabeController],
  providers: [AufgabeService],
})
export class AufgabeModule {}
