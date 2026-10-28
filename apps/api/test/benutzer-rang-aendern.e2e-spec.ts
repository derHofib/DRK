/**
 * PUT /benutzer/:id/position (benutzer.service.ts, positionWechseln()):
 * Die Geschaeftsfuehrung gibt einer anderen Person einen anderen Rang. Rechte
 * haengen nur an Besetzungen, also wird vor allem geprueft, dass der Wechsel
 * SOFORT wirkt (neue Rechte da, alte weg -- auch bei einer erst heute
 * begonnenen Besetzung, Migration 0064) und dass die Schutzregeln greifen:
 * nur mit organigramm.manage-permissions, nicht der eigene Rang, die letzte
 * aktive Geschaeftsfuehrung bleibt (DB-Trigger, 0042/0050).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AlteRolle, kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Benutzer: Rang aendern", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let gfAId: string;
  let gfBId: string;
  let leitungId: string;
  let mitarbeiterId: string;
  let verwalterId: string; // manage-permissions, aber KEIN Vollzugriff

  let posGf: string;
  let posLeitung: string;
  let posMitarbeiter: string;

  let tokenGfA: string;
  let tokenLeitung: string;
  let tokenMitarbeiter: string;
  let tokenVerwalter: string;

  const emailVon = (k: string) => `${k}-${suffix}@beispiel.test`;

  async function konto(k: string, rolle: AlteRolle): Promise<string> {
    return kontoMitAlterRolle(admin, {
      mandantId,
      rolle,
      email: emailVon(k),
      name: k,
      passwortHash: await bcrypt.hash(passwort, 4),
    });
  }

  async function positionVon(benutzerId: string): Promise<string> {
    const { rows } = await admin.query<{ position_id: string }>(
      "SELECT position_id FROM org_position_besetzung WHERE benutzer_id = $1",
      [benutzerId]
    );
    return rows[0].position_id;
  }

  async function laufendePositionen(benutzerId: string): Promise<string[]> {
    const { rows } = await admin.query<{ position_id: string }>(
      `SELECT position_id FROM org_position_besetzung
       WHERE benutzer_id = $1 AND gueltig_ab <= CURRENT_DATE
         AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)
       ORDER BY position_id`,
      [benutzerId]
    );
    return rows.map((r) => r.position_id);
  }

  async function login(k: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: emailVon(k), passwort });
    return res.body.accessToken;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantSlug = `test-rang-${suffix}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Rang ${suffix}`, mandantSlug]
    );
    mandantId = rows[0].id;

    gfAId = await konto("gf-a", "bereichsleitung");
    gfBId = await konto("gf-b", "bereichsleitung");
    leitungId = await konto("leitung", "einrichtungsleitung");
    mitarbeiterId = await konto("mitarbeiter", "betreuer");
    posGf = await positionVon(gfAId);
    posLeitung = await positionVon(leitungId);
    posMitarbeiter = await positionVon(mitarbeiterId);

    // Eigener Typ nur mit manage-permissions: kann die letzte
    // Geschaeftsfuehrung ueberhaupt erst angreifen (die GF selbst darf ihren
    // eigenen Rang ja nicht aendern).
    const { rows: ben } = await admin.query<{ id: string }>(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Verwalter', $3) RETURNING id",
      [mandantId, emailVon("verwalter"), await bcrypt.hash(passwort, 4)]
    );
    verwalterId = ben[0].id;
    const { rows: typ } = await admin.query<{ id: string }>(
      "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1, 'Typ Verwalter', false, false) RETURNING id",
      [mandantId]
    );
    await admin.query(
      "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, 'organigramm', 'manage-permissions', 'traeger', true)",
      [mandantId, typ[0].id]
    );
    const { rows: wurzel } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    const { rows: pos } = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel) VALUES ($1, $2, $3, 'Verwalter') RETURNING id",
      [mandantId, wurzel[0].id, typ[0].id]
    );
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
      mandantId,
      pos[0].id,
      verwalterId,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tokenGfA = await login("gf-a");
    tokenLeitung = await login("leitung");
    tokenMitarbeiter = await login("mitarbeiter");
    tokenVerwalter = await login("verwalter");
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer_reset_token WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const put = (token: string, id: string, body: unknown) =>
    request(app.getHttpServer()).put(`/benutzer/${id}/position`).set("Authorization", `Bearer ${token}`).send(body as object);

  // mitarbeitende.anlegen hat die Einrichtungsleitung, der Mitarbeiter nicht
  // -- ein sichtbares Recht, an dem sich der Rangwechsel ablesen laesst.
  const resetLinkVersuch = (token: string) =>
    request(app.getHttpServer())
      .post(`/benutzer/${gfBId}/passwort-reset`)
      .set("Authorization", `Bearer ${token}`);

  it("ohne manage-permissions (Einrichtungsleitung) -> 403, nichts aendert sich", async () => {
    const res = await put(tokenLeitung, mitarbeiterId, { positionId: posLeitung });
    expect(res.status).toBe(403);
    expect(await laufendePositionen(mitarbeiterId)).toEqual([posMitarbeiter]);
  });

  it("Geschaeftsfuehrung befoerdert: neue Rechte gelten sofort, alte Position ist beendet, Audit-Eintrag", async () => {
    expect((await resetLinkVersuch(tokenMitarbeiter)).status).toBe(403);

    const res = await put(tokenGfA, mitarbeiterId, { positionId: posLeitung });
    expect(res.status).toBe(200);
    expect(res.body.positionen.map((p: { positionId: string }) => p.positionId)).toEqual([posLeitung]);
    expect(await laufendePositionen(mitarbeiterId)).toEqual([posLeitung]);

    // Dasselbe Token wie vorher: Rechte werden je Anfrage aus den
    // Besetzungen gelesen, ein neuer Login ist nicht noetig.
    expect((await resetLinkVersuch(tokenMitarbeiter)).status).toBe(201);

    const { rows: audit } = await admin.query(
      "SELECT benutzer_id, vorher, nachher FROM audit_log WHERE objekt_id = $1 AND aktion = 'rang-aendern'",
      [mitarbeiterId]
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].benutzer_id).toBe(gfAId);
    expect(audit[0].vorher.positionen.map((p: { positionId: string }) => p.positionId)).toEqual([posMitarbeiter]);
    expect(audit[0].nachher.positionen.map((p: { positionId: string }) => p.positionId)).toEqual([posLeitung]);
  });

  it("Zuruecknehmen am selben Tag wirkt ebenfalls sofort (Besetzung von heute, Migration 0064)", async () => {
    const res = await put(tokenGfA, mitarbeiterId, { positionId: posMitarbeiter });
    expect(res.status).toBe(200);
    expect(await laufendePositionen(mitarbeiterId)).toEqual([posMitarbeiter]);
    expect((await resetLinkVersuch(tokenMitarbeiter)).status).toBe(403);

    // Historie bleibt: die zurueckgenommene Besetzung ist nicht geloescht.
    const { rows } = await admin.query(
      "SELECT gueltig_bis < gueltig_ab AS nie_gegolten FROM org_position_besetzung WHERE benutzer_id = $1 AND position_id = $2",
      [mitarbeiterId, posLeitung]
    );
    expect(rows).toEqual([{ nie_gegolten: true }]);
  });

  it("derselbe Rang noch einmal aendert nichts und schreibt kein weiteres Protokoll", async () => {
    const res = await put(tokenGfA, mitarbeiterId, { positionId: posMitarbeiter });
    expect(res.status).toBe(200);
    const { rows } = await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE objekt_id = $1 AND aktion = 'rang-aendern'",
      [mitarbeiterId]
    );
    expect(rows[0].n).toBe(2);
  });

  it("den eigenen Rang aendern -> 403", async () => {
    const res = await put(tokenGfA, gfAId, { positionId: posMitarbeiter });
    expect(res.status).toBe(403);
    expect(await laufendePositionen(gfAId)).toEqual([posGf]);
  });

  it("die letzte aktive Geschaeftsfuehrung bleibt bestehen -> 409, sonst darf herabgestuft werden", async () => {
    // B herabstufen geht, A bleibt.
    expect((await put(tokenGfA, gfBId, { positionId: posMitarbeiter })).status).toBe(200);
    expect(await laufendePositionen(gfBId)).toEqual([posMitarbeiter]);

    const letzte = await put(tokenVerwalter, gfAId, { positionId: posMitarbeiter });
    expect(letzte.status).toBe(409);
    expect(await laufendePositionen(gfAId)).toEqual([posGf]);
    // Rollback der ganzen Transaktion: auch die neue Besetzung ist nicht da.
    const { rows } = await admin.query(
      "SELECT count(*)::int AS n FROM org_position_besetzung WHERE benutzer_id = $1 AND position_id = $2",
      [gfAId, posMitarbeiter]
    );
    expect(rows[0].n).toBe(0);

    // B wieder befoerdern: der Wechsel zwischen zwei Vollzugriff-Inhabern
    // scheitert nicht am Trigger (erst anlegen, dann beenden).
    expect((await put(tokenGfA, gfBId, { positionId: posGf })).status).toBe(200);
    expect(await laufendePositionen(gfBId)).toEqual([posGf]);
  });

  it("positionId null nimmt jede Position (und damit alle Rechte)", async () => {
    const res = await put(tokenGfA, leitungId, { positionId: null });
    expect(res.status).toBe(200);
    expect(res.body.positionen).toEqual([]);
    expect(await laufendePositionen(leitungId)).toEqual([]);
    expect((await resetLinkVersuch(tokenLeitung)).status).toBe(403);
  });

  it("unbekannte Person/Position -> 404, fehlerhafter Body -> 400", async () => {
    expect((await put(tokenGfA, randomUUID(), { positionId: posLeitung })).status).toBe(404);
    expect((await put(tokenGfA, mitarbeiterId, { positionId: randomUUID() })).status).toBe(404);
    expect((await put(tokenGfA, mitarbeiterId, { positionId: "chef" })).status).toBe(400);
    expect((await put(tokenGfA, mitarbeiterId, {})).status).toBe(400);
  });
});
