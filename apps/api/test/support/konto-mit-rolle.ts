/**
 * Test-Fixture-Ersatz fuer das abgeschaffte benutzer.rolle (Organigramm-Plan,
 * "Entwickler-Accounttyp"): legt fuer einen Testbenutzer denselben
 * Rechteumfang an, den frueher "bereichsleitung"/"einrichtungsleitung"/
 * "betreuer" direkt ueber die Spalte hatten -- jetzt ueber einen
 * Account-Typ + eine Position + eine Besetzung, genau den Weg, den die
 * Anwendung selbst fuer Rechte vorsieht.
 *
 * Die Rechte-Listen hier sind die letzte Kopie von scripts/rollen-migration.ts
 * (Schritt 3, inzwischen entfernt) -- ihre einzige Aufgabe ist jetzt, den
 * bestehenden grossen Testbestand ohne inhaltliche Rechteverschiebung
 * weiterzubetreiben. Fuer "bereichsleitung" reicht ist_vollzugriff=true
 * (Geschaeftsfuehrung-Wildcard) komplett, deshalb keine eigene Rechte-Liste.
 *
 * Der Scope ("einrichtung") der angelegten account_typ_recht-Zeilen spielt
 * fuer hatRecht() (die hier ueberall verwendete Ja/Nein-Pruefung) keine
 * Rolle -- der ist "unabhaengig vom Scope" (siehe rechte.service.ts). Die
 * tatsaechliche Standort-Einschraenkung in Tests laeuft weiterhin ueber
 * benutzer_standort (common/standort-restriction.ts), unveraendert neben
 * diesem Helfer. Deshalb reicht als Position immer die Traeger-Wurzel --
 * keine Positionierung je Einrichtung wie noch im alten Migrationsskript.
 */
import { Client } from "pg";

export type AlteRolle = "bereichsleitung" | "einrichtungsleitung" | "betreuer";

interface RechtEintrag {
  modul: string;
  aktion: string;
  scope: string;
}

const MITARBEITER_RECHTE: readonly RechtEintrag[] = [
  { modul: "klienten", aktion: "ansehen", scope: "einrichtung" },
  { modul: "klienten", aktion: "lesen-akte", scope: "einrichtung" },
  { modul: "klienten", aktion: "anlegen", scope: "einrichtung" },
  { modul: "klienten", aktion: "bearbeiten", scope: "einrichtung" },
  { modul: "zimmer", aktion: "ansehen", scope: "einrichtung" },
  { modul: "zimmer", aktion: "belegen", scope: "einrichtung" },
  { modul: "kassenbuch", aktion: "ansehen", scope: "einrichtung" },
  { modul: "kassenbuch", aktion: "buchen", scope: "einrichtung" },
  { modul: "kostenuebernahmen", aktion: "ansehen", scope: "einrichtung" },
  { modul: "kostenuebernahmen", aktion: "anlegen", scope: "einrichtung" },
  { modul: "mitarbeitende", aktion: "ansehen", scope: "einrichtung" },
  { modul: "aufgaben", aktion: "ansehen", scope: "einrichtung" },
  { modul: "aufgaben", aktion: "bearbeiten", scope: "own" },
  { modul: "anwaerter", aktion: "ansehen", scope: "einrichtung" },
  { modul: "tagesberichte", aktion: "ansehen", scope: "einrichtung" },
  { modul: "tagesberichte", aktion: "anlegen", scope: "einrichtung" },
  { modul: "standorte", aktion: "ansehen", scope: "einrichtung" },
  { modul: "rechnungen", aktion: "ansehen", scope: "einrichtung" },
];

const EINRICHTUNGSLEITUNG_ZUSATZRECHTE: readonly RechtEintrag[] = [
  { modul: "aufgaben", aktion: "koordinieren", scope: "einrichtung" },
  { modul: "kassenbuch", aktion: "storno-entscheiden", scope: "einrichtung" },
  { modul: "kassenbuch", aktion: "typen-verwalten", scope: "einrichtung" },
  { modul: "standorte", aktion: "bearbeiten", scope: "einrichtung" },
  { modul: "rechnungen", aktion: "status-wechseln", scope: "einrichtung" },
  { modul: "anwaerter", aktion: "entscheiden", scope: "einrichtung" },
  { modul: "klienten", aktion: "archivieren", scope: "einrichtung" },
  { modul: "zimmer", aktion: "voller-verlauf", scope: "einrichtung" },
  { modul: "zimmer", aktion: "bearbeiten", scope: "einrichtung" },
  { modul: "klienten", aktion: "anonymisieren", scope: "einrichtung" },
  { modul: "mitarbeitende", aktion: "anlegen", scope: "einrichtung" },
  { modul: "mitarbeitende", aktion: "standort-zuweisen", scope: "einrichtung" },
  // Ersetzt die alte feste Vier-Augen-Gegenrolle (zimmer.service.ts,
  // kapazitaetEntscheiden()) -- die "andere Leitungsrolle" von frueher ist
  // jetzt dieses eigene Recht.
  { modul: "zimmer", aktion: "kapazitaet-entscheiden", scope: "einrichtung" },
];

