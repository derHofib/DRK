/**
 * GET /audit-log (Organigramm-Plan, Lieferreihenfolge Schritt 6): gated mit
 * organigramm.manage-permissions, NICHT organigramm.ansehen -- das
 * Audit-Log protokolliert Struktur-/Rechteaenderungen, das gehoert zur
 * Rechteverwaltung, nicht zum allgemeinen Organigramm-Ansehen (siehe
 * audit.controller.ts). Kein Schreibpfad existiert bislang (laut
 * Fachkonzept schreiben kuenftig andere Services selbst hinein) -- die
 * Testzeilen werden deshalb direkt per SQL angelegt.
 *
 * Wie organigramm-lesen.e2e-spec.ts: account_typ/org_position direkt per
 * SQL, kein rollen-mapping.ts-Pfad -- heute sieht praktisch nur ein
 * ist_vollzugriff=true-Konto diesen Endpunkt (noch keine
 * organigramm.manage-permissions-Zuordnung fuer einrichtungsleitung/
 * mitarbeiter in rollen-mapping.ts, bewusste, noch ausstehende
 * Einschraenkung, kein Bug dieses Schritts).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

describe("Audit-Log: GET /audit-log", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;

  let eintragOrganigramm1: string;
  let eintragOrganigramm2: string;
  let eintragKassenbuch: string;

  let tokenMitRecht: string;
  let tokenOhneRecht: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-audit-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Audit ${suffix}`, mandantSlug]
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
    // dass "ansehen" allein fuer das Audit-Log nicht reicht.
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
      const email = `${label}-${suffix}@audit-check.test`;
      const id = await kontoMitAlterRolle(admin, {
        mandantId,
        rolle: "betreuer",
        email,
        name: `Testperson ${label}`,
        passwortHash,
      });
      return { id, email };
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

    // Kein Schreibpfad existiert bislang -- Testzeilen direkt per SQL, in
    // zeitlich aufsteigender Reihenfolge (erstellt_am steuert die Sortierung).
    async function logZeile(modul: string, objektTyp: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO audit_log (mandant_id, benutzer_id, modul, aktion, objekt_typ, objekt_id, vorher, nachher)
         VALUES ($1, $2, $3, 'bearbeiten', $4, $5, '{"a":1}'::jsonb, '{"a":2}'::jsonb)
         RETURNING id`,
        [mandantId, benMitRecht.id, modul, objektTyp, randomUUID()]
      );
      return rows[0].id;
    }
    eintragOrganigramm1 = await logZeile("organigramm", "org_position");
    await new Promise((resolve) => setTimeout(resolve, 5));
    eintragOrganigramm2 = await logZeile("organigramm", "account_typ");
    await new Promise((resolve) => setTimeout(resolve, 5));
    eintragKassenbuch = await logZeile("kassenbuch", "kassenbuchung");

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
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
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

  function als(token: string, query = "") {
    return request(app.getHttpServer()).get(`/audit-log${query}`).set("Authorization", `Bearer ${token}`);
  }

  it("mit organigramm.manage-permissions: sieht alle drei angelegten Zeilen, neueste zuerst", async () => {
    const res = await als(tokenMitRecht);
    expect(res.status).toBe(200);
    const ids = res.body.map((e: any) => e.id);
    expect(ids).toEqual(expect.arrayContaining([eintragOrganigramm1, eintragOrganigramm2, eintragKassenbuch]));

    const idx1 = ids.indexOf(eintragOrganigramm1);
    const idx2 = ids.indexOf(eintragOrganigramm2);
    const idxK = ids.indexOf(eintragKassenbuch);
    expect(idxK).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx1);

    const zeile = res.body.find((e: any) => e.id === eintragKassenbuch);
    expect(zeile).toMatchObject({
      modul: "kassenbuch",
      aktion: "bearbeiten",
      objektTyp: "kassenbuchung",
      vorher: { a: 1 },
      nachher: { a: 2 },
      handelndAlsVertreterVon: null,
      handelndAlsVertreterVonName: null,
    });
    expect(typeof zeile.benutzerName).toBe("string");
  });

  it("ohne organigramm.manage-permissions (aber MIT organigramm.ansehen) -> 403", async () => {
    const res = await als(tokenOhneRecht);
    expect(res.status).toBe(403);
  });

  it("ohne Token -> 401", async () => {
    const res = await request(app.getHttpServer()).get("/audit-log");
    expect(res.status).toBe(401);
  });

  it("Paginierung: limit=1 liefert genau eine Zeile, offset=1 verschiebt das Fenster", async () => {
    const erste = await als(tokenMitRecht, "?limit=1");
    expect(erste.status).toBe(200);
    expect(erste.body).toHaveLength(1);
    expect(erste.body[0].id).toBe(eintragKassenbuch);

    const zweite = await als(tokenMitRecht, "?limit=1&offset=1");
    expect(zweite.status).toBe(200);
    expect(zweite.body).toHaveLength(1);
    expect(zweite.body[0].id).toBe(eintragOrganigramm2);
  });

  it("Filter modul=organigramm liefert nur die beiden Organigramm-Zeilen, nicht die Kassenbuch-Zeile", async () => {
    const res = await als(tokenMitRecht, "?modul=organigramm");
    expect(res.status).toBe(200);
    const ids = res.body.map((e: any) => e.id);
    expect(ids).toEqual(expect.arrayContaining([eintragOrganigramm1, eintragOrganigramm2]));
    expect(ids).not.toContain(eintragKassenbuch);
  });

  it("ungueltige Query-Parameter liefern 400 statt 500 (safeParse + BadRequestException, kein Stacktrace)", async () => {
    const limitZuGross = await als(tokenMitRecht, "?limit=500");
    expect(limitZuGross.status).toBe(400);

    const limitNull = await als(tokenMitRecht, "?limit=0");
    expect(limitNull.status).toBe(400);

    const offsetNegativ = await als(tokenMitRecht, "?offset=-1");
    expect(offsetNegativ.status).toBe(400);
  });
});
