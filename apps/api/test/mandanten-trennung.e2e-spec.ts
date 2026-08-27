/**
 * Das Abnahmekriterium aus dem Bauplan, Phase 0: "ein automatischer Test
 * legt zwei Mandanten an, und der Testlauf wird rot, sobald auch nur eine
 * Zeile über die Mandantengrenze hinweg sichtbar wird."
 *
 * Bewusst über den echten HTTP-Pfad getestet (Login -> Token -> Abfrage),
 * nicht direkt gegen die Datenbank -- das prüft die tatsächliche Garantie,
 * die ein Klient dieser API erlebt, nicht nur die SQL-Policy isoliert.
 *
 * Läuft gegen eine echte PostgreSQL-Instanz (siehe README, Abschnitt
 * "Lokale Entwicklung") mit bereits angewendeten Migrationen -- kein Mock,
 * kein In-Memory-Ersatz. RLS lässt sich nicht sinnvoll mocken.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

interface Testmandant {
  mandantId: string;
  slug: string;
  benutzerId: string;
  email: string;
  passwort: string;
}

async function seedMandantMitBenutzer(admin: Client, label: string): Promise<Testmandant> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `test-${label}-${suffix}`;
  const email = `${label}-${suffix}@beispiel.test`;
  const passwort = "correct horse battery staple";
  const passwortHash = await bcrypt.hash(passwort, 4); // niedrige Kostenstufe: Tests, kein Produktivsystem

  const { rows: mandantRows } = await admin.query<{ id: string }>(
    "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
    [`Testmandant ${label}`, slug]
  );
  const mandantId = mandantRows[0].id;

  const { rows: benutzerRows } = await admin.query<{ id: string }>(
    `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
     VALUES ($1, $2, $3, $4, 'bereichsleitung') RETURNING id`,
    [mandantId, email, `Testbereichsleitung ${label}`, passwortHash]
  );
  const benutzerId = benutzerRows[0].id;

  return { mandantId, slug, benutzerId, email, passwort };
}

describe("Mandantentrennung (RLS end-to-end)", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantA: Testmandant;
  let mandantB: Testmandant;

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error(
        "MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example). " +
          "Migrationen vorher mit `pnpm migrate` anwenden."
      );
    }

    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantA = await seedMandantMitBenutzer(admin, "a");
    mandantB = await seedMandantMitBenutzer(admin, "b");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer WHERE mandant_id IN ($1, $2)", [
      mandantA.mandantId,
      mandantB.mandantId,
    ]);
    await admin.query("DELETE FROM mandant WHERE id IN ($1, $2)", [mandantA.mandantId, mandantB.mandantId]);
    await admin.end();
    await app.close();
  });

  async function login(m: Testmandant): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: m.slug, email: m.email, passwort: m.passwort });
    expect(res.status).toBe(201);
    return res.body.accessToken;
  }

  it("liefert für /mandant/me ausschließlich den eigenen Mandanten", async () => {
    const tokenA = await login(mandantA);
    const tokenB = await login(mandantB);

    const resA = await request(app.getHttpServer()).get("/mandant/me").set("Authorization", `Bearer ${tokenA}`);
    const resB = await request(app.getHttpServer()).get("/mandant/me").set("Authorization", `Bearer ${tokenB}`);

    expect(resA.body.id).toBe(mandantA.mandantId);
    expect(resA.body.id).not.toBe(mandantB.mandantId);
    expect(resB.body.id).toBe(mandantB.mandantId);
    expect(resB.body.id).not.toBe(mandantA.mandantId);
  });

  it("liefert für /benutzer niemals Zeilen des anderen Mandanten", async () => {
    const tokenA = await login(mandantA);
    const tokenB = await login(mandantB);

    const resA = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenA}`);
    const resB = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenB}`);

    const idsA: string[] = resA.body.map((b: { id: string }) => b.id);
    const idsB: string[] = resB.body.map((b: { id: string }) => b.id);

    expect(idsA).toContain(mandantA.benutzerId);
    expect(idsA).not.toContain(mandantB.benutzerId);

    expect(idsB).toContain(mandantB.benutzerId);
    expect(idsB).not.toContain(mandantA.benutzerId);

    // Die eigentliche Kernaussage: keine Überschneidung, in keine Richtung.
    const schnittmenge = idsA.filter((id) => idsB.includes(id));
    expect(schnittmenge).toHaveLength(0);
  });

  it("lehnt Login mit falschem Mandanten-Slug ab, selbst bei korrektem Passwort", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: mandantB.slug, email: mandantA.email, passwort: mandantA.passwort });

    expect(res.status).toBe(401);
  });
});
