/**
 * Belegung nachträglich korrigieren (Migration 0037) + der Bugfix, der das
 * erst sinnvoll nutzbar macht: ein bereits eingetragener, aber künftig
 * fälliger Auszug darf den Bewohner nicht sofort aus Zimmer und Klientenakte
 * verschwinden lassen (zimmer.service.ts: ladeBewohner(), klient.service.ts:
 * findeAlle()/holeDetail()). Vorausschauendes Planen am Auszug war vorher
 * faktisch unbenutzbar, weil genau das passierte.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Belegung bearbeiten + vorausschauender Auszug", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let standort1Id: string;
  let standort2Id: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-belbearb-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Belegung-Bearbeiten ${suffix}`, mandantSlug]
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
    const einrichtungsleitungS1Id = await neuerBenutzer("einrichtungsleitung", "einrichtungsleitung-s1");

    const { rows: s1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    standort1Id = s1Rows[0].id;
    const { rows: s2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    standort2Id = s2Rows[0].id;

    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId,
      einrichtungsleitungS1Id,
      standort1Id,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`einrichtungsleitung-s1-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM zimmer_warteliste WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  async function neuesZimmerMitKlient(standortId: string, nummer: string, einzug: string) {
    const suffix = randomUUID().slice(0, 8);
    const { rows: zimmerRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id",
      [mandantId, standortId, nummer]
    );
    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Test', 'Person', '1980-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-BEARB-${suffix}`]
    );
    const einzugRes = await request(app.getHttpServer())
      .post("/belegungen")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ zimmerId: zimmerRows[0].id, klientId: klientRows[0].id, einzug });
    expect(einzugRes.status).toBe(201);
    return { zimmerId: zimmerRows[0].id, klientId: klientRows[0].id, belegungId: einzugRes.body.id };
  }

  it("korrigiert Einzugs- und Auszugsdatum einer bestehenden Belegung", async () => {
    const { belegungId, zimmerId, klientId } = await neuesZimmerMitKlient(standort1Id, "101", "2025-01-01");

    // Auszug bewusst in der Zukunft: der Klient bleibt damit aktueller
    // Bewohner (siehe Bugfix-Test weiter unten) -- diese Stelle prüft nur
    // die Korrektur selbst, nicht die "noch wohnhaft"-Ableitung.
    const res = await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ einzug: "2025-01-15", auszug: "2099-06-01" });

    expect(res.status).toBe(200);
    expect(res.body.einzug).toBe("2025-01-15");
    expect(res.body.auszug).toBe("2099-06-01");

    // Beide Seiten zeigen die Korrektur.
    const zimmer = await request(app.getHttpServer()).get("/zimmer").set("Authorization", `Bearer ${tokenBereichsleitung}`);
    const bewohner = zimmer.body.find((z: { id: string }) => z.id === zimmerId).bewohner[0];
    expect(bewohner.einzug).toBe("2025-01-15");

    const klient = await request(app.getHttpServer())
      .get(`/klienten/${klientId}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(klient.body.aktuellesZimmer.einzug).toBe("2025-01-15");
    expect(klient.body.aktuellesZimmer.auszug).toBe("2099-06-01");
  });

  it("setzt einen irrtümlich eingetragenen Auszug per auszug: null wieder zurück", async () => {
    const { belegungId, klientId } = await neuesZimmerMitKlient(standort1Id, "102", "2025-01-01");
    await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ einzug: "2025-01-01", auszug: "2025-03-01" });

    const res = await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ einzug: "2025-01-01", auszug: null });

    expect(res.status).toBe(200);
    expect(res.body.auszug).toBeNull();

    const klient = await request(app.getHttpServer())
      .get(`/klienten/${klientId}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(klient.body.aktuellesZimmer.auszug).toBeNull();
  });

  it("lehnt eine Korrektur ab, die mit einer anderen Belegung desselben Zimmers kollidiert (409)", async () => {
    const zimmerSuffix = randomUUID().slice(0, 8);
    const { rows: zimmerRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '103') RETURNING id",
      [mandantId, standort1Id]
    );
    const zimmerId = zimmerRows[0].id;

    const { rows: klientARows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'A', 'Test', '1980-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-KOLLA-${zimmerSuffix}`]
    );
    const { rows: klientBRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'B', 'Test', '1980-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-KOLLB-${zimmerSuffix}`]
    );

    // A wohnt schon 2025-01-01 bis 2025-06-01 in diesem Zimmer.
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, $4, $5)", [
      mandantId,
      zimmerId,
      klientARows[0].id,
      "2025-01-01",
      "2025-06-01",
    ]);
    // B zieht erst danach ein.
    const bEinzug = await request(app.getHttpServer())
      .post("/belegungen")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ zimmerId, klientId: klientBRows[0].id, einzug: "2025-07-01" });
    expect(bEinzug.status).toBe(201);

    // B's Einzug nach vorne verschieben, mitten in A's Zeitraum -- muss
    // genauso abgelehnt werden wie ein neuer Einzug dort.
    const res = await request(app.getHttpServer())
      .patch(`/belegungen/${bEinzug.body.id}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ einzug: "2025-03-01", auszug: null });

    expect(res.status).toBe(409);
  });

  it("lehnt ein Auszugsdatum vor dem Einzugsdatum mit 400 ab", async () => {
    const { belegungId } = await neuesZimmerMitKlient(standort1Id, "104", "2025-01-01");

    const res = await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ einzug: "2025-01-01", auszug: "2024-12-01" });

    expect(res.status).toBe(400);
  });

  it("ein Standort-beschränkter Benutzer kann eine Belegung außerhalb seines Standorts nicht bearbeiten (404)", async () => {
    const { belegungId } = await neuesZimmerMitKlient(standort2Id, "201", "2025-01-01");

    const res = await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenEinrichtungsleitungS1}`)
      .send({ einzug: "2025-01-02", auszug: null });

    expect(res.status).toBe(404);
  });

  /**
   * Kernaussage des Bugfixes: ein heute schon eingetragener, aber erst
   * künftig fälliger Auszug darf den Bewohner NICHT sofort aus Zimmer und
   * Klientenakte verschwinden lassen -- genau das war vorher der Fall
   * (JOIN-Bedingung "auszug IS NULL" statt "noch nicht faellig").
   */
  it("ein künftig geplanter Auszug lässt den Bewohner weiterhin als aktuell gelten", async () => {
    const { zimmerId, klientId, belegungId } = await neuesZimmerMitKlient(standort1Id, "105", "2025-01-01");

    const inEinemJahr = new Date();
    inEinemJahr.setFullYear(inEinemJahr.getFullYear() + 1);
    const kuenftigesDatum = inEinemJahr.toISOString().slice(0, 10);

    const auszugRes = await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ auszug: kuenftigesDatum });
    expect(auszugRes.status).toBe(200);

    const zimmer = await request(app.getHttpServer()).get("/zimmer").set("Authorization", `Bearer ${tokenBereichsleitung}`);
    const zimmerEintrag = zimmer.body.find((z: { id: string }) => z.id === zimmerId);
    expect(zimmerEintrag.status).toBe("vergeben");
    expect(zimmerEintrag.bewohner).toHaveLength(1);
    expect(zimmerEintrag.bewohner[0].auszug).toBe(kuenftigesDatum);

    const klient = await request(app.getHttpServer())
      .get(`/klienten/${klientId}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(klient.body.aktuellesZimmer).not.toBeNull();
    expect(klient.body.aktuellesZimmer.auszug).toBe(kuenftigesDatum);
    expect(klient.body.entlassenAm).toBeNull();

    const verlauf = await request(app.getHttpServer())
      .get(`/zimmer/${zimmerId}/belegungsverlauf`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    const eintrag = verlauf.body.find((e: { id: string }) => e.id === belegungId);
    expect(eintrag.istAktuell).toBe(true);
    expect(eintrag.geplant).toBe(false);
  });

  it("lehnt das Bearbeiten einer Belegung eines archivierten Klienten mit 400 ab", async () => {
    const { belegungId, klientId } = await neuesZimmerMitKlient(standort1Id, "106", "2025-01-01");
    await admin.query(
      `UPDATE klient SET archiviert_am = now(),
         archiviert_von = (SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1)
       WHERE id = $2`,
      [mandantId, klientId]
    );

    const res = await request(app.getHttpServer())
      .patch(`/belegungen/${belegungId}/bearbeiten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ einzug: "2025-01-02", auszug: null });

    expect(res.status).toBe(400);
  });
});
