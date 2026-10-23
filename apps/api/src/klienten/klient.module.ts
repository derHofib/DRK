import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { KlientController } from "./klient.controller";
import { KlientService } from "./klient.service";
import { KlientStammdatenService } from "./klient-stammdaten.service";
import { KlientArchivService } from "./klient-archiv.service";
import { KlientZugangService } from "./klient-zugang.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuthModule, RechteModule, AuditModule],
  controllers: [KlientController],
  providers: [KlientService, KlientStammdatenService, KlientArchivService, KlientZugangService],
  // KlientService wird auch vom AnwaerterModule gebraucht -- eine
  // angenommene Anfrage komponiert ihre Antwort aus dem neu angelegten
  // Klienten (siehe AnwaerterController.annehmen()).
  exports: [KlientService],
})
export class KlientModule {}
