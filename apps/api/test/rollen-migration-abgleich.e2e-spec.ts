/**
 * Organigramm-Plan, Lieferreihenfolge Schritt 3: "verifiziert per
 * Abgleichsskript (jede der 14 Mengen gegen die neu aufgelösten Rechte),
 * nicht per Annahme". Prüft NICHT eine im Test nachgebaute Kopie der
 * Abbildungsregel, sondern ruft die echte, exportierte
 * scripts/rollen-migration.ts::verarbeiteMandant() auf einem frischen
 * Testmandanten auf und vergleicht das Ergebnis von RechteService.hatRecht()
 * mit genau den 14 heutigen ROLLEN_MIT_*-Mengen (siehe
 * src/*\/*.service.ts, je ein "const ROLLEN_MIT_X = new Set<BenutzerRolle>(...)").
 *
 * 12 der 14 Sets enthalten bereichsleitung+einrichtungsleitung gemeinsam --
 * die liegen in src/rechte/rollen-mapping.ts::EINRICHTUNGSLEITUNG_ZUSATZRECHTE
 * und werden von dort importiert, damit Migrationsskript und Test dieselbe
 * Quelle verwenden. Die 2 bereichsleitung-exklusiven Sets
 * (ROLLEN_MIT_BRANDING, ROLLEN_MIT_STANDORT_ANLEGEN) stehen bewusst NICHT in
 * rollen-mapping.ts (Kommentar dort: "bereichsleitung braucht keine eigene
 * Rechte-Liste -- das deckt der Geschäftsführung-Wildcard komplett ab") --
 * sie sind hier direkt benannt, weil nur dieser Test beide Fälle
 * auseinanderhalten muss (bereichsleitung: ja, einrichtungsleitung: nein).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { DatabaseModule } from "../src/database/database.module";
import { RechteModule } from "../src/rechte/rechte.module";
import { RechteService } from "../src/rechte/rechte.service";
import { tenantContextStorage } from "../src/common/tenant-context";
import { verarbeiteMandant } from "../scripts/rollen-migration";
import { EINRICHTUNGSLEITUNG_ZUSATZRECHTE } from "../src/rechte/rollen-mapping";

function alsBenutzer<T>(mandantId: string, benutzerId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ mandantId, benutzerId, rolle: "betreuer" }, fn);
}

// Die 2 heutigen bereichsleitung-exklusiven ROLLEN_MIT_*-Sets (siehe
// Dateikopf) -- einrichtungsleitung hat sie vorher wie nachher NICHT.
const BEREICHSLEITUNG_EXKLUSIVE_GATES: readonly { modul: string; aktion: string }[] = [
  { modul: "mandanten", aktion: "branding-bearbeiten" }, // ROLLEN_MIT_BRANDING
  { modul: "standorte", aktion: "anlegen" }, // ROLLEN_MIT_STANDORT_ANLEGEN
];

describe("Rollen-Migration: Abgleich gegen die 14 bestehenden ROLLEN_MIT_*-Sets", () => {
  let app: INestApplication;
  let admin: Client;
  let rechte: RechteService;
  let mandantId: string;
  let benBereichsleitung: string;
  let benEinrichtungsleitung: string;
  let benBetreuer: string;

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL muss gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const slug = `rollen-mig-abgleich-${randomUUID().slice(0, 8)}`;
    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      ["Rollen-Migration-Abgleich", slug]
    );
    mandantId = mandantRows[0].id;

    await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Abgleich', 'Teststr. 1')", [
      mandantId,
    ]);

    async function neuerBenutzer(rolle: "bereichsleitung" | "einrichtungsleitung" | "betreuer"): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
        [mandantId, `${rolle}-${randomUUID().slice(0, 8)}@rollen-mig-abgleich.test`, rolle, rolle]
      );
      return rows[0].id;
    }
    benBereichsleitung = await neuerBenutzer("bereichsleitung");
    benEinrichtungsleitung = await neuerBenutzer("einrichtungsleitung");
    benBetreuer = await neuerBenutzer("betreuer");

    // Die echte Migrationslogik, kein Nachbau -- genau die Forderung aus
    // dem Organigramm-Plan ("verifiziert per Abgleichsskript ..., nicht per
    // Annahme").
    await verarbeiteMandant(admin, { id: mandantId, slug });

    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, RechteModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rechte = app.get(RechteService);
  });

  afterAll(async () => {
    // posGFId (die migrierte bereichsleitung-Position) ist die einzige
    // Vollzugriff-Position dieses Testmandanten -- ohne das Deaktivieren
    // des Schutztriggers wuerde das Aufraeumen der Besetzung am "letzter
    // Vollzugriff-Inhaber bleibt bestehen"-Schutz scheitern (gleiches
    // Vorgehen wie rechte-engine.e2e-spec.ts und
    // rollen-migration.ts::rueckgaengigMachen()). try/finally, damit
    // admin.end()/app.close() auch bei einem Fehlschlag mitten im
    // Aufraeumen garantiert laufen (sonst haengt der Jest-Prozess).
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_recht_override WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("bereichsleitung (-> Geschäftsführung, Vollzugriff): hat alle 14 Gates, auch die 2 exklusiven", async () => {
    for (const { modul, aktion } of [...EINRICHTUNGSLEITUNG_ZUSATZRECHTE, ...BEREICHSLEITUNG_EXKLUSIVE_GATES]) {
      const hat = await alsBenutzer(mandantId, benBereichsleitung, () => rechte.hatRecht(modul, aktion));
      expect(hat).toBe(true);
    }
  });

  it("einrichtungsleitung: hat genau die 12 gemeinsamen Gates", async () => {
    for (const { modul, aktion } of EINRICHTUNGSLEITUNG_ZUSATZRECHTE) {
      const hat = await alsBenutzer(mandantId, benEinrichtungsleitung, () => rechte.hatRecht(modul, aktion));
      expect(hat).toBe(true);
    }
  });

  it("einrichtungsleitung: hat die 2 bereichsleitung-exklusiven Gates NICHT", async () => {
    for (const { modul, aktion } of BEREICHSLEITUNG_EXKLUSIVE_GATES) {
      const hat = await alsBenutzer(mandantId, benEinrichtungsleitung, () => rechte.hatRecht(modul, aktion));
      expect(hat).toBe(false);
    }
  });

  it("betreuer: hat KEINES der 14 Gates", async () => {
    for (const { modul, aktion } of [...EINRICHTUNGSLEITUNG_ZUSATZRECHTE, ...BEREICHSLEITUNG_EXKLUSIVE_GATES]) {
      const hat = await alsBenutzer(mandantId, benBetreuer, () => rechte.hatRecht(modul, aktion));
      expect(hat).toBe(false);
    }
  });

  describe("Gegenprobe", () => {
    it("GEGENPROBE: ohne die Zusatzrechte-Zeilen haette einrichtungsleitung keines der 12 gemeinsamen Gates (Beleg, dass der Test wirklich etwas prueft)", async () => {
      const { rows } = await admin.query<{ id: string }>(
        "SELECT id FROM account_typ WHERE mandant_id = $1 AND name = 'Einrichtungsleitung'",
        [mandantId]
      );
      const elTypId = rows[0].id;
      const geloescht = await admin.query("DELETE FROM account_typ_recht WHERE account_typ_id = $1 RETURNING *", [
        elTypId,
      ]);
      expect(geloescht.rowCount).toBeGreaterThan(0);

      for (const { modul, aktion } of EINRICHTUNGSLEITUNG_ZUSATZRECHTE) {
        const hat = await alsBenutzer(mandantId, benEinrichtungsleitung, () => rechte.hatRecht(modul, aktion));
        expect(hat).toBe(false);
      }

      // Wiederherstellen, damit kein anderer Test in dieser Datei davon
      // beeinflusst wird.
      for (const row of geloescht.rows) {
        await admin.query(
          "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, $3, $4, $5, $6)",
          [row.mandant_id, row.account_typ_id, row.modul, row.aktion, row.scope, row.erlaubt]
        );
      }
      const hatDanach = await alsBenutzer(mandantId, benEinrichtungsleitung, () =>
        rechte.hatRecht(EINRICHTUNGSLEITUNG_ZUSATZRECHTE[0].modul, EINRICHTUNGSLEITUNG_ZUSATZRECHTE[0].aktion)
      );
      expect(hatDanach).toBe(true);
    });
  });
});
