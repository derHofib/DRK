/**
 * PUT /benutzer/:id/position mit { accountTypId } (Migration 0066): ein Rang
 * ist ein Account-Typ, auch wenn es dafuer noch keine Position gibt, und die
 * Standorte einer Person liegen an ihrer BESETZUNG
 * (org_position_besetzung_einheit), nicht an der geteilten Position.
 *
 * Der entscheidende Test ist der letzte: eine zweite Person auf DERSELBEN
 * Position darf die Standorte der ersten nicht mitbekommen -- genau das
 * koennte org_position_weitere_einheit nicht leisten.
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

describe("Benutzer: Rang aus Account-Typ, Standorte an der Besetzung", () => {
  let app: INestApplication;
  let admin: Client;
  let rechte: RechteService;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let traegerId: string;
  let einrichtungAId: string;
  let einrichtungBId: string;
  let gfId: string;
  let anna: string;
  let bernd: string;
  let bereichsleiterTypId: string;
  let tokenGf: string;

  const email = (k: string) => `${k}-${suffix}@rang-typ.test`;

  const put = (id: string, body: unknown) =>
    request(app.getHttpServer())
      .put(`/benutzer/${id}/position`)
      .set("Authorization", `Bearer ${tokenGf}`)
      .send(body as object);

  const klientenOrgUnits = (benutzerId: string) =>
    tenantContextStorage.run({ mandantId, benutzerId }, () => rechte.ermittleErlaubteOrgUnitIds("klienten", "ansehen"));

  async function neuerBenutzer(label: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, email(label), label, await bcrypt.hash(passwort, 4)]
    );
    return rows[0].id;
  }

  async function neuerTyp(name: string, vollzugriff = false): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1, $2, false, $3) RETURNING id",
      [mandantId, name, vollzugriff]
    );
    return rows[0].id;
  }

  async function neuePosition(orgUnitId: string, titel: string, typId: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, orgUnitId, titel, typId]
    );
    return rows[0].id;
  }

  async function besetze(positionId: string, benutzerId: string) {
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
      mandantId,
      positionId,
      benutzerId,
    ]);
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantSlug = `test-rang-typ-${suffix}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Rang-Typ ${suffix}`, mandantSlug]
    );
    mandantId = rows[0].id;

    const { rows: traeger } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traeger[0].id;

    const { rows: standorte } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus A', 'Str. 1'), ($1, 'Haus B', 'Str. 2') RETURNING id",
      [mandantId]
    );
    const { rows: einheiten } = await admin.query<{ id: string; standort_id: string }>(
      "SELECT id, standort_id FROM org_unit WHERE mandant_id = $1 AND typ = 'einrichtung'",
      [mandantId]
    );
    einrichtungAId = einheiten.find((e) => e.standort_id === standorte[0].id)!.id;
    einrichtungBId = einheiten.find((e) => e.standort_id === standorte[1].id)!.id;

    const gfTyp = await neuerTyp("Geschäftsführung", true);
    gfId = await neuerBenutzer("gf");
    await besetze(await neuePosition(traegerId, "Geschäftsführung", gfTyp), gfId);

    // Selbst angelegter Typ OHNE jede Position -- der Fall aus dem Dropdown.
    bereichsleiterTypId = await neuerTyp("Bereichsleiter");
    await admin.query(
      "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, 'klienten', 'ansehen', 'einrichtung', true)",
      [mandantId, bereichsleiterTypId]
    );

    // Anna arbeitet als Mitarbeiterin in zwei Einrichtungen: je Einrichtung
    // eine Position, so wie es heute entsteht.
    const mitarbeiterTyp = await neuerTyp("Mitarbeiter");
    anna = await neuerBenutzer("anna");
    bernd = await neuerBenutzer("bernd");
    await besetze(await neuePosition(einrichtungAId, "Mitarbeiter", mitarbeiterTyp), anna);
    await besetze(await neuePosition(einrichtungBId, "Mitarbeiter", mitarbeiterTyp), anna);
    await besetze(await neuePosition(einrichtungAId, "Mitarbeiter", mitarbeiterTyp), bernd);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rechte = app.get(RechteService);
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: email("gf"), passwort });
    tokenGf = res.body.accessToken;
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
      await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("Typ ohne Position ist waehlbar: Position wird angelegt, Annas Standorte ziehen mit um", async () => {
    expect(await klientenOrgUnits(anna)).toEqual([]);

    const res = await put(anna, { accountTypId: bereichsleiterTypId });
    expect(res.status).toBe(200);
    expect(res.body.positionen.map((p: { titel: string }) => p.titel)).toEqual(["Bereichsleiter"]);

    const { rows: pos } = await admin.query<{ id: string; org_unit_id: string }>(
      "SELECT id, org_unit_id FROM org_position WHERE mandant_id = $1 AND account_typ_id = $2",
      [mandantId, bereichsleiterTypId]
    );
    expect(pos).toHaveLength(1);
    expect(pos[0].org_unit_id).toBe(traegerId);

    const { rows: einheiten } = await admin.query<{ org_unit_id: string }>(
      `SELECT e.org_unit_id FROM org_position_besetzung_einheit e
       JOIN org_position_besetzung b ON b.id = e.besetzung_id
       WHERE b.benutzer_id = $1 AND b.position_id = $2`,
      [anna, pos[0].id]
    );
    expect(new Set(einheiten.map((e) => e.org_unit_id))).toEqual(new Set([einrichtungAId, einrichtungBId]));

    expect(new Set(await klientenOrgUnits(anna))).toEqual(new Set([einrichtungAId, einrichtungBId]));
  });

  it("Gegenprobe: Bernd auf derselben Position bekommt Annas Standorte NICHT mit", async () => {
    const res = await put(bernd, { accountTypId: bereichsleiterTypId });
    expect(res.status).toBe(200);

    const { rows: pos } = await admin.query(
      "SELECT id FROM org_position WHERE mandant_id = $1 AND account_typ_id = $2",
      [mandantId, bereichsleiterTypId]
    );
    expect(pos).toHaveLength(1); // wiederverwendet, nicht noch einmal angelegt

    // Bernd hatte nur Einrichtung A, also nur A -- nicht B aus Annas Besetzung.
    expect(await klientenOrgUnits(bernd)).toEqual([einrichtungAId]);
  });

  it("GET /organigramm/positions nennt je Besetzung ihre Standorte (Grundlage fuer die Anzeige unter jeder Einrichtung)", async () => {
    const res = await request(app.getHttpServer())
      .get("/organigramm/positions")
      .set("Authorization", `Bearer ${tokenGf}`);
    expect(res.status).toBe(200);
    const pos = res.body.find((p: { titel: string }) => p.titel === "Bereichsleiter");
    const jeName = Object.fromEntries(
      pos.besetztMit.map((b: { benutzerName: string; orgUnitIds: string[] }) => [b.benutzerName, new Set(b.orgUnitIds)])
    );
    expect(jeName.anna).toEqual(new Set([einrichtungAId, einrichtungBId]));
    expect(jeName.bernd).toEqual(new Set([einrichtungAId]));
  });

  it("unbekannter Account-Typ -> 404", async () => {
    const res = await put(anna, { accountTypId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it("Stabsstellen bekommen keine Besetzungs-Einheiten (DB-Trigger)", async () => {
    const { rows: stab } = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id, typ) VALUES ($1, $2, 'QM', $3, 'stabsstelle') RETURNING id",
      [mandantId, traegerId, bereichsleiterTypId]
    );
    await besetze(stab[0].id, anna);
    const { rows: bes } = await admin.query<{ id: string }>(
      "SELECT id FROM org_position_besetzung WHERE position_id = $1",
      [stab[0].id]
    );
    await expect(
      admin.query(
        "INSERT INTO org_position_besetzung_einheit (mandant_id, besetzung_id, org_unit_id) VALUES ($1, $2, $3)",
        [mandantId, bes[0].id, einrichtungAId]
      )
    ).rejects.toThrow(/nur fuer Linienpositionen/);
  });
});
