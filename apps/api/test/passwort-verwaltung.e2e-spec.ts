/**
 * Zwei zusammenhaengende Faehigkeiten, beide aus derselben Anforderung:
 * "Passwort vergessen"/"Passwort aendern" muessen moeglich sein, OHNE dass
 * die Leitung (Bereichs- oder Einrichtungsleitung) je das tatsaechlich
 * verwendete Passwort erfaehrt.
 *
 * Kernaussagen:
 *   1. PATCH /auth/passwort (eingeloggt): verlangt das aktuelle Passwort,
 *      danach funktioniert nur noch das neue.
 *   2. POST /benutzer/:id/passwort-reset (nur Bereichs-/Einrichtungsleitung) liefert einen
 *      einmaligen Link-Token -- niemals ein Passwort in der Antwort.
 *   3. POST /auth/passwort-reset/einloesen (oeffentlich, kein Login) setzt
 *      damit ein neues Passwort, das NUR die betroffene Person waehlt.
 *   4. Der Token ist einmalig (zweite Einloesung schlaegt fehl), lauft ab,
 *      und ein neuer Reset entwertet einen vorherigen offenen Link.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Passwort aendern + Passwort-Reset per Link", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantAId: string;
  let mandantASlug: string;
  let mandantBId: string;
  let mandantBSlug: string;
  let tokenBereichsleitungA: string;
  let tokenBereichsleitungB: string;

  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantASlug = `test-passwort-a-${suffix}`;
    mandantBSlug = `test-passwort-b-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantARows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Passwort A ${suffix}`, mandantASlug]
    );
    mandantAId = mandantARows[0].id;
    const { rows: mandantBRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Passwort B ${suffix}`, mandantBSlug]
    );
    mandantBId = mandantBRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung A', $3, 'bereichsleitung')`,
      [mandantAId, `bereichsleitung-a-${suffix}@beispiel.test`, passwortHash]
    );
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung B', $3, 'bereichsleitung')`,
      [mandantBId, `bereichsleitung-b-${suffix}@beispiel.test`, passwortHash]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(mandantSlug: string, email: string, pw = passwort) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort: pw });
      return res.body.accessToken as string;
    }
    tokenBereichsleitungA = await login(mandantASlug, `bereichsleitung-a-${suffix}@beispiel.test`);
    tokenBereichsleitungB = await login(mandantBSlug, `bereichsleitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer_reset_token WHERE mandant_id = ANY($1)", [[mandantAId, mandantBId]]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [[mandantAId, mandantBId]]);
    await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [[mandantAId, mandantBId]]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      post: (path: string, body?: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body ?? {}),
      patch: (path: string, body: Record<string, unknown>) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
    };
  }

  async function loginVersuch(mandantSlug: string, email: string, pw: string) {
    return request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort: pw });
  }

  describe("PATCH /auth/passwort -- eingeloggt selbst aendern", () => {
    it("aendert das Passwort bei korrektem aktuellen Passwort; danach funktioniert nur noch das neue", async () => {
      const email = `aendern-erfolg-${suffix}@beispiel.test`;
      await als(tokenBereichsleitungA).post("/benutzer", { name: "Aendert Passwort", email, rolle: "betreuer", passwort });
      const eigenerToken = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug: mandantASlug, email, passwort })
        .then((r) => r.body.accessToken as string);

      const neuesPasswort = "ein ganz neues, eigenes passwort";
      const res = await als(eigenerToken).patch("/auth/passwort", {
        aktuellesPasswort: passwort,
        neuesPasswort,
      });
      expect(res.status).toBe(200);

      const altesFunktioniertNicht = await loginVersuch(mandantASlug, email, passwort);
      expect(altesFunktioniertNicht.status).toBe(401);

      const neuesFunktioniert = await loginVersuch(mandantASlug, email, neuesPasswort);
      expect(neuesFunktioniert.status).toBe(201);
    });

    it("lehnt ein falsches aktuelles Passwort mit 401 ab und aendert nichts", async () => {
      const email = `aendern-falsch-${suffix}@beispiel.test`;
      await als(tokenBereichsleitungA).post("/benutzer", { name: "Falsches Altes", email, rolle: "betreuer", passwort });
      const eigenerToken = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug: mandantASlug, email, passwort })
        .then((r) => r.body.accessToken as string);

      const res = await als(eigenerToken).patch("/auth/passwort", {
        aktuellesPasswort: "das ist definitiv falsch",
        neuesPasswort: "waere neu gewesen",
      });
      expect(res.status).toBe(401);

      const altesFunktioniertNoch = await loginVersuch(mandantASlug, email, passwort);
      expect(altesFunktioniertNoch.status).toBe(201);
    });

    it("lehnt ein zu kurzes neues Passwort mit 400 ab", async () => {
      const res = await als(tokenBereichsleitungA).patch("/auth/passwort", {
        aktuellesPasswort: passwort,
        neuesPasswort: "kurz",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /benutzer/:id/passwort-reset -- nur Bereichs-/Einrichtungsleitung, liefert nie ein Passwort", () => {
    it("liefert als Bereichsleitung einen Token samt Ablaufzeit, aber kein Passwort in der Antwort", async () => {
      const email = `reset-ziel-1-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", {
        name: "Reset-Ziel",
        email,
        rolle: "betreuer",
        passwort,
      });
      const zielId = angelegt.body.id as string;

      const res = await als(tokenBereichsleitungA).post(`/benutzer/${zielId}/passwort-reset`);
      expect(res.status).toBe(201);
      expect(typeof res.body.token).toBe("string");
      expect(res.body.token.length).toBeGreaterThanOrEqual(32);
      expect(res.body.passwort).toBeUndefined();
      expect(res.body.neuesPasswort).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(passwort);
    });

    it("lehnt den Aufruf durch Betreuer mit 403 ab", async () => {
      const email = `betreuer-darf-nicht-${suffix}@beispiel.test`;
      const angelegterBetreuer = await als(tokenBereichsleitungA).post("/benutzer", {
        name: "Betreuer",
        email,
        rolle: "betreuer",
        passwort,
      });
      const tokenBetreuer = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug: mandantASlug, email, passwort })
        .then((r) => r.body.accessToken as string);

      const res = await als(tokenBetreuer).post(`/benutzer/${angelegterBetreuer.body.id}/passwort-reset`);
      expect(res.status).toBe(403);
    });

    it("Mandantentrennung: Bereichsleitung B kann keinen Reset fuer einen Benutzer aus Mandant A ausloesen", async () => {
      const email = `nur-in-a-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", { name: "Nur A", email, rolle: "betreuer", passwort });

      const res = await als(tokenBereichsleitungB).post(`/benutzer/${angelegt.body.id}/passwort-reset`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /auth/passwort-reset/einloesen -- oeffentlich, kein Login noetig", () => {
    it("setzt mit gueltigem Token ein neues Passwort, das dann funktioniert", async () => {
      const email = `reset-einloesen-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", {
        name: "Loest Reset ein",
        email,
        rolle: "betreuer",
        passwort,
      });
      const erstellt = await als(tokenBereichsleitungA).post(`/benutzer/${angelegt.body.id}/passwort-reset`);
      const token = erstellt.body.token as string;

      const neuesPasswort = "selbst gewaehltes neues passwort";
      const eingeloest = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token, neuesPasswort });
      expect(eingeloest.status).toBe(201);

      const login = await loginVersuch(mandantASlug, email, neuesPasswort);
      expect(login.status).toBe(201);
      const altesFunktioniertNicht = await loginVersuch(mandantASlug, email, passwort);
      expect(altesFunktioniertNicht.status).toBe(401);
    });

    it("ist einmalig: eine zweite Einloesung desselben Tokens schlaegt fehl", async () => {
      const email = `reset-einmalig-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", { name: "Einmalig", email, rolle: "betreuer", passwort });
      const erstellt = await als(tokenBereichsleitungA).post(`/benutzer/${angelegt.body.id}/passwort-reset`);
      const token = erstellt.body.token as string;

      const ersteEinloesung = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token, neuesPasswort: "erstes neues passwort" });
      expect(ersteEinloesung.status).toBe(201);

      const zweiteEinloesung = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token, neuesPasswort: "zweites neues passwort" });
      expect(zweiteEinloesung.status).toBe(401);

      // Das ERSTE neue Passwort gilt weiterhin -- die zweite (fehlgeschlagene)
      // Einloesung darf nichts mehr veraendert haben.
      const login = await loginVersuch(mandantASlug, email, "erstes neues passwort");
      expect(login.status).toBe(201);
    });

    it("lehnt einen erfundenen Token ab", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token: "d".repeat(64), neuesPasswort: "irgendein passwort" });
      expect(res.status).toBe(401);
    });

    it("lehnt einen abgelaufenen Token ab", async () => {
      const email = `reset-abgelaufen-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", {
        name: "Abgelaufen",
        email,
        rolle: "betreuer",
        passwort,
      });
      const erstellt = await als(tokenBereichsleitungA).post(`/benutzer/${angelegt.body.id}/passwort-reset`);
      const token = erstellt.body.token as string;

      await admin.query(
        "UPDATE benutzer_reset_token SET laeuft_ab_am = now() - interval '1 minute' WHERE benutzer_id = $1 AND eingeloest_am IS NULL",
        [angelegt.body.id]
      );

      const res = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token, neuesPasswort: "zu spaet" });
      expect(res.status).toBe(401);
    });

    it("ein neuer Reset entwertet einen vorherigen, noch offenen Link derselben Person", async () => {
      const email = `reset-ueberschrieben-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", {
        name: "Zwei Links",
        email,
        rolle: "betreuer",
        passwort,
      });
      const ersterReset = await als(tokenBereichsleitungA).post(`/benutzer/${angelegt.body.id}/passwort-reset`);
      const ersterToken = ersterReset.body.token as string;

      const zweiterReset = await als(tokenBereichsleitungA).post(`/benutzer/${angelegt.body.id}/passwort-reset`);
      const zweiterToken = zweiterReset.body.token as string;

      const alterLinkSchlaegtFehl = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token: ersterToken, neuesPasswort: "ueber den alten link" });
      expect(alterLinkSchlaegtFehl.status).toBe(401);

      const neuerLinkFunktioniert = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token: zweiterToken, neuesPasswort: "ueber den neuen link" });
      expect(neuerLinkFunktioniert.status).toBe(201);
    });

    it("lehnt ein zu kurzes neues Passwort mit 400 ab", async () => {
      const email = `reset-kurz-${suffix}@beispiel.test`;
      const angelegt = await als(tokenBereichsleitungA).post("/benutzer", { name: "Kurz", email, rolle: "betreuer", passwort });
      const erstellt = await als(tokenBereichsleitungA).post(`/benutzer/${angelegt.body.id}/passwort-reset`);

      const res = await request(app.getHttpServer())
        .post("/auth/passwort-reset/einloesen")
        .send({ token: erstellt.body.token, neuesPasswort: "kurz" });
      expect(res.status).toBe(400);
    });
  });
});
