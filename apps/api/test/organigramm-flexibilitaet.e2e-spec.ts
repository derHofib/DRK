/**
 * Organigramm-Nachtrag (Darstellung/Flexibilitaet, Migration 0047): zwei
 * unabhaengige Ergaenzungen in einem Spec, weil beide an denselben neuen
 * Endpunkten und demselben Fixture haengen.
 *
 * 1) Geschwister-Reihenfolge fuer Organisationseinheiten/Positionen
 *    (PUT .../org-units/reihenfolge, PUT .../positions/reihenfolge) --
 *    HTTP-Ebene: Persistenz + Validierung ("alle Ids muessen tatsaechlich
 *    Geschwister sein").
 * 2) Mehrfachzuordnung einer Linienposition zu weiteren Organisations-
 *    einheiten (PUT .../positions/:id/weitere-einheiten) -- HTTP-Ebene
 *    (Validierung: nur typ=linie, keine eigene Einheit als "weitere") UND
 *    direkt ueber RechteService (app.get(RechteService) + manuell
 *    aufgespannter Tenant-Kontext, exakt das Muster aus
 *    externe-parteien-schema.e2e-spec.ts), um zu belegen, dass die
 *    Scope-Aufloesung tatsaechlich ueber BEIDE Einheiten unioniert, nicht
 *    nur dass der Datensatz gespeichert wurde.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { RechteService } from "../src/rechte/rechte.service";
import { tenantContextStorage } from "../src/common/tenant-context";

describe("Organigramm: Flexibilität (Reihenfolge + weitere Einheiten)", () => {
  let app: INestApplication;
  let admin: Client;
  let rechte: RechteService;

  let mandantId: string;
  let mandantSlug: string;
  let traegerId: string;
  let einrichtungAId: string;
  let einrichtungBId: string;

  let posStabId: string;
  let posElId: string;
  let posSib1Id: string;
  let posSib2Id: string;
  let posSib3Id: string;

  let benEl: string;
  let tokenAdmin: string;
  let tokenEl: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-organigramm-flexibilitaet-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Flexibilität ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    const { rows: standortRows } = await admin.query<{ id: string }>(
      `INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus A', 'Teststr. 1'), ($1, 'Haus B', 'Teststr. 2') RETURNING id`,
      [mandantId]
    );
    const { rows: einrichtungRows } = await admin.query<{ id: string; standort_id: string }>(
      "SELECT id, standort_id FROM org_unit WHERE mandant_id = $1 AND typ = 'einrichtung' ORDER BY name",
      [mandantId]
    );
    einrichtungAId = einrichtungRows.find((r) => r.standort_id === standortRows[0].id)!.id;
    einrichtungBId = einrichtungRows.find((r) => r.standort_id === standortRows[1].id)!.id;

    async function neuerAccountTyp(name: string, opts: { istVollzugriff?: boolean } = {}): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ (mandant_id, name, ist_vollzugriff) VALUES ($1, $2, $3) RETURNING id`,
        [mandantId, name, opts.istVollzugriff ?? false]
      );
      return rows[0].id;
    }

    const adminTypId = await neuerAccountTyp("Geschäftsführung", { istVollzugriff: true });

    const elTypId = await neuerAccountTyp("Einrichtungsleitung");
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'klienten', 'ansehen', 'einrichtung', true)`,
      [mandantId, elTypId]
    );

    async function neuePosition(
      orgUnitId: string,
      titel: string,
      accountTypId: string,
      opts: { typ?: "linie" | "stabsstelle"; parentPositionId?: string } = {}
    ): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id, typ, parent_position_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [mandantId, orgUnitId, titel, accountTypId, opts.typ ?? "linie", opts.parentPositionId ?? null]
      );
      return rows[0].id;
    }

    const posAdminId = await neuePosition(traegerId, "Geschäftsführung", adminTypId);
    posStabId = await neuePosition(traegerId, "QM-Stabsstelle", adminTypId, { typ: "stabsstelle" });
    posElId = await neuePosition(einrichtungAId, "Einrichtungsleitung", elTypId);
    // Drei Geschwister (gleiche org_unit_id, gleiche parent_position_id=NULL)
    // fuer den Positions-Reihenfolge-Test -- bewusst ohne Besetzung, die
    // Reihenfolge ist unabhaengig davon.
    posSib1Id = await neuePosition(einrichtungAId, "Geschwister 1", adminTypId);
    posSib2Id = await neuePosition(einrichtungAId, "Geschwister 2", adminTypId);
    posSib3Id = await neuePosition(einrichtungAId, "Geschwister 3", adminTypId);

    async function neuerBenutzer(label: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, `${label}-${suffix}@flexibilitaet.test`, `Testperson ${label}`, passwortHash]
      );
      return rows[0].id;
    }
    const benAdmin = await neuerBenutzer("admin");
    benEl = await neuerBenutzer("el");
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1,$2,$3)", [
      mandantId,
      posAdminId,
      benAdmin,
    ]);
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1,$2,$3)", [
      mandantId,
      posElId,
      benEl,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rechte = app.get(RechteService);

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenAdmin = await login(`admin-${suffix}@flexibilitaet.test`);
    tokenEl = await login(`el-${suffix}@flexibilitaet.test`);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_weitere_einheit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
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
      put: (path: string, body: object) => {
        const req = request(app.getHttpServer()).put(path).send(body);
        return token ? req.set("Authorization", `Bearer ${token}`) : req;
      },
      get: (path: string) => {
        const req = request(app.getHttpServer()).get(path);
        return token ? req.set("Authorization", `Bearer ${token}`) : req;
      },
    };
  }

  // -------------------------------------------------------------------
  // Geschwister-Reihenfolge: Organisationseinheiten
  // -------------------------------------------------------------------

  it("org-units/reihenfolge: persistiert die neue Reihenfolge der Einrichtungen", async () => {
    const res = await als(tokenAdmin).put("/organigramm/org-units/reihenfolge", {
      elternId: traegerId,
      geordneteIds: [einrichtungBId, einrichtungAId],
    });
    // 204: der Endpunkt liefert bewusst kein Objekt zurueck (reine
    // Reihenfolge) -- siehe Kommentar im Controller.
    expect(res.status).toBe(204);

    const gelesen = await als(tokenAdmin).get("/organigramm/org-units");
    const indexA = gelesen.body.findIndex((u: any) => u.id === einrichtungAId);
    const indexB = gelesen.body.findIndex((u: any) => u.id === einrichtungBId);
    expect(indexB).toBeLessThan(indexA);
  });

  it("org-units/reihenfolge: 400 bei einer Id, die kein Geschwister ist", async () => {
    const res = await als(tokenAdmin).put("/organigramm/org-units/reihenfolge", {
      elternId: einrichtungAId, // weder einrichtungA noch einrichtungB sind Kinder von einrichtungA
      geordneteIds: [einrichtungAId, einrichtungBId],
    });
    expect(res.status).toBe(400);
  });

  it("org-units/reihenfolge: 403 ohne organigramm.bearbeiten, 401 ohne Token", async () => {
    const ohneRecht = await als(tokenEl).put("/organigramm/org-units/reihenfolge", {
      elternId: traegerId,
      geordneteIds: [einrichtungAId, einrichtungBId],
    });
    expect(ohneRecht.status).toBe(403);

    const ohneToken = await als(undefined).put("/organigramm/org-units/reihenfolge", {
      elternId: traegerId,
      geordneteIds: [einrichtungAId, einrichtungBId],
    });
    expect(ohneToken.status).toBe(401);
  });

  // -------------------------------------------------------------------
  // Geschwister-Reihenfolge: Positionen
  // -------------------------------------------------------------------

  it("positions/reihenfolge: persistiert die neue Reihenfolge der Geschwister-Positionen", async () => {
    const res = await als(tokenAdmin).put("/organigramm/positions/reihenfolge", {
      orgUnitId: einrichtungAId,
      parentPositionId: null,
      geordneteIds: [posSib3Id, posSib1Id, posSib2Id],
    });
    expect(res.status).toBe(204);

    const gelesen = await als(tokenAdmin).get("/organigramm/positions");
    const index3 = gelesen.body.findIndex((p: any) => p.id === posSib3Id);
    const index1 = gelesen.body.findIndex((p: any) => p.id === posSib1Id);
    const index2 = gelesen.body.findIndex((p: any) => p.id === posSib2Id);
    expect(index3).toBeLessThan(index1);
    expect(index1).toBeLessThan(index2);
  });

  it("positions/reihenfolge: 400 wenn eine Id zu einer anderen org_unit gehört", async () => {
    const res = await als(tokenAdmin).put("/organigramm/positions/reihenfolge", {
      orgUnitId: einrichtungAId,
      parentPositionId: null,
      geordneteIds: [posSib1Id, posStabId], // posStabId haengt an traegerId, nicht einrichtungAId
    });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------
  // Weitere Organisationseinheiten (Mehrfachzuordnung einer Linienposition)
  // -------------------------------------------------------------------

  it("weitere-einheiten: 409 bei einer Stabsstelle (nur Linienpositionen erlaubt)", async () => {
    const res = await als(tokenAdmin).put(`/organigramm/positions/${posStabId}/weitere-einheiten`, {
      orgUnitIds: [einrichtungAId],
    });
    expect(res.status).toBe(409);
  });

  it("weitere-einheiten: 409 wenn die weitere Einheit die eigene Heimat-Einheit ist", async () => {
    const res = await als(tokenAdmin).put(`/organigramm/positions/${posElId}/weitere-einheiten`, {
      orgUnitIds: [einrichtungAId], // posElId gehört bereits zu einrichtungAId
    });
    expect(res.status).toBe(409);
  });

  it("weitere-einheiten: 403 ohne organigramm.bearbeiten, 401 ohne Token", async () => {
    const ohneRecht = await als(tokenEl).put(`/organigramm/positions/${posElId}/weitere-einheiten`, {
      orgUnitIds: [einrichtungBId],
    });
    expect(ohneRecht.status).toBe(403);

    const ohneToken = await als(undefined).put(`/organigramm/positions/${posElId}/weitere-einheiten`, {
      orgUnitIds: [einrichtungBId],
    });
    expect(ohneToken.status).toBe(401);
  });

  it("weitere-einheiten: setzt die Zuordnung und die Rechte-Engine unioniert den Scope über beide Einheiten", async () => {
    // Vorher: posElId (Konto benEl) hat klienten.ansehen nur in einrichtungAId.
    const vorher = await tenantContextStorage.run({ mandantId, benutzerId: benEl }, () =>
      rechte.ermittleErlaubteOrgUnitIds("klienten", "ansehen")
    );
    expect(vorher).toEqual([einrichtungAId]);

    const res = await als(tokenAdmin).put(`/organigramm/positions/${posElId}/weitere-einheiten`, {
      orgUnitIds: [einrichtungBId],
    });
    expect(res.status).toBe(200);
    expect(res.body.weitereOrgUnitIds).toEqual([einrichtungBId]);

    const gelesen = await als(tokenAdmin).get("/organigramm/positions");
    const positionNachLesen = gelesen.body.find((p: any) => p.id === posElId);
    expect(positionNachLesen.weitereOrgUnitIds).toEqual([einrichtungBId]);

    // Nachher: dieselbe Position, derselbe Scope ("einrichtung") -- jetzt
    // ueber BEIDE Einheiten unioniert, ohne dass sich sonst irgendetwas an
    // der Zuweisung des Benutzers geaendert haette.
    const nachher = await tenantContextStorage.run({ mandantId, benutzerId: benEl }, () =>
      rechte.ermittleErlaubteOrgUnitIds("klienten", "ansehen")
    );
    expect(new Set(nachher)).toEqual(new Set([einrichtungAId, einrichtungBId]));
  });

  it("weitere-einheiten: Replace-Set -- ein zweiter Aufruf mit leerer Liste entfernt die Zuordnung wieder", async () => {
    const res = await als(tokenAdmin).put(`/organigramm/positions/${posElId}/weitere-einheiten`, {
      orgUnitIds: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.weitereOrgUnitIds).toEqual([]);

    const nachher = await tenantContextStorage.run({ mandantId, benutzerId: benEl }, () =>
      rechte.ermittleErlaubteOrgUnitIds("klienten", "ansehen")
    );
    expect(nachher).toEqual([einrichtungAId]);
  });
});
