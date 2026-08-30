import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KassenbuchungService } from "./kassenbuchung.service";

const anlegenSchema = z
  .object({
    // Genau eins von beiden -- eine Standort-Buchung (Spassgeld/
    // Freizeitveranstaltung) gehoert dem ganzen Haus, nicht einem
    // einzelnen Klienten. Der Service prueft dieselbe Regel nochmal
    // (fuer Aufrufer, die an diesem Controller vorbeikommen); hier sitzt
    // sie zusaetzlich, damit eine falsche Kombination bereits als 400
    // und nicht erst tiefer im Code auffaellt.
    klientId: z.string().uuid().optional(),
    standortId: z.string().uuid().optional(),
    datum: z.string().date(),
    betragCent: z.number().int(),
    verwendungszweck: z.string().min(1),
    typ: z.enum(["hzl", "einzahlung", "sonstiges"]),
    isoJahr: z.number().int().min(2000).max(2100).optional(),
    isoWoche: z.number().int().min(1).max(53).optional(),
    unterschriftBase64: z.string().optional(),
    teilnehmerKlientIds: z.array(z.string().uuid()).optional(),
    teilnehmerBenutzerIds: z.array(z.string().uuid()).optional(),
  })
  .refine((v) => Boolean(v.klientId) !== Boolean(v.standortId), {
    message: "Entweder klientId oder standortId angeben, nicht beides und nicht keins.",
  })
  .refine((v) => v.typ !== "hzl" || Boolean(v.klientId), {
    message: "HZL ist ausschließlich für einen einzelnen Klienten möglich.",
  });

const stornierenSchema = z.object({
  grund: z.string().min(1),
});

const wochenuebersichtSchema = z.object({
  jahr: z.coerce.number().int().min(2000).max(2100),
  kw: z.coerce.number().int().min(1).max(53),
});

@Controller("kassenbuchungen")
@Authenticated()
export class KassenbuchungController {
  constructor(private readonly kassenbuch: KassenbuchungService) {}

  @Get()
  async list(@Query("klientId") klientId?: string) {
    return this.kassenbuch.findeAlle(klientId ? { klientId } : undefined);
  }

  @Get("wochenuebersicht")
  async wochenuebersicht(@Query() query: unknown) {
    const { jahr, kw } = wochenuebersichtSchema.parse(query);
    return this.kassenbuch.wochenuebersicht(jahr, kw);
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.kassenbuch.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id/stornieren")
  async stornieren(@Param("id") id: string, @Body() body: unknown) {
    const { grund } = stornierenSchema.parse(body);
    return this.kassenbuch.stornieren(id, grund);
  }

  @Get(":id/unterschrift")
  async unterschrift(@Param("id") id: string, @Res({ passthrough: false }) res: Response) {
    const ergebnis = await this.kassenbuch.unterschriftBild(id);
    if (!ergebnis) throw new NotFoundException("Keine Unterschrift für diese Buchung hinterlegt.");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Bild-Hash", ergebnis.hash);
    res.send(ergebnis.bild);
  }
}
