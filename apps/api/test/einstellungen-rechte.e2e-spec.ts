/**
 * Die Einstellungsseite blendet Traeger-Bereiche (Erscheinungsbild,
 * Standorte, Kassenbuch, Datenschutz) aus, fuer die die Person kein Recht hat
 * (GET /mandant/me/einstellungen-rechte). Das Ausblenden ist Bequemlichkeit,
 * keine Sicherung -- deshalb prueft dieser Test beides: die Antwort des
 * Endpunkts UND dass ein direkter Speicherversuch ohne Recht weiterhin mit
 * 403 abgelehnt wird. Waere nur das erste gruen, saehe ein Betreuer die
 * Regler nicht mehr, koennte sie per Hand aber noch bedienen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AlteRolle, kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

const PASSWORT = "correct horse battery staple";

describe("Einstellungen: Träger-Bereiche nach Recht", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let slug: string;
  const emails: Partial<Record<AlteRolle, string>> = {};

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    slug = `einst-${randomUUID().slice(0, 8)}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      ["Testmandant Einstellungen", slug]
    );
    mandantId = rows[0].id;
    const passwortHash = await bcrypt.hash(PASSWORT, 4);
    for (const rolle of ["bereichsleitung", "einrichtungsleitung", "betreuer"] as AlteRolle[]) {
      const email = `${rolle}-${randomUUID().slice(0, 8)}@beispiel.test`;
      await kontoMitAlterRolle(admin, { mandantId, rolle, email, name: `Test ${rolle}`, passwortHash });
      emails[rolle] = email;
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  async function login(rolle: AlteRolle): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: slug, email: emails[rolle], passwort: PASSWORT });
    expect(res.status).toBe(201);
    return res.body.accessToken;
  }

  const rechte = (token: string) =>
    request(app.getHttpServer()).get("/mandant/me/einstellungen-rechte").set("Authorization", `Bearer ${token}`);

  it("Geschäftsführung/Bereichsleitung sieht alle Träger-Bereiche", async () => {
    const res = await rechte(await login("bereichsleitung"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ erscheinungsbild: true, standorte: true, kassenbuch: true, datenschutz: true });
  });

  it("Einrichtungsleitung sieht Standorte und Kassenbuch, aber weder Farben noch Datenschutz", async () => {
    const res = await rechte(await login("einrichtungsleitung"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ erscheinungsbild: false, standorte: true, kassenbuch: true, datenschutz: false });
  });

  it("Betreuer sieht keinen Träger-Bereich", async () => {
    const res = await rechte(await login("betreuer"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ erscheinungsbild: false, standorte: false, kassenbuch: false, datenschutz: false });
  });

  it("Betreuer kann ausgeblendete Einstellungen auch direkt nicht speichern", async () => {
    const token = await login("betreuer");
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(server).patch("/mandant/me").set(auth).send({ akzentfarbe: "#123456" })).status).toBe(403);
    expect((await request(server).patch("/mandant/me/chat-loeschfrist").set(auth).send({ tage: 30 })).status).toBe(403);
    expect((await request(server).patch("/mandant/me/klient-loeschfrist").set(auth).send({ tage: 60 })).status).toBe(403);
    expect((await request(server).patch("/mandant/me/rueckmeldung-weitergabe").set(auth).send({ aktiv: true })).status).toBe(403);

    const { rows } = await admin.query(
      "SELECT akzentfarbe, chat_loeschfrist_tage, rueckmeldung_weitergabe FROM mandant WHERE id = $1",
      [mandantId]
    );
    expect(rows[0].akzentfarbe).not.toBe("#123456");
    expect(rows[0].chat_loeschfrist_tage).not.toBe(30);
    expect(rows[0].rueckmeldung_weitergabe).toBe(false);
  });

  it("ohne Anmeldung gibt es keine Auskunft", async () => {
    const res = await request(app.getHttpServer()).get("/mandant/me/einstellungen-rechte");
    expect(res.status).toBe(401);
  });
});
