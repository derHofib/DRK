import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ERLAUBTE_DOKUMENT_MIME_TYPES } from "../common/datei";
import { RechnungService } from "./rechnung.service";

const anlegenSchema = z.object({
  klientId: z.string().uuid(),
  betragCent: z.number().int().positive(),
  beschreibung: z.string().min(1),
  dokumentBase64: z.string().optional(),
  dokumentDateiname: z.string().optional(),
  dokumentMimeType: z.enum(ERLAUBTE_DOKUMENT_MIME_TYPES).optional(),
});

const statusAendernSchema = z.object({
  status: z.enum(["genehmigt", "ausgezahlt", "abgelehnt"]),
  grund: z.string().min(1).optional(),
});

@Controller("rechnungen")
@Authenticated()
export class RechnungController {
  constructor(private readonly rechnungen: RechnungService) {}

  @Get()
  async list(@Query("klientId") klientId?: string) {
    return this.rechnungen.findeAlle(klientId ? { klientId } : undefined);
  }

  @Get(":id")
  async eine(@Param("id") id: string) {
    return this.rechnungen.findeEine(id);
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.rechnungen.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id/status")
  async statusAendern(@Param("id") id: string, @Body() body: unknown) {
    const { status, grund } = statusAendernSchema.parse(body);
    return this.rechnungen.statusAendern(id, status, grund);
  }

  @Get(":id/dokument")
  async dokument(@Param("id") id: string, @Res({ passthrough: false }) res: Response) {
    const ergebnis = await this.rechnungen.dokumentBild(id);
    if (!ergebnis) throw new NotFoundException("Kein Dokument für diese Rechnung hinterlegt.");
    res.setHeader("Content-Type", ergebnis.mimeType);
    // "attachment" statt "inline": selbst falls doch einmal ein Dokument mit
    // einem in ERLAUBTE_DOKUMENT_MIME_TYPES unbedachten Content-Type in der
    // Datenbank landet (Altbestand, manuelle DB-Aenderung), rendert der
    // Browser es nicht im Anwendungs-Origin, sondern bietet nur den
    // Download an -- zweite, vom Server erzwungene Verteidigungslinie
    // zusaetzlich zur Allowlist beim Anlegen.
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(ergebnis.dateiname)}"`);
    // Verhindert, dass der Browser den erklaerten Content-Type ignoriert und
    // den Inhalt anhand der Bytes selbst zu erraten versucht (MIME-Sniffing)
    // -- ohne das koennte selbst ein als image/png deklariertes, aber
    // HTML-artiges Dokument in manchen Browsern doch ausgefuehrt werden.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Datei-Hash", ergebnis.hash);
    res.send(ergebnis.inhalt);
  }
}
