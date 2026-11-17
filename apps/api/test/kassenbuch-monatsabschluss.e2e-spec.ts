/**
 * GET /kassenbuchungen/monatsabschluss: PDF je Klient:in und Monat.
 * Die Zahlen werden ueber die reine Funktion berechneSummen() geprueft (ein
 * PDF laesst sich nicht sinnvoll auf Text parsen); der Endpunkt selbst auf
 * Format, Eingabepruefung und Sichtbarkeit (fremder Standort = 404).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { berechneSummen } from "../src/kassenbuch/kassenbuch-monatsabschluss-pdf";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";
import { pdfSchriften } from "./support/pdf-schriften";

describe("Kassenbuch: Monatsabschluss als PDF", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";
  let tokenLeitung: string;
  let tokenS1: string;
  let klientS1: string;
  let klientS2: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-kb-abschluss-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    mandantId = (
      await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
        `Testmandant Abschluss ${suffix}`,
        mandantSlug,
      ])
    ).rows[0].id;
    await kontoMitAlterRolle(admin, { mandantId, rolle: "bereichsleitung", email: `l-${suffix}@beispiel.test`, name: "Leitung", passwortHash });
    const ma = await kontoMitAlterRolle(admin, { mandantId, rolle: "betreuer", email: `m-${suffix}@beispiel.test`, name: "MA S1", passwortHash });

    const standort = async (name: string) =>
      (await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Str. 1') RETURNING id", [mandantId, name])).rows[0].id;
    const s1 = await standort("Eins");
    const s2 = await standort("Zwei");
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, ma, s1]);

    const klientAn = async (nachname: string, standortId: string) => {
      const k = (
        await admin.query<{ id: string }>(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, 'Test', $2, '1990-01-01', $3, 'Amt') RETURNING id`,
          [mandantId, nachname, `AZ-${nachname}-${suffix}`]
        )
      ).rows[0].id;
      const z = (await admin.query<{ id: string }>("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '1') RETURNING id", [mandantId, standortId])).rows[0].id;
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z, k]);
      return k;
    };
    klientS1 = await klientAn("Eins", s1);
    klientS2 = await klientAn("Zwei", s2);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken;
    tokenLeitung = await login(`l-${suffix}@beispiel.test`);
    tokenS1 = await login(`m-${suffix}@beispiel.test`);

    const typ = (await admin.query<{ id: string }>("SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND NOT ist_hzl AND aktiv LIMIT 1", [mandantId])).rows[0].id;
    // Einzahlungen (positiv) brauchen keine Unterschrift.
    for (const [datum, betrag] of [["2026-07-15", 5000], ["2026-08-03", 2000], ["2026-08-20", 1500]] as const) {
      const res = await request(app.getHttpServer())
        .post("/kassenbuchungen")
        .set("Authorization", `Bearer ${tokenLeitung}`)
        .send({ klientId: klientS1, datum, betragCent: betrag, typId: typ, verwendungszweck: "Test" });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantId);
      for (const t of ["kassenbuchung", "belegung", "zimmer", "benutzer_standort", "standort", "klient", "benutzer", "kassenbuchung_typ"]) {
        await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [mandantId]);
      }
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const abschluss = (token: string, query: string) =>
    request(app.getHttpServer())
      .get(`/kassenbuchungen/monatsabschluss${query}`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const teile: Buffer[] = [];
        res.on("data", (c: Buffer) => teile.push(c));
        res.on("end", () => cb(null, Buffer.concat(teile)));
      });

  it("liefert ein gueltiges PDF mit Dateinamen", async () => {
    const res = await abschluss(tokenLeitung, `?klientId=${klientS1}&monat=2026-08`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("kassenbuch-AZ-Eins-");
    expect(res.headers["content-disposition"]).toContain("2026-08.pdf");
    const doc = await PDFDocument.load(res.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("setzt in Nunito Sans und kommt mit Ł, Ş, ř im Namen zurecht", async () => {
    // Mit der frueheren Helvetica (WinAnsi) warf pdf-lib bei diesen Zeichen
    // -- der Abschluss war fuer solche Namen ein 500.
    await admin.query("UPDATE klient SET vorname = 'Łukasz Şahin-Dvořák' WHERE id = $1", [klientS1]);
    try {
      const res = await abschluss(tokenLeitung, `?klientId=${klientS1}&monat=2026-08`);
      expect(res.status).toBe(200);
      expect(await pdfSchriften(res.body as Buffer)).toEqual(["NunitoSans-Bold", "NunitoSans-Regular"]);
    } finally {
      await admin.query("UPDATE klient SET vorname = 'Test' WHERE id = $1", [klientS1]);
    }
  });

  it("berechneSummen: Storno zaehlt in keiner Summe", () => {
    const b = (betragCent: number, storniert = false) => ({
      belegnummer: 1, datum: "2026-08-01", typBezeichnung: "x", verwendungszweck: "y", betragCent, storniert, hatUnterschrift: false,
    });
    expect(berechneSummen(5000, [b(2000), b(1500), b(-700), b(9999, true), b(-9999, true)])).toEqual({
      einzahlungenCent: 3500,
      auszahlungenCent: 700,
      endsaldoCent: 7800,
    });
  });

  it("ungueltiger Monat oder fehlende Klient-ID ist 400, kein 500", async () => {
    expect((await abschluss(tokenLeitung, `?klientId=${klientS1}&monat=2026-13`)).status).toBe(400);
    expect((await abschluss(tokenLeitung, `?klientId=${klientS1}`)).status).toBe(400);
    expect((await abschluss(tokenLeitung, `?monat=2026-08`)).status).toBe(400);
  });

  it("Mitarbeiter:in sieht den Abschluss der eigenen Klient:in, fremder Standort ist 404", async () => {
    expect((await abschluss(tokenS1, `?klientId=${klientS1}&monat=2026-08`)).status).toBe(200);
    expect((await abschluss(tokenS1, `?klientId=${klientS2}&monat=2026-08`)).status).toBe(404);
  });

  it("ohne Anmeldung 401", async () => {
    const res = await request(app.getHttpServer()).get(`/kassenbuchungen/monatsabschluss?klientId=${klientS1}&monat=2026-08`);
    expect(res.status).toBe(401);
  });
});
