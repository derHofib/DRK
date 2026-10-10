/**
 * GET /rechte/registry (Organigramm-Plan, Lieferreihenfolge Schritt 7/UI):
 * liefert die Modul×Aktion-Registry (apps/api/src/rechte/registry.ts) als
 * Daten fuer die Account-Typ-Verwaltung im Web-Client. Gated mit
 * organigramm.manage-permissions wie GET /audit-log -- dieselbe engere
 * Rechteverwaltungs-Grenze, nicht organigramm.ansehen.
 *
 * Wie audit-log-lesen.e2e-spec.ts: account_typ/org_position direkt per
 * SQL, kein rollen-mapping.ts-Pfad -- bewusste, noch ausstehende
 * Einschraenkung (kein Bug dieses Schritts).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { RECHTE_REGISTRY } from "../src/rechte/registry";

describe("Rechte-Registry: GET /rechte/registry", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;

  let tokenMitRecht: string;
  let tokenOhneRecht: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-rechte-registry-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Rechte-Registry ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    const traegerId = traegerRows[0].id;

    async function neuerAccountTyp(name: string, opts: { istVollzugriff?: boolean } = {}): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ (mandant_id, name, ist_vollzugriff) VALUES ($1, $2, $3) RETURNING id`,
        [mandantId, name, opts.istVollzugriff ?? false]
      );
      return rows[0].id;
    }

    const gfTypId = await neuerAccountTyp("Geschäftsführung", { istVollzugriff: true });
    // Hat organigramm.ansehen, aber bewusst NICHT manage-permissions -- Beleg,
    // dass "ansehen" allein fuer die Registry nicht reicht.
    const ansehenTypId = await neuerAccountTyp("Nur Organigramm ansehen");
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'organigramm', 'ansehen', 'tenant', true)`,
      [mandantId, ansehenTypId]
    );

    async function neuePosition(titel: string, accountTypId: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, traegerId, titel, accountTypId]
      );
      return rows[0].id;
    }
    const posGfId = await neuePosition("Geschäftsführung", gfTypId);
    const posAnsehenId = await neuePosition("Nur Organigramm ansehen", ansehenTypId);

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string }> {
      const email = `${label}-${suffix}@rechte-registry.test`;
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, email, `Testperson ${label}`, passwortHash]
      );
      return { id: rows[0].id, email };
    }
    async function zuweisen(positionId: string, benutzerId: string) {
      await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
        mandantId,
        positionId,
        benutzerId,
      ]);
    }

    const benMitRecht = await neuerBenutzer("mitRecht");
    const benOhneRecht = await neuerBenutzer("ohneRecht");
    await zuweisen(posGfId, benMitRecht.id);
    await zuweisen(posAnsehenId, benOhneRecht.id);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenMitRecht = await login(benMitRecht.email);
    tokenOhneRecht = await login(benOhneRecht.email);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  function als(token: string) {
    return request(app.getHttpServer()).get("/rechte/registry").set("Authorization", `Bearer ${token}`);
  }

  it("mit organigramm.manage-permissions: liefert exakt die RECHTE_REGISTRY aus dem Code", async () => {
    const res = await als(tokenMitRecht);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RECHTE_REGISTRY);
    // Beleg, dass es tatsaechlich die echte, gepflegte Liste ist, nicht ein
    // zufaellig passendes leeres/triviales Array.
    expect(res.body.length).toBeGreaterThan(10);
    expect(res.body).toContainEqual({ modul: "organigramm", aktion: "manage-permissions", nieDelegierbar: true });
  });

  it("ohne organigramm.manage-permissions (aber MIT organigramm.ansehen) -> 403", async () => {
    const res = await als(tokenOhneRecht);
    expect(res.status).toBe(403);
  });

  it("ohne Token -> 401", async () => {
    const res = await request(app.getHttpServer()).get("/rechte/registry");
    expect(res.status).toBe(401);
  });
});
