import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { StundenbuchungModule } from "../stunden/stundenbuchung.module";
import { AbwesenheitController } from "./abwesenheit.controller";
import { AbwesenheitService } from "./abwesenheit.service";
import { KalenderController } from "./kalender.controller";
import { KalenderService } from "./kalender.service";

@Module({
  imports: [AuthModule, RechteModule, StundenbuchungModule],
  // Abwesenheiten zuerst: "kalender/abwesenheiten" darf nicht von einer
  // allgemeineren Route des Kalender-Controllers geschluckt werden.
  controllers: [AbwesenheitController, KalenderController],
  providers: [KalenderService, AbwesenheitService],
  exports: [KalenderService],
})
export class KalenderModule {}
