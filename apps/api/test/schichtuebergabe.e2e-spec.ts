/**
 * Schichtuebergabe (Migration 0060): Mandanten- und Standorttrennung,
 * Unveraenderlichkeit nach dem Senden, Lesebestaetigung je Person, Nachtrag
 * als neuer Punkt und Aufgabe aus einem Punkt.
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

describe("Schichtuebergabe", () => {
  let app: INestApplication;
  let admin: Client;
  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const mandanten: string[] = [];

  let slugA: string;
  let slugB: string;
  let mandantA: string;
  let mandantB: string;
  let s1: string;
  let s2: string;
  let zimmer1: string;
  let zimmer2: string;
  let k1: string;
  let k2: string;
  let bAutor: string;
  let t: Record<"leitung" | "s1" | "s2" | "s1b" | "ohne" | "fremd", string> = {} as never;

  const als = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: unknown = {}) => request(app.getHttpServer()).post(p).set("Authorization", `Bearer ${token}`).send(body as object),
  });

  async function standortMitKlient(mandantId: string, name: string, zimmerNr: string, nachname: string) {
    const st = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Str. 1') RETURNING id", [mandantId, name])).rows[0].id;
    const z = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id", [mandantId, st, zimmerNr])).rows[0].id;
    const k = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, 'Test', $2, '1990-01-01', $3, 'Amt') RETURNING id`,
        [mandantId, nachname, `AZ-${randomUUID().slice(0, 6)}`]
      )
    ).rows[0].id;
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z, k]);
    return { st, z, k };
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);
    slugA = `test-uebergabe-${suffix}`;
    slugB = `test-uebergabe-b-${suffix}`;
    mandantA = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Uebergabe A ${suffix}`, slugA])).rows[0].id;
    mandantB = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Uebergabe B ${suffix}`, slugB])).rows[0].id;
    mandanten.push(mandantA, mandantB);

    await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "bereichsleitung", email: `leitung-${suffix}@u.test`, name: "Leitung", passwortHash: hash });
    const s1Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: `s1-${suffix}@u.test`, name: "Eins Autor", passwortHash: hash });
    const s1bId = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: `s1b-${suffix}@u.test`, name: "Eins Leser", passwortHash: hash });
    const s2Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: `s2-${suffix}@u.test`, name: "Zwei", passwortHash: hash });
    await admin.query("INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Ohne Recht', $3)", [mandantA, `ohne-${suffix}@u.test`, hash]);
    bAutor = await kontoMitAlterRolle(admin, { mandantId: mandantB, rolle: "bereichsleitung", email: `fremd-${suffix}@u.test`, name: "Fremd", passwortHash: hash });

    const a1 = await standortMitKlient(mandantA, "Haus Eins", "101", "Eins");
    const a2 = await standortMitKlient(mandantA, "Haus Zwei", "201", "Zwei");
    s1 = a1.st; s2 = a2.st; zimmer1 = a1.z; zimmer2 = a2.z; k1 = a1.k; k2 = a2.k;
    for (const [b, st] of [[s1Id, s1], [s1bId, s1], [s2Id, s2]] as const) {
      await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantA, b, st]);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (slug: string, kurz: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@u.test`, passwort })).body.accessToken;
    t = {
      leitung: await login(slugA, "leitung"),
      s1: await login(slugA, "s1"),
      s1b: await login(slugA, "s1b"),
      s2: await login(slugA, "s2"),
      ohne: await login(slugA, "ohne"),
      fremd: await login(slugB, "fremd"),
    };
  });

  afterAll(async () => {
    try {
      for (const m of mandanten) {
        await raeumeKontoMitRolleAuf(admin, m);
        await admin.query("DELETE FROM aufgabe WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM schichtuebergabe_gelesen WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM schichtuebergabe_punkt WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM schichtuebergabe WHERE mandant_id = $1", [m]);
        for (const tab of ["audit_log", "belegung", "benutzer_standort", "klient", "zimmer", "standort", "benutzer", "kassenbuchung_typ", "org_unit"])
          await admin.query(`DELETE FROM ${tab} WHERE mandant_id = $1`, [m]).catch(() => undefined);
        await admin.query("DELETE FROM kassenbuch_nummernkreis WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m]).catch(() => undefined);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  let uebergabeId: string;
  let punktMitKlient: string;
  let punktOhneBezug: string;

  it("senden: Punkte mit Klient:in und Zimmer entstehen zusammen, in Reihenfolge", async () => {
    const res = await als(t.s1).post("/schichtuebergaben", {
      standortId: s1,
      dienst: "spaet",
      punkte: [{ text: "Frau Eins hat nicht gegessen", klientId: k1 }, { text: "Heizung Zimmer 101 tropft", zimmerId: zimmer1 }, { text: "Allgemeiner Hinweis" }],
    });
    expect(res.status).toBe(201);
    uebergabeId = res.body.id;
    expect(res.body.dienst).toBe("spaet");
    expect(res.body.punkte.map((p: { position: number }) => p.position)).toEqual([1, 2, 3]);
    punktMitKlient = res.body.punkte[0].id;
    punktOhneBezug = res.body.punkte[2].id;
    expect(res.body.punkte[0].klientId).toBe(k1);
    expect(res.body.punkte[1].zimmerNummer).toBe("101");
  });

  it("falsche Bezuege: anderer Standort, fremde Klient:in, Zimmer eines anderen Standorts -> 404; ohne Punkte -> 400", async () => {
    expect((await als(t.s1).post("/schichtuebergaben", { standortId: s2, dienst: "frueh", punkte: [{ text: "x" }] })).status).toBe(404);
    expect((await als(t.s1).post("/schichtuebergaben", { standortId: s1, dienst: "frueh", punkte: [{ text: "x", klientId: k2 }] })).status).toBe(404);
    expect((await als(t.s1).post("/schichtuebergaben", { standortId: s1, dienst: "frueh", punkte: [{ text: "x", zimmerId: zimmer2 }] })).status).toBe(404);
    expect((await als(t.s1).post("/schichtuebergaben", { standortId: s1, dienst: "frueh", punkte: [] })).status).toBe(400);
    expect((await als(t.s1).post("/schichtuebergaben", { standortId: s1, dienst: "mittag", punkte: [{ text: "x" }] })).status).toBe(400);
  });

  it("ohne Recht: weder schreiben noch lesen", async () => {
    expect((await als(t.ohne).post("/schichtuebergaben", { standortId: s1, dienst: "frueh", punkte: [{ text: "x" }] })).status).toBe(403);
    expect((await als(t.ohne).get("/schichtuebergaben")).status).toBe(403);
    expect((await als(t.ohne).get("/schichtuebergaben/ungelesen")).status).toBe(403);
  });

  it("Mandantentrennung: ein fremder Mandant sieht und quittiert nichts", async () => {
    expect((await als(t.fremd).get("/schichtuebergaben")).body).toEqual([]);
    expect((await als(t.fremd).get("/schichtuebergaben/ungelesen")).body).toEqual([]);
    expect((await als(t.fremd).post(`/schichtuebergaben/${uebergabeId}/gelesen`)).status).toBe(404);
    expect((await als(t.fremd).post(`/schichtuebergaben/${uebergabeId}/nachtraege`, { text: "x" })).status).toBe(404);
    expect((await als(t.fremd).post(`/schichtuebergaben/punkte/${punktMitKlient}/aufgabe`)).status).toBe(404);
    void bAutor;
  });

  it("Standorttrennung: Standort 2 sieht die Uebergabe von Standort 1 nicht, Leitung ohne Beschraenkung schon", async () => {
    expect((await als(t.s2).get("/schichtuebergaben")).body).toEqual([]);
    expect((await als(t.s2).get("/schichtuebergaben/ungelesen")).body).toEqual([]);
    expect((await als(t.s2).post(`/schichtuebergaben/${uebergabeId}/gelesen`)).status).toBe(404);
    expect((await als(t.s2).post(`/schichtuebergaben/punkte/${punktMitKlient}/aufgabe`)).status).toBe(404);
    const leitung = await als(t.leitung).get("/schichtuebergaben");
    expect(leitung.body.map((u: { id: string }) => u.id)).toContain(uebergabeId);
  });

  it("Lesebestaetigung: Autor:in sieht die eigene nicht als ungelesen, Kolleg:in schon -- nach 'Gelesen' nicht mehr, doppelt ist harmlos", async () => {
    expect((await als(t.s1).get("/schichtuebergaben/ungelesen")).body).toEqual([]);
    const offen = await als(t.s1b).get("/schichtuebergaben/ungelesen");
    expect(offen.body.map((u: { id: string }) => u.id)).toEqual([uebergabeId]);
    expect(offen.body[0].gelesen).toBe(false);

    expect((await als(t.s1b).post(`/schichtuebergaben/${uebergabeId}/gelesen`)).status).toBe(200);
    expect((await als(t.s1b).post(`/schichtuebergaben/${uebergabeId}/gelesen`)).status).toBe(200);
    expect((await als(t.s1b).get("/schichtuebergaben/ungelesen")).body).toEqual([]);
    const zeilen = await admin.query("SELECT benutzer_id FROM schichtuebergabe_gelesen WHERE uebergabe_id = $1", [uebergabeId]);
    expect(zeilen.rows).toHaveLength(1);
    // Die Quittung gilt je Person: die Leitung sieht sie weiterhin als ungelesen.
    expect((await als(t.leitung).get("/schichtuebergaben/ungelesen")).body.map((u: { id: string }) => u.id)).toEqual([uebergabeId]);
    const liste = await als(t.s1b).get("/schichtuebergaben");
    expect(liste.body[0]).toMatchObject({ gelesen: true, gelesenAnzahl: 1 });
  });

  it("niemand quittiert fuer andere und die Datenbank laesst weder UPDATE noch DELETE zu", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    const kontext = async (benutzer: string) => {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true), set_config('app.benutzer_id', $2, true), set_config('app.klient_id', '', true)", [mandantA, benutzer]);
    };
    try {
      const fremderBenutzer = (await admin.query("SELECT id FROM benutzer WHERE mandant_id = $1 AND email = $2", [mandantA, `s2-${suffix}@u.test`])).rows[0].id;
      const ich = (await admin.query("SELECT id FROM benutzer WHERE mandant_id = $1 AND email = $2", [mandantA, `s1-${suffix}@u.test`])).rows[0].id;
      await kontext(ich);
      await expect(
        app_.query("INSERT INTO schichtuebergabe_gelesen (uebergabe_id, benutzer_id, mandant_id) VALUES ($1, $2, $3)", [uebergabeId, fremderBenutzer, mandantA])
      ).rejects.toThrow(/row-level security/);
      await app_.query("ROLLBACK");
      for (const sql of [
        "UPDATE schichtuebergabe SET dienst = 'nacht'",
        "DELETE FROM schichtuebergabe",
        "UPDATE schichtuebergabe_punkt SET text = 'umgeschrieben'",
        "DELETE FROM schichtuebergabe_punkt",
        "UPDATE schichtuebergabe_gelesen SET gelesen_am = now()",
        "DELETE FROM schichtuebergabe_gelesen",
      ]) {
        await kontext(ich);
        await expect(app_.query(sql)).rejects.toThrow(/permission denied/);
        await app_.query("ROLLBACK");
      }
    } finally {
      await app_.end();
    }
    const text = (await admin.query("SELECT text FROM schichtuebergabe_punkt WHERE id = $1", [punktMitKlient])).rows[0].text;
    expect(text).toBe("Frau Eins hat nicht gegessen");
  });

  it("Nachtrag ist ein neuer Punkt -- die urspruenglichen bleiben unveraendert", async () => {
    const vorher = (await als(t.s1).get("/schichtuebergaben")).body[0].punkte;
    const res = await als(t.s1b).post(`/schichtuebergaben/${uebergabeId}/nachtraege`, { text: "Arzt informiert", klientId: k1 });
    expect(res.status).toBe(201);
    const punkte = res.body.punkte;
    expect(punkte).toHaveLength(vorher.length + 1);
    expect(punkte[punkte.length - 1]).toMatchObject({ nachtrag: true, text: "Arzt informiert", position: vorher.length + 1 });
    expect(punkte.slice(0, vorher.length).map((p: { text: string; nachtrag: boolean }) => [p.text, p.nachtrag])).toEqual(
      vorher.map((p: { text: string; nachtrag: boolean }) => [p.text, p.nachtrag])
    );
  });

  it("Aufgabe aus Punkt: bringt Klient:in und deren Zimmer mit, bleibt am Punkt sichtbar, nur einmal", async () => {
    const res = await als(t.s1).post(`/schichtuebergaben/punkte/${punktMitKlient}/aufgabe`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ klientId: k1, zimmerId: zimmer1, uebergabePunktId: punktMitKlient, zugewiesenAn: null });
    expect((await als(t.s1).post(`/schichtuebergaben/punkte/${punktMitKlient}/aufgabe`)).status).toBe(409);
    const liste = await als(t.s1).get("/schichtuebergaben");
    const punkt = liste.body[0].punkte.find((p: { id: string }) => p.id === punktMitKlient);
    expect(punkt.aufgaben).toEqual([{ id: res.body.id, titel: "Frau Eins hat nicht gegessen", erledigt: false }]);
  });

  it("Aufgabe aus Punkt ohne Zimmer und Klient:in wird der anlegenden Person zugewiesen (sonst waere sie unsichtbar)", async () => {
    const res = await als(t.s1b).post(`/schichtuebergaben/punkte/${punktOhneBezug}/aufgabe`);
    expect(res.status).toBe(201);
    expect(res.body.zimmerId).toBeNull();
    expect(res.body.zugewiesenAn).not.toBeNull();
    expect(res.body.zugewiesenAnName).toBe("Eins Leser");
  });
});
