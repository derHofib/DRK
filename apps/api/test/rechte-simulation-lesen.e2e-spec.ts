/**
 * GET /rechte/simulation ("Anzeigen als…", Organigramm-Plan, Schritt 7/UI,
 * fuenfter Teilschritt): rein lesend, zeigt fuer einen Benutzer ODER eine
 * Position, welche Rechte effektiv gelten wuerden, inklusive Herkunft je
 * Zelle. Gated mit organigramm.manage-permissions, wie GET /rechte/registry
 * (rechte-registry-lesen.e2e-spec.ts) -- dasselbe Fixture-Muster: account_typ/
 * org_position direkt per SQL, kein rollen-mapping.ts-Pfad.
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

describe("Rechte-Simulation: GET /rechte/simulation", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;

  let tokenMitRecht: string;
  let tokenOhneRecht: string;

  let posZielId: string;
  let benZielId: string;
  let benVollzugriffId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-rechte-simulation-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Rechte-Simulation ${suffix}`, mandantSlug]
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

    // Hat organigramm.manage-permissions -- der Account-Typ des aufrufenden Kontos.
    const mitRechtTypId = await neuerAccountTyp("Mit Manage-Permissions");
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'organigramm', 'manage-permissions', 'tenant', true)`,
      [mandantId, mitRechtTypId]
    );

    // Hat organigramm.ansehen, aber bewusst NICHT manage-permissions.
    const ansehenTypId = await neuerAccountTyp("Nur Organigramm ansehen");
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'organigramm', 'ansehen', 'tenant', true)`,
      [mandantId, ansehenTypId]
    );

    // Simulationsziel: ein Default (klienten.ansehen, scope=team) UND ein
    // Override (zimmer.ansehen), das den eigenen Default (scope=team)
    // ersetzt -- belegt, dass die Simulation "override" von
    // "account-typ-default" unterscheidet.
    const zielTypId = await neuerAccountTyp("Simulationsziel");
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'klienten', 'ansehen', 'team', true),
              ($1, $2, 'zimmer', 'ansehen', 'team', true)`,
      [mandantId, zielTypId]
    );

    async function neuePosition(titel: string, accountTypId: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, traegerId, titel, accountTypId]
      );
      return rows[0].id;
    }
    const posGfId = await neuePosition("Geschäftsführung", gfTypId);
    const posMitRechtId = await neuePosition("Mit Manage-Permissions", mitRechtTypId);
    const posOhneRechtId = await neuePosition("Nur Organigramm ansehen", ansehenTypId);
    posZielId = await neuePosition("Simulationsziel", zielTypId);

    await admin.query(
      `INSERT INTO org_position_recht_override (mandant_id, position_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'zimmer', 'ansehen', 'subtree', true)`,
      [mandantId, posZielId]
    );

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string }> {
      const email = `${label}-${suffix}@rechte-simulation.test`;
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, 'betreuer') RETURNING id`,
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
    const benZiel = await neuerBenutzer("ziel");
    const benVollzugriff = await neuerBenutzer("vollzugriff");
    benZielId = benZiel.id;
    benVollzugriffId = benVollzugriff.id;

    await zuweisen(posMitRechtId, benMitRecht.id);
    await zuweisen(posOhneRechtId, benOhneRecht.id);
    await zuweisen(posZielId, benZielId);
    await zuweisen(posGfId, benVollzugriffId);

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
      await admin.query("DELETE FROM org_position_recht_override WHERE mandant_id = $1", [mandantId]);
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

  function als(token: string | undefined, query: string) {
    const req = request(app.getHttpServer()).get(`/rechte/simulation${query}`);
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  }

  it("mit organigramm.manage-permissions und ?benutzerId=...: liefert eine Zelle je Registry-Eintrag", async () => {
    const res = await als(tokenMitRecht, `?benutzerId=${benZielId}`);
    expect(res.status).toBe(200);
    expect(res.body.ziel).toEqual({ typ: "benutzer", id: benZielId });
    expect(res.body.zellen).toHaveLength(RECHTE_REGISTRY.length);

    const klientenAnsehen = res.body.zellen.find((z: any) => z.modul === "klienten" && z.aktion === "ansehen");
    expect(klientenAnsehen).toEqual({ modul: "klienten", aktion: "ansehen", erlaubt: true, herkunft: "account-typ-default", scope: "team" });

    // Override ersetzt den Default (scope=team) komplett durch scope=subtree.
    const zimmerAnsehen = res.body.zellen.find((z: any) => z.modul === "zimmer" && z.aktion === "ansehen");
    expect(zimmerAnsehen).toEqual({ modul: "zimmer", aktion: "ansehen", erlaubt: true, herkunft: "override", scope: "subtree" });

    // Ein Registry-Eintrag ganz ohne Zeile ist ein impliziter Deny.
    const kassenbuchBuchen = res.body.zellen.find((z: any) => z.modul === "kassenbuch" && z.aktion === "buchen");
    expect(kassenbuchBuchen).toEqual({ modul: "kassenbuch", aktion: "buchen", erlaubt: false, herkunft: "kein-eintrag" });
  });

  it("mit organigramm.manage-permissions und ?positionId=...: dieselben Zellen direkt aus der Position", async () => {
    const res = await als(tokenMitRecht, `?positionId=${posZielId}`);
    expect(res.status).toBe(200);
    expect(res.body.ziel).toEqual({ typ: "position", id: posZielId });
    expect(res.body.zellen).toHaveLength(RECHTE_REGISTRY.length);

    const zimmerAnsehen = res.body.zellen.find((z: any) => z.modul === "zimmer" && z.aktion === "ansehen");
    expect(zimmerAnsehen).toEqual({ modul: "zimmer", aktion: "ansehen", erlaubt: true, herkunft: "override", scope: "subtree" });
  });

  it("Vollzugriff-Konto als Benutzer simuliert: alle Zellen erlaubt mit Herkunft vollzugriff", async () => {
    const res = await als(tokenMitRecht, `?benutzerId=${benVollzugriffId}`);
    expect(res.status).toBe(200);
    expect(res.body.zellen).toHaveLength(RECHTE_REGISTRY.length);
    for (const zelle of res.body.zellen) {
      expect(zelle.erlaubt).toBe(true);
      expect(zelle.herkunft).toBe("vollzugriff");
    }
  });

  it("weder benutzerId noch positionId -> 400", async () => {
    const res = await als(tokenMitRecht, "");
    expect(res.status).toBe(400);
  });

  it("benutzerId UND positionId gleichzeitig -> 400", async () => {
    const res = await als(tokenMitRecht, `?benutzerId=${benZielId}&positionId=${posZielId}`);
    expect(res.status).toBe(400);
  });

  it("ohne organigramm.manage-permissions (aber MIT organigramm.ansehen) -> 403", async () => {
    const res = await als(tokenOhneRecht, `?benutzerId=${benZielId}`);
    expect(res.status).toBe(403);
  });

  it("ohne Token -> 401", async () => {
    const res = await als(undefined, `?benutzerId=${benZielId}`);
    expect(res.status).toBe(401);
  });

  it("unbekannte positionId -> 404", async () => {
    const res = await als(tokenMitRecht, `?positionId=${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});
