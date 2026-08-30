/**
 * Standort-Einschraenkung (benutzer_standort, common/standort-restriction.ts):
 * ein Benutzer mit mindestens einer Zeile in benutzer_standort darf nur
 * Daten von Klient:innen sehen und aendern, die AKTUELL in einem dieser
 * Standorte wohnen. Bis zur Sicherheitspruefung dieser Session war das nur
 * in zimmer.service.ts durchgesetzt -- klient, kassenbuchung,
 * kostenuebernahme und rechnung liessen jeden authentifizierten Benutzer
 * mandantsweit alles sehen, unabhaengig von der Standort-Zuordnung.
 *
 * Aufbau: zwei Standorte S1/S2, je ein Zimmer und ein aktuell dort
 * wohnender Klient. "einrichtungsleitung" ist auf S1 eingeschraenkt
 * (benutzer_standort hat eine Zeile). "bereichsleitung" bleibt unrestricted
 * (keine Zeile) und dient
 * als eingebaute Gegenprobe: dieselben Endpunkte, dieselben Daten, aber
 * alles sichtbar -- ohne diesen Vergleich koennte ein Test, der immer 404
 * liefert (z.B. wegen eines Tippfehlers in der ID), unbemerkt gruen bleiben.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Standort-Einschraenkung: klient, kassenbuchung, kostenuebernahme, rechnung", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;

  let klient1: string; // wohnt in Standort 1
  let klient2: string; // wohnt in Standort 2
  let standort1Id: string;
  let standort2Id: string;

  let buchung1: string;
  let buchung2: string;
  let auszahlung2: string; // Auszahlung mit Unterschrift, Klient 2
  let standortBuchung1: string; // Standort-Buchung (kein Klient) fuer Standort 1
  let standortBuchung2: string; // Standort-Buchung (kein Klient) fuer Standort 2

  let kostenuebernahme2: string;

  let rechnung2: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-standort-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Standort ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: bereichsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung') RETURNING id`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );
    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3, 'einrichtungsleitung') RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    const einrichtungsleitungS1Id = einrichtungsleitungRows[0].id;

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    const standort1 = standort1Rows[0].id;
    standort1Id = standort1;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    const standort2 = standort2Rows[0].id;
    standort2Id = standort2;

    // einrichtungsleitung-s1 ist NUR auf Standort 1 eingeschraenkt.
    await admin.query(
      "INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)",
      [mandantId, einrichtungsleitungS1Id, standort1]
    );

    const { rows: zimmer1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standort1]
    );
    const zimmer1 = zimmer1Rows[0].id;
    const { rows: zimmer2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, standort2]
    );
    const zimmer2 = zimmer2Rows[0].id;

    const { rows: klient1Rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Eins', 'S1', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-S1-${suffix}`]
    );
    klient1 = klient1Rows[0].id;
    const { rows: klient2Rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Zwei', 'S2', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-S2-${suffix}`]
    );
    klient2 = klient2Rows[0].id;

    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer1, klient1]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer2, klient2]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`einrichtungsleitung-s1-${suffix}@beispiel.test`);

    // Alles Fachliche als (unrestricted) Bereichsleitung anlegen -- so haengt die
    // Vorbereitung nicht bereits von der zu pruefenden Einschraenkung ab.
    function postAls(token: string, path: string, body: Record<string, unknown>) {
      return request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${token}`).send(body);
    }

    const b1 = await postAls(tokenBereichsleitung, "/kassenbuchungen", {
      klientId: klient1,
      datum: "2026-01-01",
      betragCent: 5000,
      verwendungszweck: "Einzahlung S1",
      typ: "einzahlung",
    });
    buchung1 = b1.body.id;

    const b2 = await postAls(tokenBereichsleitung, "/kassenbuchungen", {
      klientId: klient2,
      datum: "2026-01-01",
      betragCent: 5000,
      verwendungszweck: "Einzahlung S2",
      typ: "einzahlung",
    });
    buchung2 = b2.body.id;

    const a2 = await postAls(tokenBereichsleitung, "/kassenbuchungen", {
      klientId: klient2,
      datum: "2026-01-02",
      betragCent: -1000,
      verwendungszweck: "Auszahlung S2",
      typ: "sonstiges",
      unterschriftBase64: TEST_PNG_BASE64,
    });
    auszahlung2 = a2.body.id;

    const ko2 = await postAls(tokenBereichsleitung, "/kostenuebernahmen", {
      klientId: klient2,
      amt: "Testamt",
      von: "2026-01-01",
    });
    kostenuebernahme2 = ko2.body.id;

    const r2 = await postAls(tokenBereichsleitung, "/rechnungen", {
      klientId: klient2,
      betragCent: 1234,
      beschreibung: "Testrechnung S2",
      dokumentBase64: TEST_PNG_BASE64,
      dokumentDateiname: "beleg.png",
      dokumentMimeType: "image/png",
    });
    rechnung2 = r2.body.id;

    const sb1 = await postAls(tokenBereichsleitung, "/kassenbuchungen", {
      standortId: standort1,
      datum: "2026-01-03",
      betragCent: 5000,
      verwendungszweck: "Grillfest S1",
      typ: "einzahlung",
    });
    standortBuchung1 = sb1.body.id;

    const sb2 = await postAls(tokenBereichsleitung, "/kassenbuchungen", {
      standortId: standort2,
      datum: "2026-01-03",
      betragCent: 5000,
      verwendungszweck: "Grillfest S2",
      typ: "einzahlung",
    });
    standortBuchung2 = sb2.body.id;
  });

  afterAll(async () => {
    await admin.query("DELETE FROM rechnung_dokument WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung_statuswechsel WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = $1", [mandantId]);
    await admin.query(
      "DELETE FROM unterschrift WHERE kassenbuchung_id IN (SELECT id FROM kassenbuchung WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown>) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
    };
  }

  describe("einrichtungsleitung-s1 (auf Standort 1 eingeschraenkt)", () => {
    it("sieht in /klienten nur Klient 1, nicht Klient 2", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get("/klienten");
      const ids = res.body.map((k: { id: string }) => k.id);
      expect(ids).toContain(klient1);
      expect(ids).not.toContain(klient2);
    });

    it("bekommt fuer Klient 2 per Detailabruf 404", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get(`/klienten/${klient2}`);
      expect(res.status).toBe(404);
    });

    it("sieht in /kassenbuchungen nur die Buchung von Klient 1", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get("/kassenbuchungen");
      const ids = res.body.map((b: { id: string }) => b.id);
      expect(ids).toContain(buchung1);
      expect(ids).not.toContain(buchung2);
      expect(ids).not.toContain(auszahlung2);
    });

    it("kann fuer Klient 2 keine Buchung anlegen (404 statt still durchgereicht)", async () => {
      const res = await als(tokenEinrichtungsleitungS1).post("/kassenbuchungen", {
        klientId: klient2,
        datum: "2026-01-03",
        betragCent: 100,
        verwendungszweck: "sollte scheitern",
        typ: "sonstiges",
      });
      expect(res.status).toBe(404);
    });

    it("kann die Buchung von Klient 1 stornieren, die von Klient 2 nicht", async () => {
      const eigene = await als(tokenEinrichtungsleitungS1).patch(`/kassenbuchungen/${buchung1}/stornieren`, {
        grund: "Testkorrektur",
      });
      expect(eigene.status).toBe(200);

      const fremde = await als(tokenEinrichtungsleitungS1).patch(`/kassenbuchungen/${buchung2}/stornieren`, {
        grund: "sollte scheitern",
      });
      expect(fremde.status).toBe(404);
    });

    it("bekommt fuer die Unterschrift von Klient 2 404", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get(`/kassenbuchungen/${auszahlung2}/unterschrift`);
      expect(res.status).toBe(404);
    });

    it("sieht in /kassenbuchungen nur die Standort-Buchung von Standort 1, nicht die von Standort 2", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get("/kassenbuchungen");
      const ids = res.body.map((b: { id: string }) => b.id);
      expect(ids).toContain(standortBuchung1);
      expect(ids).not.toContain(standortBuchung2);
    });

    it("kann fuer Standort 1 eine Standort-Buchung anlegen, fuer Standort 2 nicht", async () => {
      const eigener = await als(tokenEinrichtungsleitungS1).post("/kassenbuchungen", {
        standortId: standort1Id,
        datum: "2026-01-04",
        betragCent: 1000,
        verwendungszweck: "sollte klappen",
        typ: "sonstiges",
      });
      expect(eigener.status).toBe(201);

      const fremder = await als(tokenEinrichtungsleitungS1).post("/kassenbuchungen", {
        standortId: standort2Id,
        datum: "2026-01-04",
        betragCent: 1000,
        verwendungszweck: "sollte scheitern",
        typ: "sonstiges",
      });
      expect(fremder.status).toBe(404);
    });

    it("kann die Standort-Buchung von Standort 1 stornieren, die von Standort 2 nicht", async () => {
      const eigene = await als(tokenEinrichtungsleitungS1).patch(`/kassenbuchungen/${standortBuchung1}/stornieren`, {
        grund: "Testkorrektur",
      });
      expect(eigene.status).toBe(200);

      const fremde = await als(tokenEinrichtungsleitungS1).patch(`/kassenbuchungen/${standortBuchung2}/stornieren`, {
        grund: "sollte scheitern",
      });
      expect(fremde.status).toBe(404);
    });

    it("sieht fuer Klient 2 eine leere Kostenuebernahme-Liste statt der echten Daten", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get(`/kostenuebernahmen?klientId=${klient2}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("kann fuer Klient 2 keine Kostenuebernahme anlegen", async () => {
      const res = await als(tokenEinrichtungsleitungS1).post("/kostenuebernahmen", {
        klientId: klient2,
        amt: "Testamt",
        von: "2026-02-01",
      });
      expect(res.status).toBe(404);
    });

    it("kann die Kostenuebernahme von Klient 2 nicht beenden", async () => {
      const res = await als(tokenEinrichtungsleitungS1).patch(`/kostenuebernahmen/${kostenuebernahme2}/beenden`, {
        bis: "2026-03-01",
      });
      expect(res.status).toBe(404);
    });

    it("sieht die Rechnung von Klient 2 weder in der Liste noch im Detailabruf", async () => {
      const liste = await als(tokenEinrichtungsleitungS1).get(`/rechnungen?klientId=${klient2}`);
      expect(liste.status).toBe(200);
      expect(liste.body).toEqual([]);

      const detail = await als(tokenEinrichtungsleitungS1).get(`/rechnungen/${rechnung2}`);
      expect(detail.status).toBe(404);
    });

    it("kann fuer Klient 2 keine Rechnung anlegen", async () => {
      const res = await als(tokenEinrichtungsleitungS1).post("/rechnungen", {
        klientId: klient2,
        betragCent: 100,
        beschreibung: "sollte scheitern",
      });
      expect(res.status).toBe(404);
    });

    it("kann den Status der Rechnung von Klient 2 nicht aendern", async () => {
      const res = await als(tokenEinrichtungsleitungS1).patch(`/rechnungen/${rechnung2}/status`, { status: "genehmigt" });
      expect(res.status).toBe(404);
    });

    it("bekommt fuer das Dokument der Rechnung von Klient 2 404", async () => {
      const res = await als(tokenEinrichtungsleitungS1).get(`/rechnungen/${rechnung2}/dokument`);
      expect(res.status).toBe(404);
    });
  });

  describe("bereichsleitung (unrestricted) -- eingebaute Gegenprobe", () => {
    it("sieht in /klienten beide Klienten", async () => {
      const res = await als(tokenBereichsleitung).get("/klienten");
      const ids = res.body.map((k: { id: string }) => k.id);
      expect(ids).toContain(klient1);
      expect(ids).toContain(klient2);
    });

    it("bekommt fuer Klient 2 einen echten Detailabruf", async () => {
      const res = await als(tokenBereichsleitung).get(`/klienten/${klient2}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(klient2);
    });

    it("sieht in /kassenbuchungen die Standort-Buchungen beider Standorte", async () => {
      const res = await als(tokenBereichsleitung).get("/kassenbuchungen");
      const ids = res.body.map((b: { id: string }) => b.id);
      expect(ids).toContain(standortBuchung1);
      expect(ids).toContain(standortBuchung2);
    });

    it("sieht die Rechnung von Klient 2 in Liste und Detailabruf und kann ihren Status aendern", async () => {
      const liste = await als(tokenBereichsleitung).get(`/rechnungen?klientId=${klient2}`);
      expect(liste.body.map((r: { id: string }) => r.id)).toContain(rechnung2);

      const detail = await als(tokenBereichsleitung).get(`/rechnungen/${rechnung2}`);
      expect(detail.status).toBe(200);

      const statusRes = await als(tokenBereichsleitung).patch(`/rechnungen/${rechnung2}/status`, { status: "genehmigt" });
      expect(statusRes.status).toBe(200);
    });
  });
});
