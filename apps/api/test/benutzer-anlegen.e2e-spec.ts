/**
 * POST /benutzer -- Mitarbeitende ueber die API anlegen, statt wie bisher
 * nur per manuellem SQL-Insert (siehe README "Ersten Benutzer anlegen").
 *
 * Kernaussagen:
 *   1. Wer das Recht mitarbeitende.anlegen hat, darf das (hier: die
 *      Bereichsleitung-/Einrichtungsleitung-aequivalenten Testkonten,
 *      siehe konto-mit-rolle.ts), ein Betreuer-aequivalentes Konto nicht.
 *   2. Anlegen vergibt KEINE Rechte mehr (Entwickler-Accounttyp-Umstellung)
 *      -- ein frisch angelegter Benutzer hat null Positionen/Rechte, bis
 *      jemand mit organigramm.manage-permissions ihn auf eine Position
 *      setzt. Die fruehere Eskalationssperre ("Einrichtungsleitung darf
 *      niemanden zur Bereichsleitung machen") ist dadurch gegenstandslos --
 *      es gibt keinen rolle-Parameter mehr, der eskalieren koennte. Die
 *      eigentliche Schutzstelle liegt jetzt bei
 *      organigramm.service.ts::besetzen() (eigener Test).
 *   3. Eine doppelte E-Mail IM SELBEN Mandanten wird mit 409 abgelehnt
 *      (UNIQUE(mandant_id, email), migrations/0004_benutzer.sql), dieselbe
 *      E-Mail in einem ANDEREN Mandanten ist erlaubt.
 *   4. Das gesetzte Passwort funktioniert wirklich -- der neu angelegte
 *      Benutzer kann sich damit einloggen (Ende-zu-Ende-Beweis fuer den
 *      bcrypt-Hash, nicht nur einen 201-Status).
 *   5. Mandantentrennung: ein in Mandant A angelegter Benutzer taucht nicht
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
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("POST /benutzer -- Mitarbeitende anlegen", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantAId: string;
  let mandantASlug: string;
  let mandantBId: string;
  let mandantBSlug: string;
  let tokenBereichsleitungA: string;
  let tokenEinrichtungsleitungA: string;
  let tokenBetreuerA: string;
  let tokenBereichsleitungB: string;

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

    await kontoMitAlterRolle(admin, {
      mandantId: mandantAId,
      rolle: "bereichsleitung",
      email: `bereichsleitung-a-${suffix}@beispiel.test`,
      name: "Bereichsleitung A",
      passwortHash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantAId,
      rolle: "einrichtungsleitung",
      email: `einrichtungsleitung-a-${suffix}@beispiel.test`,
      name: "Einrichtungsleitung A",
      passwortHash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantAId,
      rolle: "betreuer",
      email: `betreuer-a-${suffix}@beispiel.test`,
      name: "Betreuer A",
      passwortHash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantBId,
      rolle: "bereichsleitung",
      email: `bereichsleitung-b-${suffix}@beispiel.test`,
      name: "Bereichsleitung B",
      passwortHash,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(mandantSlug: string, email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitungA = await login(mandantASlug, `bereichsleitung-a-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungA = await login(mandantASlug, `einrichtungsleitung-a-${suffix}@beispiel.test`);
    tokenBetreuerA = await login(mandantASlug, `betreuer-a-${suffix}@beispiel.test`);
    tokenBereichsleitungB = await login(mandantBSlug, `bereichsleitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [[mandantAId, mandantBId]]);
      await admin.query("DELETE FROM standort WHERE mandant_id = ANY($1)", [[mandantAId, mandantBId]]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [[mandantAId, mandantBId]]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [[mandantAId, mandantBId]]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
    };
  }

  it("legt als Bereichsleitung einen neuen Mitarbeiter an -- ohne jede Rechtevergabe", async () => {
    const res = await als(tokenBereichsleitungA).post("/benutzer", {
      name: "Neuer Betreuer",
      email: `neu-1-${suffix}@beispiel.test`,
      passwort,
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Neuer Betreuer");
    expect(res.body.aktiv).toBe(true);
    expect(res.body.passwort_hash).toBeUndefined();
    expect(res.body.passwortHash).toBeUndefined();

    const liste = await als(tokenBereichsleitungA).get("/benutzer");
    const eintrag = liste.body.find((b: { email: string }) => b.email === `neu-1-${suffix}@beispiel.test`);
    expect(eintrag).toBeDefined();
    // Kernaussage 2: Anlegen vergibt keine Rechte -- keine Position, bis
    // jemand im Organigramm eine zuweist.
    expect(eintrag.positionen).toEqual([]);
  });

  it("legt auch als Einrichtungsleitung einen neuen Mitarbeiter an", async () => {
    const res = await als(tokenEinrichtungsleitungA).post("/benutzer", {
      name: "Von Einrichtungsleitung angelegt",
      email: `neu-el-${suffix}@beispiel.test`,
      passwort,
    });
    expect(res.status).toBe(201);
  });

  it("lehnt das Anlegen durch Betreuer mit 403 ab", async () => {
    const res = await als(tokenBetreuerA).post("/benutzer", {
      name: "Sollte nicht klappen",
      email: `neu-2-${suffix}@beispiel.test`,
      passwort,
    });
    expect(res.status).toBe(403);

    const liste = await als(tokenBereichsleitungA).get("/benutzer");
    expect(liste.body.some((b: { email: string }) => b.email === `neu-2-${suffix}@beispiel.test`)).toBe(false);
  });

  it("lehnt eine doppelte E-Mail im selben Mandanten mit 409 ab, erlaubt sie aber in einem ANDEREN Mandanten", async () => {
    const email = `doppelt-${suffix}@beispiel.test`;
    const erstes = await als(tokenBereichsleitungA).post("/benutzer", {
      name: "Erster",
      email,
      passwort,
    });
    expect(erstes.status).toBe(201);

    const doppelt = await als(tokenBereichsleitungA).post("/benutzer", {
      name: "Zweiter",
      email,
      passwort,
    });
    expect(doppelt.status).toBe(409);

    const andererMandant = await als(tokenBereichsleitungB).post("/benutzer", {
      name: "Auch erlaubt",
      email,
      passwort,
    });
    expect(andererMandant.status).toBe(201);
  });

  it("lehnt ungueltige Eingaben mit 400 ab (fehlende Felder, zu kurzes Passwort)", async () => {
    const fehlend = await als(tokenBereichsleitungA).post("/benutzer", { name: "Ohne Rest" });
    expect(fehlend.status).toBe(400);

    const kurzesPasswort = await als(tokenBereichsleitungA).post("/benutzer", {
      name: "X",
      email: `y-${suffix}@beispiel.test`,
      passwort: "zu-kurz",
    });
    expect(kurzesPasswort.status).toBe(400);
  });

  it("das gesetzte Passwort funktioniert wirklich -- der neue Benutzer kann sich einloggen", async () => {
    const email = `einlogg-${suffix}@beispiel.test`;
    const eigenesPasswort = "ein ganz eigenes passwort";
    const angelegt = await als(tokenBereichsleitungA).post("/benutzer", {
      name: "Kann sich einloggen",
      email,
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
    await als(tokenBereichsleitungA).post("/benutzer", {
      name: "Nur in A",
      email,
      passwort,
    });

    const listeB = await als(tokenBereichsleitungB).get("/benutzer");
    expect(listeB.body.some((b: { email: string }) => b.email === email)).toBe(false);
  });
});
