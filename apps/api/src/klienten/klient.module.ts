import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { KlientController } from "./klient.controller";
import { KlientService } from "./klient.service";
import { KlientStammdatenService } from "./klient-stammdaten.service";
import { KlientArchivService } from "./klient-archiv.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [KlientController],
  providers: [KlientService, KlientStammdatenService, KlientArchivService],
  // KlientService wird auch vom AnwaerterModule gebraucht -- eine
  // angenommene Anfrage komponiert ihre Antwort aus dem neu angelegten
  // Klienten (siehe AnwaerterController.annehmen()).
  exports: [KlientService],
})
export class KlientModule {}
