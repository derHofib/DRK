/**
 * POST /benutzer -- Mitarbeitende ueber die API anlegen, statt wie bisher
 * nur per manuellem SQL-Insert (siehe README "Ersten Benutzer anlegen").
 *
 * Kernaussagen:
 *   1. Nur die Rolle "leitung" darf das (ROLLEN_MIT_BENUTZER_ANLEGEN in
 *      benutzer.service.ts) -- bewusst die engste Fassung, bis die geplante
 *      Fuehrungshierarchie (Mitarbeiter/Leiter/Bereichsleiter) steht.
 *   2. Eine doppelte E-Mail IM SELBEN Mandanten wird mit 409 abgelehnt
 *      (UNIQUE(mandant_id, email), migrations/0004_benutzer.sql), dieselbe
 *      E-Mail in einem ANDEREN Mandanten ist erlaubt.
 *   3. Das gesetzte Passwort funktioniert wirklich -- der neu angelegte
 *      Benutzer kann sich damit einloggen (Ende-zu-Ende-Beweis fuer den
 *      bcrypt-Hash, nicht nur einen 201-Status).
 *   4. Mandantentrennung: ein in Mandant A angelegter Benutzer taucht nicht
 *      in Mandant B's Liste auf.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("POST /benutzer -- Mitarbeitende anlegen", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantAId: string;
  let mandantASlug: string;
  let mandantBId: string;
  let mandantBSlug: string;
  let tokenLeitungA: string;
  let tokenVerwaltungA: string;
  let tokenLeitungB: string;

  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantASlug = `test-benutzeranlegen-a-${suffix}`;
    mandantBSlug = `test-benutzeranlegen-b-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantARows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Benutzeranlegen A ${suffix}`, mandantASlug]
    );
    mandantAId = mandantARows[0].id;
    const { rows: mandantBRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Benutzeranlegen B ${suffix}`, mandantBSlug]
    );
    mandantBId = mandantBRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Leitung A', $3, 'leitung')`,
      [mandantAId, `leitung-a-${suffix}@beispiel.test`, passwortHash]
    );
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Verwaltung A', $3, 'verwaltung')`,
      [mandantAId, `verwaltung-a-${suffix}@beispiel.test`, passwortHash]
    );
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Leitung B', $3, 'leitung')`,
      [mandantBId, `leitung-b-${suffix}@beispiel.test`, passwortHash]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(mandantSlug: string, email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenLeitungA = await login(mandantASlug, `leitung-a-${suffix}@beispiel.test`);
    tokenVerwaltungA = await login(mandantASlug, `verwaltung-a-${suffix}@beispiel.test`);
    tokenLeitungB = await login(mandantBSlug, `leitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [[mandantAId, mandantBId]]);
    await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [[mandantAId, mandantBId]]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
    };
  }

  it("legt als Leitung einen neuen Mitarbeiter an", async () => {
    const res = await als(tokenLeitungA).post("/benutzer", {
      name: "Neue Bezugsbetreuung",
      email: `neu-1-${suffix}@beispiel.test`,
      rolle: "bezugsbetreuung",
      passwort,
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Neue Bezugsbetreuung");
    expect(res.body.rolle).toBe("bezugsbetreuung");
    expect(res.body.aktiv).toBe(true);
    expect(res.body.passwort_hash).toBeUndefined();
    expect(res.body.passwortHash).toBeUndefined();

    const liste = await als(tokenLeitungA).get("/benutzer");
    expect(liste.body.some((b: { email: string }) => b.email === `neu-1-${suffix}@beispiel.test`)).toBe(true);
  });

  it("lehnt das Anlegen durch eine Nicht-Leitung-Rolle mit 403 ab", async () => {
    const res = await als(tokenVerwaltungA).post("/benutzer", {
      name: "Sollte nicht klappen",
      email: `neu-2-${suffix}@beispiel.test`,
      rolle: "springer",
      passwort,
    });
    expect(res.status).toBe(403);

    const liste = await als(tokenLeitungA).get("/benutzer");
    expect(liste.body.some((b: { email: string }) => b.email === `neu-2-${suffix}@beispiel.test`)).toBe(false);
  });

  it("lehnt eine doppelte E-Mail im selben Mandanten mit 409 ab, erlaubt sie aber in einem ANDEREN Mandanten", async () => {
    const email = `doppelt-${suffix}@beispiel.test`;
    const erstes = await als(tokenLeitungA).post("/benutzer", {
      name: "Erster",
      email,
      rolle: "springer",
      passwort,
    });
    expect(erstes.status).toBe(201);

    const doppelt = await als(tokenLeitungA).post("/benutzer", {
      name: "Zweiter",
      email,
      rolle: "springer",
      passwort,
    });
    expect(doppelt.status).toBe(409);

    const andererMandant = await als(tokenLeitungB).post("/benutzer", {
      name: "Auch erlaubt",
      email,
      rolle: "springer",
      passwort,
    });
    expect(andererMandant.status).toBe(201);
  });

  it("lehnt ungueltige Eingaben mit 400 ab (fehlende Felder, unbekannte Rolle, zu kurzes Passwort)", async () => {
    const fehlend = await als(tokenLeitungA).post("/benutzer", { name: "Ohne Rest" });
    expect(fehlend.status).toBe(400);

    const unbekannteRolle = await als(tokenLeitungA).post("/benutzer", {
      name: "X",
      email: `x-${suffix}@beispiel.test`,
      rolle: "bereichsleiter",
      passwort,
    });
    expect(unbekannteRolle.status).toBe(400);

    const kurzesPasswort = await als(tokenLeitungA).post("/benutzer", {
      name: "X",
      email: `y-${suffix}@beispiel.test`,
      rolle: "springer",
      passwort: "zu-kurz",
    });
    expect(kurzesPasswort.status).toBe(400);
  });

  it("das gesetzte Passwort funktioniert wirklich -- der neue Benutzer kann sich einloggen", async () => {
    const email = `einlogg-${suffix}@beispiel.test`;
    const eigenesPasswort = "ein ganz eigenes passwort";
    const angelegt = await als(tokenLeitungA).post("/benutzer", {
      name: "Kann sich einloggen",
      email,
      rolle: "bezugsbetreuung",
      passwort: eigenesPasswort,
    });
    expect(angelegt.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: mandantASlug, email, passwort: eigenesPasswort });
    expect(login.status).toBe(201); // Nest-Standard fuer POST ohne @HttpCode(200)
    expect(typeof login.body.accessToken).toBe("string");
  });

  it("Mandantentrennung: ein in Mandant A angelegter Benutzer erscheint nicht in Mandant B", async () => {
    const email = `mandanten-trennung-${suffix}@beispiel.test`;
    await als(tokenLeitungA).post("/benutzer", {
      name: "Nur in A",
      email,
      rolle: "springer",
      passwort,
    });

    const listeB = await als(tokenLeitungB).get("/benutzer");
    expect(listeB.body.some((b: { email: string }) => b.email === email)).toBe(false);
  });
});
