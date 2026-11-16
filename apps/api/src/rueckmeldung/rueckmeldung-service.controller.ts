import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Patch, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { isPgError } from "../common/pg-error";
import { DatabaseService } from "../database/database.service";
import { ServiceTokenGuard } from "./service-token.guard";

const idSchema = z.string().uuid();
const statusFilterSchema = z.enum(["freigegeben", "in_arbeit", "umgesetzt"]);
const statusSchema = z.object({
  status: z.enum(["in_arbeit", "umgesetzt", "freigegeben", "rueckfrage"]),
  notiz: z.string().trim().min(1).max(2000).optional(),
  prUrl: z.string().url().startsWith("https://").max(500).optional(),
});

/**
 * Hersteller-Schnittstelle fuer Claude: freigegebene Rueckmeldungen lesen,
 * Stand zurueckmelden. DIE DRITTE dokumentierte Ausnahme vom Tenant-Kontext
 * (neben Login und den Fristlaeufen): hier gibt es keine anfragende Person
 * eines Traegers. Vertretbar, weil kein SQL aus diesem Code den Zugriff
 * bestimmt -- die vier SECURITY DEFINER-Funktionen aus Migration 0073 liefern
 * nur freigegebene Eintraege von Traegern mit eingeschalteter Weitergabe und
 * protokollieren jeden Zugriff. Dieser Controller kann nichts anderes aufrufen.
 */
@Controller("service/rueckmeldungen")
@UseGuards(ServiceTokenGuard)
export class RueckmeldungServiceController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async liste(@Query("status") status?: string) {
    const filter = status === undefined ? null : statusFilterSchema.parse(status);
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM rueckmeldung_service_liste($1)", [filter]);
      return rows.map(zuCamel);
    });
  }

  @Get(":id")
  async detail(@Param("id") rawId: string) {
    const id = idSchema.parse(rawId);
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM rueckmeldung_service_detail($1)", [id]);
      if (rows.length === 0) throw new NotFoundException();
      return zuCamel(rows[0]);
    });
  }

  @Get(":id/bild")
  async bild(@Param("id") rawId: string, @Res() res: Response) {
    const id = idSchema.parse(rawId);
    const daten = await this.db.withoutTenant(async (client) => {
      const { rows } = await client.query("SELECT rueckmeldung_service_bild($1) AS daten", [id]);
      return rows[0].daten as Buffer | null;
    });
    if (!daten) throw new NotFoundException();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(daten);
  }

  @Patch(":id/status")
  @HttpCode(200)
  async status(@Param("id") rawId: string, @Body() body: unknown) {
    const id = idSchema.parse(rawId);
    const eingabe = statusSchema.parse(body);
    try {
      return await this.db.withoutTenant(async (client) => {
        const { rows } = await client.query("SELECT rueckmeldung_service_status($1, $2, $3, $4) AS status", [
          id,
          eingabe.status,
          eingabe.notiz ?? null,
          eingabe.prUrl ?? null,
        ]);
        return { status: rows[0].status as string };
      });
    } catch (err) {
      // P0002: nicht gefunden ODER nicht freigegeben (bewusst nicht unterscheidbar).
      if (isPgError(err) && err.code === "P0002") throw new NotFoundException();
      if (isPgError(err) && err.code === "P0001") throw new ConflictException(err.message);
      throw err;
    }
  }
}

function zuCamel(zeile: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(zeile).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}
