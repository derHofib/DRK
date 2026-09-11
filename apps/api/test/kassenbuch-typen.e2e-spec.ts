/**
 * Kassenbuch-Typen (klientenwunsch: eigene Typen statt der bisherigen
 * festen Dreier-Auswahl HZL/Einzahlung/Sonstiges, siehe
 * migrations/0035_kassenbuchung_typ.sql). Kernaussagen:
 *
 * 1. Ein neu angelegter Mandant bekommt automatisch die drei Standard-
 *    Typen (Trigger mandant_kassenbuchung_typ_standard) -- ohne das koennte
 *    er ueberhaupt keine Kassenbuchung anlegen.
 * 2. Nur Bereichs-/Einrichtungsleitung duerfen Typen verwalten.
 * 3. "kommentarPflicht" steuert, ob eine Buchung dieses Typs einen
 *    Verwendungszweck braucht -- unabhaengig fuer jeden Typ.
 * 4. Der HZL-Systemtyp ist weder umbenennbar noch deaktivierbar.
 * 5. Die Typenliste ist mandantenscoped wie jede andere Tabelle.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Kassenbuch-Typen: Verwaltung, Rollen-Gate, Pflicht-Verhalten", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenBetreuer: string;
  let klientId: string;
  let hzlTypId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-kassenbuchtyp-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Kassenbuchtyp ${suffix}`, mandantSlug]
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
       VALUES ($1, 'Test', 'Klient', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-KBT-${suffix}`]
    );
    klientId = klientRows[0].id;

    const { rows: hzlRows } = await admin.query<{ id: string }>(
      "SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND bezeichnung = 'HZL'",
      [mandantId]
    );
    hzlTypId = hzlRows[0].id;

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
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
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

  it("legt einem frisch angelegten Mandanten automatisch die drei Standardtypen an", async () => {
    const res = await als(tokenBereichsleitung).get("/kassenbuchungstypen");
    expect(res.status).toBe(200);
    const bezeichnungen = res.body.map((t: { bezeichnung: string }) => t.bezeichnung).sort();
    expect(bezeichnungen).toEqual(["Einzahlung", "HZL", "Sonstiges"]);

    const hzl = res.body.find((t: { bezeichnung: string }) => t.bezeichnung === "HZL");
    expect(hzl.istHzl).toBe(true);
    expect(hzl.kommentarPflicht).toBe(false);
    expect(hzl.aktiv).toBe(true);

    const einzahlung = res.body.find((t: { bezeichnung: string }) => t.bezeichnung === "Einzahlung");
    expect(einzahlung.istHzl).toBe(false);
    expect(einzahlung.kommentarPflicht).toBe(true);
  });

  it("erlaubt der Leitung, einen eigenen Typ mit frei gewähltem Pflicht-Verhalten anzulegen", async () => {
    const res = await als(tokenBereichsleitung).post("/kassenbuchungstypen", {
      bezeichnung: "Fahrtkosten",
      kommentarPflicht: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.bezeichnung).toBe("Fahrtkosten");
    expect(res.body.kommentarPflicht).toBe(false);
    expect(res.body.istHzl).toBe(false);
    expect(res.body.aktiv).toBe(true);
  });

  it("lehnt einen Betreuer beim Anlegen und Bearbeiten eines Typs mit 403 ab", async () => {
    const anlegen = await als(tokenBetreuer).post("/kassenbuchungstypen", {
      bezeichnung: "sollte scheitern",
      kommentarPflicht: true,
    });
    expect(anlegen.status).toBe(403);

    const bearbeiten = await als(tokenBetreuer).patch(`/kassenbuchungstypen/${hzlTypId}`, {
      bezeichnung: "sollte auch scheitern",
    });
    expect(bearbeiten.status).toBe(403);
  });

  it("lehnt einen doppelten Bezeichnung je Mandant mit 409 ab", async () => {
    const res = await als(tokenBereichsleitung).post("/kassenbuchungstypen", {
      bezeichnung: "Fahrtkosten",
      kommentarPflicht: true,
    });
    expect(res.status).toBe(409);
  });

  it("erlaubt Umbenennen, Pflicht-Umschalten und Deaktivieren eines eigenen Typs", async () => {
    const angelegt = await als(tokenBereichsleitung).post("/kassenbuchungstypen", {
      bezeichnung: "Zu ändern",
      kommentarPflicht: true,
    });
    const id = angelegt.body.id;

    const umbenannt = await als(tokenBereichsleitung).patch(`/kassenbuchungstypen/${id}`, {
      bezeichnung: "Umbenannt",
      kommentarPflicht: false,
    });
    expect(umbenannt.status).toBe(200);
    expect(umbenannt.body.bezeichnung).toBe("Umbenannt");
    expect(umbenannt.body.kommentarPflicht).toBe(false);

    const deaktiviert = await als(tokenBereichsleitung).patch(`/kassenbuchungstypen/${id}`, { aktiv: false });
    expect(deaktiviert.status).toBe(200);
    expect(deaktiviert.body.aktiv).toBe(false);

    // Weiterhin in der Liste (fuer die Verwaltungsseite), nur nicht mehr aktiv.
    const liste = await als(tokenBereichsleitung).get("/kassenbuchungstypen");
    const eintrag = liste.body.find((t: { id: string }) => t.id === id);
    expect(eintrag).toBeDefined();
    expect(eintrag.aktiv).toBe(false);
  });

  it("lehnt Bearbeiten und Deaktivieren des HZL-Systemtyps ab, auch fuer die Bereichsleitung", async () => {
    const umbenennen = await als(tokenBereichsleitung).patch(`/kassenbuchungstypen/${hzlTypId}`, {
      bezeichnung: "sollte scheitern",
    });
    expect(umbenennen.status).toBe(400);

    const deaktivieren = await als(tokenBereichsleitung).patch(`/kassenbuchungstypen/${hzlTypId}`, {
      aktiv: false,
    });
    expect(deaktivieren.status).toBe(400);

    // Gegenprobe fuer die Testaussage selbst: der Typ ist danach unveraendert.
    const liste = await als(tokenBereichsleitung).get("/kassenbuchungstypen");
    const hzl = liste.body.find((t: { id: string }) => t.id === hzlTypId);
    expect(hzl.bezeichnung).toBe("HZL");
    expect(hzl.aktiv).toBe(true);
  });

  it("erzwingt kommentarPflicht beim Anlegen einer Buchung, optional je nach Typ", async () => {
    const pflichtTyp = await als(tokenBereichsleitung).post("/kassenbuchungstypen", {
      bezeichnung: "Pflicht-Test",
      kommentarPflicht: true,
    });
    const optionalTyp = await als(tokenBereichsleitung).post("/kassenbuchungstypen", {
      bezeichnung: "Kommentar-Test",
      kommentarPflicht: false,
    });

    const ohnePflicht = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-02-01",
      betragCent: 1000,
      typId: pflichtTyp.body.id,
    });
    expect(ohnePflicht.status).toBe(400);

    const mitPflicht = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-02-01",
      betragCent: 1000,
      verwendungszweck: "Testzweck",
      typId: pflichtTyp.body.id,
    });
    expect(mitPflicht.status).toBe(201);

    const ohneKommentar = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-02-02",
      betragCent: 1000,
      typId: optionalTyp.body.id,
    });
    expect(ohneKommentar.status).toBe(201);
    expect(ohneKommentar.body.verwendungszweck).toBe("");
  });

  it("lehnt eine neue Buchung mit einem deaktivierten Typ ab", async () => {
    const typ = await als(tokenBereichsleitung).post("/kassenbuchungstypen", {
      bezeichnung: "Wird deaktiviert",
      kommentarPflicht: false,
    });
    await als(tokenBereichsleitung).patch(`/kassenbuchungstypen/${typ.body.id}`, { aktiv: false });

    const res = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-02-03",
      betragCent: 1000,
      typId: typ.body.id,
    });
    expect(res.status).toBe(400);
  });

  it("lehnt eine unbekannte typId beim Anlegen einer Buchung mit 404 ab", async () => {
    const res = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-02-04",
      betragCent: 1000,
      verwendungszweck: "Test",
      typId: randomUUID(),
    });
    expect(res.status).toBe(404);
  });

  it("Mandantentrennung: ein fremder Mandant sieht die Typen nicht und kann sie nicht bearbeiten", async () => {
    const suffix = randomUUID().slice(0, 8);
    const fremdSlug = `test-kassenbuchtyp-fremd-${suffix}`;
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
      // Eigener, vom Trigger seedeter Bestand -- nicht der des ersten Mandanten.
      const eigeneListe = await als(tokenFremd).get("/kassenbuchungstypen");
      expect(eigeneListe.body.map((t: { id: string }) => t.id)).not.toContain(hzlTypId);

      const fremdZugriff = await als(tokenFremd).patch(`/kassenbuchungstypen/${hzlTypId}`, {
        bezeichnung: "Uebernahmeversuch",
      });
      expect(fremdZugriff.status).toBe(404);
    } finally {
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [fremdMandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [fremdMandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [fremdMandantId]);
    }
  });
});
