/**
 * Klient archivieren (siehe migrations/0036_klient_archivierung.sql):
 * unabhaengig von der Anonymisierung (Art. 17 DSGVO) -- eine operative,
 * REVERSIBLE Statusaenderung fuer Klient:innen, die die Einrichtung
 * verlassen haben. Kernaussagen:
 *
 * 1. Nur Bereichs-/Einrichtungsleitung duerfen archivieren/entarchivieren.
 * 2. Archivieren erzeugt einen PDF-Snapshot (klient_archiv_pdf) und friert
 *    den Klienten ein -- keine neuen Tagesberichte/Buchungen/Rechnungen/
 *    Kostenuebernahmen/Stammdaten-Aenderungen/Kontakte/Zimmerzuweisungen
 *    mehr moeglich (klientIstArchiviert(), common/standort-restriction.ts).
 * 3. Archivierte Klient:innen fehlen in der Standardliste, erscheinen aber
 *    mit ?archiviert=true.
 * 4. Entarchivieren hebt die Sperre wieder auf; der PDF-Snapshot bleibt
 *    als Beleg bestehen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Klient archivieren: Rollen-Gate, Schreibsperre, PDF-Snapshot, Reversibilitaet", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenBetreuer: string;
  let klientId: string;
  let zimmerId: string;
  let standortId: string;
  let hzlTypId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-klientarchiv-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Klientarchiv ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Betreuer Test', $3, 'betreuer')`,
      [mandantId, `betreuer-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Archiv', 'Testklient', '1995-05-05', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-ARCHIV-${suffix}`]
    );
    klientId = klientRows[0].id;

    const { rows: standortRows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Test', 'Teststr. 1') RETURNING id",
      [mandantId]
    );
    standortId = standortRows[0].id;
    const { rows: zimmerRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '101', 1) RETURNING id",
      [mandantId, standortId]
    );
    zimmerId = zimmerRows[0].id;

    // Vom Trigger mandant_kassenbuchung_typ_standard automatisch angelegt
    // (siehe migrations/0035_kassenbuchung_typ.sql).
    const { rows: typRows } = await admin.query<{ id: string }>(
      "SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND bezeichnung = 'HZL'",
      [mandantId]
    );
    hzlTypId = typRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`betreuer-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM tagesbericht WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung_statuswechsel WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient_kontakt WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient_archiv_pdf WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown> = {}) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown> = {}) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
    };
  }

  it("lehnt Betreuer beim Archivieren/Entarchivieren mit 403 ab, Zustand bleibt unveraendert", async () => {
    const archivieren = await als(tokenBetreuer).patch(`/klienten/${klientId}/archivieren`);
    expect(archivieren.status).toBe(403);
    const entarchivieren = await als(tokenBetreuer).patch(`/klienten/${klientId}/entarchivieren`);
    expect(entarchivieren.status).toBe(403);

    const danach = await als(tokenBereichsleitung).get(`/klienten/${klientId}`);
    expect(danach.body.archiviertAm).toBeNull();
  });

  it("lehnt Entarchivieren eines nicht archivierten Klienten mit 409 ab", async () => {
    const res = await als(tokenBereichsleitung).patch(`/klienten/${klientId}/entarchivieren`);
    expect(res.status).toBe(409);
  });

  it("archiviert den Klienten: PDF-Snapshot entsteht, Zustand wird eingefroren", async () => {
    const res = await als(tokenBereichsleitung).patch(`/klienten/${klientId}/archivieren`);
    expect(res.status).toBe(200);
    expect(res.body.archiviertAm).not.toBeNull();
    expect(res.body.archiviertVonName).toBe("Bereichsleitung Test");
    expect(res.body.archivPdfs).toHaveLength(1);

    const pdfId = res.body.archivPdfs[0].id;
    const download = await als(tokenBereichsleitung).get(`/klienten/${klientId}/archiv/${pdfId}/pdf`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["x-datei-hash"]).toBeDefined();
    expect(Buffer.from(download.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("lehnt ein zweites Archivieren desselben Klienten mit 409 ab", async () => {
    const res = await als(tokenBereichsleitung).patch(`/klienten/${klientId}/archivieren`);
    expect(res.status).toBe(409);
  });

  it("lehnt jede Schreiboperation gegen den archivierten Klienten mit 400 ab", async () => {
    const tagesbericht = await als(tokenBereichsleitung).post("/tagesberichte", {
      klientId,
      datum: "2026-01-01",
      text: "sollte scheitern",
    });
    expect(tagesbericht.status).toBe(400);

    const rechnung = await als(tokenBereichsleitung).post("/rechnungen", {
      klientId,
      betragCent: 1000,
      beschreibung: "sollte scheitern",
    });
    expect(rechnung.status).toBe(400);

    const kostenuebernahme = await als(tokenBereichsleitung).post("/kostenuebernahmen", {
      klientId,
      amt: "Testamt",
      von: "2026-01-01",
    });
    expect(kostenuebernahme.status).toBe(400);

    const kassenbuchung = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-01-01",
      betragCent: 1000,
      verwendungszweck: "sollte scheitern",
      typId: hzlTypId,
    });
    expect(kassenbuchung.status).toBe(400);

    const stammdaten = await als(tokenBereichsleitung).patch(`/klienten/${klientId}/stammdaten`, {
      anmerkungen: "sollte scheitern",
    });
    expect(stammdaten.status).toBe(400);

    const kontakt = await als(tokenBereichsleitung).post(`/klienten/${klientId}/kontakte`, {
      name: "sollte scheitern",
    });
    expect(kontakt.status).toBe(400);

    const einziehen = await als(tokenBereichsleitung).post("/belegungen", {
      zimmerId,
      klientId,
      einzug: "2026-01-01",
    });
    expect(einziehen.status).toBe(400);
  });

  it("blendet den archivierten Klienten aus der Standardliste aus, zeigt ihn aber mit ?archiviert=true", async () => {
    const standard = await als(tokenBereichsleitung).get("/klienten");
    expect(standard.body.map((k: { id: string }) => k.id)).not.toContain(klientId);

    const archiv = await als(tokenBereichsleitung).get("/klienten?archiviert=true");
    expect(archiv.body.map((k: { id: string }) => k.id)).toContain(klientId);
  });

  it("entarchiviert den Klienten: Schreiben ist wieder moeglich, der PDF-Snapshot bleibt erhalten", async () => {
    const res = await als(tokenBereichsleitung).patch(`/klienten/${klientId}/entarchivieren`);
    expect(res.status).toBe(200);
    expect(res.body.archiviertAm).toBeNull();
    expect(res.body.archivPdfs).toHaveLength(1);

    const tagesbericht = await als(tokenBereichsleitung).post("/tagesberichte", {
      klientId,
      datum: "2026-01-02",
      text: "jetzt wieder moeglich",
    });
    expect(tagesbericht.status).toBe(201);

    // Gegenprobe fuer die Testaussage selbst: wieder in der Standardliste.
    const standard = await als(tokenBereichsleitung).get("/klienten");
    expect(standard.body.map((k: { id: string }) => k.id)).toContain(klientId);
  });

  it("Mandantentrennung: ein fremder Mandant sieht den Klienten nicht und kann ihn nicht archivieren", async () => {
    const suffix = randomUUID().slice(0, 8);
    const fremdSlug = `test-klientarchiv-fremd-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows: fremdMandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Fremd ${suffix}`, fremdSlug]
    );
    const fremdMandantId = fremdMandantRows[0].id;
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Fremde Leitung', $3, 'bereichsleitung')`,
      [fremdMandantId, `fremd-${suffix}@beispiel.test`, passwortHash]
    );
    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: fremdSlug, email: `fremd-${suffix}@beispiel.test`, passwort });
    const tokenFremd = loginRes.body.accessToken as string;

    try {
      const zugriff = await als(tokenFremd).get(`/klienten/${klientId}`);
      expect(zugriff.status).toBe(404);

      const archivierenVersuch = await als(tokenFremd).patch(`/klienten/${klientId}/archivieren`);
      expect(archivierenVersuch.status).toBe(404);
    } finally {
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [fremdMandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [fremdMandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [fremdMandantId]);
    }
  });
});
