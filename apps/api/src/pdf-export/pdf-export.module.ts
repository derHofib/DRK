import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { ProtokollModule } from "../protokolle/protokoll.module";
import { PdfExportController } from "./pdf-export.controller";
import { PdfExportService } from "./pdf-export.service";

@Module({
  // ProtokollService: fuer den Export liest der Dienst das Protokoll ueber
  // dieselbe Rechtepruefung wie die Akte -- kein zweiter Lesepfad.
  imports: [AuthModule, RechteModule, ProtokollModule],
  controllers: [PdfExportController],
  providers: [PdfExportService],
})
export class PdfExportModule {}
