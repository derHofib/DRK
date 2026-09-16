import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { KlientService } from "./klient.service";
import { KlientStammdatenService } from "./klient-stammdaten.service";
import { KlientArchivService } from "./klient-archiv.service";

const anlegenSchema = z.object({
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  geburtsdatum: z.string().date(),
  aktenzeichen: z.string().min(1),
  amt: z.string().min(1),
  hzlRhythmus: z.enum(["monatlich", "woechentlich"]).default("monatlich"),
});

// Ein Datum als leerer String ist ein gueltiger "loeschen"-Wert (siehe
// KlientStammdatenService.setzen()), z.string().date() liesse das aber
// nicht durch -- deshalb je ein Alternativpfad fuer den leeren String.
const datumOderLeer = z.union([z.string().date(), z.literal("")]);

// Alle Felder optional: das Frontend speichert pro Datenblatt-Abschnitt
// unabhaengig, ein fehlendes Feld bleibt in der DB unveraendert (COALESCE
// im Service), ein leerer String loescht es bewusst.
const stammdatenSchema = z.object({
  geburtsort: z.string().optional(),
  nationalitaet: z.string().optional(),
  sorgeberechtigt: z.string().optional(),
  bezugsbetreuerId: z.string().uuid().optional(),
  betreuungsstunden: z.string().optional(),
  telefon: z.string().optional(),
  sprachen: z.string().optional(),
  anmerkungen: z.string().optional(),
  personaldokumente: z.string().optional(),
  bankkonto: z.string().optional(),
  iban: z.string().optional(),
  jugendamtAdresse: z.string().optional(),
  jugendamtSachbearbeiter: z.string().optional(),
  jugendamtStellenzeichen: z.string().optional(),
  jugendamtTelefon: z.string().optional(),
  jugendamtEmail: z.string().optional(),
  wjhName: z.string().optional(),
  wjhTelefon: z.string().optional(),
  wjhEmail: z.string().optional(),
  personensorgeberechtigte: z.string().optional(),
  besuchskontakte: z.string().optional(),
  krankenkasse: z.string().optional(),
  versichertennummer: z.string().optional(),
  medikamente: z.string().optional(),
  diagnosen: z.string().optional(),
  allergien: z.string().optional(),
  besonderheitenGesundheitlich: z.string().optional(),
  besonderheitenPsychisch: z.string().optional(),
  schule: z.string().optional(),
  klassenstufe: z.string().optional(),
  schulabschluesse: z.string().optional(),
  foerderbedarfe: z.string().optional(),
  vorherigeEinrichtungTraeger: z.string().optional(),
  vorherigeEinrichtungKontakt: z.string().optional(),
  vorherigeEinrichtungAnfrageAm: datumOderLeer.optional(),
  vorherigeEinrichtungEinzugAm: datumOderLeer.optional(),
  vorherigeEinrichtungAuszugAm: datumOderLeer.optional(),
});

const kontaktAnlegenSchema = z.object({
  beziehung: z.string().optional(),
  name: z.string().trim().min(1, "Name ist erforderlich."),
  adresse: z.string().optional(),
  email: z.string().optional(),
  telefon: z.string().optional(),
});

const kontaktAktualisierenSchema = z.object({
  beziehung: z.string().optional(),
  name: z.string().trim().min(1, "Name ist erforderlich.").optional(),
  adresse: z.string().optional(),
  email: z.string().optional(),
  telefon: z.string().optional(),
});

@Controller("klienten")
@Authenticated()
export class KlientController {
  constructor(
    private readonly klienten: KlientService,
    private readonly stammdaten: KlientStammdatenService,
    private readonly archiv: KlientArchivService
  ) {}

  @Get()
  async list(@Query("archiviert") archiviert?: string) {
    return this.klienten.findeAlle(archiviert === "true");
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.klienten.anlegen(anlegenSchema.parse(body));
  }

  @Get(":id")
  async eines(@Param("id") id: string) {
    return this.klienten.findeEinen(id);
  }

  @Patch(":id/anonymisieren")
  async anonymisieren(@Param("id") id: string) {
    return this.klienten.anonymisieren(id);
  }

  @Patch(":id/stammdaten")
  async stammdatenSetzen(@Param("id") id: string, @Body() body: unknown) {
    return this.stammdaten.setzen(id, stammdatenSchema.parse(body));
  }

  @Post(":id/kontakte")
  async kontaktHinzufuegen(@Param("id") id: string, @Body() body: unknown) {
    return this.stammdaten.kontaktHinzufuegen(id, kontaktAnlegenSchema.parse(body));
  }

  @Patch(":id/kontakte/:kontaktId")
  async kontaktAktualisieren(@Param("id") id: string, @Param("kontaktId") kontaktId: string, @Body() body: unknown) {
    return this.stammdaten.kontaktAktualisieren(id, kontaktId, kontaktAktualisierenSchema.parse(body));
  }

  @Delete(":id/kontakte/:kontaktId")
  async kontaktLoeschen(@Param("id") id: string, @Param("kontaktId") kontaktId: string) {
    await this.stammdaten.kontaktLoeschen(id, kontaktId);
    return { ok: true };
  }

  @Patch(":id/archivieren")
  async archivieren(@Param("id") id: string) {
    await this.archiv.archivieren(id);
    return this.klienten.findeEinen(id);
  }

  @Patch(":id/entarchivieren")
  async entarchivieren(@Param("id") id: string) {
    await this.archiv.entarchivieren(id);
    return this.klienten.findeEinen(id);
  }

  @Get(":id/archiv/:archivId/pdf")
  async archivPdf(
    @Param("id") id: string,
    @Param("archivId") archivId: string,
    @Res({ passthrough: false }) res: Response
  ) {
    const ergebnis = await this.archiv.pdfHerunterladen(id, archivId);
    if (!ergebnis) throw new NotFoundException("Kein Archiv-PDF mit dieser ID für diesen Klienten gefunden.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(ergebnis.dateiname)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Datei-Hash", ergebnis.hash);
    res.send(ergebnis.pdf);
  }
}
