import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ErfordertRecht } from "../rechte/rechte.decorator";
import { AuditService } from "./audit.service";

// safeParse + BadRequestException statt .parse(): Query-Parameter kommen als
// rohe Strings an ("offset=abc" ist moeglich), ein 400 mit verstaendlicher
// Meldung ist hier wichtiger als die globale ZodExceptionFilter-Meldung
// (CLAUDE.md, Vorbild mandant.controller.ts).
const filterSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  modul: z.string().trim().min(1).optional(),
  objektTyp: z.string().trim().min(1).optional(),
  objektId: z.string().uuid().optional(),
});

/**
 * Gated mit organigramm.manage-permissions, nicht organigramm.ansehen:
 * das Audit-Log protokolliert u. a. Struktur-/Rechteaenderungen
 * (org_unit/org_position/account_typ/delegation) -- das gehoert fachlich
 * zur Rechteverwaltung, nicht zum allgemeinen Organigramm-Ansehen. Wer nur
 * das Organigramm ansehen darf, soll nicht automatisch jede
 * Rechteaenderung im Protokoll nachvollziehen koennen.
 */
@Controller("audit-log")
@Authenticated()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ErfordertRecht("organigramm", "manage-permissions")
  async liste(
    @Query("offset") offset?: string,
    @Query("limit") limit?: string,
    @Query("modul") modul?: string,
    @Query("objektTyp") objektTyp?: string,
    @Query("objektId") objektId?: string
  ) {
    const ergebnis = filterSchema.safeParse({ offset, limit, modul, objektTyp, objektId });
    if (!ergebnis.success) {
      throw new BadRequestException(ergebnis.error.issues[0]?.message ?? "Ungültige Parameter.");
    }
    return this.audit.findeEintraege(ergebnis.data);
  }
}
