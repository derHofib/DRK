/**
 * Recht auf Loeschung fuer Klientendaten (Art. 17 DSGVO). Kein Hard-Delete
 * (siehe migrations/0027_klient_anonymisierung.sql): Kassenbuchungen und
 * Rechnungen bleiben als Belege bestehen, nur Name und Geburtsdatum des
 * Klienten werden ueberschrieben. Aktenzeichen und Amt bleiben, weil beide
 * Belege weiterhin per klient_id daran haengen.
 *
 * Wie die uebrigen Spezifikationen hier: ueber den echten HTTP-Pfad und
 * gegen eine echte PostgreSQL-Instanz. Ein Fall prueft zusaetzlich bewusst
 * UNTER der Anwendung (roher Client auf der App-Rolle), weil die
 * entscheidende Zusicherung -- kein Hard-Delete moeglich -- eine
 * Datenbankberechtigung ist, keine Codezeile.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Klient anonymisieren (Art. 17 DSGVO)", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitung: string;
  let tokenBetreuer: string;

  let klientId: string;
  let buchungId: string;
  let rechnungId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-anon-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Anonymisierung ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    async function legeBenutzerAn(label: string, rolle: string) {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, `${label}-${suffix}@beispiel.test`, `Test ${rolle}`, passwortHash, rolle]
      );
      return rows[0].id;
    }
    await legeBenutzerAn("bereichsleitung", "bereichsleitung");
    await legeBenutzerAn("einrichtungsleitung", "einrichtungsleitung");
    await legeBenutzerAn("betreuer", "betreuer");

    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Erika', 'Musterfrau', '1985-05-05', $2, 'Jugendamt Musterstadt') RETURNING id`,
      [mandantId, `AZ-ANON-${suffix}`]
    );
    klientId = klientRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitung = await login(`einrichtungsleitung-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`betreuer-${suffix}@beispiel.test`);

    const buchung = await request(app.getHttpServer())
      .post("/kassenbuchungen")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId, datum: "2026-01-01", betragCent: 5000, verwendungszweck: "HZL Januar", typ: "hzl" });
    buchungId = buchung.body.id;

    const rechnung = await request(app.getHttpServer())
      .post("/rechnungen")
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ klientId, betragCent: 1234, beschreibung: "Testrechnung" });
    rechnungId = rechnung.body.id;
  });

  afterAll(async () => {
    await admin.query("DELETE FROM rechnung_statuswechsel WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
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
      patch: (path: string) => request(http).patch(path).set("Authorization", `Bearer ${token}`).send(),
    };
  }

  it("weist Betreuer mit 403 ab und aendert den Klienten nicht", async () => {
    const res = await als(tokenBetreuer).patch(`/klienten/${klientId}/anonymisieren`);
    expect(res.status).toBe(403);

    const danach = await als(tokenBereichsleitung).get(`/klienten/${klientId}`);
    expect(danach.body.vorname).toBe("Erika");
    expect(danach.body.anonymisiertAm).toBeNull();
  });

  it("weist eine unbekannte Klienten-ID mit 404 ab", async () => {
    const res = await als(tokenEinrichtungsleitung).patch(`/klienten/${randomUUID()}/anonymisieren`);
    expect(res.status).toBe(404);
  });

  it("anonymisiert als Einrichtungsleitung: Name/Geburtsdatum weg, Aktenzeichen/Amt bleiben", async () => {
    const res = await als(tokenEinrichtungsleitung).patch(`/klienten/${klientId}/anonymisieren`);
    expect(res.status).toBe(200);
    expect(res.body.vorname).not.toBe("Erika");
    expect(res.body.nachname).not.toBe("Musterfrau");
    expect(res.body.geburtsdatum).toBeNull();
    expect(res.body.anonymisiertAm).not.toBeNull();
    expect(res.body.aktenzeichen).toContain("AZ-ANON-");
    expect(res.body.amt).toBe("Jugendamt Musterstadt");

    // Nicht nur der Antwortkoerper -- auch ein frischer Abruf.
    const erneut = await als(tokenBereichsleitung).get(`/klienten/${klientId}`);
    expect(erneut.body.vorname).toBe(res.body.vorname);
    expect(erneut.body.anonymisiertAm).not.toBeNull();
  });

  it("laesst Kassenbuchung und Rechnung des anonymisierten Klienten als Beleg bestehen", async () => {
    const buchung = await als(tokenBereichsleitung).get("/kassenbuchungen");
    const ids = buchung.body.map((b: { id: string }) => b.id);
    expect(ids).toContain(buchungId);

    const rechnung = await als(tokenBereichsleitung).get(`/rechnungen/${rechnungId}`);
    expect(rechnung.status).toBe(200);
    expect(rechnung.body.betragCent).toBe(1234);
  });

  it("lehnt eine zweite Anonymisierung desselben Klienten mit 409 ab", async () => {
    const res = await als(tokenBereichsleitung).patch(`/klienten/${klientId}/anonymisieren`);
    expect(res.status).toBe(409);
  });

  /**
   * Diese beiden Faelle umgehen die Anwendung bewusst: sie pruefen die
   * Zusicherungen der Datenbank selbst (Migration 0027). Ohne sie wuerde ein
   * spaeteres Entfernen von REVOKE/GRANT unbemerkt bleiben, solange der
   * Service noch richtig liegt.
   */
  describe("Zusicherungen der Datenbank (unterhalb der Anwendung)", () => {
    let appRolle: Client;

    beforeAll(async () => {
      appRolle = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await appRolle.connect();
    });

    afterAll(async () => {
      await appRolle.end();
    });

    async function alsMandant<T>(fn: () => Promise<T>): Promise<T> {
      await appRolle.query("BEGIN");
      await appRolle.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      try {
        return await fn();
      } finally {
        await appRolle.query("ROLLBACK");
      }
    }

    it("kann den Klienten nicht per DELETE entfernen -- nur Anonymisierung ist vorgesehen", async () => {
      await alsMandant(async () => {
        await expect(appRolle.query("DELETE FROM klient WHERE id = $1", [klientId])).rejects.toThrow(
          /permission denied/i
        );
      });
    });

    it("erlaubt der App-Rolle keine Schreibrechte auf aktenzeichen oder amt", async () => {
      for (const spalte of ["aktenzeichen = 'gekapert'", "amt = 'gekapert'"]) {
        await alsMandant(async () => {
          await expect(
            appRolle.query(`UPDATE klient SET ${spalte} WHERE id = $1`, [klientId])
          ).rejects.toThrow(/permission denied/i);
        });
      }
    });
  });
});
