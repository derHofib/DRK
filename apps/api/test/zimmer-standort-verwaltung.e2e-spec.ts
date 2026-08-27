/**
 * Zimmer/Standort bearbeiten und deaktivieren -- die drei Zusicherungen,
 * die dabei neu dazugekommen sind:
 *
 *   1. Eine doppelte Zimmernummer im selben Standort wird mit einer
 *      verstaendlichen 409-Meldung abgelehnt, nicht mit einem rohen
 *      500 aus der UNIQUE-Constraint (migrations/0009).
 *   2. Ein belegtes Zimmer laesst sich nicht deaktivieren.
 *   3. Deaktivieren ist "aktiv = false", kein DELETE -- das Zimmer
 *      verschwindet nur aus der Liste, die Belegungshistorie bleibt.
 *
 * Zusaetzlich: die Standort-Einschraenkung (siehe
 * standort-einschraenkung.e2e-spec.ts) gilt auch fuer die neuen
 * Bearbeiten-/Deaktivieren-Pfade.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Zimmer und Standort: bearbeiten, deaktivieren", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBetreuer: string;
  let standort1: string;
  let standort2: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-zimmerstammdaten-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Zimmerverwaltung ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );
    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3, 'einrichtungsleitung') RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Betreuer Test', $3, 'betreuer')`,
      [mandantId, `betreuer-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    standort1 = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    standort2 = standort2Rows[0].id;

    await admin.query(
      "INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)",
      [mandantId, einrichtungsleitungRows[0].id, standort1]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`einrichtungsleitung-s1-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`betreuer-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM belegung WHERE zimmer_id IN (SELECT id FROM zimmer WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body?: Record<string, unknown>) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body ?? {}),
    };
  }

  it("lehnt eine doppelte Zimmernummer im selben Standort mit 409 ab", async () => {
    const erstes = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort1, nummer: "301" });
    expect(erstes.status).toBe(201);

    const doppelt = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort1, nummer: "301" });
    expect(doppelt.status).toBe(409);
    expect(doppelt.body.message).toMatch(/gibt es in diesem Standort bereits/);
  });

  it("erlaubt dieselbe Nummer in einem ANDEREN Standort", async () => {
    const res = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort2, nummer: "301" });
    expect(res.status).toBe(201);
  });

  it("bearbeitet die Zimmernummer und lehnt dabei ebenfalls Duplikate ab", async () => {
    const angelegt = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort1, nummer: "302" });
    const zimmerId = angelegt.body.id;

    const umbenannt = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}`, { nummer: "303" });
    expect(umbenannt.status).toBe(200);
    expect(umbenannt.body.nummer).toBe("303");

    const konflikt = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}`, { nummer: "301" });
    expect(konflikt.status).toBe(409);
  });

  it("deaktiviert ein leeres Zimmer -- es verschwindet aus der Liste, bleibt aber in der Datenbank", async () => {
    const angelegt = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort1, nummer: "304" });
    const zimmerId = angelegt.body.id;

    const deaktiviert = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/deaktivieren`);
    expect(deaktiviert.status).toBe(200);

    const liste = await als(tokenBereichsleitung).get("/zimmer");
    expect(liste.body.find((z: { id: string }) => z.id === zimmerId)).toBeUndefined();

    const { rows } = await admin.query("SELECT aktiv FROM zimmer WHERE id = $1", [zimmerId]);
    expect(rows[0].aktiv).toBe(false);
  });

  it("lehnt das Deaktivieren eines belegten Zimmers ab", async () => {
    const angelegt = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort1, nummer: "305" });
    const zimmerId = angelegt.body.id;

    const { rows: klientRows } = await admin.query(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Belegt', 'Test', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-BELEGT-${randomUUID().slice(0, 8)}`]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmerId, klientRows[0].id]
    );

    const res = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/deaktivieren`);
    expect(res.status).toBe(409);

    const liste = await als(tokenBereichsleitung).get("/zimmer");
    expect(liste.body.find((z: { id: string }) => z.id === zimmerId)).toBeDefined();
  });

  it("bearbeitet einen Standort (Name, Adresse, aktiv)", async () => {
    const res = await als(tokenBereichsleitung).patch(`/standorte/${standort2}`, {
      name: "Standort 2 (umbenannt)",
      adresse: "Neue Str. 9",
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Standort 2 (umbenannt)");
    expect(res.body.adresse).toBe("Neue Str. 9");

    const deaktiviert = await als(tokenBereichsleitung).patch(`/standorte/${standort2}`, { aktiv: false });
    expect(deaktiviert.status).toBe(200);
    expect(deaktiviert.body.aktiv).toBe(false);

    // Bestehende Zimmer dieses Standorts bleiben unangetastet sichtbar --
    // "deaktiviert" heisst nur "kein neues Zimmer mehr hier", nicht "alles
    // hier verschwindet".
    const liste = await als(tokenBereichsleitung).get("/zimmer");
    expect(liste.body.some((z: { standortId: string }) => z.standortId === standort2)).toBe(true);
  });

  describe("Standort-Einschraenkung gilt auch hier (einrichtungsleitung-s1)", () => {
    it("kann ein Zimmer in Standort 1 bearbeiten, eins in Standort 2 nicht", async () => {
      const inS1 = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort1, nummer: "401" });
      const inS2 = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort2, nummer: "401" });

      const eigenes = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/${inS1.body.id}`, { nummer: "402" });
      expect(eigenes.status).toBe(200);

      const fremdes = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/${inS2.body.id}`, { nummer: "402" });
      expect(fremdes.status).toBe(404);
    });

    it("kann ein Zimmer in Standort 2 nicht deaktivieren", async () => {
      const inS2 = await als(tokenBereichsleitung).post("/zimmer", { standortId: standort2, nummer: "403" });
      const res = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/${inS2.body.id}/deaktivieren`);
      expect(res.status).toBe(404);
    });
  });

  describe("Rollenpruefung: Zimmer-/Standort-Stammdaten sind kein Betreuer-Tagesgeschaeft", () => {
    it("Betreuer darf weder Zimmer anlegen, bearbeiten noch deaktivieren", async () => {
      const angelegt = await als(tokenBetreuer).post("/zimmer", { standortId: standort1, nummer: "501" });
      expect(angelegt.status).toBe(403);

      const vonBereichsleitung = await als(tokenBereichsleitung).post("/zimmer", {
        standortId: standort1,
        nummer: "502",
      });
      const bearbeitet = await als(tokenBetreuer).patch(`/zimmer/${vonBereichsleitung.body.id}`, { nummer: "503" });
      expect(bearbeitet.status).toBe(403);

      const deaktiviert = await als(tokenBetreuer).patch(`/zimmer/${vonBereichsleitung.body.id}/deaktivieren`);
      expect(deaktiviert.status).toBe(403);
    });

    it("Betreuer darf weder eine Einrichtung anlegen noch bearbeiten", async () => {
      const angelegt = await als(tokenBetreuer).post("/standorte", { name: "Sollte scheitern", adresse: "Nirgends" });
      expect(angelegt.status).toBe(403);

      const bearbeitet = await als(tokenBetreuer).patch(`/standorte/${standort1}`, { name: "Sollte scheitern" });
      expect(bearbeitet.status).toBe(403);
    });

    it("nur die Bereichsleitung darf eine neue Einrichtung anlegen, Einrichtungsleitung nicht", async () => {
      const vonEinrichtungsleitung = await als(tokenEinrichtungsleitungS1).post("/standorte", {
        name: "Sollte auch scheitern",
        adresse: "Nirgends",
      });
      expect(vonEinrichtungsleitung.status).toBe(403);

      const vonBereichsleitung = await als(tokenBereichsleitung).post("/standorte", {
        name: "Standort 3",
        adresse: "Str. 3",
      });
      expect(vonBereichsleitung.status).toBe(201);
    });
  });
});
