/**
 * Kostenuebernahme-Zeitraeume werden vom Amt fachlich fast immer von
 * vornherein fuer einen festen Zeitraum bewilligt, nicht nur unbefristet ab
 * "von" -- deshalb laesst sich "bis" seit dieser Aenderung schon beim
 * Anlegen mitgeben, statt zwingend erst spaeter per beenden() gesetzt zu
 * werden. "Offen anlegen und einmal beenden" bleibt weiterhin moeglich, fuer
 * Faelle, in denen die Bewilligungsdauer noch nicht feststeht.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Kostenuebernahme: Zeitraum direkt beim Anlegen befristen", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let klientId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-kostenuebernahme-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Kostenübernahme ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Test', 'Klient', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-${suffix}`]
    );
    klientId = klientRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: `bereichsleitung-${suffix}@beispiel.test`, passwort });
    tokenBereichsleitung = res.body.accessToken;
  });

  afterAll(async () => {
    await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function post(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post("/kostenuebernahmen")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send(body);
  }
  function get() {
    return request(app.getHttpServer())
      .get(`/kostenuebernahmen?klientId=${klientId}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
  }

  it("legt einen von vornherein befristeten Zeitraum an, ohne dass beenden() noetig ist", async () => {
    const res = await post({
      klientId,
      amt: "Jugendamt Musterstadt",
      von: "2026-01-01",
      bis: "2026-06-30",
    });
    expect(res.status).toBe(201);
    expect(res.body.von).toBe("2026-01-01");
    expect(res.body.bis).toBe("2026-06-30");
  });

  it("legt weiterhin einen unbefristet offenen Zeitraum an, wenn bis fehlt", async () => {
    const res = await post({
      klientId,
      amt: "Sozialamt Musterstadt",
      von: "2026-07-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.bis).toBeNull();
  });

  it("lehnt ein Enddatum ab, das nicht nach dem Startdatum liegt", async () => {
    const gleich = await post({
      klientId,
      amt: "sollte scheitern",
      von: "2027-01-01",
      bis: "2027-01-01",
    });
    expect(gleich.status).toBe(400);

    const davor = await post({
      klientId,
      amt: "sollte scheitern",
      von: "2027-01-01",
      bis: "2026-12-01",
    });
    expect(davor.status).toBe(400);

    // Keiner der beiden abgelehnten Versuche darf einen Zeitraum angelegt haben.
    const liste = await get();
    expect(liste.body.find((k: { amt: string }) => k.amt === "sollte scheitern")).toBeUndefined();
  });

  it("lehnt einen befristeten Zeitraum ab, der sich mit einem bestehenden überschneidet", async () => {
    const res = await post({
      klientId,
      amt: "Ueberschneidung",
      von: "2026-03-01",
      bis: "2026-04-01",
    });
    expect(res.status).toBe(409);
  });

  it("kann einen offen angelegten Zeitraum weiterhin per beenden() nachträglich befristen", async () => {
    const liste = await get();
    const offener = liste.body.find((k: { bis: string | null }) => k.bis === null);
    expect(offener).toBeDefined();

    const res = await request(app.getHttpServer())
      .patch(`/kostenuebernahmen/${offener.id}/beenden`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ bis: "2026-12-31" });
    expect(res.status).toBe(200);
    expect(res.body.bis).toBe("2026-12-31");
  });
});
