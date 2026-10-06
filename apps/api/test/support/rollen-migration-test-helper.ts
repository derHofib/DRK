/**
 * Organigramm-Plan, Lieferreihenfolge Schritt 4: sobald eine der 14
 * ROLLEN_MIT_*-Prüfungen auf die Rechte-Engine umgestellt ist, kennt sie
 * benutzer.rolle nicht mehr direkt -- sie braucht eine echte Position
 * (account_typ + org_position + org_position_besetzung). Bestehende
 * e2e-Specs legen ihre Testbenutzer seit jeher per rohem SQL nur mit
 * einer `rolle`-Spalte an (kein Login-Pfad über die echte Migration).
 * Damit genau diese Benutzer nach der Umstellung weiterhin exakt das
 * Rechteverhalten haben, das ihre `rolle` vorher implizierte, ruft dieser
 * Helfer dieselbe, bereits durch rollen-migration-abgleich.e2e-spec.ts
 * verifizierte Abbildungslogik auf (`verarbeiteMandant()`) -- kein
 * zweiter, separat gepflegter Zuordnungspfad nur für Tests.
 *
 * Aufrufen, NACHDEM alle Benutzer eines Mandanten angelegt sind (auch
 * erneut, wenn später im selben Testfall weitere Benutzer dazukommen --
 * verarbeiteMandant() ist idempotent). Vor dem Löschen der Benutzer-Zeilen
 * im Teardown IMMER raeumeRollenMigrationAuf() aufrufen (FK von
 * org_position_besetzung.benutzer_id).
 */
import { Client } from "pg";
import { verarbeiteMandant } from "../../scripts/rollen-migration";

export async function migriereTestmandant(admin: Client, mandantId: string, slug: string): Promise<void> {
  await verarbeiteMandant(admin, { id: mandantId, slug });
}

/**
 * Entfernt alles, was migriereTestmandant() für GENAU diesen Mandanten
 * angelegt hat. Deaktiviert den "letzter Vollzugriff-Inhaber bleibt
 * bestehen"-Schutz (0042_org_position.sql) nur für die Dauer des
 * Aufräumens -- sonst scheitert das Entfernen der
 * Geschäftsführung-Besetzung daran, exakt wie bei jedem anderen Testmandanten
 * mit einer ist_vollzugriff-Position (siehe rechte-engine.e2e-spec.ts).
 */
export async function raeumeRollenMigrationAuf(admin: Client, mandantId: string): Promise<void> {
  await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
  await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM org_position_recht_override WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
  await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
}
