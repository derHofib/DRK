import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { StandortService } from "./standort.service";
import { StandortKontaktVereinbarungService } from "./standort-kontakt-vereinbarung.service";

// Ein ungueltiger Body wird ueber den globalen ZodExceptionFilter zum 400.

/** Freitext: getrimmt, leer = Feld leeren (null). */
const text = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .transform((v) => (v === null || v.trim() === "" ? null : v.trim()));

/** Wie text(), aber mit Format, das erst NACH dem Trimmen geprueft wird. */
const format = (muster: RegExp, meldung: string) =>
  text(200).refine((v) => v === null || muster.test(v), { message: meldung });

const angebotsform = z.enum([
  "besondere_wohnform",
  "ambulant_wg",
  "einzelwohnen",
  "jugendhilfe_34",
  "hilfe_67",
  "sonstiges",
]);

/**
 * Rueckwaerts kompatibel: bis Migration 0079 kannte die API nur ein
 * Freitextfeld "adresse". Eine noch zwischengespeicherte PWA (Service
 * Worker) oder eine Offline-Warteschlange schickt das nach dem Update
 * weiter -- statt eines 400 wird es hier so zerlegt wie in der Migration
 * ("Strasse Nr., 12345 Ort"; sonst alles in strasse).
 */
function alteAdresseZerlegen(body: unknown): unknown {
  if (typeof body !== "object" || body === null || !("adresse" in body))
    return body;
  const { adresse, ...rest } = body as Record<string, unknown>;
  if (typeof adresse !== "string" || "strasse" in rest) return rest;
  const treffer = /^(.+?),\s*([0-9]{5})\s+(.+)$/.exec(adresse.trim());
  return treffer
    ? { ...rest, strasse: treffer[1], plz: treffer[2], ort: treffer[3] }
    : { ...rest, strasse: adresse, plz: null, ort: null };
}

const anlegenSchema = z.preprocess(
  alteAdresseZerlegen,
  z.object({
    name: z.string().trim().min(1).max(200),
    angebotsform: angebotsform.nullable().optional(),
    strasse: z.string().trim().min(1).max(200),
    plz: format(/^[0-9]{5}$/, "Die PLZ hat fünf Ziffern.").optional(),
    ort: text(200).optional(),
  }),
);

const aktualisierenSchema = z.preprocess(
  alteAdresseZerlegen,
  z
    .object({
      name: z.string().trim().min(1).max(200),
      aktiv: z.boolean(),
      angebotsform: angebotsform.nullable(),
      zielgruppe: text(500),
      betreuungsumfang: z
        .enum(["rund_um_die_uhr", "tagsueber", "stundenweise"])
        .nullable(),
      inBetriebSeit: format(
        /^\d{4}-\d{2}-\d{2}$/,
        "Datum im Format JJJJ-MM-TT.",
      ),
      strasse: z.string().trim().min(1).max(200),
      plz: format(/^[0-9]{5}$/, "Die PLZ hat fünf Ziffern."),
      ort: text(200),
      telefon: text(50),
      fax: text(50),
      email: text(200).refine(
        (v) => v === null || z.string().email().safeParse(v).success,
        {
          message: "Keine gültige E-Mail-Adresse.",
        },
      ),
      buerozeiten: text(200),
      bereitschaftTelefon: text(50),
      bereitschaftHinweis: text(500),
      barrierefreiheit: z
        .enum(["barrierefrei", "teilweise", "nicht"])
        .nullable(),
      barrierefreiheitHinweis: text(500),
      oepnv: text(500),
      zugang: text(1000),
      kostenstelle: text(50),
      ikNummer: format(/^[0-9]{9}$/, "Die IK-Nummer hat neun Ziffern."),
      hinweise: text(4000),
    })
    .partial()
    .strict(),
);

const email = text(200).refine(
  (v) => v === null || z.string().email().safeParse(v).success,
  { message: "Keine gültige E-Mail-Adresse." },
);
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT.");

