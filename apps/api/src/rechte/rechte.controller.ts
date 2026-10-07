import { Controller, Get } from "@nestjs/common";
import { Authenticated } from "../common/authenticated.decorator";
import { ErfordertRecht } from "./rechte.decorator";
import { RECHTE_REGISTRY, type RechtRegistryEintrag } from "./registry";

/**
 * Die Modul×Aktion-Registry als Daten fuer die Account-Typ-Verwaltung
 * (Organigramm-Plan: "Matrix als Grid-Komponente aus der registry.ts,
 * dieselbe Liste wie serverseitig") -- rein lesend, die Registry ist Code,
 * keine mandantenspezifischen Daten. Gated mit organigramm.manage-
 * permissions, weil ausschliesslich diese eine Seite sie braucht.
 *
 * GET /rechte/simulation ("Anzeigen als...") kommt mit einem spaeteren
 * UI-Teilschritt in diesen Controller dazu (Organigramm-Plan).
 */
@Controller("rechte")
@Authenticated()
export class RechteController {
  @Get("registry")
  @ErfordertRecht("organigramm", "manage-permissions")
  registry(): readonly RechtRegistryEintrag[] {
    return RECHTE_REGISTRY;
  }
}
