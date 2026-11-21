/**
 * Abwesenheiten und Terminart (Migration 0074): wer sieht was, wer darf
 * eintragen/stornieren, Unveraenderlichkeit in der Datenbank, Mandanten-
 * trennung und Klient:innen ohne Zugriff.
 *
 * Die Datenbank-Tests verbinden sich als zimmerakte_app, nicht als Admin --
 * nur diese Rolle zeigt, ob RLS, REVOKE/GRANT und der Storno-Trigger greifen.
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
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";

describe("Abwesenheiten und Terminart", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  let mandantA: string;
  let mandantB: string;
  let slugA: string;
  let slugB: string;
  let leitungId: string;
  let ma1Id: string;
  let ma2Id: string;
  let tokenLeitung: string;
  let tokenMa1: string;
  let tokenMa2: string;
  let tokenB: string;
  let tokenKlient: string;

  const http = () => app.getHttpServer();
  const get = (token: string, pfad: string) => request(http()).get(pfad).set("Authorization", `Bearer ${token}`);
  const post = (token: string, pfad: string, body: object = {}) => request(http()).post(pfad).set("Authorization", `Bearer ${token}`).send(body);
  const liste = (token: string) => get(token, "/kalender/abwesenheiten?von=2026-01-01&bis=2026-12-31");

  async function alsApp<T>(mandantId: string, benutzerId: string, f: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await c.query("SELECT set_config('app.benutzer_id', $1, true)", [benutzerId]);
      return await f(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.end();
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    slugA = `test-abw-a-${suffix}`;
    slugB = `test-abw-b-${suffix}`;
    mandantA = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Abw A ${suffix}`, slugA])).rows[0].id;
    mandantB = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Abw B ${suffix}`, slugB])).rows[0].id;
    const hash = await bcrypt.hash(passwort, 4);
    const email = (k: string) => `${k}-${suffix}@beispiel.test`;
    leitungId = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "einrichtungsleitung", email: email("leitung"), name: "Leitung", passwortHash: hash });
    ma1Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: email("ma1"), name: "Anna Eins", passwortHash: hash });
    ma2Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: email("ma2"), name: "Bernd Zwei", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantB, rolle: "einrichtungsleitung", email: email("b"), name: "Leitung B", passwortHash: hash });
    const klientId = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Kim', 'Klient', '1990-01-01', $2, 'Amt') RETURNING id`,
        [mandantA, `AZ-ABW-${suffix}`]
      )
    ).rows[0].id;
    await legeKlientZugangAn(admin, { mandantId: mandantA, klientId, email: email("klient"), passwortHash: hash, eingeladenVon: leitungId });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (slug: string, k: string) => (await request(http()).post("/auth/login").send({ mandantSlug: slug, email: email(k), passwort })).body.accessToken;
    tokenLeitung = await login(slugA, "leitung");
    tokenMa1 = await login(slugA, "ma1");
    tokenMa2 = await login(slugA, "ma2");
    tokenB = await login(slugB, "b");
    tokenKlient = await klientToken(app, slugA, email("klient"), passwort);
  });

  afterAll(async () => {
    try {
      for (const m of [mandantA, mandantB]) {
        await admin.query("DELETE FROM abwesenheit WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM termin_teilnehmer WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM termin WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM klient_zugang WHERE mandant_id = $1", [m]);
        await raeumeKontoMitRolleAuf(admin, m);
        await admin.query("DELETE FROM klient WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m]);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  let krankId: string;
  let urlaubId: string;

  it("Mitarbeiter:in traegt eigenen Urlaub ein (ohne besonderes Recht)", async () => {
    const r = await post(tokenMa1, "/kalender/abwesenheiten", { art: "urlaub", von: "2026-07-14", bis: "2026-07-25", notiz: "Sommer" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ benutzer: { id: ma1Id, name: "Anna Eins" }, art: "urlaub", von: "2026-07-14", bis: "2026-07-25", notiz: "Sommer", stornierbar: true });
    urlaubId = r.body.id;
  });

  it("Mitarbeiter:in darf NICHT fuer andere eintragen (403), Leitung schon", async () => {
    const vorher = Number((await admin.query("SELECT count(*) FROM abwesenheit WHERE mandant_id = $1", [mandantA])).rows[0].count);
    expect((await post(tokenMa1, "/kalender/abwesenheiten", { benutzerId: ma2Id, art: "krank", von: "2026-11-17", bis: "2026-11-19" })).status).toBe(403);
    expect(Number((await admin.query("SELECT count(*) FROM abwesenheit WHERE mandant_id = $1", [mandantA])).rows[0].count)).toBe(vorher);

    const r = await post(tokenLeitung, "/kalender/abwesenheiten", { benutzerId: ma2Id, art: "krank", von: "2026-11-17", bis: "2026-11-19", notiz: "AU liegt vor" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ benutzer: { id: ma2Id }, art: "krank", notiz: "AU liegt vor" });
    krankId = r.body.id;
    const zeile = (await admin.query("SELECT eingetragen_von FROM abwesenheit WHERE id = $1", [krankId])).rows[0];
    expect(zeile.eingetragen_von).toBe(leitungId);
  });

  it("Kolleg:in sieht DASS und WANN, aber nicht den Grund und keine Notiz", async () => {
    const r = await liste(tokenMa1);
    expect(r.status).toBe(200);
    const krank = r.body.find((a: { id: string }) => a.id === krankId);
    expect(krank).toMatchObject({ benutzer: { id: ma2Id }, art: null, notiz: null, von: "2026-11-17", bis: "2026-11-19", stornierbar: false });
    // Die Antwort darf das Wort nirgends enthalten, auch nicht ueber Umwege.
    expect(JSON.stringify(krank)).not.toMatch(/krank|AU liegt/);
    // Eigene Abwesenheit: voller Grund.
    expect(r.body.find((a: { id: string }) => a.id === urlaubId)).toMatchObject({ art: "urlaub", notiz: "Sommer" });
  });

  it("Betroffene Person sieht ihren eigenen Grund, Leitung alle Gruende", async () => {
    expect((await liste(tokenMa2)).body.find((a: { id: string }) => a.id === krankId)).toMatchObject({ art: "krank", notiz: "AU liegt vor", stornierbar: true });
    const leitung = (await liste(tokenLeitung)).body;
    expect(leitung.find((a: { id: string }) => a.id === krankId)).toMatchObject({ art: "krank", stornierbar: true });
    expect(leitung.find((a: { id: string }) => a.id === urlaubId)).toMatchObject({ art: "urlaub", stornierbar: true });
  });

  it("Rechte-Endpunkt spiegelt die Rolle", async () => {
    expect((await get(tokenMa1, "/kalender/abwesenheiten/rechte")).body).toEqual({ artSehen: false, verwalten: false });
    expect((await get(tokenLeitung, "/kalender/abwesenheiten/rechte")).body).toEqual({ artSehen: true, verwalten: true });
  });

  it("Zeitraum filtert: nur ueberlappende Abwesenheiten", async () => {
    const r = await get(tokenLeitung, "/kalender/abwesenheiten?von=2026-11-19&bis=2026-11-30");
    expect(r.body.map((a: { id: string }) => a.id)).toEqual([krankId]);
    expect((await get(tokenLeitung, "/kalender/abwesenheiten?von=2026-11-20&bis=2026-11-30")).body).toEqual([]);
  });

  it("Validierung: falsche Art, bis vor von, kaputtes Datum, laenger als ein Jahr -> 400", async () => {
    const r = (body: object) => post(tokenMa1, "/kalender/abwesenheiten", { art: "urlaub", von: "2026-03-01", bis: "2026-03-02", ...body });
    expect((await r({ art: "kur" })).status).toBe(400);
    expect((await r({ bis: "2026-02-28" })).status).toBe(400);
    expect((await r({ von: "1.3.2026" })).status).toBe(400);
    expect((await r({ bis: "2027-03-05" })).status).toBe(400);
    expect((await r({ diagnose: "Grippe" })).status).toBe(400);
  });

  it("Stornieren: fremde nur mit Recht, eigene immer; danach nicht mehr in der Liste", async () => {
    expect((await post(tokenMa1, `/kalender/abwesenheiten/${krankId}/stornieren`)).status).toBe(403);
    expect((await post(tokenMa1, `/kalender/abwesenheiten/${urlaubId}/stornieren`)).status).toBe(200);
    expect((await post(tokenMa1, `/kalender/abwesenheiten/${urlaubId}/stornieren`)).status).toBe(409);
    expect((await liste(tokenLeitung)).body.map((a: { id: string }) => a.id)).not.toContain(urlaubId);
    // Die Zeile bleibt mit Urheber erhalten.
    const z = (await admin.query("SELECT storniert_von FROM abwesenheit WHERE id = $1", [urlaubId])).rows[0];
    expect(z.storniert_von).toBe(ma1Id);
  });

  it("Klient:innen haben keinen Zugriff auf Abwesenheiten", async () => {
    expect([401, 403]).toContain((await liste(tokenKlient)).status);
    // Auch direkt in der DB nicht: ohne app.benutzer_id liefert die Policy nichts.
    const n = await alsApp(mandantA, "", async (c) => (await c.query("SELECT count(*) FROM abwesenheit")).rows[0].count);
    expect(Number(n)).toBe(0);
  });

  it("Mandantentrennung: Traeger B sieht nichts und kann nicht fuer Personen von A eintragen", async () => {
    expect((await get(tokenB, "/kalender/abwesenheiten?von=2026-01-01&bis=2026-12-31")).body).toEqual([]);
    expect((await post(tokenB, "/kalender/abwesenheiten", { benutzerId: ma1Id, art: "urlaub", von: "2026-05-01", bis: "2026-05-02" })).status).toBe(404);
    expect((await post(tokenB, `/kalender/abwesenheiten/${krankId}/stornieren`)).status).toBe(404);
  });

  it("Datenbank: App-Rolle kann weder aendern noch loeschen noch ein Storno zuruecknehmen", async () => {
    await alsApp(mandantA, leitungId, async (c) => {
      await expect(c.query("UPDATE abwesenheit SET art = 'urlaub' WHERE id = $1", [krankId])).rejects.toThrow(/permission denied/);
    });
    await alsApp(mandantA, leitungId, async (c) => {
      await expect(c.query("DELETE FROM abwesenheit WHERE id = $1", [krankId])).rejects.toThrow(/permission denied/);
    });
    await alsApp(mandantA, leitungId, async (c) => {
      await expect(c.query("UPDATE abwesenheit SET storniert_am = NULL, storniert_von = NULL WHERE id = $1", [urlaubId])).rejects.toThrow(/stornierte Abwesenheit/);
    });
  });

  it("Datenbank: zusammengesetzter FK verhindert eine Person eines anderen Traegers", async () => {
    await alsApp(mandantB, leitungId, async (c) => {
      await expect(
        c.query("INSERT INTO abwesenheit (mandant_id, benutzer_id, art, von, bis, eingetragen_von) VALUES ($1, $2, 'urlaub', '2026-01-01', '2026-01-02', $2)", [mandantB, ma1Id])
      ).rejects.toThrow(/foreign key|violates/);
    });
  });

  // Seit migrations/0085 ist die feste Terminart ein Termintyp je Traeger
  // (Details in termin-typen.e2e-spec.ts). Hier nur: der Bestand aus 0074
  // ist als Typ da und am Termin waehl- und aenderbar.
  it("Termintyp: Standard ist 'Termin', Besprechung/Klient:innentermin sind waehl- und aenderbar", async () => {
    const typen = (await request(http()).get("/kalender/typen").set("Authorization", `Bearer ${tokenMa1}`)).body as { id: string; bezeichnung: string }[];
    const typ = (name: string) => typen.find((t) => t.bezeichnung === name)!.id;
    const ohne = await post(tokenMa1, "/kalender/termine", { titel: "Ohne Art", beginn: "2026-11-20", ende: "2026-11-20", ganztaegig: true });
    expect(ohne.status).toBe(201);
    expect(ohne.body.typ).toMatchObject({ bezeichnung: "Termin", istStandard: true });
    const mit = await post(tokenMa1, "/kalender/termine", { titel: "Team", beginn: "2026-11-21", ende: "2026-11-21", ganztaegig: true, typId: typ("Besprechung") });
    expect(mit.body.typ.bezeichnung).toBe("Besprechung");
    const geaendert = await request(http()).patch(`/kalender/termine/${mit.body.id}`).set("Authorization", `Bearer ${tokenMa1}`).send({ typId: typ("Klient:innentermin") });
    expect(geaendert.status).toBe(200);
    expect(geaendert.body.typ.bezeichnung).toBe("Klient:innentermin");
    // Die alte feste Art gibt es nicht mehr: beim Aendern ein klarer 400.
    expect((await request(http()).patch(`/kalender/termine/${mit.body.id}`).set("Authorization", `Bearer ${tokenMa1}`).send({ art: "klient" })).status).toBe(400);
  });
});
