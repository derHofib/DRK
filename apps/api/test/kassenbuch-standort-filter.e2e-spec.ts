/**
 * GET /kassenbuchungen: Sichtbarkeit nach Standort-Zuordnung und der
 * ?standortId=-Filter. Aufbau: zwei Standorte S1/S2, je ein Klient, der dort
 * wohnt (K1/K2), je eine Klienten-Buchung und eine Standort-Buchung.
 *  - Leitung (keine Zuordnung) sieht alles und kann auf jeden Standort filtern.
 *  - Mitarbeiter:in, zugeordnet zu S1, sieht auch OHNE Filter nur S1 -- und
 *    ein Filter auf S2 ist ein 404, nicht "leer" (kein stilles Nachfragen
 *    nach fremden Standorten).
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

describe("Kassenbuch: Standort-Sichtbarkeit und Standort-Filter", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";

  let s1: string;
  let s2: string;
  let tokenLeitung: string;
  let tokenS1: string;
  const buchungen: Record<"k1" | "k2" | "sb1" | "sb2", string> = { k1: "", k2: "", sb1: "", sb2: "" };

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-kb-filter-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
      `Testmandant KB-Filter ${suffix}`,
      mandantSlug,
    ]);
    mandantId = rows[0].id;

    await kontoMitAlterRolle(admin, {
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
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
           VALUES ($1, 'Test', $2, '1990-01-01', $3, 'Amt', 'monatlich') RETURNING id`,
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken;
    tokenLeitung = await login(`leitung-${suffix}@beispiel.test`);
    tokenS1 = await login(`ma-s1-${suffix}@beispiel.test`);

    const { rows: typ } = await admin.query<{ id: string }>(
      "SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND NOT ist_hzl AND aktiv LIMIT 1",
      [mandantId]
    );
    const buche = async (key: keyof typeof buchungen, ziel: Record<string, string>) => {
      const res = await request(app.getHttpServer())
        .post("/kassenbuchungen")
        .set("Authorization", `Bearer ${tokenLeitung}`)
        .send({ datum: "2026-08-01", betragCent: 100, typId: typ[0].id, verwendungszweck: key, ...ziel });
      expect(res.status).toBe(201);
      buchungen[key] = res.body.id;
    };
    await buche("k1", { klientId: k1 });
    await buche("k2", { klientId: k2 });
    await buche("sb1", { standortId: s1 });
    await buche("sb2", { standortId: s2 });
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

  const liste = (token: string, query = "") =>
    request(app.getHttpServer()).get(`/kassenbuchungen${query}`).set("Authorization", `Bearer ${token}`);
  const ids = (res: request.Response) => (res.body as { id: string }[]).map((b) => b.id).sort();
  const erwartet = (...keys: (keyof typeof buchungen)[]) => keys.map((k) => buchungen[k]).sort();

  it("Leitung ohne Zuordnung sieht alle Standorte", async () => {
    const res = await liste(tokenLeitung);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(erwartet("k1", "k2", "sb1", "sb2"));
  });

  it("Leitung: Filter auf einen Standort liefert dessen Klienten- UND Standort-Buchungen", async () => {
    expect(ids(await liste(tokenLeitung, `?standortId=${s1}`))).toEqual(erwartet("k1", "sb1"));
    expect(ids(await liste(tokenLeitung, `?standortId=${s2}`))).toEqual(erwartet("k2", "sb2"));
  });

  it("Mitarbeiter:in mit Zuordnung zu S1 sieht auch OHNE Filter nur S1", async () => {
    const res = await liste(tokenS1);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(erwartet("k1", "sb1"));
  });

  it("Filter auf den EIGENEN Standort funktioniert, auf einen fremden ist 404", async () => {
    expect(ids(await liste(tokenS1, `?standortId=${s1}`))).toEqual(erwartet("k1", "sb1"));
    const fremd = await liste(tokenS1, `?standortId=${s2}`);
    expect(fremd.status).toBe(404);
  });

  it("ungueltige standortId -> 400", async () => {
    expect((await liste(tokenLeitung, "?standortId=kein-uuid")).status).toBe(400);
  });
});
