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
    // Grenzen der Postgres-Spalte betrag_cent (integer, 32-Bit signed) --
    // ohne sie wirft ein zu grosser Betrag "numeric field overflow" erst in
    // der Datenbank, als unbehandelter 500. "!== 0" ist fachlich: eine
    // Kassenbuchung ohne jede Geldbewegung ist kein sinnvoller Vorgang
    // (anders als bei rechnung, wo betrag_cent > 0 schon per CHECK erzwungen
    // ist -- hier kann der Betrag auch negativ sein, siehe Kommentar oben).
    betragCent: z
      .number()
      .int()
      .min(-2147483648)
      .max(2147483647)
      .refine((v) => v !== 0, { message: "Der Betrag darf nicht 0 sein." }),
    // .trim() VOR .min(1): sonst zaehlt reines Leerraum-Padding
    // ("   ") als gueltiger Inhalt und legt einen fachlich leeren
    // Kassenbucheintrag an.
    verwendungszweck: z.string().trim().min(1, "Verwendungszweck darf nicht leer sein."),
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

const stornoBeantragenSchema = z.object({
  grund: z.string().trim().min(1, "Grund darf nicht leer sein."),
});

const stornoEntscheidenSchema = z.object({
  entscheidung: z.enum(["genehmigt", "abgelehnt"]),
  grund: z.string().trim().min(1, "Grund darf nicht leer sein.").optional(),
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

  @Post(":id/storno-antrag")
  async stornoBeantragen(@Param("id") id: string, @Body() body: unknown) {
    const { grund } = stornoBeantragenSchema.parse(body);
    return this.kassenbuch.stornoBeantragen(id, grund);
  }

  @Patch("storno-antraege/:antragId")
  async stornoEntscheiden(@Param("antragId") antragId: string, @Body() body: unknown) {
    const { entscheidung, grund } = stornoEntscheidenSchema.parse(body);
    return this.kassenbuch.stornoEntscheiden(antragId, entscheidung, grund);
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
