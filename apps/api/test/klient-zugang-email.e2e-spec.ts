/**
 * Klienten-Zugang, E-Mail aendern (Chat-Plan 1b, Migration 0054).
 *
 * Kernaussagen:
 *   1. Link nur bei aktivem Zugang MIT Passwort; nur der Hash liegt in der DB.
 *   2. Einloesen verlangt Link UND Passwort; beides falsch gibt dieselbe Antwort.
 *   3. Einmalig, befristet; Deaktivieren/Archivieren/Anonymisieren verwerfen ihn.
 *   4. Vor dem Passwort korrigiert Neu-Einladen die Adresse, danach nicht mehr.
 *   5. Die App-Rolle darf klient_zugang.email nie direkt schreiben.
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
import { legeKlientZugangAn } from "./support/klient-zugang";

describe("Klienten-Zugang: E-Mail aendern", () => {
  let app: INestApplication;
  let admin: Client;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const klientPasswort = "klient passwort lang genug";

  let mandantAId: string;
  let mandantASlug: string;
  let mandantBId: string;
  let leitungAId: string;
  let tokenLeitungA: string;
  let tokenBetreuerA: string;
  let tokenLeitungEingeschraenktA: string;
  let tokenLeitungB: string;
  let klientHash: string;

  const klientIds: string[] = [];
  const neuerKlientIdx = { n: 0 };
  let klientFremdId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);
    klientHash = await bcrypt.hash(klientPasswort, 4);

    mandantASlug = `test-kze-a-${suffix}`;
    const mandantBSlug = `test-kze-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`KZE A ${suffix}`, mandantASlug])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`KZE B ${suffix}`, mandantBSlug])).rows[0].id;

    leitungAId = await kontoMitAlterRolle(admin, {
      mandantId: mandantAId, rolle: "einrichtungsleitung", email: `leitung-a-${suffix}@beispiel.test`, name: "Leitung A", passwortHash: hash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantAId, rolle: "betreuer", email: `betreuer-a-${suffix}@beispiel.test`, name: "Betreuer A", passwortHash: hash,
    });
    const eingeschraenktId = await kontoMitAlterRolle(admin, {
      mandantId: mandantAId, rolle: "einrichtungsleitung", email: `eingeschraenkt-a-${suffix}@beispiel.test`, name: "Eingeschraenkt A", passwortHash: hash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantBId, rolle: "einrichtungsleitung", email: `leitung-b-${suffix}@beispiel.test`, name: "Leitung B", passwortHash: hash,
    });
    const standortId = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S1', 'Str. 1') RETURNING id", [mandantAId])).rows[0].id;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantAId, eingeschraenktId, standortId]);

    klientFremdId = await neuerKlient();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = async (slug: string, email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort })).body.accessToken as string;
    tokenLeitungA = await login(mandantASlug, `leitung-a-${suffix}@beispiel.test`);
    tokenBetreuerA = await login(mandantASlug, `betreuer-a-${suffix}@beispiel.test`);
    tokenLeitungEingeschraenktA = await login(mandantASlug, `eingeschraenkt-a-${suffix}@beispiel.test`);
    tokenLeitungB = await login(mandantBSlug, `leitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient_archiv_pdf WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM standort WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
  });
  const klientLogin = (email: string, pw = klientPasswort) =>
    request(http()).post("/auth/klient/login").send({ mandantSlug: mandantASlug, email, passwort: pw });
  const tokenAus = (link: string) => link.split("klient-email=")[1];
  const pruefen = (token: string) => request(http()).get(`/auth/klient/email-aendern/${token}`);
  const einloesen = (token: string, neueEmail: string, pw = klientPasswort) =>
    request(http()).post("/auth/klient/email-aendern/einloesen").send({ token, neueEmail, passwort: pw });

  async function neuerKlient(): Promise<string> {
    const n = ++neuerKlientIdx.n;
    const id = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Vorname', $2, '2005-01-01', $3, 'Jugendamt') RETURNING id`,
        [mandantAId, `Nach${n}`, `KZE${n}-${suffix}`]
      )
    ).rows[0].id;
    klientIds.push(id);
    return id;
  }
  // Zugang mit gesetztem Passwort, direkt per Fixture.
  async function aktiverKlient(email: string): Promise<string> {
    const klientId = await neuerKlient();
    await legeKlientZugangAn(admin, { mandantId: mandantAId, klientId, email, passwortHash: klientHash, eingeladenVon: leitungAId });
    return klientId;
  }
  async function linkFuer(klientId: string): Promise<string> {
    const res = await als(tokenLeitungA).post(`/klienten/${klientId}/zugang/email-aendern-link`);
    expect(res.status).toBe(201);
    return tokenAus(res.body.link);
  }

  it("Link erzeugen: nur Hash in der DB, Audit ohne Token, Status zeigt offene Frist", async () => {
    const email = `k1-${suffix}@beispiel.test`;
    const klientId = await aktiverKlient(email);
    const res = await als(tokenLeitungA).post(`/klienten/${klientId}/zugang/email-aendern-link`);
    expect(res.status).toBe(201);
    expect(res.body.link).toMatch(/^\/\?klient-email=[0-9a-f]{64}$/);
    const token = tokenAus(res.body.link);
    expect(new Date(res.body.laeuftAbAm).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400_000);

    const { rows } = await admin.query("SELECT email_aenderung_token_hash FROM klient_zugang WHERE klient_id = $1", [klientId]);
    expect(rows[0].email_aenderung_token_hash).toHaveLength(64);
    expect(rows[0].email_aenderung_token_hash).not.toBe(token);

    const audit = await admin.query("SELECT nachher FROM audit_log WHERE mandant_id = $1 AND aktion = 'zugang-email-link' AND objekt_id = (SELECT id FROM klient_zugang WHERE klient_id = $2)", [mandantAId, klientId]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0].nachher)).not.toContain(token);

    const status = await als(tokenLeitungA).get(`/klienten/${klientId}/zugang`);
    expect(status.body.emailAenderungOffenBis).toBe(res.body.laeuftAbAm);
  });

  it("Pruefen, Einloesen, danach Login nur mit neuer E-Mail; Link ist verbraucht; Audit ohne Token", async () => {
    const alt = `k2-${suffix}@beispiel.test`;
    const neu = `k2neu-${suffix}@beispiel.test`;
    const klientId = await aktiverKlient(alt);
    const token = await linkFuer(klientId);

    const p = await pruefen(token);
    expect(p.status).toBe(200);
    expect(p.body.emailMaskiert).toBe("k***@beispiel.test");

    expect((await einloesen(token, neu)).status).toBe(201);
    expect((await klientLogin(neu)).status).toBe(201);
    expect((await klientLogin(alt)).status).toBe(401);

    expect((await einloesen(token, `zweitens-${suffix}@beispiel.test`)).status).toBe(401);
    expect((await pruefen(token)).status).toBe(404);
    const { rows } = await admin.query("SELECT email_aenderung_token_hash, email_aenderung_ablauf, email_aenderung_von FROM klient_zugang WHERE klient_id = $1", [klientId]);
    expect(rows[0]).toEqual({ email_aenderung_token_hash: null, email_aenderung_ablauf: null, email_aenderung_von: null });

    const audit = await admin.query("SELECT benutzer_id, vorher, nachher FROM audit_log WHERE mandant_id = $1 AND aktion = 'zugang-email-geaendert' AND objekt_id = (SELECT id FROM klient_zugang WHERE klient_id = $2)", [mandantAId, klientId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].benutzer_id).toBe(leitungAId);
    expect(audit.rows[0].vorher.email).toBe(alt);
    expect(audit.rows[0].nachher.email).toBe(neu);
    expect(JSON.stringify(audit.rows[0])).not.toContain(token);
  });

  it("Falsches Passwort und unbekannter Link: identische 401-Antwort; Link bleibt nach falschem Passwort gueltig", async () => {
    const klientId = await aktiverKlient(`k3-${suffix}@beispiel.test`);
    const token = await linkFuer(klientId);
    const falschesPw = await einloesen(token, `k3neu-${suffix}@beispiel.test`, "falsches passwort");
    const falscherLink = await einloesen("0".repeat(64), `k3neu-${suffix}@beispiel.test`);
    expect(falschesPw.status).toBe(401);
    expect(falscherLink.status).toBe(401);
    expect(falschesPw.body.message).toBe(falscherLink.body.message);
    expect((await klientLogin(`k3-${suffix}@beispiel.test`)).status).toBe(201);
    expect((await pruefen(token)).status).toBe(200);
  });

  it("Abgelaufener Link: Pruefen 404, Einloesen 401", async () => {
    const klientId = await aktiverKlient(`k4-${suffix}@beispiel.test`);
    const token = await linkFuer(klientId);
    await admin.query("UPDATE klient_zugang SET email_aenderung_ablauf = now() - interval '1 hour' WHERE klient_id = $1", [klientId]);
    expect((await pruefen(token)).status).toBe(404);
    expect((await einloesen(token, `k4neu-${suffix}@beispiel.test`)).status).toBe(401);
    expect((await als(tokenLeitungA).get(`/klienten/${klientId}/zugang`)).body.emailAenderungOffenBis).toBeNull();
  });

  it("Vergebene E-Mail im Mandanten -> 409, Link bleibt fuer einen zweiten Versuch; anderer Mandant darf dieselbe Adresse haben", async () => {
    const vergeben = `k5b-${suffix}@beispiel.test`;
    await aktiverKlient(vergeben);
    const klientId = await aktiverKlient(`k5-${suffix}@beispiel.test`);
    const token = await linkFuer(klientId);
    expect((await einloesen(token, vergeben)).status).toBe(409);
    expect((await einloesen(token, vergeben.toUpperCase())).status).toBe(409); // citext
    expect((await klientLogin(`k5-${suffix}@beispiel.test`)).status).toBe(201);
    expect((await einloesen(token, `k5neu-${suffix}@beispiel.test`)).status).toBe(201);
  });

  it("Neuer Link ersetzt den alten", async () => {
    const klientId = await aktiverKlient(`k6-${suffix}@beispiel.test`);
    const alt = await linkFuer(klientId);
    const neu = await linkFuer(klientId);
    expect((await pruefen(alt)).status).toBe(404);
    expect((await pruefen(neu)).status).toBe(200);
  });

  it("Link nur bei aktivem Zugang mit Passwort: eingeladen -> 409, deaktiviert -> 409, kein Zugang -> 404", async () => {
    const t = als(tokenLeitungA);
    const ohneZugang = await neuerKlient();
    expect((await t.post(`/klienten/${ohneZugang}/zugang/email-aendern-link`)).status).toBe(404);

    const eingeladen = await neuerKlient();
    expect((await t.post(`/klienten/${eingeladen}/zugang`, { email: `k7-${suffix}@beispiel.test` })).status).toBe(201);
    const res = await t.post(`/klienten/${eingeladen}/zugang/email-aendern-link`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Neu einladen/);

    const deaktiviert = await aktiverKlient(`k7b-${suffix}@beispiel.test`);
    await t.patch(`/klienten/${deaktiviert}/zugang`, { aktiv: false });
    expect((await t.post(`/klienten/${deaktiviert}/zugang/email-aendern-link`)).status).toBe(409);
  });

  it("Deaktivieren verwirft einen offenen Link; Reaktivieren belebt ihn nicht wieder", async () => {
    const klientId = await aktiverKlient(`k8-${suffix}@beispiel.test`);
    const token = await linkFuer(klientId);
    await als(tokenLeitungA).patch(`/klienten/${klientId}/zugang`, { aktiv: false });
    expect((await pruefen(token)).status).toBe(404);
    await als(tokenLeitungA).patch(`/klienten/${klientId}/zugang`, { aktiv: true });
    expect((await pruefen(token)).status).toBe(404);
    expect((await einloesen(token, `k8neu-${suffix}@beispiel.test`)).status).toBe(401);
  });

  it("Archivieren und Anonymisieren verwerfen den Link (Trigger)", async () => {
    const a = await aktiverKlient(`k9a-${suffix}@beispiel.test`);
    const tokenA = await linkFuer(a);
    await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [a, leitungAId]);
    expect((await pruefen(tokenA)).status).toBe(404);
    const rowA = (await admin.query("SELECT email_aenderung_token_hash, email_aenderung_von FROM klient_zugang WHERE klient_id = $1", [a])).rows[0];
    expect(rowA).toEqual({ email_aenderung_token_hash: null, email_aenderung_von: null });

    const b = await aktiverKlient(`k9b-${suffix}@beispiel.test`);
    const tokenB = await linkFuer(b);
    await admin.query("UPDATE klient SET anonymisiert_am = now(), anonymisiert_von = $2 WHERE id = $1", [b, leitungAId]);
    expect((await pruefen(tokenB)).status).toBe(404);
    expect((await einloesen(tokenB, `k9bneu-${suffix}@beispiel.test`)).status).toBe(401);
    const rowB = (await admin.query("SELECT email_aenderung_token_hash FROM klient_zugang WHERE klient_id = $1", [b])).rows[0];
    expect(rowB.email_aenderung_token_hash).toBeNull();
  });

  it("Archivierter Klient mit noch gesetztem Token (Trigger umgangen): Funktion loest trotzdem nichts ein", async () => {
    const klientId = await aktiverKlient(`k10-${suffix}@beispiel.test`);
    const token = await linkFuer(klientId);
    await admin.query("ALTER TABLE klient DISABLE TRIGGER klient_zugang_bei_sperre");
    try {
      await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [klientId, leitungAId]);
    } finally {
      await admin.query("ALTER TABLE klient ENABLE TRIGGER klient_zugang_bei_sperre");
    }
    expect((await pruefen(token)).status).toBe(404);
    expect((await einloesen(token, `k10neu-${suffix}@beispiel.test`)).status).toBe(401);
  });

  it("Neu einladen mit E-Mail vor dem Passwort: korrigiert Adresse, neuer Link, Audit nennt die Aenderung", async () => {
    const t = als(tokenLeitungA);
    const klientId = await neuerKlient();
    const falsch = `tippfehler-${suffix}@beispiel.test`;
    const richtig = `richtig-${suffix}@beispiel.test`;
    await t.post(`/klienten/${klientId}/zugang`, { email: falsch });
    const res = await t.post(`/klienten/${klientId}/zugang/neu-einladen`, { email: richtig });
    expect(res.status).toBe(201);
    expect((await t.get(`/klienten/${klientId}/zugang`)).body.email).toBe(richtig);

    const einl = await request(http()).post("/auth/klient/einladung/einloesen").send({
      token: res.body.einladungsLink.split("klient-einladung=")[1], neuesPasswort: klientPasswort,
    });
    expect(einl.status).toBe(201);
    expect((await klientLogin(richtig)).status).toBe(201);
    expect((await klientLogin(falsch)).status).toBe(401);

    const audit = await admin.query("SELECT vorher, nachher FROM audit_log WHERE mandant_id = $1 AND aktion = 'zugang-neu-einladen' AND objekt_id = (SELECT id FROM klient_zugang WHERE klient_id = $2)", [mandantAId, klientId]);
    expect(audit.rows[0].vorher.email).toBe(falsch);
    expect(audit.rows[0].nachher.email).toBe(richtig);
  });

  it("Neu einladen mit E-Mail: vergebene Adresse -> 409 (Zugang unveraendert); nach dem Passwort -> 409 mit Hinweis", async () => {
    const t = als(tokenLeitungA);
    const belegt = `belegt-${suffix}@beispiel.test`;
    await aktiverKlient(belegt);
    const klientId = await neuerKlient();
    const orig = `orig-${suffix}@beispiel.test`;
    await t.post(`/klienten/${klientId}/zugang`, { email: orig });
    expect((await t.post(`/klienten/${klientId}/zugang/neu-einladen`, { email: belegt })).status).toBe(409);
    expect((await t.get(`/klienten/${klientId}/zugang`)).body.email).toBe(orig);

    const aktiv = await aktiverKlient(`k11-${suffix}@beispiel.test`);
    const res = await t.post(`/klienten/${aktiv}/zugang/neu-einladen`, { email: `k11neu-${suffix}@beispiel.test` });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Änderungslink/);
    expect((await t.get(`/klienten/${aktiv}/zugang`)).body.email).toBe(`k11-${suffix}@beispiel.test`);
    // ohne E-Mail bleibt Neu-Einladen nach Passwort erlaubt (Passwort vergessen)
    expect((await t.post(`/klienten/${aktiv}/zugang/neu-einladen`)).status).toBe(201);
  });

  it("Rechte: ohne Recht 403, unsichtbarer Klient 404, anderer Mandant 404", async () => {
    const klientId = await aktiverKlient(`k12-${suffix}@beispiel.test`);
    const pfad = (id: string) => `/klienten/${id}/zugang/email-aendern-link`;
    expect((await als(tokenBetreuerA).post(pfad(klientId))).status).toBe(403);
    expect((await als(tokenBetreuerA).post(`/klienten/${klientId}/zugang/neu-einladen`, { email: "x@beispiel.test" })).status).toBe(403);
    expect((await als(tokenLeitungEingeschraenktA).post(pfad(klientFremdId))).status).toBe(404);
    expect((await als(tokenLeitungB).post(pfad(klientId))).status).toBe(404);
    expect((await als(tokenLeitungB).post(`/klienten/${klientId}/zugang/neu-einladen`, { email: "x@beispiel.test" })).status).toBe(404);
    const { rows } = await admin.query("SELECT email_aenderung_token_hash FROM klient_zugang WHERE klient_id = $1", [klientId]);
    expect(rows[0].email_aenderung_token_hash).toBeNull();
  });

  it("Mandantentrennung in der Korrektur-Funktion: fremder Tenant-Kontext aendert nichts", async () => {
    const klientId = await neuerKlient();
    const orig = `mt-${suffix}@beispiel.test`;
    await als(tokenLeitungA).post(`/klienten/${klientId}/zugang`, { email: orig });
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantBId]);
      const { rows } = await app_.query("SELECT klient_zugang_email_korrigieren($1, 'fremd@beispiel.test') AS e", [klientId]);
      expect(rows[0].e).toBe("nicht_gefunden");
      await app_.query("ROLLBACK");
      // ohne Kontext ebenso
      const ohne = await app_.query("SELECT klient_zugang_email_korrigieren($1, 'fremd@beispiel.test') AS e", [klientId]);
      expect(ohne.rows[0].e).toBe("nicht_gefunden");
    } finally {
      await app_.end();
    }
    expect((await admin.query("SELECT email FROM klient_zugang WHERE klient_id = $1", [klientId])).rows[0].email).toBe(orig);
  });

  it("App-Rolle darf email nicht direkt aendern (42501), die Token-Spalten aber schon", async () => {
    const klientId = await aktiverKlient(`k13-${suffix}@beispiel.test`);
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
      await expect(app_.query("UPDATE klient_zugang SET email = 'x@beispiel.test' WHERE klient_id = $1", [klientId])).rejects.toMatchObject({ code: "42501" });
      await app_.query("ROLLBACK");

      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
      await app_.query("UPDATE klient_zugang SET email_aenderung_token_hash = 'h', email_aenderung_ablauf = now(), email_aenderung_von = $2 WHERE klient_id = $1", [klientId, leitungAId]);
      await app_.query("ROLLBACK");
    } finally {
      await app_.end();
    }
  });
});