const kontaktFelder = {
  rolle: z.enum([
    "vermieter",
    "hausmeister",
    "notdienst",
    "krisendienst",
    "hausarzt",
    "apotheke",
    "polizei",
    "sonstiges",
  ]),
  name: z.string().trim().min(1).max(200),
  telefon: text(50),
  email,
  hinweis: text(1000),
};
const kontaktAnlegenSchema = z
  .object(kontaktFelder)
  .partial({ telefon: true, email: true, hinweis: true })
  .strict();
const kontaktAendernSchema = z.object(kontaktFelder).partial().strict();

const vereinbarungAnlegenSchema = z
  .object({
    art: z.enum([
      "leistungsvereinbarung",
      "verguetungsvereinbarung",
      "betriebserlaubnis",
      "sonstige",
    ]),
    partner: z.string().trim().min(1).max(300),
    kennung: text(100).optional(),
    gueltigVon: datum,
    gueltigBis: datum.nullable().optional(),
    plaetze: z.number().int().positive().max(10000).nullable().optional(),
    verguetungTagCent: z.number().int().min(0).max(100_000_00).nullable().optional(),
    bemerkung: text(2000).optional(),
  })
  .strict()
  .refine((v) => !v.gueltigBis || v.gueltigBis > v.gueltigVon, {
    message: "„Gültig bis“ muss nach „gültig von“ liegen.",
    path: ["gueltigBis"],
  });
// Nur was die Datenbank auch spaltenscharf zulaesst (0081).
const vereinbarungAendernSchema = z
  .object({
    gueltigBis: datum.nullable(),
    kennung: text(100),
    bemerkung: text(2000),
  })
  .partial()
  .strict();
const stornoSchema = z.object({ grund: z.string().trim().min(3).max(500) }).strict();

@Controller("standorte")
@Authenticated()
export class StandortController {
  constructor(
    private readonly standorte: StandortService,
    private readonly anhang: StandortKontaktVereinbarungService,
  ) {}

  @Get()
  async list() {
    return this.standorte.findeAlle();
  }

  /** Liste unter Organisatorisch > Standorte, mit abgeleiteten Plaetzen und Leitung. */
  @Get("verwaltung")
  async verwaltungsliste() {
    return this.standorte.verwaltungsliste();
  }

  @Get(":id/uebersicht")
  async uebersicht(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.standorte.uebersicht(id);
  }

  @Get(":id/steckbrief")
  async steckbrief(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.standorte.steckbrief(id);
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.standorte.anlegen(anlegenSchema.parse(body));
  }

  @Patch(":id")
  async aktualisieren(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.standorte.aktualisieren(id, aktualisierenSchema.parse(body));
  }
  @Post(":id/kontakte")
  async kontaktAnlegen(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.anhang.kontaktAnlegen(id, kontaktAnlegenSchema.parse(body));
  }

  @Patch(":id/kontakte/:kontaktId")
  async kontaktAendern(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("kontaktId", new ParseUUIDPipe()) kontaktId: string,
    @Body() body: unknown,
  ) {
    return this.anhang.kontaktAendern(id, kontaktId, kontaktAendernSchema.parse(body));
  }

  @Delete(":id/kontakte/:kontaktId")
  @HttpCode(204)
  async kontaktLoeschen(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("kontaktId", new ParseUUIDPipe()) kontaktId: string,
  ) {
    await this.anhang.kontaktLoeschen(id, kontaktId);
  }

  @Post(":id/vereinbarungen")
  async vereinbarungAnlegen(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.anhang.vereinbarungAnlegen(id, vereinbarungAnlegenSchema.parse(body));
  }

  @Patch(":id/vereinbarungen/:vereinbarungId")
  async vereinbarungAendern(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("vereinbarungId", new ParseUUIDPipe()) vereinbarungId: string,
    @Body() body: unknown,
  ) {
    return this.anhang.vereinbarungAendern(id, vereinbarungId, vereinbarungAendernSchema.parse(body));
  }

  @Post(":id/vereinbarungen/:vereinbarungId/storno")
  async vereinbarungStornieren(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("vereinbarungId", new ParseUUIDPipe()) vereinbarungId: string,
    @Body() body: unknown,
  ) {
    return this.anhang.vereinbarungStornieren(id, vereinbarungId, stornoSchema.parse(body).grund);
  }
}
