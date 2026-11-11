/**
 * Kopplung der iPhone-App per QR-Code (Migration 0070).
 *
 * Kernaussagen:
 *   1. Ein angemeldeter Benutzer erzeugt einen Kopplungs-Token; die App
 *      tauscht ihn OHNE Sitzung gegen ein Geraete-Token. Einmalig, kurz gueltig.
 *   2. Der Token steht nie im Klartext in der Datenbank.
 *   3. Ein gesperrtes Geraet verliert seine Sitzung sofort -- das Token selbst
 *      ist noch 30 Tage gueltig, der Guard entscheidet.
 *   4. Geraete sind je Person und je Mandant getrennt (RLS + 404 statt 403).
 *   5. Push-Tokens gibt es nur fuer Geraete-Sitzungen und verschwinden mit der Sperre.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Geraete-Kopplung (iPhone-App)", () => {
  let app: INestApplication;
  let admin: Client;
  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const mandantIds: string[] = [];
  const slugs = { a: `test-geraet-a-${suffix}`, b: `test-geraet-b-${suffix}` };
  const email = (m: string, n: string) => `${n}-${m}-${suffix}@beispiel.test`;
  const SERVER = { server: "https://zimmerakte.beispiel.test" };
  let tokenA: string;
  let tokenA2: string; // zweite Person im selben Mandanten
  let tokenB: string;
  let benutzerA2Id: string;

  async function login(slug: string, mail: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email: mail, passwort });
    return res.body.accessToken as string;
  }
  const mit = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: Record<string, unknown> = {}) =>
      request(app.getHttpServer()).post(p).set("Authorization", `Bearer ${token}`).send(body),
  });
  async function koppeln(sitzung: string, name = "iPhone von Test") {
    const kopplung = await mit(sitzung).post("/geraete/kopplung", SERVER);
    const res = await request(app.getHttpServer())
      .post("/auth/geraet/einloesen")
      .send({ token: kopplung.body.token, geraeteName: name, plattform: "ios" });
    return { kopplung, res, geraeteToken: res.body.accessToken as string };
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);
    for (const [k, slug] of Object.entries(slugs)) {
      const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
        `Testmandant Geraet ${k} ${suffix}`,
        slug,
      ]);
      mandantIds.push(rows[0].id);
    }
    const [mandantA, mandantB] = mandantIds;
    await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "bereichsleitung", email: email("a", "eins"), name: "Eins A", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "bereichsleitung", email: email("a", "zwei"), name: "Zwei A", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantB, rolle: "betreuer", email: email("b", "eins"), name: "Eins B", passwortHash: hash });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenA = await login(slugs.a, email("a", "eins"));
    tokenA2 = await login(slugs.a, email("a", "zwei"));
    tokenB = await login(slugs.b, email("b", "eins"));
    const { rows } = await admin.query<{ id: string }>("SELECT id FROM benutzer WHERE email = $1", [email("a", "zwei")]);
    benutzerA2Id = rows[0].id;
  });

  afterAll(async () => {
    try {
      for (const id of mandantIds) {
        await admin.query("DELETE FROM geraet WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM geraet_kopplung WHERE mandant_id = $1", [id]);
        await raeumeKontoMitRolleAuf(admin, id);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [id]);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("kopplung -> einloesen -> Geraete-Token ist eine gueltige Sitzung derselben Person", async () => {
    const { kopplung, res, geraeteToken } = await koppeln(tokenA);
    expect(kopplung.status).toBe(201);
    expect(kopplung.body.mandantSlug).toBe(slugs.a);
    expect(kopplung.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.status).toBe(200);
    const liste = await mit(geraeteToken).get("/geraete");
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(1);
    expect(liste.body[0]).toMatchObject({ name: "iPhone von Test", plattform: "ios", gesperrtAm: null, pushAktiv: false });
  });

  it("der Token ist einmalig", async () => {
    const kopplung = await mit(tokenA).post("/geraete/kopplung", SERVER);
    const einloesen = () =>
      request(app.getHttpServer())
        .post("/auth/geraet/einloesen")
        .send({ token: kopplung.body.token, geraeteName: "Zweitversuch", plattform: "ios" });
    expect((await einloesen()).status).toBe(200);
    expect((await einloesen()).status).toBe(401);
  });

  it("die Kopplung verlangt eine https-Adresse (oder localhost) ohne Pfad", async () => {
    for (const server of ["http://zimmerakte.beispiel.test", "https://zimmerakte.beispiel.test/pfad", "javascript:alert(1)", ""]) {
      expect((await mit(tokenA).post("/geraete/kopplung", { server })).status).toBe(400);
    }
    expect((await mit(tokenA).post("/geraete/kopplung")).status).toBe(400);
    expect((await mit(tokenA).post("/geraete/kopplung", { server: "http://localhost:5173" })).status).toBe(201);
  });

  it("der Token steht nicht im Klartext in der Datenbank", async () => {
    const kopplung = await mit(tokenA).post("/geraete/kopplung", SERVER);
    const { rows } = await admin.query("SELECT 1 FROM geraet_kopplung WHERE token_hash = $1", [kopplung.body.token]);
    expect(rows).toHaveLength(0);
  });

  it("ein abgelaufener Token wird abgelehnt", async () => {
    const kopplung = await mit(tokenA).post("/geraete/kopplung", SERVER);
    await admin.query("UPDATE geraet_kopplung SET laeuft_ab_am = now() - interval '1 second' WHERE mandant_id = $1", [mandantIds[0]]);
    const res = await request(app.getHttpServer())
      .post("/auth/geraet/einloesen")
      .send({ token: kopplung.body.token, geraeteName: "Zu spaet", plattform: "ios" });
    expect(res.status).toBe(401);
  });

  it("ein erfundener Token und ungueltige Eingaben werden abgelehnt (401 bzw. 400, kein 500)", async () => {
    const http = request(app.getHttpServer());
    expect((await http.post("/auth/geraet/einloesen").send({ token: "gibts-nicht", geraeteName: "x", plattform: "ios" })).status).toBe(401);
    expect((await request(app.getHttpServer()).post("/auth/geraet/einloesen").send({ token: "x" })).status).toBe(400);
  });

  it("fuer eine deaktivierte Person wird nichts gekoppelt und der Token nicht verbraucht", async () => {
    const kopplung = await mit(tokenA2).post("/geraete/kopplung", SERVER);
    await admin.query("UPDATE benutzer SET aktiv = false WHERE id = $1", [benutzerA2Id]);
    const res = await request(app.getHttpServer())
      .post("/auth/geraet/einloesen")
      .send({ token: kopplung.body.token, geraeteName: "Gesperrte Person", plattform: "ios" });
    expect(res.status).toBe(401);
    const { rows } = await admin.query("SELECT eingeloest_am FROM geraet_kopplung WHERE benutzer_id = $1 ORDER BY erstellt_am DESC LIMIT 1", [benutzerA2Id]);
    expect(rows[0].eingeloest_am).toBeNull();
    await admin.query("UPDATE benutzer SET aktiv = true WHERE id = $1", [benutzerA2Id]);
  });

  it("ein gesperrtes Geraet verliert seine Sitzung sofort; die Web-Sitzung bleibt", async () => {
    const { geraeteToken } = await koppeln(tokenA, "Verlorenes Handy");
    const liste = await mit(tokenA).get("/geraete");
    const id = liste.body.find((g: { name: string }) => g.name === "Verlorenes Handy").id;
    expect((await mit(geraeteToken).get("/geraete")).status).toBe(200);
    expect((await mit(tokenA).post(`/geraete/${id}/sperren`)).status).toBe(204);
    expect((await mit(geraeteToken).get("/geraete")).status).toBe(401);
    expect((await mit(tokenA).get("/geraete")).status).toBe(200);
  });

  it("Geraete anderer Personen und Mandanten sind nicht sperrbar (404)", async () => {
    const { geraeteToken } = await koppeln(tokenA, "Nur meins");
    const id = (await mit(geraeteToken).get("/geraete")).body.find((g: { name: string }) => g.name === "Nur meins").id;
    expect((await mit(tokenA2).post(`/geraete/${id}/sperren`)).status).toBe(404);
    expect((await mit(tokenB).post(`/geraete/${id}/sperren`)).status).toBe(404);
    expect((await mit(tokenB).get("/geraete")).body).toHaveLength(0);
    expect((await mit(geraeteToken).get("/geraete")).status).toBe(200);
  });

  it("Push-Token: nur fuer Geraete-Sitzungen, und die Sperre loescht ihn", async () => {
    const apns = "ab".repeat(32);
    expect((await mit(tokenA).post("/geraete/push-token", { apnsToken: apns })).status).toBe(400);
    const { geraeteToken } = await koppeln(tokenA, "Mit Push");
    expect((await mit(geraeteToken).post("/geraete/push-token", { apnsToken: "kein-hex!" })).status).toBe(400);
    expect((await mit(geraeteToken).post("/geraete/push-token", { apnsToken: apns })).status).toBe(204);
    const liste = (await mit(tokenA).get("/geraete")).body;
    const g = liste.find((x: { name: string }) => x.name === "Mit Push");
    expect(g.pushAktiv).toBe(true);
    await mit(tokenA).post(`/geraete/${g.id}/sperren`);
    const { rows } = await admin.query("SELECT apns_token FROM geraet WHERE id = $1", [g.id]);
    expect(rows[0].apns_token).toBeNull();
  });
});
