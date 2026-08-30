/**
 * Dashboard: eine Antwort fasst Kennzahlen aus sechs Fachbereichen
 * zusammen. Sicherheitsrelevant ist vor allem, dass die
 * Standort-Einschraenkung fuer JEDEN Teil der Antwort greift -- eine
 * Kennzahl, die diese vergisst, waere ein stiller Informationsleck ueber
 * die Mandantengrenze eines Standorts hinweg.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { isoWoche } from "../src/common/iso-woche";

describe("Dashboard: Kennzahlen und Standort-Einschraenkung", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;

  let klient1: string; // Standort 1, woechentlich, HZL bezahlt, alter Tagesbericht
  let klient2: string; // Standort 2, woechentlich, HZL offen, aktueller Tagesbericht
  let klient3: string; // Standort 1, monatlich, kein Tagesbericht je

  const passwort = "correct horse battery staple";
  const { jahr, woche } = isoWoche(new Date());

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-dashboard-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Dashboard ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: bereichsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung') RETURNING id`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );
    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3, 'einrichtungsleitung') RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    const einrichtungsleitungS1Id = einrichtungsleitungRows[0].id;

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

    await admin.query(
      "INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)",
      [mandantId, einrichtungsleitungS1Id, standort1]
    );

    const { rows: zimmer1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standort1]
    );
    const { rows: zimmer1bRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '102') RETURNING id",
      [mandantId, standort1]
    );
    // Bleibt in Standort 1 frei, damit "frei" dort nicht immer 0 ist.
    await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '103')", [
      mandantId,
      standort1,
    ]);
    const { rows: zimmer2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, standort2]
    );

    const { rows: k1 } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Eins', 'S1', '1990-01-01', $2, 'Testamt', 'woechentlich') RETURNING id`,
      [mandantId, `AZ-1-${suffix}`]
    );
    klient1 = k1[0].id;
    const { rows: k2 } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Zwei', 'S2', '1990-01-01', $2, 'Testamt', 'woechentlich') RETURNING id`,
      [mandantId, `AZ-2-${suffix}`]
    );
    klient2 = k2[0].id;
    const { rows: k3 } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Drei', 'S1', '1990-01-01', $2, 'Testamt', 'monatlich') RETURNING id`,
      [mandantId, `AZ-3-${suffix}`]
    );
    klient3 = k3[0].id;

    // Belegungen: klient1 in Zimmer 101, klient3 in Zimmer 102 (beide Standort 1,
    // Zimmer 103 bleibt frei), klient2 in Zimmer 201 (Standort 2).
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer1Rows[0].id, klient1]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer1bRows[0].id, klient3]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer2Rows[0].id, klient2]
    );

    // HZL: klient1 diese Woche bezahlt, klient2 nicht.
    await admin.query(
      `INSERT INTO kassenbuchung (mandant_id, klient_id, datum, betrag_cent, verwendungszweck, typ, iso_jahr, iso_woche, gebucht_von)
       VALUES ($1, $2, CURRENT_DATE, -2000, 'HZL', 'hzl', $3, $4, NULL)`,
      [mandantId, klient1, jahr, woche]
    );

    // Rechnung: eine offene ("beantragt") fuer klient1, eine bereits genehmigte fuer klient2 (zaehlt nicht mit).
    const { rows: r1 } = await admin.query<{ id: string }>(
      "INSERT INTO rechnung (mandant_id, klient_id, betrag_cent, beschreibung, erstellt_von) VALUES ($1, $2, 1500, 'Offen', NULL) RETURNING id",
      [mandantId, klient1]
    );
    await admin.query(
      "INSERT INTO rechnung_statuswechsel (mandant_id, rechnung_id, status, geaendert_von) VALUES ($1, $2, 'beantragt', NULL)",
      [mandantId, r1[0].id]
    );
    const { rows: r2 } = await admin.query<{ id: string }>(
      "INSERT INTO rechnung (mandant_id, klient_id, betrag_cent, beschreibung, erstellt_von) VALUES ($1, $2, 500, 'Genehmigt', NULL) RETURNING id",
      [mandantId, klient2]
    );
    await admin.query(
      "INSERT INTO rechnung_statuswechsel (mandant_id, rechnung_id, status, geaendert_von) VALUES ($1, $2, 'beantragt', NULL)",
      [mandantId, r2[0].id]
    );
    await admin.query(
      "INSERT INTO rechnung_statuswechsel (mandant_id, rechnung_id, status, geaendert_von) VALUES ($1, $2, 'genehmigt', NULL)",
      [mandantId, r2[0].id]
    );

    // Kostenuebernahmen: klient1 endet in 10 Tagen (im 30-Tage-Fenster),
    // klient2 in 5 Tagen (Standort 2 -- fuer S1-Leitung unsichtbar),
    // klient3 in 40 Tagen (ausserhalb des Fensters).
    await admin.query(
      "INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, bis) VALUES ($1, $2, 'Amt Eins', '2025-01-01', CURRENT_DATE + 10)",
      [mandantId, klient1]
    );
    await admin.query(
      "INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, bis) VALUES ($1, $2, 'Amt Zwei', '2025-01-01', CURRENT_DATE + 5)",
      [mandantId, klient2]
    );
    await admin.query(
      "INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, bis) VALUES ($1, $2, 'Amt Drei', '2025-01-01', CURRENT_DATE + 40)",
      [mandantId, klient3]
    );

    // Tagesberichte: klient1 vor 10 Tagen (ueberfaellig), klient2 heute (aktuell), klient3 nie.
    await admin.query(
      "INSERT INTO tagesbericht (mandant_id, klient_id, datum, text) VALUES ($1, $2, CURRENT_DATE - 10, 'Alt')",
      [mandantId, klient1]
    );
    await admin.query(
      "INSERT INTO tagesbericht (mandant_id, klient_id, datum, text) VALUES ($1, $2, CURRENT_DATE, 'Heute')",
      [mandantId, klient2]
    );

    // Ein ausstehender (nicht eingeloester, nicht abgelaufener) Passwort-Reset.
    await admin.query(
      `INSERT INTO benutzer_reset_token (mandant_id, benutzer_id, token_hash, erstellt_von, laeuft_ab_am)
       VALUES ($1, $2, $3, $2, now() + interval '30 minutes')`,
      [mandantId, einrichtungsleitungS1Id, randomUUID()]
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
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer_reset_token WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM tagesbericht WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung_statuswechsel WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM rechnung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function get(token: string) {
    return request(app.getHttpServer()).get("/dashboard").set("Authorization", `Bearer ${token}`);
  }

  describe("bereichsleitung (unrestricted)", () => {
    it("zaehlt Zimmer korrekt: 1 von 4 frei, ueber 2 Standorte", async () => {
      const res = await get(tokenBereichsleitung);
      expect(res.status).toBe(200);
      expect(res.body.zimmer).toEqual({ frei: 1, gesamt: 4, standorte: 2 });
    });

    it("zaehlt die HZL-Wochenuebersicht nur fuer woechentliche Klient:innen", async () => {
      const res = await get(tokenBereichsleitung);
      expect(res.body.hzlWoche).toEqual({ bezahlt: 1, gesamt: 2, isoJahr: jahr, isoWoche: woche });
    });

    it("zaehlt genau die eine offene Rechnung, nicht die bereits genehmigte", async () => {
      const res = await get(tokenBereichsleitung);
      expect(res.body.offeneRechnungen).toEqual({ anzahl: 1, summeCent: 1500 });
    });

    it("sieht alle Mitarbeitenden und den ausstehenden Passwort-Reset", async () => {
      const res = await get(tokenBereichsleitung);
      expect(res.body.mitarbeitende.gesamt).toBe(2);
      expect(res.body.mitarbeitende.aktiv).toBe(2);
      expect(res.body.mitarbeitende.ausstehendeResets).toBeGreaterThanOrEqual(1);
    });

    it("zeigt Kostenuebernahmen beider Standorte, aber nicht die ausserhalb des 30-Tage-Fensters", async () => {
      const res = await get(tokenBereichsleitung);
      const ids = res.body.kostenuebernahmenBaldEndend.map((k: { klientId: string }) => k.klientId);
      expect(ids).toContain(klient1);
      expect(ids).toContain(klient2);
      expect(ids).not.toContain(klient3);
      const eintragKlient1 = res.body.kostenuebernahmenBaldEndend.find((k: { klientId: string }) => k.klientId === klient1);
      expect(eintragKlient1.tageVerbleibend).toBe(10);
    });

    it("zeigt beide Klienten ohne aktuellen Tagesbericht (aelter als 7 Tage oder nie), nicht den mit heutigem Bericht", async () => {
      const res = await get(tokenBereichsleitung);
      const ids = res.body.klientenOhneTagesbericht.map((k: { klientId: string }) => k.klientId);
      expect(ids).toContain(klient1);
      expect(ids).toContain(klient3);
      expect(ids).not.toContain(klient2);
      const eintragKlient3 = res.body.klientenOhneTagesbericht.find((k: { klientId: string }) => k.klientId === klient3);
      expect(eintragKlient3.tageSeitLetztem).toBeNull();
    });
  });

  describe("einrichtungsleitung-s1 (auf Standort 1 eingeschraenkt)", () => {
    it("sieht nur die Zimmer von Standort 1", async () => {
      const res = await get(tokenEinrichtungsleitungS1);
      expect(res.body.zimmer).toEqual({ frei: 1, gesamt: 3, standorte: 1 });
    });

    it("sieht nur den woechentlichen Klienten von Standort 1 in der HZL-Uebersicht", async () => {
      const res = await get(tokenEinrichtungsleitungS1);
      expect(res.body.hzlWoche).toEqual({ bezahlt: 1, gesamt: 1, isoJahr: jahr, isoWoche: woche });
    });

    it("sieht nur die Kostenuebernahme von Standort 1, nicht die von Standort 2", async () => {
      const res = await get(tokenEinrichtungsleitungS1);
      const ids = res.body.kostenuebernahmenBaldEndend.map((k: { klientId: string }) => k.klientId);
      expect(ids).toContain(klient1);
      expect(ids).not.toContain(klient2);
    });

    it("sieht nur Klient:innen von Standort 1 ohne aktuellen Tagesbericht", async () => {
      const res = await get(tokenEinrichtungsleitungS1);
      const ids = res.body.klientenOhneTagesbericht.map((k: { klientId: string }) => k.klientId);
      expect(ids).toContain(klient1);
      expect(ids).toContain(klient3);
      expect(ids).not.toContain(klient2);
    });

    it("zaehlt bei Mitarbeitenden nur sich selbst -- die Bereichsleitung ist keinem Standort zugeordnet", async () => {
      const res = await get(tokenEinrichtungsleitungS1);
      expect(res.body.mitarbeitende.gesamt).toBe(1);
    });
  });
});
