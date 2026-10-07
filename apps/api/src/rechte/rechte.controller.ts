import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import type { SimulationDto } from "@zimmerakte/shared";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ErfordertRecht } from "./rechte.decorator";
import { RECHTE_REGISTRY, type RechtRegistryEintrag } from "./registry";
import { RechteService } from "./rechte.service";

/**
 * Die Modul×Aktion-Registry als Daten fuer die Account-Typ-Verwaltung
 * (Organigramm-Plan: "Matrix als Grid-Komponente aus der registry.ts,
 * dieselbe Liste wie serverseitig") -- rein lesend, die Registry ist Code,
 * keine mandantenspezifischen Daten. Gated mit organigramm.manage-
 * permissions, weil ausschliesslich diese eine Seite sie braucht.
 *
 * GET /rechte/simulation ("Anzeigen als...") -- Organigramm-Plan, Schritt
 * 7/UI, fuenfter Teilschritt. Genau ein Query-Parameter ist erlaubt: entweder
 * benutzerId (was gilt fuer diese Person heute effektiv, inkl. Vertretung)
 * oder positionId (was wuerde diese Position allein gewaehren, auch wenn sie
 * noch gar nicht besetzt ist). Derselbe Gate wie /rechte/registry --
 * "Anzeigen als…" deckt auf, wie Rechte fuer eine Person/Position aufgeloest
 * werden, dieselbe Vertraulichkeitsstufe wie die Account-Typ-Verwaltung
 * selbst.
 */
const simulationQuerySchema = z
  .object({ benutzerId: z.string().uuid().optional(), positionId: z.string().uuid().optional() })
  .refine((v) => (v.benutzerId ? 1 : 0) + (v.positionId ? 1 : 0) === 1, "Genau eines von benutzerId oder positionId angeben.");

@Controller("rechte")
@Authenticated()
export class RechteController {
  constructor(private readonly rechte: RechteService) {}

  @Get("registry")
  @ErfordertRecht("organigramm", "manage-permissions")
  registry(): readonly RechtRegistryEintrag[] {
    return RECHTE_REGISTRY;
  }

  @Get("simulation")
  @ErfordertRecht("organigramm", "manage-permissions")
  async simulation(@Query("benutzerId") benutzerId?: string, @Query("positionId") positionId?: string): Promise<SimulationDto> {
    // safeParse + BadRequestException statt ungefangenem ZodError (CLAUDE.md:
    // kein globaler ZodError-Filter, ein durchgereichter ZodError wird zu
    // einem 500 mit Stacktrace).
    const parsed = simulationQuerySchema.safeParse({ benutzerId, positionId });
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Ungültige Anfrage.");

    if (parsed.data.benutzerId) {
      return {
        ziel: { typ: "benutzer", id: parsed.data.benutzerId },
        zellen: await this.rechte.simuliereFuerBenutzer(parsed.data.benutzerId),
      };
    }
    return {
      ziel: { typ: "position", id: parsed.data.positionId! },
      zellen: await this.rechte.simuliereFuerPosition(parsed.data.positionId!),
    };
  }
}
