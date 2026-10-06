/**
 * Organigramm-Plan, Lieferreihenfolge Schritt 3: bildet benutzer.rolle 1:1
 * auf die drei Systemvorlagen ab (siehe src/rechte/rollen-mapping.ts) und
 * legt dafuer Account-Typen, Positionen und Positionszuweisungen an.
 *
 * Anders als scripts/migrate.ts (reines Schema, bewusst ohne
 * Rollback-Mechanismus -- "eine fehlerhafte Migration wird durch eine neue
 * korrigierende Migration behoben") ist dies eine DATEN-Migration nach
 * einer fachlichen Abbildungsregel, kein Schema-Schritt -- dafuer sieht
 * der Auftrag explizit Dry-Run und Rollback vor, bevor jemand von Hand an
 * der neuen Organisationsstruktur weiterarbeitet.
 *
 * Modi (per CLI-Flag, Default ist Dry-Run):
 *   tsx scripts/rollen-migration.ts                 -- Dry-Run, nichts wird geschrieben
 *   tsx scripts/rollen-migration.ts --anwenden       -- schreibt wirklich
 *   tsx scripts/rollen-migration.ts --mandant <slug> -- auf einen Mandanten beschraenkt (fuer beide Modi)
 *   tsx scripts/rollen-migration.ts --rueckgaengig   -- entfernt die drei Systemtypen (+ alles, was an
 *                                                       ihnen haengt) wieder -- NUR sicher, solange seit
 *                                                       dem --anwenden-Lauf niemand von Hand an der neuen
 *                                                       Organisationsstruktur weitergearbeitet hat (siehe
 *                                                       unten, rueckgaengigMachen()).
 *
 * Idempotent: ein zweiter Lauf (Dry-Run oder --anwenden) legt nichts
 * doppelt an -- jede sicherXyz()-Funktion prueft zuerst, ob die Zeile
 * schon existiert.
 *
 * Dry-Run = derselbe Code, derselbe Transaktionsinhalt, nur ROLLBACK statt
 * COMMIT am Ende -- bewusst KEIN zweiter, parallel gepflegter
 * "Simulations"-Code-Pfad, der mit der Zeit vom echten Lauf abweichen
 * koennte.
 */
import { Client } from "pg";
import { loadEnvFromRepoRoot } from "../src/load-env";
import {
  EINRICHTUNGSLEITUNG_RECHTE,
  MITARBEITER_RECHTE,
  SYSTEMTYP_NAME,
  type RollenMappingEintrag,
} from "../src/rechte/rollen-mapping";

interface Bericht {
  mandant: string;
  accountTypenAngelegt: string[];
  rechteZeilenAngelegt: number;
  positionenAngelegt: number;
  besetzungenAngelegt: number;
  warnungen: string[];
}

async function sicherAccountTyp(
  client: Client,
  mandantId: string,
  name: string,
  istVollzugriff: boolean,
  bericht: Bericht
): Promise<string> {
  const { rows } = await client.query<{ id: string }>("SELECT id FROM account_typ WHERE mandant_id = $1 AND name = $2", [
    mandantId,
    name,
  ]);
  if (rows.length > 0) return rows[0].id;

  const { rows: neu } = await client.query<{ id: string }>(
    "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1, $2, true, $3) RETURNING id",
    [mandantId, name, istVollzugriff]
  );
  bericht.accountTypenAngelegt.push(name);
  return neu[0].id;
}

async function sicherRechteZeilen(
  client: Client,
  mandantId: string,
  accountTypId: string,
  eintraege: readonly RollenMappingEintrag[]
): Promise<number> {
  let angelegt = 0;
  for (const e of eintraege) {
    const { rows } = await client.query(
      "SELECT 1 FROM account_typ_recht WHERE account_typ_id = $1 AND modul = $2 AND aktion = $3",
      [accountTypId, e.modul, e.aktion]
    );
    if (rows.length > 0) continue;
    await client.query(
      "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, $3, $4, $5, true)",
      [mandantId, accountTypId, e.modul, e.aktion, e.scope]
    );
    angelegt++;
  }
  return angelegt;
}

async function sicherPosition(
  client: Client,
  mandantId: string,
  orgUnitId: string,
  accountTypId: string,
  titel: string
): Promise<{ id: string; neu: boolean }> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT id FROM org_position WHERE mandant_id = $1 AND org_unit_id = $2 AND account_typ_id = $3",
    [mandantId, orgUnitId, accountTypId]
  );
  if (rows.length > 0) return { id: rows[0].id, neu: false };

  const { rows: neu } = await client.query<{ id: string }>(
    "INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel) VALUES ($1, $2, $3, $4) RETURNING id",
    [mandantId, orgUnitId, accountTypId, titel]
  );
  return { id: neu[0].id, neu: true };
}

