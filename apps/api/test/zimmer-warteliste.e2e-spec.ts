/**
 * Zimmer-Warteliste (Migration 0038): vorausschauendes Planen fuer volle
 * Zimmer -- ein zugesagter neuer Klient oder ein bestehender Bewohner, der
 * umziehen moechte, kann schon vorgemerkt werden, sobald ein Platz frei
 * wird. Bewusst ohne Datum (siehe Kommentar in der Migration), ein Klient
 * kann gleichzeitig auf mehreren Wartelisten stehen, verschwindet aber von
 * ALLEN, sobald er irgendwo tatsaechlich einzieht (Trigger
 * zimmer_warteliste_aufraeumen()) -- das ist die Kernaussage dieser Datei.
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

describe("Zimmer-Warteliste", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let standort1Id: string;
  let standort2Id: string;
  let zimmer1Id: string;
  let zimmer2Id: string;
  let zimmerStandort2Id: string;
  let klient1: { id: string; vorname: string; nachname: string };
  let klient2Id: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-warteliste-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Warteliste ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    async function neuerBenutzer(rolle: AlteRolle, emailPrefix: string): Promise<string> {
      return kontoMitAlterRolle(admin, {
        mandantId,
        rolle,
        email: `${emailPrefix}-${suffix}@beispiel.test`,
        name: `${emailPrefix} Test`,
        passwortHash,
      });
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

    const { rows: zimmer1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standort1Id]
    );
    zimmer1Id = zimmer1Rows[0].id;
    const { rows: zimmer2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '102') RETURNING id",
      [mandantId, standort1Id]
    );
    zimmer2Id = zimmer2Rows[0].id;
    const { rows: zimmerS2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, standort2Id]
    );
    zimmerStandort2Id = zimmerS2Rows[0].id;

    const { rows: klient1Rows } = await admin.query(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Warte', 'Fall', '1985-01-01', $2, 'Testamt') RETURNING id, vorname, nachname`,
      [mandantId, `AZ-WARTE-${suffix}`]
    );
    klient1 = klient1Rows[0];
    const { rows: klient2Rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Zweiter', 'Fall', '1986-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-WARTE2-${suffix}`]
    );
    klient2Id = klient2Rows[0].id;

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
    await raeumeKontoMitRolleAuf(admin, mandantId);
    await admin.query("DELETE FROM zimmer_warteliste WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  it("fügt einen Klienten zur Warteliste hinzu und liefert ihn in der Zimmerantwort zurück", async () => {
    const res = await request(app.getHttpServer())
      .post(`/zimmer/${zimmer1Id}/warteliste`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId: klient1.id });

    expect(res.status).toBe(201);
    expect(res.body.warteliste).toHaveLength(1);
    expect(res.body.warteliste[0].klientName).toBe(`${klient1.vorname} ${klient1.nachname}`);
  });

  it("lehnt einen doppelten Wartelisten-Eintrag für dasselbe Zimmer mit 409 ab", async () => {
    const res = await request(app.getHttpServer())
      .post(`/zimmer/${zimmer1Id}/warteliste`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId: klient1.id });

    expect(res.status).toBe(409);

    // Gegenprobe zum Idempotenz-Anspruch: weiterhin genau ein Eintrag.
    const zimmer = await request(app.getHttpServer())
      .get("/zimmer")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(zimmer.body.find((z: { id: string }) => z.id === zimmer1Id).warteliste).toHaveLength(1);
  });

  it("derselbe Klient kann gleichzeitig auf mehreren Wartelisten stehen", async () => {
    const res = await request(app.getHttpServer())
      .post(`/zimmer/${zimmer2Id}/warteliste`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId: klient1.id });

    expect(res.status).toBe(201);
    expect(res.body.warteliste).toHaveLength(1);
  });

  it("entfernt einen Eintrag wieder von der Warteliste", async () => {
    const res = await request(app.getHttpServer())
      .post(`/zimmer/${zimmer2Id}/warteliste`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId: klient2Id });
    expect(res.status).toBe(201);
    const eintragId = res.body.warteliste.find((w: { klientId: string }) => w.klientId === klient2Id).id;

    const entfernt = await request(app.getHttpServer())
      .delete(`/zimmer/${zimmer2Id}/warteliste/${eintragId}`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(entfernt.status).toBe(200);
    expect(entfernt.body.warteliste.some((w: { id: string }) => w.id === eintragId)).toBe(false);
  });

  it("lehnt das Eintragen eines archivierten Klienten mit 400 ab", async () => {
    const suffix = randomUUID().slice(0, 8);
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, archiviert_am, archiviert_von)
       VALUES ($1, 'Archiviert', 'Test', '1980-01-01', $2, 'Testamt', now(),
         (SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1))
       RETURNING id`,
      [mandantId, `AZ-ARCH-${suffix}`]
    );

    const res = await request(app.getHttpServer())
      .post(`/zimmer/${zimmer1Id}/warteliste`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId: rows[0].id });

    expect(res.status).toBe(400);
  });

  it("ein Standort-beschränkter Benutzer sieht kein Zimmer eines anderen Standorts (404 statt der Warteliste)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/zimmer/${zimmerStandort2Id}/warteliste`)
      .set("Authorization", `Bearer ${tokenEinrichtungsleitungS1}`)
      .send({ klientId: klient1.id });

    expect(res.status).toBe(404);
  });

  it("Kernaussage: sobald der Klient IRGENDWO einzieht, verschwindet er von ALLEN Wartelisten", async () => {
    // Vorbedingung: klient1 steht zu diesem Zeitpunkt auf der Warteliste von
    // zimmer2Id (aus einem frueheren Test in dieser Datei).
    const vorher = await request(app.getHttpServer())
      .get("/zimmer")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(vorher.body.find((z: { id: string }) => z.id === zimmer2Id).warteliste).toHaveLength(1);

    // Zieht in ein DRITTES, komplett anderes Zimmer ein -- nicht in eines,
    // fuer das er auf der Warteliste stand.
    const { rows: drittesZimmerRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '103') RETURNING id",
      [mandantId, standort1Id]
    );
    const einzugRes = await request(app.getHttpServer())
      .post("/belegungen")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ zimmerId: drittesZimmerRows[0].id, klientId: klient1.id, einzug: "2025-01-01" });
    expect(einzugRes.status).toBe(201);

    const nachher = await request(app.getHttpServer())
      .get("/zimmer")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(nachher.body.find((z: { id: string }) => z.id === zimmer2Id).warteliste).toHaveLength(0);
    expect(
      nachher.body
        .find((z: { id: string }) => z.id === drittesZimmerRows[0].id)
        .warteliste.some((w: { klientId: string }) => w.klientId === klient1.id)
    ).toBe(false);
  });

  /**
   * Gegenprobe (CLAUDE.md-Pflicht): den Aufraeum-Trigger kurz entfernen,
   * derselbe Ablauf wie oben muss jetzt eine stehen gebliebene Warteliste
   * zeigen -- erst dann ist bewiesen, dass der vorherige Test tatsaechlich
   * den Trigger prueft und nicht zufaellig gruen war.
   */
  it("Gegenprobe: ohne den Aufräum-Trigger bleibt der Klient fälschlich auf der Warteliste stehen", async () => {
    await admin.query("DROP TRIGGER zimmer_warteliste_aufraeumen ON belegung");
    try {
      const vorher = await request(app.getHttpServer())
        .post(`/zimmer/${zimmer2Id}/warteliste`)
        .set("Authorization", `Bearer ${tokenBereichsleitung}`)
        .send({ klientId: klient2Id });
      expect(vorher.status).toBe(201);

      const { rows: zimmerRows } = await admin.query<{ id: string }>(
        "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '104') RETURNING id",
        [mandantId, standort1Id]
      );
      const einzugRes = await request(app.getHttpServer())
        .post("/belegungen")
        .set("Authorization", `Bearer ${tokenBereichsleitung}`)
        .send({ zimmerId: zimmerRows[0].id, klientId: klient2Id, einzug: "2025-02-01" });
      expect(einzugRes.status).toBe(201);

      const nachher = await request(app.getHttpServer())
        .get("/zimmer")
        .set("Authorization", `Bearer ${tokenBereichsleitung}`);
      // Ohne Trigger bleibt der laengst eingezogene Klient faelschlich auf
      // der Warteliste stehen -- das beweist, dass der Trigger im
      // vorherigen Test die eigentliche Ursache fuer das Aufraeumen war.
      expect(
        nachher.body
          .find((z: { id: string }) => z.id === zimmer2Id)
          .warteliste.some((w: { klientId: string }) => w.klientId === klient2Id)
      ).toBe(true);
    } finally {
      await admin.query(`
        CREATE TRIGGER zimmer_warteliste_aufraeumen
          AFTER INSERT ON belegung
          FOR EACH ROW EXECUTE FUNCTION zimmer_warteliste_aufraeumen()
      `);
    }
  });
});
