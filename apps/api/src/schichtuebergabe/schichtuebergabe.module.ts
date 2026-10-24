import { Module } from "@nestjs/common";
import { AufgabeModule } from "../aufgaben/aufgabe.module";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { SchichtuebergabeController } from "./schichtuebergabe.controller";
import { SchichtuebergabeService } from "./schichtuebergabe.service";

@Module({
  imports: [AuthModule, RechteModule, AufgabeModule],
  controllers: [SchichtuebergabeController],
  providers: [SchichtuebergabeService],
})
export class SchichtuebergabeModule {}
