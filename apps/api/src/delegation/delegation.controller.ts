import { Controller, Get } from "@nestjs/common";
import { Authenticated } from "../common/authenticated.decorator";
import { DelegationService } from "./delegation.service";

/**
 * Nur lesend (Organigramm-Plan, Lieferreihenfolge Schritt 6) -- anlegen,
 * genehmigen und widerrufen einer Delegation folgen in einem spaeteren
 * Schritt. Bewusst ohne @ErfordertRecht(): die eigenen Delegationen zu
 * sehen braucht kein besonderes Recht, analog zu z. B.
 * GET /aufgaben?nurEigene=true.
 */
@Controller("delegationen")
@Authenticated()
export class DelegationController {
  constructor(private readonly delegationen: DelegationService) {}

  @Get("meine")
  async meine() {
    return this.delegationen.meineDelegationen();
  }
}
