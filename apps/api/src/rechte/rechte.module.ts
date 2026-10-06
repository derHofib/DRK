import { Module } from "@nestjs/common";
import { RechteGuard } from "./rechte.guard";
import { RechteService } from "./rechte.service";

/**
 * Noch ohne eigene Controller/Routen -- dieser Schritt baut nur die
 * Engine selbst (siehe Organigramm-Plan, Lieferreihenfolge Schritt 2).
 * Export von RechteService und RechteGuard, damit kuenftige Controller
 * (ueber @ErfordertRecht()) und Services (Schritt 4: die 14 bestehenden
 * ROLLEN_MIT_*-Stellen) sie nutzen koennen. DatabaseModule ist @Global()
 * (siehe database/database.module.ts) -- kein expliziter Import noetig,
 * gleiches Muster wie in jedem anderen Modul dieses Projekts.
 */
@Module({
  providers: [RechteService, RechteGuard],
  exports: [RechteService, RechteGuard],
})
export class RechteModule {}
