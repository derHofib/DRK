/**
 * GET /standorte/:id/uebersicht (Menuepunkt "Standorte"): Zimmer, Klient:innen
 * und Kassenbuch EINES Standorts. Sicherheitsrelevant ist, dass weder Daten
 * eines nicht zugeordneten Standorts noch die eines fremden Mandanten
 * durchkommen. Die Bereichsleitung (unrestricted) liefert die Gegenprobe:
 * dieselbe Anfrage klappt dort, der 404 beim eingeschraenkten Konto liegt
 * also wirklich an der Standort-Schranke und nicht an einem Tippfehler.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

describe("Standort-Uebersicht", () => {
  let app: INestApplication;
  let admin: Client;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let standort1Id: string;
  let standort2Id: string;
  let fremderStandortId: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const mandantSlug = `test-standortuebersicht-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: m } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Uebersicht ${suffix}`, mandantSlug]
    );
    const mandantId = m[0].id;
    const { rows: fm } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Fremdmandant ${suffix}`, `fremd-${suffix}`]
    );
    const { rows: fs } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Fremd', 'x') RETURNING id",
      [fm[0].id]
    );
    fremderStandortId = fs[0].id;

    await kontoMitAlterRolle(admin, {
      mandantId, rolle: "bereichsleitung", email: `bl-${suffix}@beispiel.test`, name: "BL", passwortHash,
    });
    const elId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "einrichtungsleitung", email: `el-${suffix}@beispiel.test`, name: "EL", passwortHash,
    });

    const ins = async (sql: string, p: unknown[]) => (await admin.query<{ id: string }>(sql, p)).rows[0].id;
    standort1Id = await ins("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus 1', 'Str. 1') RETURNING id", [mandantId]);
    standort2Id = await ins("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus 2', 'Str. 2') RETURNING id", [mandantId]);
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, elId, standort1Id]);

    const z1 = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '101', 2) RETURNING id", [mandantId, standort1Id]);
    await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '102') RETURNING id", [mandantId, standort1Id]);
    const z2 = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id", [mandantId, standort2Id]);
    const k1 = await ins(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Eins', 'Haus1', '1990-01-01', $2, 'Amt') RETURNING id`, [mandantId, `AZ1-${suffix}`]);
    const k2 = await ins(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Zwei', 'Haus2', '1990-01-01', $2, 'Amt') RETURNING id`, [mandantId, `AZ2-${suffix}`]);
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z1, k1]);
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z2, k2]);

    const { rows: typ } = await admin.query<{ id: string }>(
      "SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND bezeichnung = 'Einzahlung'", [mandantId]);
    const typId = typ[0].id;
    const buche = (klient: string | null, standort: string | null, cent: number, zweck: string, storniert = false) =>
      admin.query(
        `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, typ_id,
                                    storniert, storno_grund, storniert_von, storniert_am)
         VALUES ($1,$2,$3,'2026-01-01',$4,$5,$6,$7,$8,$9,$10)`,
        [mandantId, klient, standort, cent, zweck, typId, storniert, storniert ? "Irrtum" : null, storniert ? elId : null, storniert ? new Date() : null]
      );
    await buche(k1, null, 5000, "Klient Haus1");
    await buche(k2, null, 7777, "Klient Haus2");
    await buche(null, standort1Id, 2000, "Haus1 Spassgeld");
    await buche(null, standort1Id, 900, "Haus1 storniert", true);
    await buche(null, standort2Id, 4242, "Haus2 Spassgeld");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken as string;
    tokenBereichsleitung = await login(`bl-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`el-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const get = (token: string, id: string) =>
    request(app.getHttpServer()).get(`/standorte/${id}/uebersicht`).set("Authorization", `Bearer ${token}`);

  it("liefert Zimmer, Klienten und Kassenbuch des eigenen Standorts", async () => {
    const res = await get(tokenEinrichtungsleitungS1, standort1Id);
    expect(res.status).toBe(200);
    expect(res.body.standort.name).toBe("Haus 1");
    expect(res.body.zimmer).toMatchObject({ anzahl: 2, plaetzeGesamt: 3, plaetzeBelegt: 1, plaetzeFrei: 2 });
    expect(res.body.klienten.map((k: { name: string }) => k.name)).toEqual(["Eins Haus1"]);
    expect(res.body.kassenbuch.hausSaldoCent).toBe(2000); // stornierte 900 zaehlen nicht
    expect(res.body.kassenbuch.klientenSaldoCent).toBe(5000);
    const zwecke = res.body.kassenbuch.letzteBuchungen.map((b: { verwendungszweck: string }) => b.verwendungszweck);
    expect(zwecke.sort()).toEqual(["Haus1 Spassgeld", "Klient Haus1"]);
  });

  it("verweigert einen nicht zugeordneten Standort (404), obwohl er im Mandanten existiert", async () => {
    const res = await get(tokenEinrichtungsleitungS1, standort2Id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Haus2");
  });

  it("Gegenprobe: die uneingeschraenkte Bereichsleitung sieht denselben Standort 2", async () => {
    const res = await get(tokenBereichsleitung, standort2Id);
    expect(res.status).toBe(200);
    expect(res.body.kassenbuch.hausSaldoCent).toBe(4242);
    expect(res.body.kassenbuch.klientenSaldoCent).toBe(7777);
  });

  it("zeigt keinen Standort eines fremden Mandanten (RLS)", async () => {
    expect((await get(tokenBereichsleitung, fremderStandortId)).status).toBe(404);
  });

  it("lehnt eine ungueltige ID mit 400 ab", async () => {
    expect((await get(tokenBereichsleitung, "kein-uuid")).status).toBe(400);
  });
});
