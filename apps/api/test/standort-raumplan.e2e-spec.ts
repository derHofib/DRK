/**
 * Raumplan eines Standorts (standort-plan.service.ts): Etagen mit Zimmern und
 * Gemeinschaftsraeumen, Grundriss-Upload je Etage, Positionen der Karten.
 * Gegenproben stehen direkt neben jeder Sperre: dieselbe Anfrage, die fuer die
 * Leitung klappt, scheitert fuer das eingeschraenkte bzw. unberechtigte Konto.
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
import { etageSortSchluessel, vergleicheEtagen } from "../src/standorte/standort-plan.service";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("Raumplan", () => {
  let app: INestApplication;
  let admin: Client;
  let tokenBL: string; // bereichsleitung, unrestricted
  let tokenELS1: string; // einrichtungsleitung, nur Standort 1
  let tokenBetreuer: string; // darf nicht bearbeiten
  let s1: string;
  let s2: string;
  let zimmerEg: string;
  let zimmerOg: string;
  let zimmerS2: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const slug = `test-raumplan-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows: m } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Raumplan ${suffix}`, slug]
    );
    const mandantId = m[0].id;
    await kontoMitAlterRolle(admin, { mandantId, rolle: "bereichsleitung", email: `bl-${suffix}@x.test`, name: "BL", passwortHash });
    const elId = await kontoMitAlterRolle(admin, { mandantId, rolle: "einrichtungsleitung", email: `el-${suffix}@x.test`, name: "EL", passwortHash });
    await kontoMitAlterRolle(admin, { mandantId, rolle: "betreuer", email: `be-${suffix}@x.test`, name: "BE", passwortHash });

    const ins = async (sql: string, p: unknown[]) => (await admin.query<{ id: string }>(sql, p)).rows[0].id;
    s1 = await ins("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus 1', 'a') RETURNING id", [mandantId]);
    s2 = await ins("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus 2', 'b') RETURNING id", [mandantId]);
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, elId, s1]);
    zimmerEg = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer, etage) VALUES ($1, $2, '1', 'EG') RETURNING id", [mandantId, s1]);
    zimmerOg = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer, etage) VALUES ($1, $2, '21', '1. OG') RETURNING id", [mandantId, s1]);
    zimmerS2 = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer, etage) VALUES ($1, $2, '9', 'EG') RETURNING id", [mandantId, s2]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort })).body.accessToken as string;
    tokenBL = await login(`bl-${suffix}@x.test`);
    tokenELS1 = await login(`el-${suffix}@x.test`);
    tokenBetreuer = await login(`be-${suffix}@x.test`);
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const als = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string) => request(app.getHttpServer()).post(p).set("Authorization", `Bearer ${token}`),
    put: (p: string) => request(app.getHttpServer()).put(p).set("Authorization", `Bearer ${token}`),
    patch: (p: string) => request(app.getHttpServer()).patch(p).set("Authorization", `Bearer ${token}`),
    del: (p: string) => request(app.getHttpServer()).delete(p).set("Authorization", `Bearer ${token}`),
  });

  it("sortiert Etagen von unten nach oben", () => {
    const sortiert = ["Dachgeschoss", "2. OG", "EG", "Keller", "1. OG", "Anbau"].sort(vergleicheEtagen);
    expect(sortiert).toEqual(["Keller", "EG", "1. OG", "2. OG", "Anbau", "Dachgeschoss"]);
    expect(etageSortSchluessel("1. UG")).toBe(-1);
  });

  it("liefert Etagen mit Zimmern; Betreuer sieht, darf aber nicht bearbeiten", async () => {
    const res = await als(tokenELS1).get(`/standorte/${s1}/raumplan`);
    expect(res.status).toBe(200);
    expect(res.body.etagen.map((e: { etage: string }) => e.etage)).toEqual(["EG", "1. OG"]);
    expect(res.body.darfBearbeiten).toBe(true);
    const betreuer = await als(tokenBetreuer).get(`/standorte/${s1}/raumplan`);
    expect(betreuer.status).toBe(200);
    expect(betreuer.body.darfBearbeiten).toBe(false);
  });

  it("Gemeinschaftsraum: anlegen klappt fuer Leitung, nicht fuer Betreuer", async () => {
    const ok = await als(tokenELS1).post(`/standorte/${s1}/raeume`).send({ name: "Küche", etage: "EG" });
    expect(ok.status).toBe(201);
    const verboten = await als(tokenBetreuer).post(`/standorte/${s1}/raeume`).send({ name: "Heimlich", etage: "EG" });
    expect(verboten.status).toBe(403);
    const plan = await als(tokenELS1).get(`/standorte/${s1}/raumplan`);
    const eg = plan.body.etagen.find((e: { etage: string }) => e.etage === "EG");
    expect(eg.raeume.map((r: { name: string }) => r.name)).toEqual(["Küche"]);
    // Plaetze bleiben unberuehrt: ein Raum ist kein Zimmer.
    expect(eg.zimmer).toHaveLength(1);
  });

  it("Standort-Schranke: eingeschraenktes Konto sieht Standort 2 nicht, Bereichsleitung schon", async () => {
    expect((await als(tokenELS1).get(`/standorte/${s2}/raumplan`)).status).toBe(404);
    expect((await als(tokenELS1).post(`/standorte/${s2}/raeume`).send({ name: "X", etage: "EG" })).status).toBe(404);
    expect((await als(tokenBL).get(`/standorte/${s2}/raumplan`)).status).toBe(200);
  });

  it("Grundriss: Upload, Abruf, Typpruefung, Loeschen", async () => {
    const put = (token: string, etage: string, typ: string, body: Buffer) =>
      als(token).put(`/standorte/${s1}/grundriss?etage=${encodeURIComponent(etage)}`).set("Content-Type", typ).set("X-Dateiname", "plan.png").send(body);

    expect((await put(tokenELS1, "EG", "image/png", PNG_1X1)).status).toBe(200);
    const abruf = await als(tokenELS1).get(`/standorte/${s1}/grundriss?etage=EG`).buffer(true).parse((r, cb) => {
      const teile: Buffer[] = [];
      r.on("data", (t: Buffer) => teile.push(t));
      r.on("end", () => cb(null, Buffer.concat(teile)));
    });
    expect(abruf.status).toBe(200);
    expect(abruf.headers["content-type"]).toBe("image/png");
    expect((abruf.body as Buffer).equals(PNG_1X1)).toBe(true);

    // Erklaerter Typ passt nicht zum Inhalt -> abgelehnt.
    expect((await put(tokenELS1, "EG", "image/jpeg", PNG_1X1)).status).toBe(400);
    expect((await put(tokenELS1, "EG", "image/png", Buffer.from("<script>alert(1)</script>"))).status).toBe(400);
    // Betreuer darf nicht hochladen, Standort 2 ist fuer das Konto unsichtbar.
    expect((await put(tokenBetreuer, "EG", "image/png", PNG_1X1)).status).toBe(403);
    expect((await als(tokenELS1).get(`/standorte/${s2}/grundriss?etage=EG`)).status).toBe(404);

    const plan = await als(tokenELS1).get(`/standorte/${s1}/raumplan`);
    expect(plan.body.etagen.find((e: { etage: string }) => e.etage === "EG").hatGrundriss).toBe(true);

    expect((await als(tokenELS1).del(`/standorte/${s1}/grundriss?etage=EG`)).status).toBe(200);
    expect((await als(tokenELS1).get(`/standorte/${s1}/grundriss?etage=EG`)).status).toBe(404);
  });

  it("Grundriss ueber dem Limit wird abgelehnt (413)", async () => {
    const gross = Buffer.concat([PNG_1X1, Buffer.alloc(8_100_000)]);
    const res = await als(tokenELS1).put(`/standorte/${s1}/grundriss?etage=EG`).set("Content-Type", "image/png").send(gross);
    expect(res.status).toBe(413);
  });

  it("Positionen: speichern, ersetzen, und nur eigene Karten der richtigen Etage", async () => {
    const send = (token: string, etage: string, positionen: unknown[]) =>
      als(token).put(`/standorte/${s1}/raumplan/positionen`).send({ etage, positionen });

    expect((await send(tokenELS1, "EG", [{ art: "zimmer", id: zimmerEg, x: 25.5, y: 40 }])).status).toBe(200);
    let plan = await als(tokenELS1).get(`/standorte/${s1}/raumplan`);
    expect(plan.body.etagen.find((e: { etage: string }) => e.etage === "EG").zimmer[0].position).toEqual({ x: 25.5, y: 40 });

    // Karte der falschen Etage / eines fremden Standorts -> 400.
    expect((await send(tokenELS1, "EG", [{ art: "zimmer", id: zimmerOg, x: 1, y: 1 }])).status).toBe(400);
    expect((await send(tokenELS1, "EG", [{ art: "zimmer", id: zimmerS2, x: 1, y: 1 }])).status).toBe(400);
    // Ausserhalb 0..100 und Dopplung -> 400.
    expect((await send(tokenELS1, "EG", [{ art: "zimmer", id: zimmerEg, x: 101, y: 1 }])).status).toBe(400);
    expect((await send(tokenELS1, "EG", [{ art: "zimmer", id: zimmerEg, x: 1, y: 1 }, { art: "zimmer", id: zimmerEg, x: 2, y: 2 }])).status).toBe(400);
    expect((await send(tokenBetreuer, "EG", [])).status).toBe(403);

    // Leerer Plan entfernt die Position wieder (ersetzen, nicht ergaenzen).
    expect((await send(tokenELS1, "EG", [])).status).toBe(200);
    plan = await als(tokenELS1).get(`/standorte/${s1}/raumplan`);
    expect(plan.body.etagen.find((e: { etage: string }) => e.etage === "EG").zimmer[0].position).toBeNull();
  });

  it("Position gilt nur auf der Etage, fuer die sie gesetzt wurde", async () => {
    await als(tokenELS1).put(`/standorte/${s1}/raumplan/positionen`).send({ etage: "EG", positionen: [{ art: "zimmer", id: zimmerEg, x: 10, y: 10 }] });
    await admin.query("UPDATE zimmer SET etage = '1. OG' WHERE id = $1", [zimmerEg]);
    const plan = await als(tokenELS1).get(`/standorte/${s1}/raumplan`);
    const og = plan.body.etagen.find((e: { etage: string }) => e.etage === "1. OG");
    expect(og.zimmer.find((z: { id: string }) => z.id === zimmerEg).position).toBeNull();
  });
});
