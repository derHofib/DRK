/**
 * Entwickler-Accounttyp (Migration 0048, Organigramm-Plan-Nachtrag
 * "Entwickler-Accounttyp"): jeder neu angelegte Mandant bekommt automatisch
 * genau EINEN dauerhaften Vollzugriff-Accounttyp "Entwickler" -- darueber
 * legt der allererste Account eines Traegers die echten Accounttypen an
 * (z.B. "Geschäftsführung") und vergibt deren Rechte, bevor der Träger
 * normal zu arbeiten beginnt. Kein Einmal-Bootstrap-Schritt: der Typ bleibt
 * dauerhaft bestehen (siehe scripts/account-anlegen.sh).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Entwickler-Accounttyp (Migration 0048)", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  let entwicklerTypId: string;
  let token: string;

  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantSlug = `test-entwickler-${suffix}`;
    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Entwickler ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows: benRows } = await admin.query<{ id: string }>(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Erster Account', $3) RETURNING id",
      [mandantId, `erster-${suffix}@beispiel.test`, passwortHash]
    );
    const benutzerId = benRows[0].id;

    const { rows: typRows } = await admin.query<{ id: string }>(
      "SELECT id FROM account_typ WHERE mandant_id = $1 AND ist_vollzugriff",
      [mandantId]
    );
    entwicklerTypId = typRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    const { rows: posRows } = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel) VALUES ($1, $2, $3, 'Entwickler') RETURNING id",
      [mandantId, traegerRows[0].id, entwicklerTypId]
    );
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
      mandantId,
      posRows[0].id,
      benutzerId,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: `erster-${suffix}@beispiel.test`, passwort });
    token = login.body.accessToken;
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("legt beim Anlegen eines Mandanten genau einen Vollzugriff-Accounttyp 'Entwickler' an", async () => {
    const { rows } = await admin.query(
      "SELECT name, kategorie, ist_system, ist_vollzugriff FROM account_typ WHERE mandant_id = $1",
      [mandantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Entwickler",
      kategorie: "intern",
      ist_system: true,
      ist_vollzugriff: true,
    });
  });

  it("bekommt laut Migration 0041 keine einzelnen account_typ_recht-Zeilen (Wildcard-Kurzschluss)", async () => {
    const { rows } = await admin.query("SELECT 1 FROM account_typ_recht WHERE account_typ_id = $1", [entwicklerTypId]);
    expect(rows).toHaveLength(0);
  });

  it("der erste Account auf der Entwickler-Position hat vollen Zugriff (z.B. organigramm.manage-permissions)", async () => {
    const res = await request(app.getHttpServer())
      .get("/organigramm/account-typen")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("GEGENPROBE -- der Entwickler-Typ kann nicht umbenannt werden (ist_system)", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/organigramm/account-typen/${entwicklerTypId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Umbenannt" });
    expect(res.status).toBe(400);
  });
});