async function sicherBesetzung(client: Client, mandantId: string, positionId: string, benutzerId: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM org_position_besetzung
     WHERE position_id = $1 AND benutzer_id = $2
       AND gueltig_ab <= CURRENT_DATE AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)`,
    [positionId, benutzerId]
  );
  if (rows.length > 0) return false;
  await client.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
    mandantId,
    positionId,
    benutzerId,
  ]);
  return true;
}

/**
 * Exportiert fuer den Abgleichstest (test/rollen-migration-abgleich.e2e-spec.ts),
 * damit er die ECHTE Abbildungslogik prueft, nicht eine im Test
 * nachgebaute Kopie davon, die mit der Zeit abweichen koennte.
 */
export async function verarbeiteMandant(
  client: Client,
  mandant: { id: string; slug: string }
): Promise<Bericht> {
  const bericht: Bericht = {
    mandant: mandant.slug,
    accountTypenAngelegt: [],
    rechteZeilenAngelegt: 0,
    positionenAngelegt: 0,
    besetzungenAngelegt: 0,
    warnungen: [],
  };

  const { rows: traegerRows } = await client.query<{ id: string }>(
    "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
    [mandant.id]
  );
  const traegerId = traegerRows[0].id;

  const { rows: einrichtungen } = await client.query<{ id: string; standort_id: string }>(
    "SELECT id, standort_id FROM org_unit WHERE mandant_id = $1 AND typ = 'einrichtung'",
    [mandant.id]
  );

  const gfTypId = await sicherAccountTyp(client, mandant.id, SYSTEMTYP_NAME.geschaeftsfuehrung, true, bericht);
  const elTypId = await sicherAccountTyp(client, mandant.id, SYSTEMTYP_NAME.einrichtungsleitung, false, bericht);
  const maTypId = await sicherAccountTyp(client, mandant.id, SYSTEMTYP_NAME.mitarbeiter, false, bericht);

  bericht.rechteZeilenAngelegt += await sicherRechteZeilen(client, mandant.id, elTypId, EINRICHTUNGSLEITUNG_RECHTE);
  bericht.rechteZeilenAngelegt += await sicherRechteZeilen(client, mandant.id, maTypId, MITARBEITER_RECHTE);

  const { rows: benutzerListe } = await client.query<{ id: string; rolle: string }>(
    "SELECT id, rolle FROM benutzer WHERE mandant_id = $1",
    [mandant.id]
  );

  for (const benutzer of benutzerListe) {
    const { rows: standortZeilen } = await client.query<{ standort_id: string }>(
      "SELECT standort_id FROM benutzer_standort WHERE benutzer_id = $1",
      [benutzer.id]
    );

    if (benutzer.rolle === "bereichsleitung") {
      if (standortZeilen.length > 0) {
        bericht.warnungen.push(
          `bereichsleitung ${benutzer.id} hat ${standortZeilen.length} benutzer_standort-Zeile(n), die durch den Geschäftsführung-Vollzugriff wirkungslos werden (Rolle galt schon vorher als trägerweit, siehe migrations/0026).`
        );
      }
      const position = await sicherPosition(client, mandant.id, traegerId, gfTypId, SYSTEMTYP_NAME.geschaeftsfuehrung);
      if (position.neu) bericht.positionenAngelegt++;
      if (await sicherBesetzung(client, mandant.id, position.id, benutzer.id)) bericht.besetzungenAngelegt++;
      continue;
    }

    const istEinrichtungsleitung = benutzer.rolle === "einrichtungsleitung";
    const typId = istEinrichtungsleitung ? elTypId : maTypId;
    const titel = istEinrichtungsleitung ? SYSTEMTYP_NAME.einrichtungsleitung : SYSTEMTYP_NAME.mitarbeiter;

    const zielEinrichtungen =
      standortZeilen.length === 0
        ? einrichtungen
        : einrichtungen.filter((e) => standortZeilen.some((s) => s.standort_id === e.standort_id));

    if (standortZeilen.length === 0 && einrichtungen.length > 1) {
      bericht.warnungen.push(
        `${benutzer.rolle} ${benutzer.id} hatte keine Standort-Einschränkung (sah alle Standorte) -> bekommt ${einrichtungen.length} Positionen, eine je bestehender Einrichtung. Ein künftig neu angelegter Standort braucht eine manuell nachgetragene Position.`
      );
    }
    if (zielEinrichtungen.length === 0) {
      bericht.warnungen.push(
        `${benutzer.rolle} ${benutzer.id}: keine passende Einrichtung gefunden (benutzer_standort verweist auf einen Standort ohne org_unit?) -- ÜBERSPRUNGEN, manuell prüfen.`
      );
      continue;
    }

    for (const einrichtung of zielEinrichtungen) {
      const position = await sicherPosition(client, mandant.id, einrichtung.id, typId, titel);
      if (position.neu) bericht.positionenAngelegt++;
      if (await sicherBesetzung(client, mandant.id, position.id, benutzer.id)) bericht.besetzungenAngelegt++;
    }
  }

  return bericht;
}

async function rueckgaengigMachen(client: Client, mandant: { id: string; slug: string }): Promise<void> {
  const { rows: typen } = await client.query<{ id: string }>(
    "SELECT id FROM account_typ WHERE mandant_id = $1 AND ist_system AND name = ANY($2)",
    [mandant.id, Object.values(SYSTEMTYP_NAME)]
  );
  if (typen.length === 0) {
    console.log(`  (${mandant.slug}: keine der drei Systemtypen vorhanden, nichts zu tun)`);
    return;
  }
  const typIds = typen.map((t) => t.id);

  // Vollzugriff-Schutz nur fuer die Dauer des Rueckbaus deaktivieren --
  // sonst blockiert er genau das Entfernen der Geschaeftsfuehrung-
  // Besetzungen, die dieser Rueckbau ja ausdruecklich will (siehe
  // 0042_org_position.sql, gleiches Vorgehen wie im Abgleichstest und bei
  // der manuellen Migrationsverifikation).
  await client.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
  await client.query(
    "DELETE FROM org_position_besetzung WHERE position_id IN (SELECT id FROM org_position WHERE account_typ_id = ANY($1))",
    [typIds]
  );
  await client.query(
    "DELETE FROM org_position_recht_override WHERE position_id IN (SELECT id FROM org_position WHERE account_typ_id = ANY($1))",
    [typIds]
  );
  await client.query("DELETE FROM org_position WHERE account_typ_id = ANY($1)", [typIds]);
  await client.query("DELETE FROM account_typ_recht WHERE account_typ_id = ANY($1)", [typIds]);
  await client.query("DELETE FROM account_typ WHERE id = ANY($1)", [typIds]);
  await client.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
  console.log(`  ${mandant.slug}: 3 Systemtypen + zugehörige Positionen/Besetzungen entfernt.`);
}

function berichtDrucken(b: Bericht) {
  console.log(`\n--- ${b.mandant} ---`);
  if (b.accountTypenAngelegt.length > 0) console.log(`  Neue Account-Typen: ${b.accountTypenAngelegt.join(", ")}`);
  console.log(`  Neue Rechte-Zeilen: ${b.rechteZeilenAngelegt}`);
  console.log(`  Neue Positionen: ${b.positionenAngelegt}`);
  console.log(`  Neue Zuweisungen: ${b.besetzungenAngelegt}`);
  for (const w of b.warnungen) console.log(`  ⚠ ${w}`);
}

async function main() {
  loadEnvFromRepoRoot();
  const connectionString = process.env.MIGRATIONS_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATIONS_DATABASE_URL ist nicht gesetzt (siehe .env.example).");

  const args = process.argv.slice(2);
  const anwenden = args.includes("--anwenden");
  const rueckgaengig = args.includes("--rueckgaengig");
  const mandantFlagIndex = args.indexOf("--mandant");
  const mandantSlug = mandantFlagIndex >= 0 ? args[mandantFlagIndex + 1] : undefined;

  if (anwenden && rueckgaengig) throw new Error("--anwenden und --rueckgaengig schließen sich aus.");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows: mandanten } = await client.query<{ id: string; slug: string }>(
      mandantSlug ? "SELECT id, slug FROM mandant WHERE slug = $1" : "SELECT id, slug FROM mandant ORDER BY slug",
      mandantSlug ? [mandantSlug] : []
    );
    if (mandanten.length === 0) {
      console.log(mandantSlug ? `Kein Mandant mit Slug "${mandantSlug}" gefunden.` : "Keine Mandanten vorhanden.");
      return;
    }

    if (rueckgaengig) {
      console.log(`Mache Rollen-Migration rückgängig für ${mandanten.length} Mandant(en)...`);
      for (const mandant of mandanten) {
        await client.query("BEGIN");
        try {
          await rueckgaengigMachen(client, mandant);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
      return;
    }

    console.log(
      anwenden
        ? `Wende Rollen-Migration an für ${mandanten.length} Mandant(en)...`
        : `DRY-RUN -- zeigt, was für ${mandanten.length} Mandant(en) entstünde, schreibt nichts.`
    );

    for (const mandant of mandanten) {
      await client.query("BEGIN");
      try {
        const bericht = await verarbeiteMandant(client, mandant);
        berichtDrucken(bericht);
        await client.query(anwenden ? "COMMIT" : "ROLLBACK");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log(anwenden ? "\nFertig, Änderungen gespeichert." : "\nDry-Run beendet, nichts gespeichert.");
  } finally {
    await client.end();
  }
}

// Nur ausfuehren, wenn direkt aufgerufen (tsx scripts/rollen-migration.ts) --
// nicht, wenn der Abgleichstest verarbeiteMandant() importiert.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
