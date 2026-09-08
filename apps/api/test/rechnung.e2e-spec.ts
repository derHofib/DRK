/**
 * Die Abnahmekriterien aus dem Bauplan, Phase 3: "eine Rechnung durchläuft
 * beantragt -> genehmigt -> ausgezahlt, jeder unzulässige Sprung wird
 * abgelehnt, der Status wird nie gespeichert sondern immer aus dem
 * Verlauf abgeleitet, und zwei Kostenübernahme-Zeiträume desselben
 * Klienten dürfen sich nicht überschneiden."
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

const TEST_PDF_BASE64 = "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsO4CQ==";

describe("Kostenübernahmen & Rechnungen: Zeitraum-Sperre, Statusworkflow, Änderungsschutz", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let klientId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-rechnung-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Rechnung ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Test', 'Klient', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-RECH-${suffix}`]
    );
    klientId = klientRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: `bereichsleitung-${suffix}@beispiel.test`, passwort });
    tokenBereichsleitung = res.body.accessToken;
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM rechnung_dokument WHERE rechnung_id IN (SELECT id FROM rechnung WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query(
      "DELETE FROM rechnung_statuswechsel WHERE rechnung_id IN (SELECT id FROM rechnung WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query("DELETE FROM rechnung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${tokenBereichsleitung}`).send(body);
  }
  function patch(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).patch(path).set("Authorization", `Bearer ${tokenBereichsleitung}`).send(body);
  }
  function get(path: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${tokenBereichsleitung}`);
  }

  describe("Kostenübernahme-Zeiträume", () => {
    let ersterZeitraumId: string;

    it("legt einen offenen Kostenübernahme-Zeitraum an", async () => {
      const res = await post("/kostenuebernahmen", { klientId, amt: "Amt A", von: "2026-01-01" });
      expect(res.status).toBe(201);
      expect(res.body.bis).toBeNull();
      ersterZeitraumId = res.body.id;
    });

    it("lehnt einen überlappenden Zeitraum mit 409 ab", async () => {
      const res = await post("/kostenuebernahmen", { klientId, amt: "Amt B", von: "2026-02-01" });
      expect(res.status).toBe(409);
    });

    it("beendet den offenen Zeitraum, danach ist ein neuer, anschließender Zeitraum möglich", async () => {
      const beendenRes = await patch(`/kostenuebernahmen/${ersterZeitraumId}/beenden`, { bis: "2026-06-01" });
      expect(beendenRes.status).toBe(200);
      expect(beendenRes.body.bis).toBe("2026-06-01");

      const neuerRes = await post("/kostenuebernahmen", { klientId, amt: "Amt B", von: "2026-06-01" });
      expect(neuerRes.status).toBe(201);
    });

    it("lehnt ein zweites Beenden desselben (bereits geschlossenen) Zeitraums mit 404 ab", async () => {
      const res = await patch(`/kostenuebernahmen/${ersterZeitraumId}/beenden`, { bis: "2026-07-01" });
      expect(res.status).toBe(404);
    });

    it("listet beide Zeiträume für den Klienten", async () => {
      const res = await get(`/kostenuebernahmen?klientId=${klientId}`);
      expect(res.body).toHaveLength(2);
    });

    /**
     * Realer Systemtest-Fund: anlegen() prueft "bis > von" schon per zod
     * (kostenuebernahme.controller.ts), aber beenden() kannte "von" bislang
     * erst nach einem Datenbank-Lookup und hatte gar keine eigene Pruefung
     * -- ein zu fruehes Enddatum stuerzte dort mit einem unbehandelten 500
     * ab (CHECK-Constraint "bis IS NULL OR bis > von", migrations/0013),
     * statt sauber 400 zu liefern.
     */
    it("lehnt beim Beenden ein Enddatum vor oder am Startdatum sauber mit 400 ab, statt mit 500 abzustuerzen", async () => {
      // Eigener, sonst unbeteiligter Klient -- der geteilte "klientId" hat zu
      // diesem Zeitpunkt bereits einen offenen (unbefristeten) Zeitraum ab
      // 2026-06-01 (siehe Test oben), ein zweiter offener Zeitraum fuer
      // denselben Klienten wuerde also selbst schon an der
      // EXCLUDE-Constraint scheitern, unabhaengig vom hier zu pruefenden Bug.
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Fruehende', 'Test', '1990-01-01', $2, 'Testamt') RETURNING id`,
        [mandantId, `AZ-FRUEHENDE-${randomUUID().slice(0, 8)}`]
      );
      const eigenerKlient = rows[0].id;

      const offenRes = await post("/kostenuebernahmen", { klientId: eigenerKlient, amt: "Amt Fruehende", von: "2028-01-01" });
      expect(offenRes.status).toBe(201);
      const zeitraumId = offenRes.body.id;

      const amGleichenTag = await patch(`/kostenuebernahmen/${zeitraumId}/beenden`, { bis: "2028-01-01" });
      expect(amGleichenTag.status).toBe(400);

      const davor = await patch(`/kostenuebernahmen/${zeitraumId}/beenden`, { bis: "2027-12-01" });
      expect(davor.status).toBe(400);

      // Keiner der beiden abgelehnten Versuche darf den Zeitraum beendet haben.
      const liste = await get(`/kostenuebernahmen?klientId=${eigenerKlient}`);
      const zeitraum = liste.body.find((k: { id: string }) => k.id === zeitraumId);
      expect(zeitraum.bis).toBeNull();
    });
  });

  describe("Rechnungen: Statusworkflow", () => {
    let rechnungId: string;

    it("legt eine Rechnung mit Dokument an, Status ist sofort 'beantragt'", async () => {
      const res = await post("/rechnungen", {
        klientId,
        betragCent: 15000,
        beschreibung: "Fahrtkosten Januar",
        dokumentBase64: TEST_PDF_BASE64,
        dokumentDateiname: "fahrtkosten.pdf",
        dokumentMimeType: "application/pdf",
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("beantragt");
      expect(res.body.hatDokument).toBe(true);
      rechnungId = res.body.id;

      const dokRes = await get(`/rechnungen/${rechnungId}/dokument`);
      expect(dokRes.status).toBe(200);
      expect(dokRes.headers["content-type"]).toBe("application/pdf");
      expect(Buffer.from(dokRes.body).length).toBeGreaterThan(0);
    });

    it("lehnt den Sprung 'beantragt' -> 'ausgezahlt' mit 409 ab", async () => {
      const res = await patch(`/rechnungen/${rechnungId}/status`, { status: "ausgezahlt" });
      expect(res.status).toBe(409);
    });

    it("lehnt 'abgelehnt' ohne Grund mit 400 ab", async () => {
      const res = await patch(`/rechnungen/${rechnungId}/status`, { status: "abgelehnt" });
      expect(res.status).toBe(400);
    });

    it("erlaubt 'beantragt' -> 'genehmigt'", async () => {
      const res = await patch(`/rechnungen/${rechnungId}/status`, { status: "genehmigt" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("genehmigt");
    });

    it("erlaubt 'genehmigt' -> 'ausgezahlt'", async () => {
      const res = await patch(`/rechnungen/${rechnungId}/status`, { status: "ausgezahlt" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ausgezahlt");
    });

    it("lehnt jeden weiteren Statuswechsel ab, sobald 'ausgezahlt' erreicht ist", async () => {
      const res = await patch(`/rechnungen/${rechnungId}/status`, { status: "abgelehnt", grund: "zu spät" });
      expect(res.status).toBe(409);
    });

    it("liefert den vollständigen Statusverlauf über /rechnungen/:id", async () => {
      const res = await get(`/rechnungen/${rechnungId}`);
      expect(res.status).toBe(200);
      expect(res.body.statusVerlauf.map((s: { status: string }) => s.status)).toEqual([
        "beantragt",
        "genehmigt",
        "ausgezahlt",
      ]);
    });

    it("eine zweite, separat abgelehnte Rechnung zeigt 'abgelehnt' mit Grund", async () => {
      const anlegenRes = await post("/rechnungen", { klientId, betragCent: 5000, beschreibung: "Zweite Rechnung" });
      const zweiteId = anlegenRes.body.id;

      const ablehnenRes = await patch(`/rechnungen/${zweiteId}/status`, {
        status: "abgelehnt",
        grund: "Beleg fehlt",
      });
      expect(ablehnenRes.status).toBe(200);
      expect(ablehnenRes.body.status).toBe("abgelehnt");
      expect(ablehnenRes.body.statusGrund).toBe("Beleg fehlt");
      expect(ablehnenRes.body.hatDokument).toBe(false);
    });

    /**
     * Realer Systemtest-Fund: .positive() allein liess einen Betrag jenseits
     * der 32-Bit-Grenze der Postgres-Spalte betrag_cent durch -- das loeste
     * dort "numeric field overflow" aus, als unbehandelter 500.
     */
    it("lehnt einen 32-Bit-Integer-Overflow beim Betrag mit 400 ab", async () => {
      const res = await post("/rechnungen", {
        klientId,
        betragCent: 99_999_999_999,
        beschreibung: "Sollte scheitern",
      });
      expect(res.status).toBe(400);

      const liste = await get(`/rechnungen?klientId=${klientId}`);
      expect(liste.body.find((r: { beschreibung: string }) => r.beschreibung === "Sollte scheitern")).toBeUndefined();
    });

    it("verweigert der App-Datenbankrolle jede Änderung an Betrag oder Beschreibung einer Rechnung", async () => {
      const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await appClient.connect();
      try {
        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(
          appClient.query("UPDATE rechnung SET betrag_cent = 1 WHERE mandant_id = $1", [mandantId])
        ).rejects.toThrow(/permission denied/i);
        await appClient.query("ROLLBACK");

        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(
          appClient.query("DELETE FROM rechnung_statuswechsel WHERE mandant_id = $1", [mandantId])
        ).rejects.toThrow(/permission denied/i);
        await appClient.query("ROLLBACK");
      } finally {
        await appClient.end();
      }
    });
  });
});
