import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { ErfordertRecht } from "../rechte/rechte.decorator";
import { OrganigrammService } from "./organigramm.service";

// Nur "bereich"|"team" sind ueber diesen Endpunkt anlegbar -- "traeger" und
// "einrichtung" entstehen automatisch per Trigger (migrations/0040_org_unit.sql).
// Ein Versuch mit einem der beiden Werte scheitert bereits hier als
// ZodError/400 (global uebersetzt von ZodExceptionFilter), bevor der
// Service ueberhaupt aufgerufen wird.
const orgUnitAnlegenSchema = z.object({
  typ: z.enum(["bereich", "team"]),
  name: z.string().trim().min(1, "Name darf nicht leer sein."),
  parentId: z.string().uuid(),
});

const orgUnitAktualisierenSchema = z
  .object({
    name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
    parentId: z.string().uuid().optional(),
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, "Mindestens ein Feld muss angegeben werden.");

const positionAnlegenSchema = z.object({
  orgUnitId: z.string().uuid(),
  titel: z.string().trim().min(1, "Titel darf nicht leer sein."),
  typ: z.enum(["linie", "stabsstelle"]).optional(),
  accountTypId: z.string().uuid(),
  parentPositionId: z.string().uuid().optional(),
  sollBesetzung: z.number().int().min(1).optional(),
  gueltigAb: z.string().date().optional(),
  gueltigBis: z.string().date().optional(),
});

const positionAktualisierenSchema = z
  .object({
    titel: z.string().trim().min(1, "Titel darf nicht leer sein.").optional(),
    accountTypId: z.string().uuid().optional(),
    parentPositionId: z.string().uuid().optional(),
    sollBesetzung: z.number().int().min(1).optional(),
    gueltigBis: z.string().date().nullable().optional(),
    istGeplant: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld muss angegeben werden.");

const besetzenSchema = z.object({
  benutzerId: z.string().uuid(),
  gueltigAb: z.string().date().optional(),
});

// Body optional (siehe Organigramm-Plan: "Body optional: { gueltigBis? }") --
// der Controller faengt ein fehlendes Body-Objekt per "?? {}" ab, bevor das
// Schema greift.
const besetzungBeendenSchema = z.object({
  gueltigBis: z.string().date().optional(),
});

const stabsstelleScopeSchema = z.object({
  orgUnitIds: z.array(z.string().uuid()),
});

const accountTypAnlegenSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein."),
  kategorie: z.enum(["intern", "extern"]).optional(),
});

const accountTypAktualisierenSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
});

const accountTypRechteSchema = z.object({
  rechte: z.array(
    z.object({
      modul: z.string().trim().min(1),
      aktion: z.string().trim().min(1),
      scope: z.string().trim().min(1),
      erlaubt: z.boolean(),
    })
  ),
});

/**
 * Lesende UND schreibende Organigramm-Endpunkte (Organigramm-Plan,
 * Lieferreihenfolge Schritt 7). Alle Lese-Endpunkte bleiben mit
 * organigramm.ansehen gegated, alle Positions-/Org-Unit-Schreibendpunkte
 * mit organigramm.bearbeiten, die Account-Typ-/Rechte-Endpunkte bewusst
 * mit dem engeren organigramm.manage-permissions (Rechteverwaltung, nicht
 * allgemeines Organigramm-Bearbeiten).
 *
 * Heutiger Zwischenstand: rollen-mapping.ts (Schritt 3, noch ausstehend)
 * kennt organigramm.* fuer die Rollen einrichtungsleitung/mitarbeiter noch
 * nicht -- nur ein Account-Typ mit ist_vollzugriff=true (Wildcard) nutzt
 * diese Endpunkte heute ueberhaupt. Kein Bug, siehe Testdatei-Kopf von
 * organigramm-schreiben.e2e-spec.ts.
 */
@Controller("organigramm")
@Authenticated()
export class OrganigrammController {
  constructor(private readonly organigramm: OrganigrammService) {}

  @Get("org-units")
  @ErfordertRecht("organigramm", "ansehen")
  async orgUnits() {
    return this.organigramm.findeOrgUnits();
  }

  @Get("positions")
  @ErfordertRecht("organigramm", "ansehen")
  async positions() {
    return this.organigramm.findePositionen();
  }

  @Get("account-typen")
  @ErfordertRecht("organigramm", "ansehen")
  async accountTypen() {
    return this.organigramm.findeAccountTypen();
  }

  @Post("org-units")
  @ErfordertRecht("organigramm", "bearbeiten")
  async orgUnitAnlegen(@Body() body: unknown) {
    return this.organigramm.legeOrgUnitAn(orgUnitAnlegenSchema.parse(body));
  }

  @Patch("org-units/:id")
  @ErfordertRecht("organigramm", "bearbeiten")
  async orgUnitAktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.organigramm.aktualisiereOrgUnit(id, orgUnitAktualisierenSchema.parse(body));
  }

  @Post("positions")
  @ErfordertRecht("organigramm", "bearbeiten")
  async positionAnlegen(@Body() body: unknown) {
    return this.organigramm.legePositionAn(positionAnlegenSchema.parse(body));
  }

  @Patch("positions/:id")
  @ErfordertRecht("organigramm", "bearbeiten")
  async positionAktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.organigramm.aktualisierePosition(id, positionAktualisierenSchema.parse(body));
  }

  @Patch("positions/:id/deaktivieren")
  @ErfordertRecht("organigramm", "bearbeiten")
  async positionDeaktivieren(@Param("id") id: string) {
    return this.organigramm.deaktiviertPosition(id);
  }

  @Post("positions/:id/besetzen")
  @ErfordertRecht("organigramm", "bearbeiten")
  async positionBesetzen(@Param("id") id: string, @Body() body: unknown) {
    return this.organigramm.besetzen(id, besetzenSchema.parse(body));
  }

  @Patch("positions/:id/besetzung/:besetzungId/beenden")
  @ErfordertRecht("organigramm", "bearbeiten")
  async positionBesetzungBeenden(
    @Param("id") id: string,
    @Param("besetzungId") besetzungId: string,
    @Body() body: unknown
  ) {
    return this.organigramm.besetzungBeenden(id, besetzungId, besetzungBeendenSchema.parse(body ?? {}));
  }

  @Put("positions/:id/stabsstelle-scope")
  @ErfordertRecht("organigramm", "bearbeiten")
  async stabsstelleScope(@Param("id") id: string, @Body() body: unknown) {
    const { orgUnitIds } = stabsstelleScopeSchema.parse(body);
    return this.organigramm.setzeStabsstelleScope(id, orgUnitIds);
  }

  @Post("account-typen")
  @ErfordertRecht("organigramm", "manage-permissions")
  async accountTypAnlegen(@Body() body: unknown) {
    return this.organigramm.legeAccountTypAn(accountTypAnlegenSchema.parse(body));
  }

  @Patch("account-typen/:id")
  @ErfordertRecht("organigramm", "manage-permissions")
  async accountTypAktualisieren(@Param("id") id: string, @Body() body: unknown) {
    return this.organigramm.aktualisiereAccountTyp(id, accountTypAktualisierenSchema.parse(body));
  }

  @Put("account-typen/:id/rechte")
  @ErfordertRecht("organigramm", "manage-permissions")
  async accountTypRechte(@Param("id") id: string, @Body() body: unknown) {
    const { rechte } = accountTypRechteSchema.parse(body);
    return this.organigramm.setzeAccountTypRechte(id, rechte);
  }
}
