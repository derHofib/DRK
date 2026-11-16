import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { StundenbuchungController } from "./stundenbuchung.controller";
import { StundenbuchungService } from "./stundenbuchung.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [StundenbuchungController],
  providers: [StundenbuchungService],
})
export class StundenbuchungModule {}
