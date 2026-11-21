import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { StundenbuchungModule } from "../stunden/stundenbuchung.module";
import { AbwesenheitController } from "./abwesenheit.controller";
import { AbwesenheitService } from "./abwesenheit.service";
import { KalenderController } from "./kalender.controller";
import { KalenderService } from "./kalender.service";
import { TerminTypController } from "./termin-typ.controller";
import { TerminTypService } from "./termin-typ.service";

@Module({
  imports: [AuthModule, RechteModule, StundenbuchungModule],
  // Abwesenheiten zuerst: "kalender/abwesenheiten" darf nicht von einer
  // allgemeineren Route des Kalender-Controllers geschluckt werden.
  controllers: [AbwesenheitController, TerminTypController, KalenderController],
  providers: [KalenderService, AbwesenheitService, TerminTypService],
  exports: [KalenderService],
})
export class KalenderModule {}
