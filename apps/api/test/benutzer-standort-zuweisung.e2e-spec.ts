/**
 * PUT /benutzer/:id/standorte (benutzer.service.ts, standorteSetzen()):
 * die bislang komplett fehlende Schreibseite von benutzer_standort. Ohne
 * sie blieb die Lesefilterung (ermittleErlaubteStandortIds()) in jedem
 * Modul wirkungslos -- es gab schlicht keine Moeglichkeit, jemanden
 * ueberhaupt einzuschraenken.
 *
 * Aufbau: zwei Standorte S1/S2, eine Bereichsleitung (traegerweit), eine
 * Einrichtungsleitung mit Zuordnung zu S1, ein Betreuer ohne Zuordnung
 * (Zielperson der Zuweisung).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Benutzer: Standort-Zuweisung (benutzer_standort)", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBetreuer: string;

  let standort1Id: string;
  let standort2Id: string;
  let betreuerId: string;
  let einrichtungsleitungS1Id: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Zuweisung ${suffix}`, `test-zuweisung-${suffix}`]
    );
    mandantId = mandantRows[0].id;

    async function neuerBenutzer(rolle: string, emailPrefix: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, `${emailPrefix}-${suffix}@beispiel.test`, `${emailPrefix} Test`, passwortHash, rolle]
      );
      return rows[0].id;
    }
    await neuerBenutzer("bereichsleitung", "bereichsleitung");
    einrichtungsleitungS1Id = await neuerBenutzer("einrichtungsleitung", "einrichtungsleitung-s1");
    betreuerId = await neuerBenutzer("betreuer", "betreuer");

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    standort1Id = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    standort2Id = standort2Rows[0].id;

    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId,
      einrichtungsleitungS1Id,
      standort1Id,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const { rows: slugRows } = await admin.query<{ slug: string }>("SELECT slug FROM mandant WHERE id = $1", [mandantId]);
    const mandantSlug = slugRows[0].slug;
    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`einrichtungsleitung-s1-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`betreuer-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      put: (path: string, body: Record<string, unknown>) =>
        request(http).put(path).set("Authorization", `Bearer ${token}`).send(body),
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
    };
  }

  afterEach(async () => {
    // Jeder Test faengt bei "unrestricted" an, damit die Tests unabhaengig
    // voneinander bleiben (keine Reihenfolge-Kopplung ueber den DB-Zustand).
    await admin.query("DELETE FROM benutzer_standort WHERE benutzer_id = $1", [betreuerId]);
  });

  it("Bereichsleitung weist dem Betreuer einen Standort zu -- GET /benutzer zeigt ihn danach an", async () => {
    const res = await als(tokenBereichsleitung).put(`/benutzer/${betreuerId}/standorte`, {
      standortIds: [standort1Id],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([standort1Id]);

    const liste = await als(tokenBereichsleitung).get("/benutzer");
    const betreuer = liste.body.find((b: { id: string }) => b.id === betreuerId);
    expect(betreuer.standortIds).toEqual([standort1Id]);
  });

  it("eine leere Liste hebt die Einschraenkung wieder auf", async () => {
    await als(tokenBereichsleitung).put(`/benutzer/${betreuerId}/standorte`, { standortIds: [standort1Id] });
    const res = await als(tokenBereichsleitung).put(`/benutzer/${betreuerId}/standorte`, { standortIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);

    const liste = await als(tokenBereichsleitung).get("/benutzer");
    const betreuer = liste.body.find((b: { id: string }) => b.id === betreuerId);
    expect(betreuer.standortIds).toEqual([]);
  });

  it("Betreuer darf ueberhaupt niemandem Standorte zuweisen (403)", async () => {
    const res = await als(tokenBetreuer).put(`/benutzer/${betreuerId}/standorte`, { standortIds: [standort1Id] });
    expect(res.status).toBe(403);
  });

  it("Einrichtungsleitung-S1 darf dem Betreuer NUR den eigenen Standort zuweisen, nicht Standort 2", async () => {
    const eigener = await als(tokenEinrichtungsleitungS1).put(`/benutzer/${betreuerId}/standorte`, {
      standortIds: [standort1Id],
    });
    expect(eigener.status).toBe(200);

    const fremder = await als(tokenEinrichtungsleitungS1).put(`/benutzer/${betreuerId}/standorte`, {
      standortIds: [standort2Id],
    });
    expect(fremder.status).toBe(403);

    // Gegenprobe: Bereichsleitung darf denselben fremden Standort sehr wohl zuweisen.
    const bereichsleitungDarf = await als(tokenBereichsleitung).put(`/benutzer/${betreuerId}/standorte`, {
      standortIds: [standort2Id],
    });
    expect(bereichsleitungDarf.status).toBe(200);
  });

  it("Einrichtungsleitung-S1 darf einer anderen Einrichtungsleitung keine Standorte zuweisen", async () => {
    const res = await als(tokenEinrichtungsleitungS1).put(`/benutzer/${einrichtungsleitungS1Id}/standorte`, {
      standortIds: [standort1Id],
    });
    expect(res.status).toBe(403);
  });

  it("eine zugewiesene Person sieht ueber /standorte danach nur noch den eigenen Standort", async () => {
    await als(tokenBereichsleitung).put(`/benutzer/${betreuerId}/standorte`, { standortIds: [standort1Id] });
    const res = await als(tokenBetreuer).get("/standorte");
    const ids = res.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(standort1Id);
    expect(ids).not.toContain(standort2Id);
  });

  it("lehnt eine unbekannte standortId ab (404)", async () => {
    const res = await als(tokenBereichsleitung).put(`/benutzer/${betreuerId}/standorte`, {
      standortIds: [randomUUID()],
    });
    expect(res.status).toBe(404);
  });
});
