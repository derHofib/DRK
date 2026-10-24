/**
 * Backend des HZL-Uebergabemodus (Phase A): Entsperren mit dem Passwort des
 * eigenen Kontos, Vorab-Pruefung "darf buchen", die zusaetzlichen Felder der
 * Wochenuebersicht (Vorname/Nachname, letzter HZL-Betrag, Saldo) und die
 * Unterschriftspflicht der HZL-Auszahlung -- Buchung nur MIT Unterschrift,
 * ohne Unterschrift bleibt keine Zeile zurueck.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

// 1x1-PNG, wie im Kassenbuch-Spec.
const TEST_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("HZL-Uebergabemodus: Backend", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let slug: string;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let leitungId: string;
  let tokenLeitung: string;
  let tokenOhneRecht: string;
  let tokenKlient: string;
  let klientId: string;
  let hzlTypId: string;
  let einzahlungTypId: string;

  const als = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: unknown) => request(app.getHttpServer()).post(p).set("Authorization", `Bearer ${token}`).send(body as object),
  });

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    slug = `test-hzl-uebergabe-${suffix}`;
    mandantId = (
      await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Testmandant HZL ${suffix}`, slug])
    ).rows[0].id;
    const hash = await bcrypt.hash(passwort, 4);

    leitungId = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email: `leitung-${suffix}@beispiel.test`,
      name: "Leitung",
      passwortHash: hash,
    });
    // Eingeloggt, aber ohne jede Position: darf nichts buchen.
    await admin.query("INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Ohne Recht', $3)", [
      mandantId,
      `ohne-${suffix}@beispiel.test`,
      hash,
    ]);

    klientId = (
      await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, 'Anna Maria', 'Beispiel', '1990-01-01', $2, 'Amt', 'woechentlich') RETURNING id`,
        [mandantId, `AZ-HZL-${suffix}`]
      )
    ).rows[0].id;
    await legeKlientZugangAn(admin, { mandantId, klientId, email: `klient-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: leitungId });

    const typen = await admin.query<{ id: string; bezeichnung: string }>("SELECT id, bezeichnung FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    hzlTypId = typen.rows.find((t) => t.bezeichnung === "HZL")!.id;
    einzahlungTypId = typen.rows.find((t) => t.bezeichnung === "Einzahlung")!.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (kurz: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken;
    tokenLeitung = await login("leitung");
    tokenOhneRecht = await login("ohne");
    tokenKlient = await klientToken(app, slug, `klient-${suffix}@beispiel.test`, passwort);
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM unterschrift WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const hzl = (woche: number, extra: Record<string, unknown> = {}) => ({
    klientId,
    datum: "2026-08-17",
    betragCent: -2000,
    verwendungszweck: "HZL",
    typId: hzlTypId,
    isoJahr: 2026,
    isoWoche: woche,
    ...extra,
  });
  const zeilen = async (woche: number) =>
    Number((await admin.query("SELECT count(*) FROM kassenbuchung WHERE klient_id = $1 AND iso_woche = $2", [klientId, woche])).rows[0].count);

  it("HZL-Auszahlung ohne Unterschrift: 400 -- und es bleibt KEINE Buchung zurueck", async () => {
    const res = await als(tokenLeitung).post("/kassenbuchungen", hzl(33));
    expect(res.status).toBe(400);
    expect(await zeilen(33)).toBe(0);
  });

  it("HZL-Auszahlung mit Unterschrift: Buchung UND Unterschrift entstehen zusammen", async () => {
    await als(tokenLeitung).post("/kassenbuchungen", { klientId, datum: "2026-08-10", betragCent: 5000, verwendungszweck: "Einzahlung", typId: einzahlungTypId });
    const res = await als(tokenLeitung).post("/kassenbuchungen", hzl(34, { unterschriftBase64: TEST_PNG_BASE64 }));
    expect(res.status).toBe(201);
    expect(res.body.hatUnterschrift).toBe(true);
    expect(await zeilen(34)).toBe(1);
  });

  it("Wochenuebersicht liefert Vorname/Nachname getrennt, letzten HZL-Betrag (positiv) und Saldo", async () => {
    const res = await als(tokenLeitung).get("/kassenbuchungen/wochenuebersicht?jahr=2026&kw=35");
    expect(res.status).toBe(200);
    const e = res.body.find((x: any) => x.klientId === klientId);
    expect(e).toMatchObject({ vorname: "Anna Maria", nachname: "Beispiel", bezahlt: false, letzterHzlBetragCent: 2000, saldoCent: 3000 });
  });

  it("stornierte Buchungen zaehlen weder fuer Saldo noch fuer den letzten HZL-Betrag", async () => {
    await admin.query(
      "UPDATE kassenbuchung SET storniert = true, storno_grund = 'Test', storniert_von = $2, storniert_am = now() WHERE klient_id = $1 AND iso_woche = 34",
      [klientId, leitungId]
    );
    try {
      const res = await als(tokenLeitung).get("/kassenbuchungen/wochenuebersicht?jahr=2026&kw=35");
      const e = res.body.find((x: any) => x.klientId === klientId);
      expect(e.saldoCent).toBe(5000);
      expect(e.letzterHzlBetragCent).toBeNull();
    } finally {
      await admin.query(
        "UPDATE kassenbuchung SET storniert = false, storno_grund = NULL, storniert_von = NULL, storniert_am = NULL WHERE klient_id = $1 AND iso_woche = 34",
        [klientId]
      );
    }
  });

  it("darf-buchen: mit Recht true, ohne Recht false (vor der Uebergabe, nicht erst nach der Unterschrift)", async () => {
    expect((await als(tokenLeitung).get("/kassenbuchungen/darf-buchen")).body).toEqual({ darf: true });
    expect((await als(tokenOhneRecht).get("/kassenbuchungen/darf-buchen")).body).toEqual({ darf: false });
    expect((await als(tokenOhneRecht).post("/kassenbuchungen", hzl(36, { unterschriftBase64: TEST_PNG_BASE64 }))).status).toBe(403);
  });

  it("Entsperren mit dem eigenen Passwort: ok und im Audit-Log", async () => {
    const res = await als(tokenLeitung).post("/kassenbuchungen/hzl-uebergabe/entsperren", { passwort });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    const { rows } = await admin.query("SELECT 1 FROM audit_log WHERE mandant_id = $1 AND aktion = 'hzl-uebergabe.entsperrt' AND benutzer_id = $2", [mandantId, leitungId]);
    expect(rows).toHaveLength(1);
  });

  it("falsches Passwort: 403 (NICHT 401, sonst beendet der Web-Client die Sitzung) und ein Audit-Eintrag", async () => {
    const res = await als(tokenLeitung).post("/kassenbuchungen/hzl-uebergabe/entsperren", { passwort: "falsch-falsch" });
    expect(res.status).toBe(403);
    const { rows } = await admin.query("SELECT 1 FROM audit_log WHERE mandant_id = $1 AND aktion = 'hzl-uebergabe.entsperren-fehlgeschlagen'", [mandantId]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("Eingabe und Prinzipal: ohne Passwort 400, Klient-Token 401", async () => {
    expect((await als(tokenLeitung).post("/kassenbuchungen/hzl-uebergabe/entsperren", {})).status).toBe(400);
    expect((await als(tokenKlient).post("/kassenbuchungen/hzl-uebergabe/entsperren", { passwort })).status).toBe(401);
    expect((await als(tokenKlient).get("/kassenbuchungen/darf-buchen")).status).toBe(401);
  });
});
