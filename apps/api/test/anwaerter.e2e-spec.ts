/**
 * Anwärter (Migration 0039): eine abgespeckte Vorstufe des Klienten für
 * Anfragen, bevor ein Aktenzeichen existiert. Kernaussagen: Bearbeiten/
 * Löschen nur solange "offen"; Annehmen/Ablehnen ist eine Leitungs-
 * entscheidung (Vier-Augen-Rollenmuster wie bei Zimmer-Kapazität); eine
 * Annahme legt einen echten Klienten mit den übergebenen Aktenzeichen/Amt
 * an und verweist vom Anwärter-Datensatz darauf; eine zweite Entscheidung
 * über dieselbe Anfrage wird mit 409 abgelehnt.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Anwärter", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenBetreuer: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-anwaerter-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Anwärter ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    async function neuerBenutzer(rolle: string, emailPrefix: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, `${emailPrefix}-${suffix}@beispiel.test`, `${emailPrefix} Test`, passwortHash, rolle]
      );
      return rows[0].id;
    }
    await neuerBenutzer("bereichsleitung", "bereichsleitung");
    await neuerBenutzer("betreuer", "betreuer");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`betreuer-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM anwaerter WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  async function neueAnfrage(zusatz: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post("/anwaerter")
      .set("Authorization", `Bearer ${tokenBetreuer}`)
      .send({ vorname: "Test", nachname: "Fall", ...zusatz });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it("legt eine Anfrage mit nur Vorname/Nachname an -- alles andere bleibt leer", async () => {
    const res = await request(app.getHttpServer())
      .post("/anwaerter")
      .set("Authorization", `Bearer ${tokenBetreuer}`)
      .send({ vorname: "Mia", nachname: "Beispiel" });

    expect(res.status).toBe(201);
    expect(res.body.vorname).toBe("Mia");
    expect(res.body.nachname).toBe("Beispiel");
    expect(res.body.status).toBe("offen");
    expect(res.body.telefon).toBeNull();
    expect(res.body.email).toBeNull();
    expect(res.body.anfragendeStelle).toBeNull();
    expect(res.body.klientId).toBeNull();
  });

  it("GET /anwaerter?status= filtert korrekt", async () => {
    const liste = await request(app.getHttpServer())
      .get("/anwaerter?status=offen")
      .set("Authorization", `Bearer ${tokenBetreuer}`);
    expect(liste.status).toBe(200);
    expect(liste.body.every((a: { status: string }) => a.status === "offen")).toBe(true);

    const leer = await request(app.getHttpServer())
      .get("/anwaerter?status=angenommen")
      .set("Authorization", `Bearer ${tokenBetreuer}`);
    expect(leer.status).toBe(200);
    expect(leer.body).toHaveLength(0);
  });

  it("bearbeitet eine offene Anfrage, lehnt das nach einer Entscheidung aber mit 400 ab", async () => {
    const { id } = await neueAnfrage({ telefon: "0123" });

    const bearbeitet = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}`)
      .set("Authorization", `Bearer ${tokenBetreuer}`)
      .send({ telefon: "0456" });
    expect(bearbeitet.status).toBe(200);
    expect(bearbeitet.body.telefon).toBe("0456");

    const abgelehnt = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/ablehnen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "Kein Platz verfügbar" });
    expect(abgelehnt.status).toBe(200);

    const erneuterVersuch = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}`)
      .set("Authorization", `Bearer ${tokenBetreuer}`)
      .send({ telefon: "0789" });
    expect(erneuterVersuch.status).toBe(400);
  });

  it("löscht eine offene Anfrage, aber nicht mehr nach einer Entscheidung", async () => {
    const offen = await neueAnfrage();
    const geloescht = await request(app.getHttpServer())
      .delete(`/anwaerter/${offen.id}`)
      .set("Authorization", `Bearer ${tokenBetreuer}`);
    expect(geloescht.status).toBe(200);

    const { id } = await neueAnfrage();
    await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/ablehnen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "Testgrund" });

    const versuch = await request(app.getHttpServer())
      .delete(`/anwaerter/${id}`)
      .set("Authorization", `Bearer ${tokenBetreuer}`);
    expect(versuch.status).toBe(400);
  });

  it("lehnt 'Annehmen' durch einen Betreuer mit 403 ab -- Zustand bleibt unverändert", async () => {
    const { id } = await neueAnfrage();

    const res = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/annehmen`)
      .set("Authorization", `Bearer ${tokenBetreuer}`)
      .send({ aktenzeichen: `AZ-ANW-${randomUUID().slice(0, 8)}`, amt: "Testamt" });
    expect(res.status).toBe(403);

    const nachher = await request(app.getHttpServer())
      .get(`/anwaerter/${id}`)
      .set("Authorization", `Bearer ${tokenBetreuer}`);
    expect(nachher.body.status).toBe("offen");
    expect(nachher.body.klientId).toBeNull();
  });

  it("lehnt 'Ablehnen' durch einen Betreuer mit 403 ab", async () => {
    const { id } = await neueAnfrage();
    const res = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/ablehnen`)
      .set("Authorization", `Bearer ${tokenBetreuer}`)
      .send({ grund: "Testgrund" });
    expect(res.status).toBe(403);
  });

  it("'Ablehnen' ohne Grund wird mit 400 abgelehnt", async () => {
    const { id } = await neueAnfrage();
    const res = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/ablehnen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "" });
    expect(res.status).toBe(400);
  });

  it("nimmt eine Anfrage an: legt einen echten Klienten mit den übergebenen Daten an", async () => {
    const { id } = await neueAnfrage({ geburtsdatum: "1990-05-15" });
    const aktenzeichen = `AZ-ANW-${randomUUID().slice(0, 8)}`;

    const res = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/annehmen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ aktenzeichen, amt: "Jugendamt Teststadt", hzlRhythmus: "woechentlich" });

    expect(res.status).toBe(200);
    expect(res.body.aktenzeichen).toBe(aktenzeichen);
    expect(res.body.amt).toBe("Jugendamt Teststadt");
    expect(res.body.hzlRhythmus).toBe("woechentlich");
    expect(res.body.vorname).toBe("Test");
    expect(res.body.nachname).toBe("Fall");
    expect(res.body.geburtsdatum).toBe("1990-05-15");

    const anwaerterNachher = await request(app.getHttpServer())
      .get(`/anwaerter/${id}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(anwaerterNachher.body.status).toBe("angenommen");
    expect(anwaerterNachher.body.klientId).toBe(res.body.id);
  });

  it("lehnt eine zweite Entscheidung über eine bereits entschiedene Anfrage mit 409 ab", async () => {
    const { id } = await neueAnfrage();
    const erste = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/ablehnen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "Erster Grund" });
    expect(erste.status).toBe(200);

    const zweiteAblehnung = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/ablehnen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "Zweiter Grund" });
    expect(zweiteAblehnung.status).toBe(409);

    const nachtraeglichesAnnehmen = await request(app.getHttpServer())
      .patch(`/anwaerter/${id}/annehmen`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ aktenzeichen: `AZ-ANW-${randomUUID().slice(0, 8)}`, amt: "Testamt" });
    expect(nachtraeglichesAnnehmen.status).toBe(409);
  });

  it("Mandantentrennung: ein anderer Mandant sieht diese Anfragen nicht", async () => {
    const suffix = randomUUID().slice(0, 8);
    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows: anderMandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Anderer Mandant ${suffix}`, `test-anwaerter-anderer-${suffix}`]
    );
    const andererMandantId = anderMandantRows[0].id;
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Fremd Test', $3, 'bereichsleitung')`,
      [andererMandantId, `fremd-${suffix}@beispiel.test`, passwortHash]
    );
    const fremderToken = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug: `test-anwaerter-anderer-${suffix}`, email: `fremd-${suffix}@beispiel.test`, passwort })
    ).body.accessToken;

    const liste = await request(app.getHttpServer())
      .get("/anwaerter?status=offen")
      .set("Authorization", `Bearer ${fremderToken}`);
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(0);

    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [andererMandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [andererMandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [andererMandantId]);
  });
});
