/**
 * Hilfeplan und Ziele je Klient. Prueft neben dem Fachablauf vor allem das,
 * was die Datenbank (Migration 0070) erzwingen soll: Mandantentrennung,
 * Append-only des Verlaufs und dass ein Verlaufseintrag nur auf einen
 * Tagesbericht DESSELBEN Klienten zeigen kann.
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

describe("Hilfeplan und Ziele", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  const mandanten: string[] = [];
  let tokenA: string;
  let tokenB: string;
  let klientA: string;
  let klientA2: string;
  let berichtA: string;
  let berichtA2: string;
  let klientB: string;

  async function mandantMitKonto(name: string) {
    const slug = `test-hilfeplan-${name}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Hilfeplan ${name} ${suffix}`, slug]
    );
    const mandantId = rows[0].id;
    mandanten.push(mandantId);
    const email = `leitung-${name}-${suffix}@beispiel.test`;
    await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email,
      name: `Leitung ${name}`,
      passwortHash: await bcrypt.hash(passwort, 4),
    });
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort });
    const klient = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Test', $2, '1990-01-01', $3, 'Testamt') RETURNING id`,
      [mandantId, `Klient${name}`, `AZ-${name}-${suffix}`]
    );
    return { mandantId, token: res.body.accessToken as string, klientId: klient.rows[0].id };
  }

  async function bericht(mandantId: string, klientId: string) {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO tagesbericht (mandant_id, klient_id, datum, text) VALUES ($1, $2, '2026-01-05', 'Bericht') RETURNING id",
      [mandantId, klientId]
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const a = await mandantMitKonto("a");
    const b = await mandantMitKonto("b");
    tokenA = a.token;
    tokenB = b.token;
    klientA = a.klientId;
    klientB = b.klientId;
    const zweiter = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Zweiter', 'Klient', '1991-02-02', $2, 'Testamt') RETURNING id`,
      [a.mandantId, `AZ2-${suffix}`]
    );
    klientA2 = zweiter.rows[0].id;
    berichtA = await bericht(a.mandantId, klientA);
    berichtA2 = await bericht(a.mandantId, klientA2);
  });

  afterAll(async () => {
    for (const m of mandanten) {
      for (const t of ["hilfeplan_ziel_verlauf", "hilfeplan_ziel", "hilfeplan", "tagesbericht", "klient"]) {
        await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [m]);
      }
      await raeumeKontoMitRolleAuf(admin, m);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [m]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [m]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [m]);
    }
    await admin.end();
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const post = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).post(url).set(auth(token)).send(body);
  const patch = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).patch(url).set(auth(token)).send(body);
  const liste = (token: string, klientId: string) =>
    request(app.getHttpServer()).get(`/hilfeplaene?klientId=${klientId}`).set(auth(token));

  let planId: string;
  let zielId: string;

  it("legt Hilfeplan und Ziel an; Fortschritt ist ohne Verlauf 0", async () => {
    const plan = await post(tokenA, "/hilfeplaene", {
      klientId: klientA,
      von: "2026-01-01",
      bis: "2026-12-31",
      naechstesGespraech: "2026-06-15",
    });
    expect(plan.status).toBe(201);
    planId = plan.body.id;

    const ziel = await post(tokenA, `/hilfeplaene/${planId}/ziele`, {
      titel: "Eigenständig Termine wahrnehmen",
      faelligAm: "2026-03-01",
    });
    expect(ziel.status).toBe(201);
    const z = ziel.body.ziele[0];
    zielId = z.id;
    expect(z.fortschritt).toBe(0);
    expect(z.erreicht).toBe(false);
    expect(z.ueberfaellig).toBe(true); // 2026-03-01 liegt vor dem heutigen Datum der Testumgebung
  });

  it("lehnt ein Enddatum vor dem Start und leere Titel mit 400 ab", async () => {
    const r1 = await post(tokenA, "/hilfeplaene", { klientId: klientA, von: "2026-05-01", bis: "2026-04-01" });
    expect(r1.status).toBe(400);
    const r2 = await post(tokenA, `/hilfeplaene/${planId}/ziele`, { titel: "   " });
    expect(r2.status).toBe(400);
    const r3 = await patch(tokenA, `/hilfeplaene/${planId}`, { bis: "2025-01-01" });
    expect(r3.status).toBe(400);
  });

  it("leitet den Fortschritt aus dem juengsten Verlaufseintrag ab, mit Link zum Tagesbericht", async () => {
    await post(tokenA, `/hilfeplaene/ziele/${zielId}/verlauf`, { fortschritt: 40, notiz: "Erster Termin allein" });
    const res = await post(tokenA, `/hilfeplaene/ziele/${zielId}/verlauf`, {
      fortschritt: 70,
      tagesberichtId: berichtA,
    });
    expect(res.status).toBe(201);
    const z = res.body.ziele[0];
    expect(z.fortschritt).toBe(70);
    expect(z.verlauf).toHaveLength(2);
    expect(z.verlauf[0].tagesbericht).toEqual({ id: berichtA, datum: "2026-01-05" });
    // Auch eine Korrektur nach unten ist erlaubt: neuer Eintrag, nichts wird ueberschrieben.
    const zurueck = await post(tokenA, `/hilfeplaene/ziele/${zielId}/verlauf`, { fortschritt: 50 });
    expect(zurueck.body.ziele[0].fortschritt).toBe(50);
    expect(zurueck.body.ziele[0].verlauf).toHaveLength(3);
  });

  it("lehnt Fortschritt ausserhalb 0-100 ab", async () => {
    const res = await post(tokenA, `/hilfeplaene/ziele/${zielId}/verlauf`, { fortschritt: 101 });
    expect(res.status).toBe(400);
  });

  it("lehnt den Tagesbericht eines anderen Klienten desselben Traegers ab (zusammengesetzter FK)", async () => {
    const res = await post(tokenA, `/hilfeplaene/ziele/${zielId}/verlauf`, {
      fortschritt: 60,
      tagesberichtId: berichtA2,
    });
    expect(res.status).toBe(400);
    expect((await liste(tokenA, klientA)).body[0].ziele[0].verlauf).toHaveLength(3);
  });

  it("markiert erreichte Ziele und nimmt verworfene aus Offen/Ueberfaellig heraus", async () => {
    await post(tokenA, `/hilfeplaene/ziele/${zielId}/verlauf`, { fortschritt: 100 });
    let z = (await liste(tokenA, klientA)).body[0].ziele[0];
    expect(z.erreicht).toBe(true);
    expect(z.ueberfaellig).toBe(false);

    const neu = await post(tokenA, `/hilfeplaene/${planId}/ziele`, { titel: "Altes Ziel", faelligAm: "2026-01-02" });
    const altId = neu.body.ziele.find((x: { titel: string }) => x.titel === "Altes Ziel").id;
    const verworfen = await patch(tokenA, `/hilfeplaene/ziele/${altId}`, { verworfen: true });
    const alt = verworfen.body.ziele.find((x: { id: string }) => x.id === altId);
    expect(alt.verworfen).toBe(true);
    expect(alt.ueberfaellig).toBe(false);
    const nachVerwerfen = await post(tokenA, `/hilfeplaene/ziele/${altId}/verlauf`, { fortschritt: 10 });
    expect(nachVerwerfen.status).toBe(400);
  });

  it("macht den Verlauf in der Datenbank unveraenderlich", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await expect(app_.query("UPDATE hilfeplan_ziel_verlauf SET fortschritt = 0")).rejects.toThrow(/permission denied/);
      await expect(app_.query("DELETE FROM hilfeplan_ziel_verlauf")).rejects.toThrow(/permission denied/);
      await expect(app_.query("DELETE FROM hilfeplan_ziel")).rejects.toThrow(/permission denied/);
      await expect(app_.query("UPDATE hilfeplan_ziel SET klient_id = klient_id")).rejects.toThrow(/permission denied/);
    } finally {
      await app_.end();
    }
  });

  it("trennt Mandanten: fremde Klienten, Plaene und Ziele sind nicht les- oder schreibbar", async () => {
    expect((await liste(tokenB, klientA)).body).toEqual([]);
    expect((await post(tokenB, "/hilfeplaene", { klientId: klientA, von: "2026-01-01" })).status).toBe(404);
    expect((await post(tokenB, `/hilfeplaene/${planId}/ziele`, { titel: "Fremd" })).status).toBe(404);
    expect((await patch(tokenB, `/hilfeplaene/ziele/${zielId}`, { titel: "Fremd" })).status).toBe(404);
    expect((await post(tokenB, `/hilfeplaene/ziele/${zielId}/verlauf`, { fortschritt: 1 })).status).toBe(404);
    // Tagesbericht des anderen Traegers im eigenen Verlauf: ebenfalls abgelehnt.
    const planB = await post(tokenB, "/hilfeplaene", { klientId: klientB, von: "2026-01-01" });
    const zielB = await post(tokenB, `/hilfeplaene/${planB.body.id}/ziele`, { titel: "Eigenes Ziel" });
    const fremderBericht = await post(tokenB, `/hilfeplaene/ziele/${zielB.body.ziele[0].id}/verlauf`, {
      fortschritt: 10,
      tagesberichtId: berichtA,
    });
    expect(fremderBericht.status).toBe(400);
  });

  it("verhindert in der Datenbank eine Zeile, die mit eigenem Mandanten auf einen fremden Klienten zeigt", async () => {
    const m = mandanten[1];
    await expect(
      admin.query("INSERT INTO hilfeplan (mandant_id, klient_id, von) VALUES ($1, $2, '2026-01-01')", [m, klientA])
    ).rejects.toThrow(/foreign key/);
  });

  it("sperrt Schreibzugriffe auf archivierte Klienten", async () => {
    await admin.query(
      "UPDATE klient SET archiviert_am = now(), archiviert_von = (SELECT id FROM benutzer WHERE mandant_id = klient.mandant_id LIMIT 1) WHERE id = $1",
      [klientA]
    );
    try {
      expect((await post(tokenA, `/hilfeplaene/${planId}/ziele`, { titel: "Zu spaet" })).status).toBe(400);
      expect((await liste(tokenA, klientA)).status).toBe(200);
    } finally {
      await admin.query("UPDATE klient SET archiviert_am = NULL, archiviert_von = NULL WHERE id = $1", [klientA]);
    }
  });
});
