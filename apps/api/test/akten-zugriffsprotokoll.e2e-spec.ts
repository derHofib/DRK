/**
 * Lesezugriffe auf Klientenakten (migrations/0070_akten_zugriffsprotokoll.sql):
 * jedes Oeffnen einer Akte und jeder Abruf eines Aktenauszugs landet im
 * unveraenderlichen audit_log; die Leitung wertet das ueber
 * GET /audit-log/akten-zugriffe aus (Recht klienten.zugriffsprotokoll).
 *
 * Kernaussagen:
 * 1. Oeffnen schreibt genau einen Eintrag; Nachladen im Zeitfenster nicht,
 *    ein spaeteres Oeffnen wieder.
 * 2. Was nicht ausgeliefert wird (404), steht nicht im Protokoll.
 * 3. Auswertung nur mit dem Recht; Filter wirken; falsche Parameter -> 400.
 * 4. Mandantentrennung: ein anderer Traeger sieht nichts davon.
 * 5. Klientennamen werden beim Lesen anonymisiert (Standorteinschraenkung).
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

describe("Akten-Zugriffsprotokoll", () => {
  let app: INestApplication;
  let admin: Client;

  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const mandantIds: string[] = [];

  let mandantSlug: string;
  let mandantId: string;
  let klientAId: string;
  let klientBId: string;
  let betreuerId: string;
  let leitungId: string;
  let tokenLeitung: string; // Vollzugriff
  let tokenBetreuer: string; // kein Zugriffsprotokoll-Recht
  let tokenEinschraenkt: string; // Recht ja, aber auf einen fremden Standort beschraenkt
  let tokenAnderer: string; // anderer Mandant

  async function login(slug: string, email: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort });
    return res.body.accessToken as string;
  }
  const als = (token: string) => ({
    get: (pfad: string) => request(app.getHttpServer()).get(pfad).set("Authorization", `Bearer ${token}`),
    patch: (pfad: string) => request(app.getHttpServer()).patch(pfad).set("Authorization", `Bearer ${token}`),
  });
  async function anzahlEintraege(aktion: string, klientId: string, benutzerId?: string): Promise<number> {
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE modul = 'klienten' AND aktion = $1 AND objekt_id = $2 AND ($3::uuid IS NULL OR benutzer_id = $3)`,
      [aktion, klientId, benutzerId ?? null]
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const passwortHash = await bcrypt.hash(passwort, 4);

    async function neuerMandant(slug: string) {
      const { rows } = await admin.query<{ id: string }>(
        "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
        [`Testmandant Zugriff ${slug}`, slug]
      );
      mandantIds.push(rows[0].id);
      return rows[0].id;
    }
    mandantSlug = `test-zugriff-a-${suffix}`;
    mandantId = await neuerMandant(mandantSlug);
    const anderesSlug = `test-zugriff-b-${suffix}`;
    const anderesId = await neuerMandant(anderesSlug);

    leitungId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "bereichsleitung", email: `leitung-${suffix}@beispiel.test`, name: "Leitung Test", passwortHash,
    });
    betreuerId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "betreuer", email: `betreuer-${suffix}@beispiel.test`, name: "Betreuer Test", passwortHash,
    });
    const einschraenktId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "einrichtungsleitung", email: `eingeschraenkt-${suffix}@beispiel.test`, name: "Einrichtung Test", passwortHash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: anderesId, rolle: "bereichsleitung", email: `anders-${suffix}@beispiel.test`, name: "Andere Leitung", passwortHash,
    });

    // Einrichtungsleitung bekommt das Recht wie es die Migration 0070 fuer
    // bestehende Leitungs-Account-Typen vergibt.
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       SELECT mandant_id, account_typ_id, 'klienten', 'zugriffsprotokoll', scope, true
       FROM account_typ_recht WHERE mandant_id = $1 AND modul = 'klienten' AND aktion = 'anonymisieren'
       ON CONFLICT DO NOTHING`,
      [mandantId]
    );

    const { rows: kRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Anna', 'Akte', '1995-01-01', $2, 'Amt'), ($1, 'Bernd', 'Beispiel', '1996-02-02', $3, 'Amt')
       RETURNING id`,
      [mandantId, `AZ-A-${suffix}`, `AZ-B-${suffix}`]
    );
    klientAId = kRows[0].id;
    klientBId = kRows[1].id;

    // Standort, an dem der eingeschraenkte Benutzer arbeitet -- die Klienten
    // wohnen dort NICHT, er sieht sie also nur als Initialen.
    const { rows: s } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Fremd', 'Str. 1') RETURNING id",
      [mandantId]
    );
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId, einschraenktId, s[0].id,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tokenLeitung = await login(mandantSlug, `leitung-${suffix}@beispiel.test`);
    tokenBetreuer = await login(mandantSlug, `betreuer-${suffix}@beispiel.test`);
    tokenEinschraenkt = await login(mandantSlug, `eingeschraenkt-${suffix}@beispiel.test`);
    tokenAnderer = await login(anderesSlug, `anders-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    try {
      for (const id of mandantIds) {
        await raeumeKontoMitRolleAuf(admin, id);
        await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM klient_archiv_pdf WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM standort WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM klient WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [id]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [id]);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("protokolliert das Oeffnen einer Akte mit Person, Klient und Aktion", async () => {
    const res = await als(tokenBetreuer).get(`/klienten/${klientAId}`);
    expect(res.status).toBe(200);
    expect(await anzahlEintraege("akte_geoeffnet", klientAId, betreuerId)).toBe(1);
  });

  it("protokolliert ein Nachladen im Zeitfenster nicht doppelt, ein spaeteres Oeffnen aber wieder", async () => {
    await als(tokenBetreuer).get(`/klienten/${klientAId}`);
    await als(tokenBetreuer).get(`/klienten/${klientAId}`);
    expect(await anzahlEintraege("akte_geoeffnet", klientAId, betreuerId)).toBe(1);

    // Gegenprobe: ohne das Fenster waere es bei 3 -- hier wird der alte
    // Eintrag nur zeitlich zurueckgesetzt (admin darf, die App-Rolle nicht).
    await admin.query(
      "UPDATE audit_log SET erstellt_am = now() - interval '2 hours' WHERE objekt_id = $1 AND aktion = 'akte_geoeffnet'",
      [klientAId]
    );
    await als(tokenBetreuer).get(`/klienten/${klientAId}`);
    expect(await anzahlEintraege("akte_geoeffnet", klientAId, betreuerId)).toBe(2);
  });

  it("protokolliert nichts, wenn die Akte nicht ausgeliefert wird (404)", async () => {
    const unbekannt = randomUUID();
    const res = await als(tokenBetreuer).get(`/klienten/${unbekannt}`);
    expect(res.status).toBe(404);
    expect(await anzahlEintraege("akte_geoeffnet", unbekannt)).toBe(0);
  });

  it("protokolliert einen Abruf des Aktenauszugs (Archiv-PDF) ohne Zeitfenster", async () => {
    const archiviert = await als(tokenLeitung).patch(`/klienten/${klientBId}/archivieren`);
    expect(archiviert.status).toBe(200);
    const archivId = archiviert.body.archivPdfs[0].id;
    await als(tokenLeitung).get(`/klienten/${klientBId}/archiv/${archivId}/pdf`).expect(200);
    await als(tokenLeitung).get(`/klienten/${klientBId}/archiv/${archivId}/pdf`).expect(200);
    expect(await anzahlEintraege("archiv_pdf_geladen", klientBId, leitungId)).toBe(2);
  });

  it("liefert der Leitung Eintraege und Summen je Person", async () => {
    const res = await als(tokenLeitung).get("/audit-log/akten-zugriffe");
    expect(res.status).toBe(200);
    expect(res.body.gesamt).toBeGreaterThanOrEqual(4);
    const betreuer = res.body.jeBenutzer.find((b: { benutzerId: string }) => b.benutzerId === betreuerId);
    expect(betreuer).toMatchObject({ benutzerName: "Betreuer Test", anzahl: 2, anzahlKlienten: 1 });
    const eintrag = res.body.eintraege.find((e: { klientId: string; aktion: string }) => e.klientId === klientAId);
    expect(eintrag).toMatchObject({ klientName: "Anna Akte", aktion: "akte_geoeffnet", benutzerName: "Betreuer Test" });
  });

  it("filtert nach Person, Klient und Datum", async () => {
    const nachBetreuer = await als(tokenLeitung).get(`/audit-log/akten-zugriffe?benutzerId=${betreuerId}`);
    expect(nachBetreuer.body.eintraege.every((e: { benutzerId: string }) => e.benutzerId === betreuerId)).toBe(true);

    const nachKlient = await als(tokenLeitung).get(`/audit-log/akten-zugriffe?klientId=${klientBId}`);
    expect(nachKlient.body.gesamt).toBe(2);

    const zukunft = await als(tokenLeitung).get("/audit-log/akten-zugriffe?von=2999-01-01");
    expect(zukunft.body).toMatchObject({ gesamt: 0, eintraege: [], jeBenutzer: [] });

    const seite = await als(tokenLeitung).get("/audit-log/akten-zugriffe?limit=1");
    expect(seite.body.eintraege).toHaveLength(1);
    expect(seite.body.gesamt).toBeGreaterThan(1);
  });

  it("lehnt falsche Parameter mit 400 ab", async () => {
    const res = await als(tokenLeitung).get("/audit-log/akten-zugriffe?von=gestern");
    expect(res.status).toBe(400);
  });

  it("verweigert die Auswertung ohne das Recht mit 403", async () => {
    const res = await als(tokenBetreuer).get("/audit-log/akten-zugriffe");
    expect(res.status).toBe(403);
  });

  it("zeigt einem anderen Traeger keine Eintraege (RLS)", async () => {
    const res = await als(tokenAnderer).get("/audit-log/akten-zugriffe");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gesamt: 0, eintraege: [] });
  });

  it("zeigt Klientennamen ausserhalb des eigenen Standorts nur als Initialen", async () => {
    const res = await als(tokenEinschraenkt).get("/audit-log/akten-zugriffe");
    expect(res.status).toBe(200);
    const namen = res.body.eintraege.map((e: { klientName: string }) => e.klientName);
    expect(namen.length).toBeGreaterThan(0);
    expect(namen).not.toContain("Anna Akte");
    expect(namen).toContain("A. A.");
  });

  it("macht Eintraege fuer die App-Rolle unveraenderlich", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(app_.query("DELETE FROM audit_log WHERE modul = 'klienten'")).rejects.toThrow(/permission denied/);
    } finally {
      await app_.query("ROLLBACK").catch(() => {});
      await app_.end();
    }
  });
});
