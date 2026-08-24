/**
 * Die Abnahmekriterien aus dem Bauplan, Phase 2: "eine zweite HZL-Buchung
 * für dieselbe Woche wird abgelehnt, eine Auszahlung ohne Unterschrift
 * kann nicht gespeichert werden, und ein Änderungsversuch an einer
 * bestehenden Buchung scheitert an der Datenbank."
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

// Eine winzige, aber gueltige 1x1-PNG-Datei -- reicht als Testsignatur.
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Kassenbuch: HZL-Eindeutigkeit, Unterschriftspflicht, Aenderungsschutz", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenLeitung: string;
  let klientWoechentlich: string;
  let klientMonatlich: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-kassenbuch-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Kassenbuch ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: leitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Leitung Test', $3, 'leitung') RETURNING id`,
      [mandantId, `leitung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: klientWoRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Wochen', 'Klientin', '1990-01-01', $2, 'Testamt', 'woechentlich') RETURNING id`,
      [mandantId, `AZ-WO-${suffix}`]
    );
    klientWoechentlich = klientWoRows[0].id;

    const { rows: klientMoRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Monats', 'Klient', '1990-01-01', $2, 'Testamt', 'monatlich') RETURNING id`,
      [mandantId, `AZ-MO-${suffix}`]
    );
    klientMonatlich = klientMoRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: `leitung-${suffix}@beispiel.test`, passwort });
    tokenLeitung = res.body.accessToken;
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM unterschrift WHERE kassenbuchung_id IN (SELECT id FROM kassenbuchung WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${tokenLeitung}`).send(body);
  }
  function get(path: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${tokenLeitung}`);
  }

  it("lehnt eine Auszahlung ohne Unterschrift ab", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-17",
      betragCent: -2000,
      verwendungszweck: "HZL",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
    });
    expect(res.status).toBe(400);
  });

  it("speichert eine Auszahlung mit Unterschrift, und das Bild lässt sich abrufen", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-17",
      betragCent: -2000,
      verwendungszweck: "HZL",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
      unterschriftBase64: TEST_PNG_BASE64,
    });
    expect(res.status).toBe(201);
    expect(res.body.hatUnterschrift).toBe(true);

    const bildRes = await get(`/kassenbuchungen/${res.body.id}/unterschrift`);
    expect(bildRes.status).toBe(200);
    expect(bildRes.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(bildRes.body).length).toBeGreaterThan(0);
  });

  it("speichert eine Einzahlung (positiver Betrag) auch ohne Unterschrift", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-01",
      betragCent: 5000,
      verwendungszweck: "Einzahlung Taschengeldkonto",
      typ: "einzahlung",
    });
    expect(res.status).toBe(201);
    expect(res.body.hatUnterschrift).toBe(false);
  });

  it("lehnt eine zweite HZL-Buchung für dieselbe Woche mit 409 ab", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-19",
      betragCent: -2000,
      verwendungszweck: "HZL nochmal",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
      unterschriftBase64: TEST_PNG_BASE64,
    });
    expect(res.status).toBe(409);
  });

  it("zeigt in der Wochenübersicht korrekt bezahlt/offen", async () => {
    const res = await get("/kassenbuchungen/wochenuebersicht?jahr=2026&kw=34");
    const woechentlich = res.body.find((e: { klientId: string }) => e.klientId === klientWoechentlich);
    expect(woechentlich.bezahlt).toBe(true);

    // Monatlicher Klient darf in der woechentlichen Übersicht gar nicht erst auftauchen.
    expect(res.body.find((e: { klientId: string }) => e.klientId === klientMonatlich)).toBeUndefined();
  });

  it("nach Storno ist die Woche wieder frei für eine neue HZL-Buchung", async () => {
    const liste = await get(`/kassenbuchungen?klientId=${klientWoechentlich}`);
    const offeneHzl = liste.body.find((b: { typ: string; storniert: boolean }) => b.typ === "hzl" && !b.storniert);

    const stornoRes = await request(app.getHttpServer())
      .patch(`/kassenbuchungen/${offeneHzl.id}/stornieren`)
      .set("Authorization", `Bearer ${tokenLeitung}`)
      .send({ grund: "Falscher Betrag eingegeben" });
    expect(stornoRes.status).toBe(200);
    expect(stornoRes.body.storniert).toBe(true);
    expect(stornoRes.body.stornoGrund).toBe("Falscher Betrag eingegeben");

    const neueBuchung = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-20",
      betragCent: -2000,
      verwendungszweck: "HZL korrigiert",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
      unterschriftBase64: TEST_PNG_BASE64,
    });
    expect(neueBuchung.status).toBe(201);

    // Die ursprüngliche, stornierte Buchung bleibt als Zeile erhalten -- sie
    // wird nicht ersetzt oder gelöscht.
    const listeNachStorno = await get(`/kassenbuchungen?klientId=${klientWoechentlich}`);
    expect(listeNachStorno.body.find((b: { id: string }) => b.id === offeneHzl.id).storniert).toBe(true);
  });

  it("lehnt ein zweites Stornieren derselben Buchung ab", async () => {
    const liste = await get(`/kassenbuchungen?klientId=${klientWoechentlich}`);
    const bereitsStorniert = liste.body.find((b: { storniert: boolean }) => b.storniert);

    const res = await request(app.getHttpServer())
      .patch(`/kassenbuchungen/${bereitsStorniert.id}/stornieren`)
      .set("Authorization", `Bearer ${tokenLeitung}`)
      .send({ grund: "Nochmal" });
    expect(res.status).toBe(404);
  });

  it("verweigert der App-Datenbankrolle jede Änderung an Betrag oder Datum einer Buchung", async () => {
    // Jede Pruefung braucht ihre eigene Transaktion: Nach einem
    // "permission denied" ist die Postgres-Transaktion abgebrochen und
    // jeder weitere Befehl darin schlaegt nur noch deshalb fehl, nicht mehr
    // wegen der Rechteprüfung selbst.
    const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query("UPDATE kassenbuchung SET betrag_cent = -1 WHERE mandant_id = $1", [mandantId])
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId])
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }
  });
});
