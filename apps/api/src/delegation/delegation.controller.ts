import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { DelegationService } from "./delegation.service";

const anlegenSchema = z.object({
  vertreterBenutzerId: z.string().uuid(),
  von: z.string().date(),
  bis: z.string().date(),
  umfang: z.enum(["alle", "auswahl"]),
  sensibleRechteEingeschlossen: z.boolean().optional(),
  rechte: z.array(z.object({ modul: z.string().min(1), aktion: z.string().min(1) })).optional(),
});

/**
 * anlegen/genehmigen/widerrufen sind bewusst NUR mit @Authenticated()
 * gegated, kein @ErfordertRecht() -- die fachliche Berechtigung ("bin ich
 * Vertretener/Vertreter GENAU dieser Zeile") ist spezifisch fuer den
 * einzelnen Datensatz, kein globales Modul-Recht. Deshalb pruefen die
 * Service-Methoden das selbst (analog zu meineDelegationen()/
 * GET /aufgaben?nurEigene=true).
 */
@Controller("delegationen")
@Authenticated()
export class DelegationController {
  constructor(private readonly delegationen: DelegationService) {}

  @Get("meine")
  async meine() {
    return this.delegationen.meineDelegationen();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.delegationen.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id/genehmigen")
  async genehmigen(@Param("id") id: string) {
    return this.delegationen.genehmigen(id);
  }

  @Patch(":id/widerrufen")
  async widerrufen(@Param("id") id: string) {
    return this.delegationen.widerrufen(id);
  }
}
