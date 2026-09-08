/**
 * Erweiterte Klienten-Stammdaten (klient_stammdaten, klient_kontakt, siehe
 * migrations/0034_klient_stammdaten.sql). Kernaussagen:
 *
 * 1. Partial-Update-Semantik: PATCH .../stammdaten speichert pro Aufruf nur
 *    die mitgeschickten Felder, alle anderen bleiben unveraendert (COALESCE-
 *    Upsert in KlientStammdatenService.setzen()). Ein leerer String loescht
 *    ein Feld bewusst.
 * 2. Bezugsbetreuer:in ist eine echte FK auf benutzer -- eine unbekannte id
 *    liefert 404 statt eines rohen FK-Verletzungs-500ers.
 * 3. Dieselbe Standort-Einschraenkung wie bei klient/kassenbuchung/
 *    kostenuebernahme/rechnung (siehe standort-einschraenkung.e2e-spec.ts)
 *    gilt auch hier, fuer Stammdaten UND Kontakte.
 * 4. Kontakte sind 1:n und frei loeschbar/aenderbar.
 * 5. Aufnahme-/Entlassungsdatum werden aus der Belegung abgeleitet, nicht
 *    gespeichert (CLAUDE.md, "Zustaende werden abgeleitet, nicht gespeichert").
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Klienten-Stammdaten und Kontakte", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;

  let klient1: string; // wohnt in Standort 1
  let klient2: string; // wohnt in Standort 2
  let klient3: string; // frueher in Standort 1, mittlerweile ausgezogen (entlassen)

  let bezugsbetreuerId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-stammdaten-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Stammdaten ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3, 'einrichtungsleitung') RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    const einrichtungsleitungS1Id = einrichtungsleitungRows[0].id;

    const { rows: betreuerRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Betreuer:in Test', $3, 'betreuer') RETURNING id`,
      [mandantId, `betreuer-${suffix}@beispiel.test`, passwortHash]
    );
    bezugsbetreuerId = betreuerRows[0].id;

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    const standort1 = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    const standort2 = standort2Rows[0].id;

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
    const { rows: zimmer3Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '102') RETURNING id",
      [mandantId, standort1]
    );
    const zimmer3 = zimmer3Rows[0].id;

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
    const { rows: klient3Rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Drei', 'Entlassen', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-S3-${suffix}`]
    );
    klient3 = klient3Rows[0].id;

    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-03-15')",
      [mandantId, zimmer1, klient1]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer2, klient2]
    );
    // klient3: abgeschlossener Aufenthalt -- kein offener Aufenthalt mehr,
    // also muss entlassenAm den Auszug zeigen (siehe holeDetail()).
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, '2023-05-01', '2023-11-30')",
      [mandantId, zimmer3, klient3]
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
  });

  afterAll(async () => {
    await admin.query("DELETE FROM klient_kontakt WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = $1", [mandantId]);
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
      delete: (path: string) => request(http).delete(path).set("Authorization", `Bearer ${token}`),
    };
  }

  describe("Partial-Update-Semantik (COALESCE-Upsert)", () => {
    it("legt beim ersten Speichern nur die mitgeschickten Felder an, Rest bleibt null", async () => {
      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient1}/stammdaten`, {
        geburtsort: "Musterstadt",
        nationalitaet: "deutsch",
      });
      expect(res.status).toBe(200);
      expect(res.body.geburtsort).toBe("Musterstadt");
      expect(res.body.nationalitaet).toBe("deutsch");
      expect(res.body.sorgeberechtigt).toBeNull();
      expect(res.body.telefon).toBeNull();
    });

    it("aendert bei einem zweiten Aufruf nur die neu mitgeschickten Felder, der Rest bleibt erhalten", async () => {
      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient1}/stammdaten`, {
        telefon: "0123456789",
      });
      expect(res.status).toBe(200);
      expect(res.body.telefon).toBe("0123456789");
      // Aus dem ersten Aufruf -- muss trotz des zweiten, unabhaengigen
      // Aufrufs unveraendert da sein (das ist die Kernaussage der COALESCE-
      // Upsert-Logik: nicht mitgeschickte Felder werden NICHT auf null
      // zurueckgesetzt).
      expect(res.body.geburtsort).toBe("Musterstadt");
      expect(res.body.nationalitaet).toBe("deutsch");
    });

    it("leert ein Feld gezielt, wenn es als leerer String mitgeschickt wird", async () => {
      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient1}/stammdaten`, {
        nationalitaet: "",
      });
      expect(res.status).toBe(200);
      // Gespeichert wird ein leerer String (nicht NULL) -- die Spalte hat
      // keinen NOT-NULL-Zwang, "" reicht, damit die Oberflaeche es als
      // "nicht angegeben" behandelt (siehe anzeigeWert() in KlientDetail.tsx).
      expect(res.body.nationalitaet).toBe("");
      // Unbeteiligte Felder bleiben unberuehrt.
      expect(res.body.geburtsort).toBe("Musterstadt");
      expect(res.body.telefon).toBe("0123456789");
    });

    it("spiegelt die gespeicherten Stammdaten im Klienten-Detailabruf", async () => {
      const res = await als(tokenBereichsleitung).get(`/klienten/${klient1}`);
      expect(res.status).toBe(200);
      expect(res.body.stammdaten.geburtsort).toBe("Musterstadt");
      expect(res.body.stammdaten.telefon).toBe("0123456789");
    });
  });

  describe("Bezugsbetreuer:in (FK auf benutzer)", () => {
    it("verknuepft eine bekannte Benutzer-id und liefert den Namen mit zurueck", async () => {
      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient1}/stammdaten`, {
        bezugsbetreuerId,
      });
      expect(res.status).toBe(200);
      expect(res.body.bezugsbetreuerId).toBe(bezugsbetreuerId);
      expect(res.body.bezugsbetreuerName).toBe("Betreuer:in Test");
    });

    it("lehnt eine unbekannte Benutzer-id mit 404 ab statt eines rohen FK-Fehlers", async () => {
      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient1}/stammdaten`, {
        bezugsbetreuerId: randomUUID(),
      });
      expect(res.status).toBe(404);

      // Gegenprobe fuer die Testaussage selbst: die vorherige, gueltige
      // Zuordnung darf durch den fehlgeschlagenen Versuch nicht ueberschrieben
      // worden sein.
      const detail = await als(tokenBereichsleitung).get(`/klienten/${klient1}`);
      expect(detail.body.stammdaten.bezugsbetreuerId).toBe(bezugsbetreuerId);
    });

    it("lehnt eine syntaktisch ungueltige Benutzer-id mit 400 ab (zod-Validierung)", async () => {
      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient1}/stammdaten`, {
        bezugsbetreuerId: "keine-uuid",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Standort-Einschraenkung", () => {
    it("einrichtungsleitung-s1 kann Stammdaten von Klient 1 speichern, von Klient 2 nicht", async () => {
      const eigener = await als(tokenEinrichtungsleitungS1).patch(`/klienten/${klient1}/stammdaten`, {
        anmerkungen: "von S1 gespeichert",
      });
      expect(eigener.status).toBe(200);

      const fremder = await als(tokenEinrichtungsleitungS1).patch(`/klienten/${klient2}/stammdaten`, {
        anmerkungen: "sollte scheitern",
      });
      expect(fremder.status).toBe(404);

      // Gegenprobe: bereichsleitung (unrestricted) kann denselben Klienten 2
      // sehr wohl bearbeiten -- derselbe Endpunkt, andere Rolle.
      const unrestricted = await als(tokenBereichsleitung).patch(`/klienten/${klient2}/stammdaten`, {
        anmerkungen: "von bereichsleitung gespeichert",
      });
      expect(unrestricted.status).toBe(200);
    });

    it("einrichtungsleitung-s1 kann fuer Klient 1 einen Kontakt anlegen, fuer Klient 2 nicht", async () => {
      const eigener = await als(tokenEinrichtungsleitungS1).post(`/klienten/${klient1}/kontakte`, {
        name: "sollte klappen",
      });
      expect(eigener.status).toBe(201);

      const fremder = await als(tokenEinrichtungsleitungS1).post(`/klienten/${klient2}/kontakte`, {
        name: "sollte scheitern",
      });
      expect(fremder.status).toBe(404);
    });
  });

  describe("Kontakte (1:n, beliebig viele Datensaetze)", () => {
    it("legt mehrere Kontakte fuer denselben Klienten an", async () => {
      const mutter = await als(tokenBereichsleitung).post(`/klienten/${klient2}/kontakte`, {
        beziehung: "Mutter",
        name: "Erika Musterfrau",
        telefon: "0111",
      });
      expect(mutter.status).toBe(201);
      expect(mutter.body.beziehung).toBe("Mutter");

      const anwalt = await als(tokenBereichsleitung).post(`/klienten/${klient2}/kontakte`, {
        beziehung: "Anwalt",
        name: "Dr. Recht",
        email: "recht@beispiel.test",
      });
      expect(anwalt.status).toBe(201);

      const detail = await als(tokenBereichsleitung).get(`/klienten/${klient2}`);
      const namen = detail.body.kontakte.map((k: { name: string }) => k.name);
      expect(namen).toContain("Erika Musterfrau");
      expect(namen).toContain("Dr. Recht");
    });

    it("lehnt einen Kontakt ohne Namen ab", async () => {
      const res = await als(tokenBereichsleitung).post(`/klienten/${klient2}/kontakte`, {
        beziehung: "ohne Namen",
      });
      expect(res.status).toBe(400);
    });

    it("aendert einen bestehenden Kontakt gezielt", async () => {
      const angelegt = await als(tokenBereichsleitung).post(`/klienten/${klient2}/kontakte`, {
        name: "Zu aendern",
        telefon: "0000",
      });
      const kontaktId = angelegt.body.id;

      const res = await als(tokenBereichsleitung).patch(`/klienten/${klient2}/kontakte/${kontaktId}`, {
        telefon: "9999",
      });
      expect(res.status).toBe(200);
      expect(res.body.telefon).toBe("9999");
      expect(res.body.name).toBe("Zu aendern");
    });

    it("loescht einen Kontakt, danach ist er weder abrufbar noch erneut loeschbar", async () => {
      const angelegt = await als(tokenBereichsleitung).post(`/klienten/${klient2}/kontakte`, {
        name: "Zu loeschen",
      });
      const kontaktId = angelegt.body.id;

      const geloescht = await als(tokenBereichsleitung).delete(`/klienten/${klient2}/kontakte/${kontaktId}`);
      expect(geloescht.status).toBe(200);
      expect(geloescht.body.ok).toBe(true);

      const detail = await als(tokenBereichsleitung).get(`/klienten/${klient2}`);
      expect(detail.body.kontakte.find((k: { id: string }) => k.id === kontaktId)).toBeUndefined();

      const nochmal = await als(tokenBereichsleitung).delete(`/klienten/${klient2}/kontakte/${kontaktId}`);
      expect(nochmal.status).toBe(404);
    });
  });

  describe("Abgeleitetes Aufnahme-/Entlassungsdatum", () => {
    it("zeigt bei aktuell offenem Aufenthalt das Einzugsdatum als Aufnahme, kein Entlassungsdatum", async () => {
      const res = await als(tokenBereichsleitung).get(`/klienten/${klient1}`);
      expect(res.body.aufnahmeAm).toBe("2024-03-15");
      expect(res.body.entlassenAm).toBeNull();
    });

    it("zeigt bei abgeschlossenem Aufenthalt sowohl Aufnahme- als auch Entlassungsdatum", async () => {
      const res = await als(tokenBereichsleitung).get(`/klienten/${klient3}`);
      expect(res.body.aufnahmeAm).toBe("2023-05-01");
      expect(res.body.entlassenAm).toBe("2023-11-30");
    });
  });
});
