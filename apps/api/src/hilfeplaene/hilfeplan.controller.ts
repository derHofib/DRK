import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { HilfeplanService } from "./hilfeplan.service";

const datum = z.string().date();

const planAnlegenSchema = z
  .object({
    klientId: z.string().uuid(),
    von: datum,
    bis: datum.optional(),
    naechstesGespraech: datum.optional(),
    bemerkung: z.string().trim().max(4000).optional(),
  })
  .refine((v) => v.bis === undefined || v.bis > v.von, {
    message: "Das Enddatum muss nach dem Startdatum liegen.",
    path: ["bis"],
  });

// null = Wert entfernen, fehlend = unveraendert.
const planAendernSchema = z.object({
  bis: datum.nullable().optional(),
  naechstesGespraech: datum.nullable().optional(),
  bemerkung: z.string().trim().max(4000).nullable().optional(),
});

const zielAnlegenSchema = z.object({
  titel: z.string().trim().min(1, "Das Ziel braucht einen Titel.").max(300),
  beschreibung: z.string().trim().max(4000).optional(),
  faelligAm: datum.optional(),
});

const zielAendernSchema = z.object({
  titel: z.string().trim().min(1, "Das Ziel braucht einen Titel.").max(300).optional(),
  beschreibung: z.string().trim().max(4000).nullable().optional(),
  faelligAm: datum.nullable().optional(),
  verworfen: z.boolean().optional(),
});

const verlaufSchema = z.object({
  fortschritt: z.number().int().min(0).max(100),
  notiz: z.string().trim().max(2000).optional(),
  tagesberichtId: z.string().uuid().optional(),
});

function pruefe<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? "Ungültige Eingabe.");
  return r.data;
}

@Controller("hilfeplaene")
@Authenticated()
export class HilfeplanController {
  constructor(private readonly hilfeplaene: HilfeplanService) {}

  @Get()
  async list(@Query("klientId", new ParseUUIDPipe()) klientId: string) {
    return this.hilfeplaene.findeAlleFuerKlient(klientId);
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.hilfeplaene.planAnlegen(pruefe(planAnlegenSchema, body));
  }

  @Patch("ziele/:id")
  async zielAendern(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.hilfeplaene.zielAendern(id, pruefe(zielAendernSchema, body));
  }

  @Post("ziele/:id/verlauf")
  async verlauf(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.hilfeplaene.verlaufErfassen(id, pruefe(verlaufSchema, body));
  }

  @Patch(":id")
  async planAendern(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.hilfeplaene.planAendern(id, pruefe(planAendernSchema, body));
  }

  @Post(":id/ziele")
  async zielAnlegen(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.hilfeplaene.zielAnlegen(id, pruefe(zielAnlegenSchema, body));
  }
}
