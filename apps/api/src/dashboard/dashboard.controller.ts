import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { DashboardService } from "./dashboard.service";

const ermittelnSchema = z.object({
  standortId: z.string().uuid().optional(),
});

/**
 * Ohne "standortId" dieselben Daten fuer jede Rolle -- welche Kacheln davon
 * angezeigt werden, entscheidet ausschliesslich das Frontend (siehe
 * apps/web/src/dashboard/sichtbarkeit.ts). Keine der hier zusammengefassten
 * Zahlen ist rollenabhaengig geheim: "offene Rechnungen" darf z.B. jede
 * Rolle SEHEN, nur den Status AENDERN duerfen ausschliesslich Bereichs-
 * und Einrichtungsleitung (siehe rechnung.service.ts).
 *
 * "standortId" engt die ohnehin schon erlaubte Standort-Menge weiter ein,
 * fuer den Standort-Umschalter im Dashboard (Dashboard.tsx) -- die Pruefung,
 * ob die Auswahl ueberhaupt erlaubt ist, liegt im Service
 * (DashboardService.ermitteln(), via standortIstErlaubt()), nicht hier.
 */
@Controller("dashboard")
@Authenticated()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async ermitteln(@Query() query: unknown) {
    const { standortId } = ermittelnSchema.parse(query);
    return this.dashboard.ermitteln(standortId);
  }
}
