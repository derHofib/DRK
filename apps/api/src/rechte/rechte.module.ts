import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteController } from "./rechte.controller";
import { RechteGuard } from "./rechte.guard";
import { RechteService } from "./rechte.service";

/**
 * RechteService/RechteGuard werden von anderen Modulen importiert (ueber
 * @ErfordertRecht()) und von den umgestellten Services (Schritt 4: die 14
 * ehemaligen ROLLEN_MIT_*-Stellen) genutzt. Seit Schritt 7/UI (Account-
 * Typ-Verwaltung) hat das Modul zusaetzlich einen eigenen Controller
 * (GET /rechte/registry). DatabaseModule ist @Global() (siehe
 * database/database.module.ts) -- kein expliziter Import noetig, gleiches
 * Muster wie in jedem anderen Modul dieses Projekts.
 */
@Module({
  imports: [AuthModule],
  controllers: [RechteController],
  providers: [RechteService, RechteGuard],
  exports: [RechteService, RechteGuard],
})
export class RechteModule {}
