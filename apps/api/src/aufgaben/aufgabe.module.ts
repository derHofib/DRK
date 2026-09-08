import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AufgabeController } from "./aufgabe.controller";
import { AufgabeService } from "./aufgabe.service";

@Module({
  imports: [AuthModule],
  controllers: [AufgabeController],
  providers: [AufgabeService],
})
export class AufgabeModule {}