const EINRICHTUNGSLEITUNG_RECHTE: readonly RechtEintrag[] = [
  ...MITARBEITER_RECHTE,
  ...EINRICHTUNGSLEITUNG_ZUSATZRECHTE,
];

const SYSTEMTYP_NAME: Record<AlteRolle, string> = {
  bereichsleitung: "Bereichsleitung (Testkonto)",
  einrichtungsleitung: "Einrichtungsleitung (Testkonto)",
  betreuer: "Mitarbeiter (Testkonto)",
};

async function sicherAccountTyp(admin: Client, mandantId: string, rolle: AlteRolle): Promise<string> {
  const name = SYSTEMTYP_NAME[rolle];
  const { rows } = await admin.query<{ id: string }>(
    "SELECT id FROM account_typ WHERE mandant_id = $1 AND name = $2",
    [mandantId, name]
  );
  if (rows.length > 0) return rows[0].id;

  const istVollzugriff = rolle === "bereichsleitung";
  const { rows: neu } = await admin.query<{ id: string }>(
    "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1, $2, true, $3) RETURNING id",
    [mandantId, name, istVollzugriff]
  );
  const accountTypId = neu[0].id;

  const rechte = rolle === "einrichtungsleitung" ? EINRICHTUNGSLEITUNG_RECHTE : rolle === "betreuer" ? MITARBEITER_RECHTE : [];
  for (const e of rechte) {
    await admin.query(
      "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, $3, $4, $5, true)",
      [mandantId, accountTypId, e.modul, e.aktion, e.scope]
    );
  }
  return accountTypId;
}

async function sicherPosition(admin: Client, mandantId: string, accountTypId: string, rolle: AlteRolle): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "SELECT id FROM org_position WHERE mandant_id = $1 AND account_typ_id = $2",
    [mandantId, accountTypId]
  );
  if (rows.length > 0) return rows[0].id;

  const { rows: traegerRows } = await admin.query<{ id: string }>(
    "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
    [mandantId]
  );
  const { rows: neu } = await admin.query<{ id: string }>(
    "INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel) VALUES ($1, $2, $3, $4) RETURNING id",
    [mandantId, traegerRows[0].id, accountTypId, SYSTEMTYP_NAME[rolle]]
  );
  return neu[0].id;
}

/**
 * Legt einen Benutzer an UND stattet ihn ueber Account-Typ/Position/
 * Besetzung mit genau dem Rechteumfang aus, den fruehere Tests mit
 * `rolle: '...'` meinten. Account-Typ und Position werden je Mandant+Rolle
 * wiederverwendet (idempotent), nur die Besetzung ist je Aufruf neu.
 */
export async function kontoMitAlterRolle(
  admin: Client,
  params: { mandantId: string; rolle: AlteRolle; email: string; name: string; passwortHash: string }
): Promise<string> {
  const { rows: benRows } = await admin.query<{ id: string }>(
    "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, $4) RETURNING id",
    [params.mandantId, params.email, params.name, params.passwortHash]
  );
  const benutzerId = benRows[0].id;

  const accountTypId = await sicherAccountTyp(admin, params.mandantId, params.rolle);
  const positionId = await sicherPosition(admin, params.mandantId, accountTypId, params.rolle);
  await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
    params.mandantId,
    positionId,
    benutzerId,
  ]);

  return benutzerId;
}

/**
 * Entfernt alles, was kontoMitAlterRolle() fuer GENAU diesen Mandanten
 * angelegt hat -- vor dem Loeschen der benutzer-/mandant-Zeilen im Teardown
 * aufrufen (FK von org_position_besetzung.benutzer_id). Deaktiviert den
 * "letzter Vollzugriff-Inhaber bleibt bestehen"-Schutz (0042_org_position.sql)
 * nur fuer die Dauer des Aufraeumens -- sonst scheitert das Entfernen der
 * Bereichsleitung-Besetzung (ist_vollzugriff) daran, exakt wie bei jedem
 * anderen Testmandanten mit einer ist_vollzugriff-Position.
 */
export async function raeumeKontoMitRolleAuf(admin: Client, mandantId: string): Promise<void> {
  await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
  await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM org_position_recht_override WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
  await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
  await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
}
