import { Controller, Get } from "@nestjs/common";
import { Authenticated } from "../common/authenticated.decorator";
import { DashboardService } from "./dashboard.service";

/**
 * Eine Antwort, dieselben Daten fuer jede Rolle -- welche Kacheln davon
 * angezeigt werden, entscheidet ausschliesslich das Frontend (siehe
 * apps/web/src/dashboard/sichtbarkeit.ts). Keine der hier zusammengefassten
 * Zahlen ist rollenabhaengig geheim: "offene Rechnungen" darf z.B. jede
 * Rolle SEHEN, nur den Status AENDERN duerfen ausschliesslich Bereichs-
 * und Einrichtungsleitung (siehe rechnung.service.ts).
 */
@Controller("dashboard")
@Authenticated()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async ermitteln() {
    return this.dashboard.ermitteln();
  }
}
