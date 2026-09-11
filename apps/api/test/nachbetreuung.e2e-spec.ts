/**
 * Nachbetreuung ausgezogener Klient:innen (z.B. Verselbststaendigung in eine
 * eigene Wohnung): `klientIstErlaubt()` prüfte bis zu diesem Fix
 * ausschliesslich die AKTUELL offene Belegung. Im selben Moment, in dem ein
 * Klient auszieht, verlor das bis dahin zustaendige Standort-Team -- und
 * selbst der als Bezugsbetreuer:in in klient_stammdaten eingetragene
 * Mitarbeitende -- jeden Lese- und Schreibzugriff auf Stammdaten,
 * Tagesberichte usw. (siehe Bugreport). `klientIstErlaubt()` erlaubt jetzt
 * zusaetzlich den Zugriff, wenn (a) der Mitarbeitende als Bezugsbetreuer:in
 * eingetragen ist, oder (b) die letzte (auch abgeschlossene) Belegung an
 * einem der erlaubten Standorte lag.
 *
 * Bewusst NICHT Teil dieses Fixes: `klientStandortBedingung()` (die
 * Listenabfragen wie GET /klienten filtert) bleibt unveraendert -- ein
 * ausgezogener Klient soll weiterhin nicht in der allgemeinen Klientenliste
 * auftauchen, die Nachbetreuung geschieht gezielt ueber die schon bekannte
 * Akte (z.B. einen abgespeicherten Link oder die Bezugsbetreuer-Zuordnung).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Nachbetreuung: klientIstErlaubt() nach Auszug", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let einrichtungsleitungS1Id: string;

  let klientNachbetreuungStandort: string; // wohnte in Standort 1, jetzt ausgezogen, kein Bezugsbetreuer
  let klientNachbetreuungBezugsbetreuer: string; // wohnte nur in Standort 2, jetzt ausgezogen, Bezugsbetreuer = einrichtungsleitung-s1
  let klientOhneBezug: string; // wohnte nur in Standort 2, jetzt ausgezogen, kein Bezug zu S1 -- Gegenprobe

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-nachbetreuung-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Nachbetreuung ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3, 'einrichtungsleitung') RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    einrichtungsleitungS1Id = einrichtungsleitungRows[0].id;

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    const standort1 = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    const standort2 = standort2Rows[0].id;

    // einrichtungsleitung-s1 ist NUR auf Standort 1 eingeschraenkt.
    await admin.query(
      "INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)",
      [mandantId, einrichtungsleitungS1Id, standort1]
    );

    const { rows: zimmer1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standort1]
    );
    const zimmer1 = zimmer1Rows[0].id;
    const { rows: zimmer2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, standort2]
    );
    const zimmer2 = zimmer2Rows[0].id;
    const { rows: zimmer3Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '202') RETURNING id",
      [mandantId, standort2]
    );
    const zimmer3 = zimmer3Rows[0].id;

    const { rows: k1 } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Verselbststaendigt', 'S1', '2005-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-NB-S1-${suffix}`]
    );
    klientNachbetreuungStandort = k1[0].id;
    const { rows: k2 } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Verselbststaendigt', 'Bezug', '2005-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-NB-BEZ-${suffix}`]
    );
    klientNachbetreuungBezugsbetreuer = k2[0].id;
    const { rows: k3 } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Ohne', 'Bezug', '2005-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-NB-OHNE-${suffix}`]
    );
    klientOhneBezug = k3[0].id;

    // Klient 1: letzte (und einzige) Belegung lag in Standort 1, ist aber
    // laengst abgeschlossen -- kein aktueller Aufenthalt mehr.
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, '2023-01-01', '2023-06-30')",
      [mandantId, zimmer1, klientNachbetreuungStandort]
    );
    // Klient 2 und 3: letzte (und einzige) Belegung lag in Standort 2 --
    // fuer einrichtungsleitung-s1 ohne Bezugsbetreuer-Eintrag ausserhalb
    // jeder Reichweite.
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, '2023-01-01', '2023-06-30')",
      [mandantId, zimmer2, klientNachbetreuungBezugsbetreuer]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, '2023-01-01', '2023-06-30')",
      [mandantId, zimmer3, klientOhneBezug]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`einrichtungsleitung-s1-${suffix}@beispiel.test`);

    // Bezugsbetreuer-Zuordnung fuer Klient 2 als (unrestricted) bereichsleitung
    // anlegen, damit die Vorbereitung nicht von der zu pruefenden
    // Einschraenkung selbst abhaengt.
    const zuordnung = await request(app.getHttpServer())
      .patch(`/klienten/${klientNachbetreuungBezugsbetreuer}/stammdaten`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ bezugsbetreuerId: einrichtungsleitungS1Id });
    expect(zuordnung.status).toBe(200);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM tagesbericht WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
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
      patch: (path: string, body: Record<string, unknown>) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
    };
  }

  it("erlaubt Zugriff auf Stammdaten, wenn die letzte (abgeschlossene) Belegung am erlaubten Standort lag", async () => {
    const res = await als(tokenEinrichtungsleitungS1).patch(
      `/klienten/${klientNachbetreuungStandort}/stammdaten`,
      { anmerkungen: "Nachbetreuung laeuft" }
    );
    expect(res.status).toBe(200);
    expect(res.body.anmerkungen).toBe("Nachbetreuung laeuft");
  });

  it("erlaubt einen neuen Tagesbericht fuer denselben ausgezogenen Klienten", async () => {
    const res = await als(tokenEinrichtungsleitungS1).post("/tagesberichte", {
      klientId: klientNachbetreuungStandort,
      datum: "2026-01-05",
      text: "Nachbetreuungsgespraech gefuehrt.",
    });
    expect(res.status).toBe(201);
  });

  it("erlaubt Zugriff auf Stammdaten ueber die Bezugsbetreuer-Zuordnung, unabhaengig vom letzten Standort", async () => {
    const res = await als(tokenEinrichtungsleitungS1).patch(
      `/klienten/${klientNachbetreuungBezugsbetreuer}/stammdaten`,
      { anmerkungen: "Als Bezugsbetreuer:in weiter zustaendig" }
    );
    expect(res.status).toBe(200);
    expect(res.body.anmerkungen).toBe("Als Bezugsbetreuer:in weiter zustaendig");
  });

  it("Gegenprobe: ohne Standort-Bezug und ohne Bezugsbetreuer-Zuordnung bleibt der Zugriff verwehrt", async () => {
    const res = await als(tokenEinrichtungsleitungS1).patch(`/klienten/${klientOhneBezug}/stammdaten`, {
      anmerkungen: "sollte scheitern",
    });
    expect(res.status).toBe(404);
  });
});
