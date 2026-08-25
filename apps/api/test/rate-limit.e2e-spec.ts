/**
 * Beweist, dass die Raten-Schranke auf /auth/login (auth.controller.ts,
 * RATEN_SCHRANKE) tatsaechlich greift -- nicht nur, dass sie konfiguriert
 * ist. Alle anderen e2e-Specs laufen mit ausgeschalteter Schranke (siehe
 * skipIf in app.module.ts): sie loggen sich in schneller Folge dutzendfach
 * ein, das ist legitime Testlast, keine Bruteforce-Simulation. Dieser eine
 * Test schaltet die Schranke ueber RATE_LIMIT_TESTEN=1 gezielt fuer sich
 * selbst wieder ein und ist damit der einzige Ort, an dem sie gegen echte
 * Anfragen geprueft wird ("Pruefen statt behaupten").
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Raten-Schranke auf /auth/login", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  let email: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    // Muss VOR dem ersten throttled Request gesetzt sein -- skipIf liest
    // process.env live pro Anfrage, nicht beim Kompilieren des Moduls.
    process.env.RATE_LIMIT_TESTEN = "1";

    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-ratenschranke-${suffix}`;
    email = `ratenschranke-${suffix}@beispiel.test`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Ratenschranke ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle) VALUES ($1, $2, 'Ratenschranke Test', $3, 'leitung')`,
      [mandantId, email, passwortHash]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    delete process.env.RATE_LIMIT_TESTEN;
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function login() {
    return request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email, passwort });
  }

  it(
    "laesst die konfigurierten 10 Anfragen pro Minute durch und weist die 11. mit 429 ab",
    async () => {
      for (let i = 1; i <= 10; i++) {
        const res = await login();
        expect(res.status).toBe(201);
      }

      const elfte = await login();
      expect(elfte.status).toBe(429);
    },
    30_000
  );
});
