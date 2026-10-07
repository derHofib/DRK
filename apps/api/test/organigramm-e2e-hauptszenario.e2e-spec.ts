/**
 * Organigramm-Plan, Lieferreihenfolge Schritt 10 ("durchgaengige
 * Verifikation"): das im Auftrag explizit genannte Hauptszenario als
 * einziger zusammenhaengender Test, statt nur in Einzelteilen ueber die
 * vielen Teilschritt-Specs verstreut zu sein:
 *
 *   Platzhalter-Position anlegen -> Rechte konfigurieren -> Mitarbeiter
 *   zuweisen -> Rechte greifen SOFORT (ohne weiteren Schritt, insbesondere
 *   ohne Neu-Login/Token-Refresh) -> Audit-Eintrag vorhanden.
 *
 * Bewusst ueber echte HTTP-Endpunkte (nicht nur RechteService direkt, wie
 * in rechte-engine.e2e-spec.ts) -- das Szenario ist eine Behauptung ueber
 * das Zusammenspiel von Controllern, Guard und Engine, nicht nur ueber die
 * Engine allein. "sofort" wird konkret so geprueft: derselbe, bereits vor
 * der Zuweisung ausgestellte JWT wird nach der Zuweisung unveraendert
 * wiederverwendet -- ein Erfolg wuerde also belegen, dass Rechte pro
 * Request aus der DB aufgeloest werden, nicht im Token oder einem Cache
 * stecken (Organigramm-Plan, "keine Cross-Request-Caches").
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Organigramm-Hauptszenario (Organigramm-Plan, Schritt 10)", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let traegerId: string;

  const passwort = "correct horse battery staple";

  let adminToken: string;
  let zielToken: string;
  let zielBenutzerId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-hauptszenario-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Hauptszenario ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    // Admin-Konto, das selbst die Szenario-Schritte ausfuehrt (Vollzugriff,
    // damit es organigramm.bearbeiten/manage-permissions ohnehin hat --
    // dessen eigene Rechteaufloesung ist nicht Gegenstand dieses Tests).
    const { rows: gfTypRows } = await admin.query<{ id: string }>(
      "INSERT INTO account_typ (mandant_id, name, ist_vollzugriff) VALUES ($1, $2, true) RETURNING id",
      [mandantId, "Geschäftsführung"]
    );
    const { rows: adminPosRows } = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, traegerId, "Geschäftsführung", gfTypRows[0].id]
    );
    const { rows: adminBenRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle) VALUES ($1, $2, $3, $4, 'bereichsleitung') RETURNING id`,
      [mandantId, `admin-${suffix}@hauptszenario.test`, "Testperson Admin", passwortHash]
    );
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
      mandantId,
      adminPosRows[0].id,
      adminBenRows[0].id,
    ]);

    // Der spaetere Zielbenutzer existiert von Anfang an, aber OHNE jede
    // Position -- genau der Zustand "vor der Zuweisung" aus dem Szenario.
    const { rows: zielBenRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle) VALUES ($1, $2, $3, $4, 'betreuer') RETURNING id`,
      [mandantId, `ziel-${suffix}@hauptszenario.test`, "Testperson Ziel", passwortHash]
    );
    zielBenutzerId = zielBenRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    adminToken = await login(`admin-${suffix}@hauptszenario.test`);
    // Bewusst VOR jeder Positions-Zuweisung eingeloggt -- genau dieses
    // Token wird spaeter, nach der Zuweisung, unveraendert wiederverwendet.
    zielToken = await login(`ziel-${suffix}@hauptszenario.test`);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
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

  function als(token: string | undefined) {
    return {
      get: (path: string) => {
        const req = request(app.getHttpServer()).get(path);
        return token ? req.set("Authorization", `Bearer ${token}`) : req;
      },
      post: (path: string, body: object) => {
        const req = request(app.getHttpServer()).post(path).send(body);
        return token ? req.set("Authorization", `Bearer ${token}`) : req;
      },
      patch: (path: string, body: object) => {
        const req = request(app.getHttpServer()).patch(path).send(body);
        return token ? req.set("Authorization", `Bearer ${token}`) : req;
      },
      put: (path: string, body: object) => {
        const req = request(app.getHttpServer()).put(path).send(body);
        return token ? req.set("Authorization", `Bearer ${token}`) : req;
      },
    };
  }

  it("durchlaeuft das volle Hauptszenario und greift sofort, belegt per Audit-Log", async () => {
    // 0. Vorher: der Zielbenutzer hat noch keine Position -- organigramm.ansehen fehlt.
    const vorher = await als(zielToken).get("/organigramm/org-units");
    expect(vorher.status).toBe(403);

    // 1. Rechte konfigurieren: neuer Account-Typ "Einrichtungsleitung" mit
    // genau einem Recht (organigramm.ansehen, trägerweit).
    const accountTypRes = await als(adminToken).post("/organigramm/account-typen", {
      name: "Einrichtungsleitung",
      kategorie: "intern",
    });
    expect(accountTypRes.status).toBe(201);
    const accountTypId = accountTypRes.body.id as string;

    const rechteRes = await als(adminToken).put(`/organigramm/account-typen/${accountTypId}/rechte`, {
      rechte: [{ modul: "organigramm", aktion: "ansehen", scope: "tenant", erlaubt: true }],
    });
    expect(rechteRes.status).toBe(200);

    // 2. Platzhalter-Position anlegen ("Einrichtungsleitung (geplant)"):
    // zuerst normal anlegen (ist_geplant ist beim Anlegen nicht setzbar,
    // siehe organigramm.service.ts::legePositionAn()), danach explizit als
    // Platzhalter markieren.
    const positionRes = await als(adminToken).post("/organigramm/positions", {
      orgUnitId: traegerId,
      titel: "Einrichtungsleitung (geplant)",
      accountTypId,
    });
    expect(positionRes.status).toBe(201);
    const positionId = positionRes.body.id as string;
    expect(positionRes.body.istGeplant).toBe(false);

    const geplantRes = await als(adminToken).patch(`/organigramm/positions/${positionId}`, { istGeplant: true });
    expect(geplantRes.status).toBe(200);
    expect(geplantRes.body.istGeplant).toBe(true);

    // 3. Mitarbeiter zuweisen.
    const besetzenRes = await als(adminToken).post(`/organigramm/positions/${positionId}/besetzen`, {
      benutzerId: zielBenutzerId,
    });
    expect(besetzenRes.status).toBe(201);

    // 4. Rechte greifen SOFORT: derselbe, vor der Zuweisung ausgestellte
    // Token -- kein Re-Login, kein Refresh, kein zusaetzlicher Schritt.
    const nachher = await als(zielToken).get("/organigramm/org-units");
    expect(nachher.status).toBe(200);

    // 5. Audit-Eintrag vorhanden: jede Strukturaenderung oben hat eine Zeile
    // geschrieben, objektbezogen nachvollziehbar.
    const { rows: positionAudit } = await admin.query(
      `SELECT aktion FROM audit_log WHERE mandant_id = $1 AND objekt_typ = 'org_position' AND objekt_id = $2 ORDER BY erstellt_am`,
      [mandantId, positionId]
    );
    expect(positionAudit.map((r) => r.aktion)).toEqual(expect.arrayContaining(["position.anlegen", "position.bearbeiten"]));

    // position.besetzen protokolliert objektbezogen auf die neue
    // org_position_besetzung-Zeile, nicht auf die Position selbst (siehe
    // organigramm.service.ts::besetzen()) -- gesucht wird deshalb ueber den
    // nachher-Snapshot, der die Positions-Id weiterhin traegt.
    const { rows: besetzenAudit } = await admin.query(
      `SELECT 1 FROM audit_log WHERE mandant_id = $1 AND aktion = 'position.besetzen' AND nachher->>'id' = $2`,
      [mandantId, positionId]
    );
    expect(besetzenAudit).toHaveLength(1);

    const { rows: accountTypAudit } = await admin.query(
      `SELECT aktion FROM audit_log WHERE mandant_id = $1 AND objekt_typ = 'account_typ' AND objekt_id = $2 ORDER BY erstellt_am`,
      [mandantId, accountTypId]
    );
    expect(accountTypAudit.map((r) => r.aktion)).toEqual(
      expect.arrayContaining(["account-typ.anlegen", "account-typ.rechte-setzen"])
    );
  });
});
