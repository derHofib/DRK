/**
 * Kalender (Chat-Plan, Schritt 2).
 *
 * Kernaussagen:
 *   1. Ein Termin ist nur fuer Ersteller:in und Teilnehmende sichtbar -- auch
 *      ein ist_vollzugriff-Konto bekommt 404 (per RLS, nicht per Code).
 *   2. Aendern/Absagen nur durch die Ersteller:in; abgesagte Termine sind
 *      eingefroren; Antworten/Uebernehmen sind idempotent.
 *   3. Teilnehmende muessen aktiv und fuer die einladende Person sichtbar sein;
 *      Klient:innen laden niemanden ein.
 *   4. Die App-Rolle kann Policies und gesperrte Spalten nicht umgehen.
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

describe("Kalender", () => {
  let app: INestApplication;
  let admin: Client;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";

  let mandantAId: string;
  let mandantBId: string;
  let leitungId: string;
  let betreuerId: string;
  let vollzugriffId: string;
  let eingeschraenktId: string;
  let leitungBId: string;
  let inaktivId: string;

  let tokenLeitung: string;
  let tokenBetreuer: string;
  let tokenVollzugriff: string;
  let tokenEingeschraenkt: string;
  let tokenLeitungB: string;
  let tokenKlient1: string;
  let tokenKlient2: string;

  let klient1Id: string; // Max Muster, Zugang, keine Belegung
  let klient2Id: string; // Erika Beispiel, Zugang, Belegung an S1
  let klient3Id: string; // ohne Zugang
  let klientBId: string; // anderer Mandant, mit Zugang

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
  });

  const zeit = (tag: string, uhr: string) => `2026-${tag}T${uhr}:00+01:00`;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    const slugA = `test-kal-a-${suffix}`;
    const slugB = `test-kal-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Kal A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Kal B ${suffix}`, slugB])).rows[0].id;

    const konto = (mandantId: string, rolle: "bereichsleitung" | "einrichtungsleitung" | "betreuer", kurz: string, name: string) =>
      kontoMitAlterRolle(admin, { mandantId, rolle, email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash: hash });
    leitungId = await konto(mandantAId, "einrichtungsleitung", "leitung", "Anna Leitung");
    betreuerId = await konto(mandantAId, "betreuer", "betreuer", "Bernd Betreuer");
    vollzugriffId = await konto(mandantAId, "bereichsleitung", "vollzugriff", "Vera Vollzugriff");
    eingeschraenktId = await konto(mandantAId, "einrichtungsleitung", "eingeschraenkt", "Egon Eingeschraenkt");
    inaktivId = await konto(mandantAId, "betreuer", "inaktiv", "Ida Inaktiv");
    leitungBId = await konto(mandantBId, "einrichtungsleitung", "leitung-b", "Lena Leitung B");
    await admin.query("UPDATE benutzer SET aktiv = false WHERE id = $1", [inaktivId]);

    const standortId = (
      await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S1', 'Str. 1') RETURNING id", [mandantAId])
    ).rows[0].id;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantAId, eingeschraenktId, standortId]);
    const zimmerId = (
      await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id", [mandantAId, standortId])
    ).rows[0].id;

    async function neuerKlient(mandantId: string, vorname: string, nachname: string, az: string): Promise<string> {
      return (
        await admin.query(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, $2, $3, '2005-01-01', $4, 'Jugendamt') RETURNING id`,
          [mandantId, vorname, nachname, `${az}-${suffix}`]
        )
      ).rows[0].id;
    }
    klient1Id = await neuerKlient(mandantAId, "Max", "Muster", "KAL1");
    klient2Id = await neuerKlient(mandantAId, "Erika", "Beispiel", "KAL2");
    klient3Id = await neuerKlient(mandantAId, "Karl", "Ohnezugang", "KAL3");
    klientBId = await neuerKlient(mandantBId, "Britta", "Fremd", "KALB");
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantAId, zimmerId, klient2Id]);

    const zugang = (mandantId: string, klientId: string, kurz: string, von: string) =>
      legeKlientZugangAn(admin, { mandantId, klientId, email: `${kurz}-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: von });
    await zugang(mandantAId, klient1Id, "klient1", leitungId);
    await zugang(mandantAId, klient2Id, "klient2", leitungId);
    await zugang(mandantBId, klientBId, "klientb", leitungBId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(slug: string, kurz: string) {
      const res = await request(http()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort });
      return res.body.accessToken as string;
    }
    tokenLeitung = await login(slugA, "leitung");
    tokenBetreuer = await login(slugA, "betreuer");
    tokenVollzugriff = await login(slugA, "vollzugriff");
    tokenEingeschraenkt = await login(slugA, "eingeschraenkt");
    tokenLeitungB = await login(slugB, "leitung-b");
    tokenKlient1 = await klientToken(app, slugA, `klient1-${suffix}@beispiel.test`, passwort);
    tokenKlient2 = await klientToken(app, slugA, `klient2-${suffix}@beispiel.test`, passwort);
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      await admin.query("DELETE FROM termin_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM termin WHERE mandant_id = ANY($1)", [ids]);
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM belegung WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM zimmer WHERE mandant_id = ANY($1)", [ids]);
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

  /** Fuehrt SQL mit der echten App-Rolle unter einem gesetzten Prinzipal aus (RLS aktiv). */
  async function alsAppRolle<T>(
    ctx: { mandantId: string; benutzerId?: string; klientId?: string },
    fn: (c: Client) => Promise<T>
  ): Promise<T> {
    const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.mandant_id', $1, true)", [ctx.mandantId]);
      await c.query("SELECT set_config('app.benutzer_id', $1, true)", [ctx.benutzerId ?? ""]);
      await c.query("SELECT set_config('app.klient_id', $1, true)", [ctx.klientId ?? ""]);
      return await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.end();
    }
  }

  let hauptId: string; // Termin der Leitung mit Betreuer + Klient 1

  it("Anlegen: Ersteller:in ist zugesagt, Eingeladene sind offen, Namen sind aus Sicht der Leitung voll", async () => {
    const res = await als(tokenLeitung).post("/kalender/termine", {
      titel: "  Hilfeplangespräch  ",
      beschreibung: "Mit Amt",
      beginn: zeit("11-05", "09:00"),
      ende: zeit("11-05", "10:30"),
      teilnehmer: [{ benutzerId: betreuerId }, { klientId: klient1Id }, { benutzerId: betreuerId }, { benutzerId: leitungId }],
    });
    expect(res.status).toBe(201);
    hauptId = res.body.id;
    expect(res.body).toMatchObject({
      titel: "Hilfeplangespräch",
      beschreibung: "Mit Amt",
      ort: null,
      beginn: "2026-11-05T08:00:00.000Z",
      ende: "2026-11-05T09:30:00.000Z",
      ganztaegig: false,
      abgesagtAm: null,
      binErsteller: true,
      meineAntwort: "zugesagt",
      erstelltVon: { art: "benutzer", id: leitungId, name: "Anna Leitung" },
    });
    // Duplikate und die eigene Person wurden entfernt: Leitung (zugesagt), Betreuer, Klient 1.
    expect(res.body.teilnehmer).toHaveLength(3);
    const nachArt = Object.fromEntries(res.body.teilnehmer.map((t: any) => [`${t.art}:${t.id}`, t]));
    expect(nachArt[`benutzer:${leitungId}`].antwort).toBe("zugesagt");
    expect(nachArt[`benutzer:${betreuerId}`]).toMatchObject({ antwort: "offen", geantwortetAm: null, name: "Bernd Betreuer" });
    expect(nachArt[`klient:${klient1Id}`]).toMatchObject({ antwort: "offen", name: "Max Muster" });
  });

  it("Eingabefehler -> 400", async () => {
    const t = als(tokenLeitung);
    const basis = { titel: "X", beginn: zeit("11-05", "09:00"), ende: zeit("11-05", "10:00") };
    expect((await t.post("/kalender/termine", { ...basis, titel: "   " })).status).toBe(400);
    expect((await t.post("/kalender/termine", { ...basis, ende: zeit("11-05", "08:00") })).status).toBe(400);
    expect((await t.post("/kalender/termine", { ...basis, beginn: "morgen" })).status).toBe(400);
    expect((await t.post("/kalender/termine", { ...basis, beginn: "2026-11-05T09:00:00" })).status).toBe(400);
    expect((await t.post("/kalender/termine", { ...basis, ganztaegig: true })).status).toBe(400);
    expect((await t.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: "kein-uuid" }] })).status).toBe(400);
  });

  it("Lesen als Teilnehmer:in: Betreuer sieht den Termin mit offener Antwort, Klient:in nur Vornamen anderer Klient:innen", async () => {
    const b = await als(tokenBetreuer).get(`/kalender/termine/${hauptId}`);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ binErsteller: false, meineAntwort: "offen" });

    const k = await als(tokenKlient1).get(`/kalender/termine/${hauptId}`);
    expect(k.status).toBe(200);
    expect(k.body.meineAntwort).toBe("offen");
    const klientTeilnehmer = k.body.teilnehmer.find((t: any) => t.art === "klient");
    expect(klientTeilnehmer.name).toBe("Max");
    expect(k.body.teilnehmer.find((t: any) => t.id === betreuerId).name).toBe("Bernd Betreuer");
  });

  it("Fremde (auch ist_vollzugriff, anderer Mandant, andere:r Klient:in) sehen den Termin weder per ID noch in der Liste -> 404", async () => {
    const von = "2026-11-01";
    const bis = "2026-12-01";
    for (const token of [tokenVollzugriff, tokenLeitungB, tokenKlient2]) {
      const t = als(token);
      expect((await t.get(`/kalender/termine/${hauptId}`)).status).toBe(404);
      expect((await t.get(`/kalender/termine/${hauptId}/ics`)).status).toBe(404);
      expect((await t.patch(`/kalender/termine/${hauptId}`, { titel: "gekapert" })).status).toBe(404);
      expect((await t.post(`/kalender/termine/${hauptId}/absagen`)).status).toBe(404);
      expect((await t.post(`/kalender/termine/${hauptId}/antwort`, { antwort: "zugesagt" })).status).toBe(404);
      expect((await t.post(`/kalender/termine/${hauptId}/uebernehmen`)).status).toBe(404);
      const liste = await t.get(`/kalender/termine?von=${von}&bis=${bis}`);
      expect(liste.status).toBe(200);
      expect(liste.body.map((x: any) => x.id)).not.toContain(hauptId);
    }
    expect((await als(tokenLeitung).get("/kalender/termine/kein-uuid")).status).toBe(404);
  });

  it("Ohne Token -> 401", async () => {
    expect((await request(http()).get("/kalender/termine?von=2026-11-01&bis=2026-12-01")).status).toBe(401);
  });

  it("Ändern/Absagen nur durch die Ersteller:in (403 fuer sichtbare Teilnehmende)", async () => {
    const b = als(tokenBetreuer);
    expect((await b.patch(`/kalender/termine/${hauptId}`, { titel: "Umbenannt" })).status).toBe(403);
    expect((await b.post(`/kalender/termine/${hauptId}/absagen`)).status).toBe(403);
    expect((await als(tokenKlient1).patch(`/kalender/termine/${hauptId}`, { ort: "Hier" })).status).toBe(403);

    const l = als(tokenLeitung);
    expect((await l.patch(`/kalender/termine/${hauptId}`, {})).status).toBe(400);
    expect((await l.patch(`/kalender/termine/${hauptId}`, { ende: zeit("11-05", "07:00") })).status).toBe(400);
    expect((await l.patch(`/kalender/termine/${hauptId}`, { erstelltVon: "x" })).status).toBe(400);
    const ok = await l.patch(`/kalender/termine/${hauptId}`, { ort: "Büro 3", beschreibung: null, ende: zeit("11-05", "11:00") });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ titel: "Hilfeplangespräch", ort: "Büro 3", beschreibung: null, ende: "2026-11-05T10:00:00.000Z" });
  });

  it("Antworten: zusagen, ablehnen (verschwindet aus der Liste, bleibt per ID lesbar), Uebernehmen setzt wieder zu und ist idempotent", async () => {
    const b = als(tokenBetreuer);
    const liste = () => b.get("/kalender/termine?von=2026-11-01&bis=2026-12-01").then((r) => r.body.map((x: any) => x.id));

    expect((await b.post(`/kalender/termine/${hauptId}/antwort`, { antwort: "vielleicht" })).status).toBe(400);
    const zu = await b.post(`/kalender/termine/${hauptId}/antwort`, { antwort: "zugesagt" });
    expect(zu.status).toBe(200);
    expect(zu.body.meineAntwort).toBe("zugesagt");
    expect(await liste()).toContain(hauptId);

    const ab = await b.post(`/kalender/termine/${hauptId}/antwort`, { antwort: "abgelehnt" });
    expect(ab.body.meineAntwort).toBe("abgelehnt");
    expect(await liste()).not.toContain(hauptId);
    expect((await b.get(`/kalender/termine/${hauptId}`)).status).toBe(200);

    const erst = await b.post(`/kalender/termine/${hauptId}/uebernehmen`);
    expect(erst.status).toBe(200);
    expect(erst.body.meineAntwort).toBe("zugesagt");
    const stempel = erst.body.teilnehmer.find((t: any) => t.id === betreuerId).geantwortetAm;
    expect(await liste()).toContain(hauptId);

    const zweit = await b.post(`/kalender/termine/${hauptId}/uebernehmen`);
    expect(zweit.status).toBe(200);
    expect(zweit.body.teilnehmer.find((t: any) => t.id === betreuerId).geantwortetAm).toBe(stempel);
    expect(zweit.body.teilnehmer).toHaveLength(3);

    const offen = await b.post(`/kalender/termine/${hauptId}/antwort`, { antwort: "offen" });
    expect(offen.body.teilnehmer.find((t: any) => t.id === betreuerId)).toMatchObject({ antwort: "offen", geantwortetAm: null });
  });

  it("Uebernehmen legt die Teilnehmerzeile an, wenn man den Termin sieht, aber nicht eingetragen ist", async () => {
    // Ohne Teilnehmerzeile sichtbar ist man (bis zum Chat-Teilen in Schritt 3) nur als Ersteller:in.
    const id = (
      await admin.query(
        `INSERT INTO termin (mandant_id, titel, beginn, ende, erstellt_von_benutzer_id)
         VALUES ($1, 'Ohne Zeile', '2026-11-06T08:00Z', '2026-11-06T09:00Z', $2) RETURNING id`,
        [mandantAId, vollzugriffId]
      )
    ).rows[0].id;
    const v = als(tokenVollzugriff);
    expect((await v.get(`/kalender/termine/${id}`)).body).toMatchObject({ meineAntwort: null, binErsteller: true });
    expect((await v.post(`/kalender/termine/${id}/antwort`, { antwort: "zugesagt" })).status).toBe(409);

    const res = await v.post(`/kalender/termine/${id}/uebernehmen`);
    expect(res.status).toBe(200);
    expect(res.body.meineAntwort).toBe("zugesagt");
    expect((await v.post(`/kalender/termine/${id}/uebernehmen`)).body.teilnehmer).toHaveLength(1);
  });

  it("Absagen: Termin bleibt sichtbar und markiert, ist danach eingefroren (409)", async () => {
    const neu = await als(tokenLeitung).post("/kalender/termine", {
      titel: "Fällt aus", beginn: zeit("11-12", "14:00"), ende: zeit("11-12", "15:00"), teilnehmer: [{ benutzerId: betreuerId }],
    });
    const id = neu.body.id;
    const abg = await als(tokenLeitung).post(`/kalender/termine/${id}/absagen`);
    expect(abg.status).toBe(200);
    expect(abg.body.abgesagtAm).not.toBeNull();

    const b = als(tokenBetreuer);
    const liste = await b.get("/kalender/termine?von=2026-11-01&bis=2026-12-01");
    expect(liste.body.find((x: any) => x.id === id).abgesagtAm).not.toBeNull();

    expect((await als(tokenLeitung).post(`/kalender/termine/${id}/absagen`)).status).toBe(409);
    expect((await als(tokenLeitung).patch(`/kalender/termine/${id}`, { titel: "doch" })).status).toBe(409);
    expect((await b.post(`/kalender/termine/${id}/antwort`, { antwort: "zugesagt" })).status).toBe(409);
    expect((await b.post(`/kalender/termine/${id}/uebernehmen`)).status).toBe(409);
  });

  it("Zeitraumfilter: Ueberlappung, Sortierung, ganztaegig, Pflichtparameter und Maximalspanne", async () => {
    const l = als(tokenLeitung);
    const mehrtaegig = await l.post("/kalender/termine", { titel: "Freizeit", beginn: "2026-03-30", ende: "2026-04-02", ganztaegig: true });
    expect(mehrtaegig.status).toBe(201);
    expect(mehrtaegig.body).toMatchObject({ ganztaegig: true, beginn: "2026-03-30", ende: "2026-04-02" });
    const { rows } = await admin.query("SELECT beginn, ende FROM termin WHERE id = $1", [mehrtaegig.body.id]);
    expect(rows[0].beginn.toISOString()).toBe("2026-03-30T00:00:00.000Z");
    expect(rows[0].ende.toISOString()).toBe("2026-04-03T00:00:00.000Z");

    const spaet = await l.post("/kalender/termine", { titel: "B-Termin", beginn: "2026-04-01T12:00:00Z", ende: "2026-04-01T13:00:00Z" });
    const frueh = await l.post("/kalender/termine", { titel: "A-Termin", beginn: "2026-04-01T08:00:00Z", ende: "2026-04-01T09:00:00Z" });
    const punkt = await l.post("/kalender/termine", { titel: "Punkt", beginn: "2026-05-01T00:00:00Z", ende: "2026-05-01T00:00:00Z" });

    const ids = async (von: string, bis: string) => (await l.get(`/kalender/termine?von=${von}&bis=${bis}`)).body.map((x: any) => x.titel);
    expect(await ids("2026-04-01", "2026-04-02")).toEqual(["Freizeit", "A-Termin", "B-Termin"]);
    // Der ganztaegige Termin laeuft bis zum Ende des 2. April, aber nicht in den 3.
    expect(await ids("2026-04-02T12:00:00Z", "2026-04-03T12:00:00Z")).toEqual(["Freizeit"]);
    expect(await ids("2026-04-03", "2026-04-20")).toEqual([]);
    // Der Termin endet genau zu "von": ausserhalb. Ein Zeitpunkt-Termin genau auf "von": innerhalb.
    expect(await ids("2026-04-01T09:00:00Z", "2026-04-01T11:00:00Z")).toEqual(["Freizeit"]);
    expect(await ids("2026-05-01T00:00:00Z", "2026-05-02T00:00:00Z")).toEqual(["Punkt"]);
    expect(await ids("2026-04-30", "2026-05-01")).toEqual([]);
    expect(punkt.status + spaet.status + frueh.status).toBe(603);

    expect((await l.get("/kalender/termine")).status).toBe(400);
    expect((await l.get("/kalender/termine?von=2026-04-01")).status).toBe(400);
    expect((await l.get("/kalender/termine?von=gestern&bis=2026-04-01")).status).toBe(400);
    expect((await l.get("/kalender/termine?von=2026-04-02&bis=2026-04-01")).status).toBe(400);
    expect((await l.get("/kalender/termine?von=2026-01-01&bis=2027-02-05")).status).toBe(200);
    expect((await l.get("/kalender/termine?von=2026-01-01&bis=2027-02-07")).status).toBe(400);
  });

  it("Ganztaegig <-> Uhrzeit umschalten verlangt neue Zeiten", async () => {
    const neu = await als(tokenLeitung).post("/kalender/termine", { titel: "Wechsel", beginn: "2026-06-01", ende: "2026-06-01", ganztaegig: true });
    const id = neu.body.id;
    expect((await als(tokenLeitung).patch(`/kalender/termine/${id}`, { ganztaegig: false })).status).toBe(400);
    const ok = await als(tokenLeitung).patch(`/kalender/termine/${id}`, {
      ganztaegig: false, beginn: "2026-06-01T10:00:00Z", ende: "2026-06-01T11:00:00Z",
    });
    expect(ok.body).toMatchObject({ ganztaegig: false, beginn: "2026-06-01T10:00:00.000Z" });
  });

  it("Teilnehmer-Pruefung: inaktiv, fremder Mandant, Klient ohne Zugang -> 400; Standort-Einschraenkung gilt fuer Klient:innen", async () => {
    const basis = { titel: "Einladung", beginn: zeit("12-01", "09:00"), ende: zeit("12-01", "10:00") };
    const post = (token: string, teilnehmer: object[]) => als(token).post("/kalender/termine", { ...basis, teilnehmer });
    expect((await post(tokenLeitung, [{ benutzerId: inaktivId }])).status).toBe(400);
    expect((await post(tokenLeitung, [{ benutzerId: leitungBId }])).status).toBe(400);
    expect((await post(tokenLeitung, [{ benutzerId: randomUUID() }])).status).toBe(400);
    expect((await post(tokenLeitung, [{ klientId: klient3Id }])).status).toBe(400);
    expect((await post(tokenLeitung, [{ klientId: klientBId }])).status).toBe(400);

    // Deaktivierter Zugang: nicht mehr einladbar.
    await admin.query("UPDATE klient_zugang SET aktiv = false WHERE klient_id = $1", [klient2Id]);
    expect((await post(tokenLeitung, [{ klientId: klient2Id }])).status).toBe(400);
    await admin.query("UPDATE klient_zugang SET aktiv = true WHERE klient_id = $1", [klient2Id]);

    // Eingeschraenkt auf S1: Klient 1 (keine Belegung) ist unsichtbar, Klient 2 (an S1) sichtbar.
    expect((await post(tokenEingeschraenkt, [{ klientId: klient1Id }])).status).toBe(400);
    expect((await post(tokenEingeschraenkt, [{ klientId: klient2Id }])).status).toBe(201);

    // Kein halb angelegter Termin nach einem Fehlschlag.
    const { rows } = await admin.query("SELECT 1 FROM termin WHERE mandant_id = $1 AND titel = 'Einladung' AND erstellt_von_benutzer_id = $2", [mandantAId, leitungId]);
    expect(rows).toHaveLength(0);
  });

  it("Klientennamen werden beim Lesen anonymisiert: eingeschraenkter Kollege sieht Initialen statt Namen", async () => {
    const neu = await als(tokenLeitung).post("/kalender/termine", {
      titel: "Gemeinsam", beginn: zeit("12-02", "09:00"), ende: zeit("12-02", "10:00"),
      teilnehmer: [{ benutzerId: eingeschraenktId }, { klientId: klient1Id }, { klientId: klient2Id }],
    });
    expect(neu.status).toBe(201);
    const sicht = await als(tokenEingeschraenkt).get(`/kalender/termine/${neu.body.id}`);
    const name = (id: string) => sicht.body.teilnehmer.find((t: any) => t.id === id).name;
    expect(name(klient1Id)).toBe("M. M.");
    expect(name(klient2Id)).toBe("Erika Beispiel");
    const voll = await als(tokenLeitung).get(`/kalender/termine/${neu.body.id}`);
    expect(voll.body.teilnehmer.find((t: any) => t.id === klient1Id).name).toBe("Max Muster");
    const kl = await als(tokenKlient2).get(`/kalender/termine/${neu.body.id}`);
    expect(kl.body.teilnehmer.find((t: any) => t.id === klient1Id).name).toBe("Max");
  });

  it("Klient-Sitzung: eigener Termin ohne Teilnehmende, keine Einladungen, Mitarbeitende sehen ihn nicht", async () => {
    const k = als(tokenKlient1);
    const basis = { titel: "Arzttermin", ort: "Praxis", beginn: zeit("11-20", "09:00"), ende: zeit("11-20", "09:30") };
    const eingeladen = await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: leitungId }] });
    expect(eingeladen.status).toBe(403);
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ klientId: klient2Id }] })).status).toBe(403);

    const res = await k.post("/kalender/termine", basis);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      binErsteller: true, meineAntwort: "zugesagt", erstelltVon: { art: "klient", id: klient1Id, name: "Max" },
    });
    expect(res.body.teilnehmer).toHaveLength(1);

    const liste = await k.get("/kalender/termine?von=2026-11-01&bis=2026-12-01");
    expect(liste.body.map((t: any) => t.id)).toEqual(expect.arrayContaining([res.body.id, hauptId]));

    // Privatsphaere: weder Leitung noch Vollzugriff noch andere Klient:innen sehen den Termin.
    for (const token of [tokenLeitung, tokenVollzugriff, tokenKlient2]) {
      expect((await als(token).get(`/kalender/termine/${res.body.id}`)).status).toBe(404);
    }
    // Eigene Termine aendern/absagen geht.
    expect((await k.patch(`/kalender/termine/${res.body.id}`, { ort: "Andere Praxis" })).body.ort).toBe("Andere Praxis");
    expect((await k.post(`/kalender/termine/${res.body.id}/absagen`)).body.abgesagtAm).not.toBeNull();
  });

  it("Klient-Zugang wird deaktiviert -> Kalender sofort gesperrt", async () => {
    const t = await klientToken(app, `test-kal-a-${suffix}`, `klient2-${suffix}@beispiel.test`, passwort);
    expect((await als(t).get("/kalender/termine?von=2026-11-01&bis=2026-12-01")).status).toBe(200);
    await admin.query("UPDATE klient_zugang SET aktiv = false WHERE klient_id = $1", [klient2Id]);
    expect((await als(t).get("/kalender/termine?von=2026-11-01&bis=2026-12-01")).status).toBe(401);
    await admin.query("UPDATE klient_zugang SET aktiv = true WHERE klient_id = $1", [klient2Id]);
    expect(tokenKlient2).toBeTruthy();
  });

  it("Mandantentrennung: Termine des anderen Mandanten tauchen nirgends auf, auch nicht auf DB-Ebene", async () => {
    const b = await als(tokenLeitungB).post("/kalender/termine", { titel: "Nur B", beginn: zeit("11-05", "09:00"), ende: zeit("11-05", "10:00") });
    expect(b.status).toBe(201);
    expect((await als(tokenLeitung).get(`/kalender/termine/${b.body.id}`)).status).toBe(404);
    const liste = await als(tokenLeitungB).get("/kalender/termine?von=2026-11-01&bis=2026-12-01");
    expect(liste.body.map((t: any) => t.titel)).toEqual(["Nur B"]);

    // Selbst mit der richtigen Benutzer-ID, aber falschem Mandanten, liefert die App-Rolle nichts.
    const n = await alsAppRolle({ mandantId: mandantBId, benutzerId: leitungId }, (c) =>
      c.query("SELECT count(*)::int AS n FROM termin WHERE id = $1", [hauptId]).then((r) => r.rows[0].n)
    );
    expect(n).toBe(0);
  });

  describe("direkt mit der App-Rolle (RLS und Spaltenrechte)", () => {
    it("Sichtbarkeit: Ersteller:in und Teilnehmende ja, Vollzugriff und Fremde nein", async () => {
      const zaehle = (ctx: { mandantId: string; benutzerId?: string; klientId?: string }) =>
        alsAppRolle(ctx, async (c) => ({
          termin: (await c.query("SELECT count(*)::int AS n FROM termin WHERE id = $1", [hauptId])).rows[0].n,
          teilnehmer: (await c.query("SELECT count(*)::int AS n FROM termin_teilnehmer WHERE termin_id = $1", [hauptId])).rows[0].n,
        }));
      expect(await zaehle({ mandantId: mandantAId, benutzerId: leitungId })).toEqual({ termin: 1, teilnehmer: 3 });
      expect(await zaehle({ mandantId: mandantAId, benutzerId: betreuerId })).toEqual({ termin: 1, teilnehmer: 3 });
      expect(await zaehle({ mandantId: mandantAId, klientId: klient1Id })).toEqual({ termin: 1, teilnehmer: 3 });
      expect(await zaehle({ mandantId: mandantAId, benutzerId: vollzugriffId })).toEqual({ termin: 0, teilnehmer: 0 });
      expect(await zaehle({ mandantId: mandantAId, klientId: klient2Id })).toEqual({ termin: 0, teilnehmer: 0 });
      expect(await zaehle({ mandantId: mandantAId })).toEqual({ termin: 0, teilnehmer: 0 });
    });

    it("Nur Ersteller:in darf Termindaten aendern; Teilnehmende nur die eigene Antwort", async () => {
      const upd = (ctx: { mandantId: string; benutzerId: string }, sql: string, params: unknown[]) =>
        alsAppRolle(ctx, (c) => c.query(sql, params).then((r) => r.rowCount));
      const a = { mandantId: mandantAId, benutzerId: betreuerId };
      expect(await upd(a, "UPDATE termin SET titel = 'x' WHERE id = $1", [hauptId])).toBe(0);
      expect(await upd({ ...a, benutzerId: leitungId }, "UPDATE termin SET titel = titel WHERE id = $1", [hauptId])).toBe(1);
      expect(await upd(a, "UPDATE termin_teilnehmer SET antwort = 'abgelehnt' WHERE termin_id = $1 AND benutzer_id = $2", [hauptId, leitungId])).toBe(0);
      expect(await upd(a, "UPDATE termin_teilnehmer SET antwort = 'zugesagt' WHERE termin_id = $1 AND benutzer_id = $2", [hauptId, betreuerId])).toBe(1);
    });

    it("Gesperrte Spalten und DELETE werden verweigert", async () => {
      const verweigert = async (ctx: { mandantId: string; benutzerId: string }, sql: string, params: unknown[]) => {
        await expect(alsAppRolle(ctx, (c) => c.query(sql, params))).rejects.toMatchObject({ code: "42501" });
      };
      const l = { mandantId: mandantAId, benutzerId: leitungId };
      await verweigert(l, "UPDATE termin SET mandant_id = $2 WHERE id = $1", [hauptId, mandantBId]);
      await verweigert(l, "UPDATE termin SET erstellt_von_benutzer_id = $2 WHERE id = $1", [hauptId, betreuerId]);
      await verweigert(l, "UPDATE termin SET erstellt_am = now() WHERE id = $1", [hauptId]);
      await verweigert(l, "DELETE FROM termin WHERE id = $1", [hauptId]);
      await verweigert(l, "UPDATE termin_teilnehmer SET benutzer_id = $2 WHERE termin_id = $1", [hauptId, vollzugriffId]);
      await verweigert(l, "UPDATE termin_teilnehmer SET termin_id = $2 WHERE termin_id = $1", [hauptId, randomUUID()]);
      await verweigert(l, "DELETE FROM termin_teilnehmer WHERE termin_id = $1", [hauptId]);
    });

    it("Anlegen nur als man selbst, Einladen nur durch Ersteller:in, Selbsteintrag nur bei Sichtbarkeit", async () => {
      const ctx = { mandantId: mandantAId, benutzerId: vollzugriffId };
      // Termin im Namen einer anderen Person -> RLS-Verletzung (42501).
      await expect(
        alsAppRolle(ctx, (c) =>
          c.query(
            "INSERT INTO termin (mandant_id, titel, beginn, ende, erstellt_von_benutzer_id) VALUES ($1, 'x', now(), now(), $2)",
            [mandantAId, leitungId]
          )
        )
      ).rejects.toMatchObject({ code: "42501" });
      // Sich selbst an einen unsichtbaren Termin haengen.
      await expect(
        alsAppRolle(ctx, (c) =>
          c.query("INSERT INTO termin_teilnehmer (mandant_id, termin_id, benutzer_id) VALUES ($1, $2, $3)", [mandantAId, hauptId, vollzugriffId])
        )
      ).rejects.toMatchObject({ code: "42501" });
      // Eine:n Dritte:n eintragen, ohne Ersteller:in zu sein (Betreuer sieht den Termin).
      await expect(
        alsAppRolle({ mandantId: mandantAId, benutzerId: betreuerId }, (c) =>
          c.query("INSERT INTO termin_teilnehmer (mandant_id, termin_id, benutzer_id) VALUES ($1, $2, $3)", [mandantAId, hauptId, vollzugriffId])
        )
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("ics: Header, Escaping, Faltung bei 75 Oktetten, UTC-Zeiten, ganztaegig, abgesagt", async () => {
    const lang = "Übergabegespräch mit äußerst langem Titel für die Faltung öüß, mehr Text, noch mehr Text, bis über die Grenze";
    const neu = await als(tokenLeitung).post("/kalender/termine", {
      titel: lang,
      beschreibung: "Zeile 1\nZeile 2; mit \\ Backslash, Komma",
      ort: "Raum 5, Haus B",
      beginn: "2026-11-05T09:00:00+01:00",
      ende: "2026-11-05T10:30:00+01:00",
      teilnehmer: [{ klientId: klient1Id }],
    });
    const res = await als(tokenBetreuer).get(`/kalender/termine/${neu.body.id}/ics`);
    // Betreuer ist hier nicht eingeladen -> 404; Leitung holt die Datei.
    expect(res.status).toBe(404);

    const ics = await als(tokenLeitung).get(`/kalender/termine/${neu.body.id}/ics`).buffer(true).parse((r, cb) => {
      const teile: Buffer[] = [];
      r.on("data", (d: Buffer) => teile.push(d));
      r.on("end", () => cb(null, Buffer.concat(teile)));
    });
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(ics.headers["content-disposition"]).toBe(`attachment; filename="termin-${neu.body.id}.ics"`);

    const roh = (ics.body as Buffer).toString("utf8");
    expect(roh.endsWith("\r\n")).toBe(true);
    expect(roh.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const zeile of roh.split("\r\n").slice(0, -1)) {
      expect(Buffer.byteLength(zeile, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(roh.split("\r\n").some((z) => z.startsWith(" "))).toBe(true);

    const entfaltet = roh.replace(/\r\n /g, "");
    expect(entfaltet).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(entfaltet).toContain(`UID:${neu.body.id}@hecaso\r\n`);
    expect(entfaltet).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/);
    expect(entfaltet).toContain("DTSTART:20261105T080000Z\r\n");
    expect(entfaltet).toContain("DTEND:20261105T093000Z\r\n");
    expect(entfaltet).toContain(`SUMMARY:${lang.replace(/,/g, "\\,")}\r\n`);
    expect(entfaltet).toContain("DESCRIPTION:Zeile 1\\nZeile 2\; mit \\\\ Backslash\\, Komma\r\n");
    expect(entfaltet).toContain("LOCATION:Raum 5\\, Haus B\r\n");
    expect(entfaltet).toContain("STATUS:CONFIRMED\r\n");
    // Keine Namen von Teilnehmenden in der Datei.
    expect(entfaltet).not.toMatch(/Max|Muster|Anna Leitung/);

    await als(tokenLeitung).post(`/kalender/termine/${neu.body.id}/absagen`);
    const abgesagt = await als(tokenLeitung).get(`/kalender/termine/${neu.body.id}/ics`);
    expect(abgesagt.text).toContain("STATUS:CANCELLED\r\n");

    const tag = await als(tokenLeitung).post("/kalender/termine", { titel: "Ausflug", beginn: "2026-11-10", ende: "2026-11-11", ganztaegig: true });
    const tagIcs = (await als(tokenLeitung).get(`/kalender/termine/${tag.body.id}/ics`)).text;
    expect(tagIcs).toContain("DTSTART;VALUE=DATE:20261110\r\n");
    expect(tagIcs).toContain("DTEND;VALUE=DATE:20261112\r\n");
  });
});
