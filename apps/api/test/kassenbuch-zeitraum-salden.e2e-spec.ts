/**
 * GET /kassenbuchungen?von=&bis= und GET /kassenbuchungen/salden.
 *
 * Seit die Kassenbuch-Seite nur noch einen Zeitraum laedt (Voreinstellung
 * letzte 30 Tage, Messung 24.11.2026), kommen Kassenstand und Anfangssaldo
 * aus /salden. Zwei Dinge muessen hier halten:
 *  - die Summen stimmen (ohne stornierte, Stichtag exklusiv),
 *  - die Summen folgen DERSELBEN Standort-Sichtbarkeit wie die Liste: eine
 *    Person mit Zuordnung zu S1 darf auch ueber eine Summe nichts ueber S2
 *    erfahren. Gegenprobe: in sichtbarkeitsBedingungen() die erste Bedingung
 *    weglassen -> "zugeordnete Person" wird rot (1250 statt 250).
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

describe("Kassenbuch: Zeitraum und Salden", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let leitungId: string;
  let s1: string;
  let s2: string;
  let tokenLeitung: string;
  let tokenS1: string;
  const passwort = "correct horse battery staple";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const mandantSlug = `test-kb-zeitraum-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    mandantId = (
      await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
        `Testmandant KB-Zeitraum ${suffix}`,
        mandantSlug,
      ])
    ).rows[0].id;
    leitungId = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email: `leitung-${suffix}@beispiel.test`,
      name: "Leitung",
      passwortHash,
    });
    const s1Mitarbeiter = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "betreuer",
      email: `ma-s1-${suffix}@beispiel.test`,
      name: "Mitarbeiter S1",
      passwortHash,
    });

    const standort = async (name: string) =>
      (
        await admin.query<{ id: string }>(
          "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Str. 1') RETURNING id",
          [mandantId, name]
        )
      ).rows[0].id;
    s1 = await standort("Standort Eins");
    s2 = await standort("Standort Zwei");
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId,
      s1Mitarbeiter,
      s1,
    ]);

    const klientAnStandort = async (nachname: string, standortId: string, az: string) => {
      const klient = (
        await admin.query<{ id: string }>(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, 'Test', $2, '1990-01-01', $3, 'Amt') RETURNING id`,
          [mandantId, nachname, az]
        )
      ).rows[0].id;
      const zimmer = (
        await admin.query<{ id: string }>(
          "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '1') RETURNING id",
          [mandantId, standortId]
        )
      ).rows[0].id;
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
        mandantId,
        zimmer,
        klient,
      ]);
      return klient;
    };
    const k1 = await klientAnStandort("EinsKlient", s1, `AZ1-${suffix}`);
    const k2 = await klientAnStandort("ZweiKlient", s2, `AZ2-${suffix}`);

    // Direkt per Admin statt ueber POST: so sind beliebige Vergangenheits-
    // daten moeglich, unabhaengig von Monatsabschluss und HZL-Regeln.
    const typId = (
      await admin.query<{ id: string }>(
        "SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND NOT ist_hzl AND aktiv LIMIT 1",
        [mandantId]
      )
    ).rows[0].id;
    const buche = async (key: string, ziel: { klientId?: string; standortId?: string }, datum: string, cent: number) => {
      ids[key] = (
        await admin.query<{ id: string }>(
          `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, gebucht_von, typ_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [mandantId, ziel.klientId ?? null, ziel.standortId ?? null, datum, cent, key, leitungId, typId]
        )
      ).rows[0].id;
    };
    await buche("k1-juli", { klientId: k1 }, "2026-07-01", 100);
    await buche("k1-aug", { klientId: k1 }, "2026-08-01", 200);
    await buche("k1-aug-aus", { klientId: k1 }, "2026-08-15", -50);
    await buche("k1-storniert", { klientId: k1 }, "2026-07-10", 9999);
    await admin.query(
      "UPDATE kassenbuchung SET storniert = true, storno_grund = 'Test', storniert_von = $2, storniert_am = now() WHERE id = $1",
      [ids["k1-storniert"], leitungId]
    );
    await buche("k2-aug", { klientId: k2 }, "2026-08-10", 1000);
    await buche("sb1-juli", { standortId: s1 }, "2026-07-15", 30);
    await buche("sb2-aug", { standortId: s2 }, "2026-08-20", 7);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken;
    tokenLeitung = await login(`leitung-${suffix}@beispiel.test`);
    tokenS1 = await login(`ma-s1-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const get = (token: string, pfad: string) =>
    request(app.getHttpServer()).get(pfad).set("Authorization", `Bearer ${token}`);
  const schluessel = (res: request.Response) =>
    (res.body as { verwendungszweck: string }[]).map((b) => b.verwendungszweck).sort();

  it("ohne Zeitraum: alle sichtbaren Buchungen wie bisher", async () => {
    const res = await get(tokenLeitung, "/kassenbuchungen");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
  });

  it("von/bis grenzen die Liste ein, beide Grenzen inklusive", async () => {
    expect(schluessel(await get(tokenLeitung, "/kassenbuchungen?von=2026-08-01"))).toEqual(
      ["k1-aug", "k1-aug-aus", "k2-aug", "sb2-aug"].sort()
    );
    expect(schluessel(await get(tokenLeitung, "/kassenbuchungen?von=2026-07-10&bis=2026-08-01"))).toEqual(
      ["k1-aug", "k1-storniert", "sb1-juli"].sort()
    );
  });

  it("Salden: gesamt und vor Stichtag, ohne stornierte, Stichtag exklusiv", async () => {
    const res = await get(tokenLeitung, "/kassenbuchungen/salden?vor=2026-08-01");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      klientGesamtCent: 100 + 200 - 50 + 1000,
      klientVorherCent: 100,
      standortGesamtCent: 37,
      standortVorherCent: 30,
      klientAnzahl: 4,
      standortAnzahl: 2,
    });
  });

  it("Salden ohne Stichtag: Vorher-Werte 0", async () => {
    const res = await get(tokenLeitung, "/kassenbuchungen/salden");
    expect(res.body.klientVorherCent).toBe(0);
    expect(res.body.klientGesamtCent).toBe(1250);
  });

  it("zugeordnete Person: Summen nur ueber den eigenen Standort", async () => {
    const res = await get(tokenS1, "/kassenbuchungen/salden?vor=2026-08-01");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      klientGesamtCent: 250,
      klientVorherCent: 100,
      standortGesamtCent: 30,
      standortVorherCent: 30,
      klientAnzahl: 3,
      standortAnzahl: 1,
    });
    expect(schluessel(await get(tokenS1, "/kassenbuchungen?von=2026-08-01"))).toEqual(["k1-aug", "k1-aug-aus"]);
  });

  it("Standortfilter auf fremden Standort bleibt 404, auch bei den Salden", async () => {
    expect((await get(tokenS1, `/kassenbuchungen/salden?standortId=${s2}`)).status).toBe(404);
    const eigen = await get(tokenS1, `/kassenbuchungen/salden?standortId=${s1}`);
    expect(eigen.body.klientGesamtCent).toBe(250);
    const leitungS2 = await get(tokenLeitung, `/kassenbuchungen/salden?standortId=${s2}`);
    expect(leitungS2.body).toMatchObject({ klientGesamtCent: 1000, standortGesamtCent: 7 });
  });

  it("ungueltige Datumsangaben -> 400 statt 500", async () => {
    expect((await get(tokenLeitung, "/kassenbuchungen?von=2026-02-31")).status).toBe(400);
    expect((await get(tokenLeitung, "/kassenbuchungen?bis=gestern")).status).toBe(400);
    expect((await get(tokenLeitung, "/kassenbuchungen/salden?vor=abc")).status).toBe(400);
    expect((await get(tokenLeitung, "/kassenbuchungen/salden?standortId=kein-uuid")).status).toBe(400);
  });
});
