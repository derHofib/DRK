import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { AktenZugriffService } from "./akten-zugriff.service";

// safeParse + BadRequestException: es gibt keinen globalen ZodError-Filter
// (CLAUDE.md), ein durchgereichter ZodError waere ein 500.
const filterSchema = z.object({
  von: z.string().date().optional(),
  bis: z.string().date().optional(),
  benutzerId: z.string().uuid().optional(),
  klientId: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Eigener Pfad statt GET /audit-log: dort gilt organigramm.manage-permissions
// (Rechteverwaltung), hier das eigene Recht klienten.zugriffsprotokoll.
// Die Rechtepruefung selbst steht im Service.
@Controller("audit-log/akten-zugriffe")
@Authenticated()
export class AktenZugriffController {
  constructor(private readonly zugriffe: AktenZugriffService) {}

  @Get()
  async auswerten(@Query() query: Record<string, string | undefined>) {
    const ergebnis = filterSchema.safeParse({
      von: query.von || undefined,
      bis: query.bis || undefined,
      benutzerId: query.benutzerId || undefined,
      klientId: query.klientId || undefined,
      offset: query.offset,
      limit: query.limit,
    });
    if (!ergebnis.success) {
      throw new BadRequestException(ergebnis.error.issues[0]?.message ?? "Ungültige Parameter.");
    }
    return this.zugriffe.auswerten(ergebnis.data);
  }
}
