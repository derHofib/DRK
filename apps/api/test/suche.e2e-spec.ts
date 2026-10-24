/**
 * Befehlspalette, Serverseite: GET /suche und POST /suche/zuletzt. Geprueft
 * wird, was NICHT herausgehen darf -- fremder Mandant, fremder Standort,
 * fehlendes Recht -- und die lueckenlose Belegnummer (Migration 0059).
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

describe("Suche (Befehlspalette)", () => {
  let app: INestApplication;
  let admin: Client;
  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const mandanten: string[] = [];

  let slugA: string;
  let mandantA: string;
  let mandantB: string;
  let standort1: string;
  let standort2: string;
  let zimmer1: string;
  let k1: string; // Standort 1
  let k2: string; // Standort 2
  let kFremd: string;
  let tokenLeitung: string;
  let tokenStandort1: string;
  let tokenOhneRecht: string;
  let buchung1: string;

  const suche = (token: string, q: string) =>
    request(app.getHttpServer()).get("/suche").query({ q }).set("Authorization", `Bearer ${token}`);
  const ids = (res: request.Response, gruppe: string): string[] => res.body[gruppe].map((t: { id: string }) => t.id);

  async function standortMitKlient(mandantId: string, name: string, zimmerNr: string, vorname: string, nachname: string) {
    const s = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Str. 1') RETURNING id", [mandantId, name])).rows[0].id;
    const z = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id", [mandantId, s, zimmerNr])).rows[0].id;
    const k = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, $2, $3, '1990-01-01', $4, 'Amt') RETURNING id`,
        [mandantId, vorname, nachname, `AZ-${randomUUID().slice(0, 6)}`]
      )
    ).rows[0].id;
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z, k]);
    return { s, z, k };
  }
  async function buchen(mandantId: string, klientId: string, zweck: string, cent: number, von: string): Promise<string> {
    const typ = (await admin.query("SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND bezeichnung = 'Einzahlung'", [mandantId])).rows[0].id;
    return (
      await admin.query(
        `INSERT INTO kassenbuchung (mandant_id, klient_id, datum, betrag_cent, verwendungszweck, typ_id, gebucht_von)
         VALUES ($1, $2, '2026-01-05', $3, $4, $5, $6) RETURNING id`,
        [mandantId, klientId, cent, zweck, typ, von]
      )
    ).rows[0].id;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);
    slugA = `test-suche-${suffix}`;
    mandantA = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Suche A ${suffix}`, slugA])).rows[0].id;
    mandantB = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Suche B ${suffix}`, `test-suche-b-${suffix}`])).rows[0].id;
    mandanten.push(mandantA, mandantB);

    const leitungId = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "bereichsleitung", email: `leitung-${suffix}@s.test`, name: "Leitung Suche", passwortHash: hash });
    const s1Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: `s1-${suffix}@s.test`, name: "Betreuer Eins", passwortHash: hash });
    await admin.query("INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Ohne Recht', $3)", [mandantA, `ohne-${suffix}@s.test`, hash]);

    const a1 = await standortMitKlient(mandantA, "Haus Eins", "101", "Maria", "Müllerstein");
    const a2 = await standortMitKlient(mandantA, "Haus Zwei", "201", "Martin", "Müllerhof");
    standort1 = a1.s; standort2 = a2.s; zimmer1 = a1.z; k1 = a1.k; k2 = a2.k;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantA, s1Id, standort1]);

    const fremdLeitung = await kontoMitAlterRolle(admin, { mandantId: mandantB, rolle: "bereichsleitung", email: `fremd-${suffix}@s.test`, name: "Fremd Leitung", passwortHash: hash });
    const b = await standortMitKlient(mandantB, "Haus Fremd", "301", "Fritz", "Müllerfremd");
    kFremd = b.k;

    buchung1 = await buchen(mandantA, k1, "Taschengeld Eins", 2050, leitungId);
    await buchen(mandantA, k2, "Taschengeld Zwei", 3000, leitungId);
    await buchen(mandantB, kFremd, "Taschengeld Fremd", 2050, fremdLeitung);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (kurz: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slugA, email: `${kurz}-${suffix}@s.test`, passwort })).body.accessToken;
    tokenLeitung = await login("leitung");
    tokenStandort1 = await login("s1");
    tokenOhneRecht = await login("ohne");
  });

  afterAll(async () => {
    try {
      for (const m of mandanten) {
        await raeumeKontoMitRolleAuf(admin, m);
        for (const t of ["audit_log", "kassenbuchung", "belegung", "benutzer_standort", "klient", "zimmer", "standort", "benutzer", "kassenbuchung_typ", "org_unit"])
          await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [m]).catch(() => undefined);
        await admin.query("DELETE FROM kassenbuch_nummernkreis WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m]).catch(() => undefined);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("findet Klient:innen, Zimmer und Belege des eigenen Mandanten -- nie die eines fremden", async () => {
    const res = await suche(tokenLeitung, "Müller");
    expect(res.status).toBe(200);
    expect(ids(res, "klienten").sort()).toEqual([k1, k2].sort());
    expect(ids(res, "klienten")).not.toContain(kFremd);
    const alleTitel = JSON.stringify(res.body);
    expect(alleTitel).not.toContain("Fremd");
  });

  it("fremder Mandant: Name, Zimmer und Verwendungszweck des anderen Mandanten liefern nichts", async () => {
    for (const q of ["Müllerfremd", "Haus Fremd", "Taschengeld Fremd", "301"]) {
      const res = await suche(tokenLeitung, q);
      expect(res.body).toEqual({ klienten: [], zimmer: [], mitarbeitende: [], belege: [] });
    }
  });

  it("standortbeschraenkt: nur Standort 1 -- Klient:in, Zimmer und Beleg von Standort 2 bleiben unsichtbar", async () => {
    const klienten = await suche(tokenStandort1, "Müller");
    expect(ids(klienten, "klienten")).toEqual([k1]);
    const zimmer = await suche(tokenStandort1, "Haus");
    expect(zimmer.body.zimmer.map((z: { standortId: string }) => z.standortId)).toEqual([standort1]);
    const belege = await suche(tokenStandort1, "Taschengeld");
    expect(belege.body.belege).toHaveLength(1);
    expect(belege.body.belege[0].id).toBe(buchung1);
  });

  it("ohne Recht keine Treffer in den Gruppen, fuer die das Recht fehlt", async () => {
    const res = await suche(tokenOhneRecht, "Müller");
    expect(res.body).toEqual({ klienten: [], zimmer: [], mitarbeitende: [], belege: [] });
    const m = await suche(tokenOhneRecht, "Leitung");
    expect(m.body.mitarbeitende).toEqual([]);
  });

  it("Mitarbeitende: Treffer ohne E-Mail-Adresse in der Antwort", async () => {
    const res = await suche(tokenLeitung, "Betreuer");
    expect(res.body.mitarbeitende.map((t: { titel: string }) => t.titel)).toContain("Betreuer Eins");
    expect(JSON.stringify(res.body)).not.toContain("@s.test");
  });

  it("Belege per KB-Nummer und per Betrag; Nummern sind lueckenlos je Mandant", async () => {
    const nr = (await admin.query("SELECT belegnummer FROM kassenbuchung WHERE id = $1", [buchung1])).rows[0].belegnummer;
    const perNummer = await suche(tokenLeitung, `KB-${nr}`);
    expect(ids(perNummer, "belege")).toContain(buchung1);
    expect(perNummer.body.belege.find((b: { id: string }) => b.id === buchung1).titel).toBe(`KB-${String(nr).padStart(5, "0")}`);
    const perBetrag = await suche(tokenLeitung, "20,50");
    expect(ids(perBetrag, "belege")).toEqual([buchung1]);
    const nummernA = (await admin.query("SELECT belegnummer FROM kassenbuchung WHERE mandant_id = $1 ORDER BY belegnummer", [mandantA])).rows.map((r) => r.belegnummer);
    expect(nummernA).toEqual([1, 2]);
    const nummernB = (await admin.query("SELECT belegnummer FROM kassenbuchung WHERE mandant_id = $1", [mandantB])).rows.map((r) => r.belegnummer);
    expect(nummernB).toEqual([1]);
  });

  it("Belegnummer ist fuer die App-Rolle nicht aenderbar und der Zaehler nicht lesbar", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    const kontext = async () => {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true), set_config('app.benutzer_id', $2, true), set_config('app.klient_id', '', true)", [
        mandantA,
        randomUUID(),
      ]);
    };
    try {
      await kontext();
      await expect(app_.query("UPDATE kassenbuchung SET belegnummer = 999 WHERE id = $1", [buchung1])).rejects.toThrow(/permission denied/);
      await app_.query("ROLLBACK");
      await kontext();
      await expect(app_.query("SELECT * FROM kassenbuch_nummernkreis")).rejects.toThrow(/permission denied/);
      await app_.query("ROLLBACK");
    } finally {
      await app_.end();
    }
  });

  it("hoechstens 8 Treffer je Gruppe", async () => {
    for (let i = 0; i < 10; i++) {
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, 'Vielfach', $2, '1990-01-01', $3, 'Amt')`,
        [mandantA, `Nr${i}`, `AZ-V-${suffix}-${i}`]
      );
      // Ohne Belegung sind sie fuer die unbeschraenkte Leitung trotzdem sichtbar (kein Standortfilter).
    }
    const res = await suche(tokenLeitung, "Vielfach");
    expect(res.body.klienten).toHaveLength(8);
  });

  it("Eingabe: zu kurz -> 400, LIKE-Metazeichen sind Text und treffen nicht alles", async () => {
    expect((await suche(tokenLeitung, "M")).status).toBe(400);
    const res = await suche(tokenLeitung, "%%");
    expect(res.body).toEqual({ klienten: [], zimmer: [], mitarbeitende: [], belege: [] });
  });

  it("zuletzt geoeffnet: fremde und nicht erlaubte IDs kommen nicht zurueck", async () => {
    const res = await request(app.getHttpServer())
      .post("/suche/zuletzt")
      .set("Authorization", `Bearer ${tokenStandort1}`)
      .send({ eintraege: [{ gruppe: "klienten", id: k1 }, { gruppe: "klienten", id: k2 }, { gruppe: "klienten", id: kFremd }, { gruppe: "zimmer", id: zimmer1 }] });
    expect(res.status).toBe(200);
    expect(ids(res, "klienten")).toEqual([k1]);
    expect(ids(res, "zimmer")).toEqual([zimmer1]);
  });

  it("ohne Anmeldung 401", async () => {
    expect((await request(app.getHttpServer()).get("/suche").query({ q: "Müller" })).status).toBe(401);
  });
});
