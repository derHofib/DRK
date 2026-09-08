/**
 * Aufgaben (Migration 0033): ein einheitliches Modell fuer Zimmer-Aufgaben
 * und persoenliche Aufgaben. Drei Sichtbarkeitsebenen werden hier geprueft:
 * 1. Mandant -- RLS wie ueberall.
 * 2. Standort -- Zimmer-Aufgaben erben die benutzer_standort-Einschraenkung,
 *    durchgesetzt im Service (aufgabe.service.ts), nicht per RLS (siehe
 *    Kommentar in 0033_aufgabe.sql und common/standort-restriction.ts).
 * 3. Person -- persoenliche Aufgaben (zimmer_id NULL) sind ausschliesslich
 *    fuer erstellt_von/zugewiesen_an sichtbar, per RLS-Policy durchgesetzt
 *    (app.benutzer_id steht in DatabaseService.withTenant() zur Verfuegung).
 *
 * Dazu: doppeltes Erledigen -> 409 mit serverseitig gesetztem erledigt_von,
 * Cross-Tenant-Zugriff ueber den echten HTTP-Pfad.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Aufgaben: Zimmer-Aufgaben, persönliche Aufgaben, Sichtbarkeit", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantBId: string;

  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBetreuerS1: string;
  let tokenBetreuerS2: string;
  let tokenBereichsleitungB: string;

  let benutzerIdBetreuerS1: string;
  let benutzerIdBetreuerS2: string;

  let standort1Id: string;
  let standort2Id: string;
  let zimmer1Id: string;
  let zimmer2Id: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Aufgaben ${suffix}`, `test-aufgaben-${suffix}`]
    );
    mandantId = mandantRows[0].id;

    const { rows: mandantBRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Aufgaben B ${suffix}`, `test-aufgaben-b-${suffix}`]
    );
    mandantBId = mandantBRows[0].id;

    async function neuerBenutzer(mId: string, rolle: string, emailPrefix: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mId, `${emailPrefix}-${suffix}@beispiel.test`, `${emailPrefix} Test`, passwortHash, rolle]
      );
      return rows[0].id;
    }

    await neuerBenutzer(mandantId, "bereichsleitung", "bereichsleitung");
    const einrichtungsleitungS1Id = await neuerBenutzer(mandantId, "einrichtungsleitung", "einrichtungsleitung-s1");
    benutzerIdBetreuerS1 = await neuerBenutzer(mandantId, "betreuer", "betreuer-s1");
    benutzerIdBetreuerS2 = await neuerBenutzer(mandantId, "betreuer", "betreuer-s2");
    await neuerBenutzer(mandantBId, "bereichsleitung", "bereichsleitung-b");

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    standort1Id = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    standort2Id = standort2Rows[0].id;

    const { rows: zimmer1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standort1Id]
    );
    zimmer1Id = zimmer1Rows[0].id;
    const { rows: zimmer2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, standort2Id]
    );
    zimmer2Id = zimmer2Rows[0].id;

    await admin.query(
      `INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
      [mandantId, einrichtungsleitungS1Id, standort1Id, benutzerIdBetreuerS1]
    );
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId,
      benutzerIdBetreuerS2,
      standort2Id,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(mSlug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug: mSlug, email, passwort });
      return res.body.accessToken;
    }
    tokenBereichsleitung = await login(`test-aufgaben-${suffix}`, `bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(
      `test-aufgaben-${suffix}`,
      `einrichtungsleitung-s1-${suffix}@beispiel.test`
    );
    tokenBetreuerS1 = await login(`test-aufgaben-${suffix}`, `betreuer-s1-${suffix}@beispiel.test`);
    tokenBetreuerS2 = await login(`test-aufgaben-${suffix}`, `betreuer-s2-${suffix}@beispiel.test`);
    tokenBereichsleitungB = await login(`test-aufgaben-b-${suffix}`, `bereichsleitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM aufgabe WHERE mandant_id IN ($1, $2)", [mandantId, mandantBId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id IN ($1, $2)", [mandantId, mandantBId]);
    await admin.query("DELETE FROM mandant WHERE id IN ($1, $2)", [mandantId, mandantBId]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      post: (path: string, body: Record<string, unknown> = {}) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown> = {}) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      delete: (path: string) => request(http).delete(path).set("Authorization", `Bearer ${token}`),
    };
  }

  describe("Vier Kombinationen: Zimmer/Zuweisung je gesetzt oder leer", () => {
    it("Zimmer-Aufgabe MIT Zuweisung", async () => {
      const res = await als(tokenBereichsleitung).post("/aufgaben", {
        titel: "Fenstergriff defekt",
        zimmerId: zimmer1Id,
        zugewiesenAn: benutzerIdBetreuerS1,
      });
      expect(res.status).toBe(201);
      expect(res.body.zimmerId).toBe(zimmer1Id);
      expect(res.body.zugewiesenAn).toBe(benutzerIdBetreuerS1);

      const liste = await als(tokenBereichsleitung).get("/aufgaben");
      expect(liste.body.some((a: { id: string }) => a.id === res.body.id)).toBe(true);
    });

    it("Zimmer-Aufgabe OHNE Zuweisung -- offener Posten, kein Fehlerzustand", async () => {
      const res = await als(tokenBereichsleitung).post("/aufgaben", {
        titel: "Endreinigung vor Einzug",
        zimmerId: zimmer1Id,
      });
      expect(res.status).toBe(201);
      expect(res.body.zimmerId).toBe(zimmer1Id);
      expect(res.body.zugewiesenAn).toBeNull();
    });

    it("persönliche Aufgabe MIT Zuweisung an eine andere Person", async () => {
      const res = await als(tokenBetreuerS1).post("/aufgaben", {
        titel: "Bitte Übergabe für Frau K. vorbereiten",
        zugewiesenAn: benutzerIdBetreuerS2,
      });
      expect(res.status).toBe(201);
      expect(res.body.zimmerId).toBeNull();
      expect(res.body.zugewiesenAn).toBe(benutzerIdBetreuerS2);

      // Beide Seiten der Zuweisung sehen sie -- Ersteller UND Zugewiesene:r.
      const alsErsteller = await als(tokenBetreuerS1).get("/aufgaben");
      expect(alsErsteller.body.some((a: { id: string }) => a.id === res.body.id)).toBe(true);
      const alsZugewiesen = await als(tokenBetreuerS2).get("/aufgaben");
      expect(alsZugewiesen.body.some((a: { id: string }) => a.id === res.body.id)).toBe(true);
    });

    it("persönliche Aufgabe OHNE Zuweisung -- reiner privater Merkzettel", async () => {
      const res = await als(tokenBetreuerS1).post("/aufgaben", { titel: "Fortbildung anmelden" });
      expect(res.status).toBe(201);
      expect(res.body.zimmerId).toBeNull();
      expect(res.body.zugewiesenAn).toBeNull();

      const liste = await als(tokenBetreuerS1).get("/aufgaben");
      expect(liste.body.some((a: { id: string }) => a.id === res.body.id)).toBe(true);
    });
  });

  describe("Sichtbarkeitsebene 3: Person", () => {
    it("persönliche Aufgabe ist für einen zweiten Benutzer desselben Mandanten unsichtbar -- auch für eine Leitungsrolle", async () => {
      const angelegt = await als(tokenBetreuerS1).post("/aufgaben", { titel: "Streng privat, niemanden zugewiesen" });
      expect(angelegt.status).toBe(201);
      const aufgabeId = angelegt.body.id;

      const alsKollege = await als(tokenBetreuerS2).get("/aufgaben");
      expect(alsKollege.body.some((a: { id: string }) => a.id === aufgabeId)).toBe(false);

      const alsLeitung = await als(tokenBereichsleitung).get("/aufgaben");
      expect(alsLeitung.body.some((a: { id: string }) => a.id === aufgabeId)).toBe(false);

      // Auch der direkte Schreibpfad ist versperrt, nicht nur die Liste.
      const patchVersuch = await als(tokenBereichsleitung).patch(`/aufgaben/${aufgabeId}`, { titel: "Umbenannt" });
      expect(patchVersuch.status).toBe(404);
    });
  });

  describe("Sichtbarkeitsebene 2: Standort", () => {
    it("Benutzer mit benutzer_standort-Einschränkung sieht keine Aufgabe eines fremden Standorts", async () => {
      const angelegt = await als(tokenBereichsleitung).post("/aufgaben", {
        titel: "Heizkörper Standort 2 prüfen",
        zimmerId: zimmer2Id,
      });
      expect(angelegt.status).toBe(201);
      const aufgabeId = angelegt.body.id;

      const alsS1Betreuer = await als(tokenBetreuerS1).get("/aufgaben");
      expect(alsS1Betreuer.body.some((a: { id: string }) => a.id === aufgabeId)).toBe(false);
      const alsS1Einrichtungsleitung = await als(tokenEinrichtungsleitungS1).get("/aufgaben");
      expect(alsS1Einrichtungsleitung.body.some((a: { id: string }) => a.id === aufgabeId)).toBe(false);

      const alsS2Betreuer = await als(tokenBetreuerS2).get("/aufgaben");
      expect(alsS2Betreuer.body.some((a: { id: string }) => a.id === aufgabeId)).toBe(true);

      const erledigenVersuch = await als(tokenBetreuerS1).patch(`/aufgaben/${aufgabeId}/erledigen`);
      expect(erledigenVersuch.status).toBe(404);
    });

    it("Zählendpunkt für Badges zählt offene Zimmer-Aufgaben je Zimmer standort-eingeschränkt", async () => {
      const anzahl = await als(tokenBetreuerS1).get("/aufgaben/anzahl-offen");
      expect(anzahl.status).toBe(200);
      expect(anzahl.body.jeZimmer[zimmer1Id]).toBeGreaterThan(0);
      expect(anzahl.body.jeZimmer[zimmer2Id]).toBeUndefined();
    });
  });

  describe("Cross-Tenant", () => {
    it("Cross-Tenant-Zugriff über den echten HTTP-Pfad schlägt fehl", async () => {
      const angelegt = await als(tokenBereichsleitung).post("/aufgaben", { titel: "Mandant A Aufgabe" });
      expect(angelegt.status).toBe(201);

      const fremderZugriff = await als(tokenBereichsleitungB).patch(`/aufgaben/${angelegt.body.id}/erledigen`);
      expect(fremderZugriff.status).toBe(404);

      const fremdeListe = await als(tokenBereichsleitungB).get("/aufgaben");
      expect(fremdeListe.body.some((a: { id: string }) => a.id === angelegt.body.id)).toBe(false);
    });
  });

  describe("Erledigen: Idempotenz und serverseitig gesetzte Felder", () => {
    it("doppeltes Erledigen -> 409, erledigt_von wird serverseitig gesetzt und ignoriert einen manipulierten Body", async () => {
      const angelegt = await als(tokenBetreuerS1).post("/aufgaben", { titel: "Einmal erledigen" });
      const aufgabeId = angelegt.body.id;

      // Body enthaelt einen Versuch, eine andere Person als Erlediger
      // unterzuschieben -- der Controller liest fuer diesen Endpunkt gar
      // keinen Body, der Versuch darf also folgenlos bleiben.
      const ersterVersuch = await als(tokenBetreuerS1).patch(`/aufgaben/${aufgabeId}/erledigen`, {
        erledigtVon: benutzerIdBetreuerS2,
      });
      expect(ersterVersuch.status).toBe(200);
      expect(ersterVersuch.body.erledigtAm).not.toBeNull();
      expect(ersterVersuch.body.erledigtVonName).toBe("betreuer-s1 Test");

      const zweiterVersuch = await als(tokenBetreuerS1).patch(`/aufgaben/${aufgabeId}/erledigen`);
      expect(zweiterVersuch.status).toBe(409);
    });

    it("nur Ersteller:in, zugewiesene Person oder Leitung dürfen erledigen", async () => {
      const angelegt = await als(tokenBetreuerS1).post("/aufgaben", {
        titel: "Fremde Zimmer-Aufgabe",
        zimmerId: zimmer1Id,
      });
      const versuch = await als(tokenEinrichtungsleitungS1).patch(`/aufgaben/${angelegt.body.id}/erledigen`);
      // Einrichtungsleitung darf koordinieren (ROLLEN_MIT_AUFGABEN_KOORDINATION).
      expect(versuch.status).toBe(200);
    });
  });

  describe("Selbstzuweisung: Ausnahme von der Schreibsperre", () => {
    it("wer eine sichtbare Zimmer-Aufgabe ohne Zuweisung sieht, darf sie sich selbst zuweisen", async () => {
      const angelegt = await als(tokenBereichsleitung).post("/aufgaben", {
        titel: "Offener Posten für Standort 1",
        zimmerId: zimmer1Id,
      });
      const zuweisung = await als(tokenBetreuerS1).patch(`/aufgaben/${angelegt.body.id}`, {
        zugewiesenAn: benutzerIdBetreuerS1,
      });
      expect(zuweisung.status).toBe(200);
      expect(zuweisung.body.zugewiesenAn).toBe(benutzerIdBetreuerS1);
    });

    it("ein Betreuer darf keine fremde Zimmer-Aufgabe einer anderen Person zuweisen", async () => {
      const angelegt = await als(tokenBereichsleitung).post("/aufgaben", {
        titel: "Noch ein offener Posten",
        zimmerId: zimmer1Id,
      });
      const versuch = await als(tokenBetreuerS1).patch(`/aufgaben/${angelegt.body.id}`, {
        zugewiesenAn: benutzerIdBetreuerS2,
      });
      expect(versuch.status).toBe(403);
    });
  });

  describe("CHECK-Constraint: erledigt_am und erledigt_von nur gemeinsam", () => {
    it("greift auch bei einem direkten INSERT ohne den Service (z.B. bei einem künftigen Datenimport)", async () => {
      const versuchNurErledigtAm = admin.query(
        `INSERT INTO aufgabe (mandant_id, titel, erstellt_von, erledigt_am)
         VALUES ($1, 'CHECK-Test', $2, now())`,
        [mandantId, benutzerIdBetreuerS1]
      );
      await expect(versuchNurErledigtAm).rejects.toThrow(/check/i);

      const versuchNurErledigtVon = admin.query(
        `INSERT INTO aufgabe (mandant_id, titel, erstellt_von, erledigt_von)
         VALUES ($1, 'CHECK-Test', $2, $2)`,
        [mandantId, benutzerIdBetreuerS1]
      );
      await expect(versuchNurErledigtVon).rejects.toThrow(/check/i);
    });
  });

  /**
   * Chaos-Test-Fund: z.string().min(1) allein akzeptiert reines
   * Leerzeichen-Padding ("   ") als "nicht leer" -- dadurch liessen sich
   * fachlich leere Aufgaben anlegen. .trim() VOR .min(1) im Schema schliesst
   * das (aufgabe.controller.ts).
   */
  describe("Leerzeichen-Validierung: .trim() vor .min(1)", () => {
    it("lehnt einen rein aus Leerzeichen bestehenden Titel beim Anlegen mit 400 ab", async () => {
      const res = await als(tokenBereichsleitung).post("/aufgaben", { titel: "     " });
      expect(res.status).toBe(400);
    });

    it("lehnt eine rein aus Leerzeichen bestehende Beschreibung beim Anlegen mit 400 ab", async () => {
      const res = await als(tokenBereichsleitung).post("/aufgaben", {
        titel: "Gültiger Titel",
        beschreibung: "   ",
      });
      expect(res.status).toBe(400);
    });

    it("lehnt einen rein aus Leerzeichen bestehenden Titel beim Aktualisieren mit 400 ab", async () => {
      const angelegt = await als(tokenBereichsleitung).post("/aufgaben", { titel: "Wird aktualisiert" });
      expect(angelegt.status).toBe(201);

      const res = await als(tokenBereichsleitung).patch(`/aufgaben/${angelegt.body.id}`, { titel: "   " });
      expect(res.status).toBe(400);

      const geladen = await als(tokenBereichsleitung).get("/aufgaben");
      const unveraendert = geladen.body.find((a: { id: string }) => a.id === angelegt.body.id);
      expect(unveraendert.titel).toBe("Wird aktualisiert");
    });

    it("speichert einen Titel mit fuehrenden/nachfolgenden Leerzeichen getrimmt", async () => {
      const res = await als(tokenBereichsleitung).post("/aufgaben", { titel: "  Umlaufende Leerzeichen  " });
      expect(res.status).toBe(201);
      expect(res.body.titel).toBe("Umlaufende Leerzeichen");
    });
  });
});
