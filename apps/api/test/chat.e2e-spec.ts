/**
 * Chat (Chat-Plan, Schritt 3, ohne Chat-Anfragen).
 *
 * Kernaussagen:
 *   1. Nachrichten, Anhaenge und im Chat geteilte Termine sieht NUR, wer aktive:r
 *      Teilnehmer:in ist -- auch ein ist_vollzugriff-Konto nicht; wer verlassen hat
 *      oder entfernt wurde, verliert die Historie (per RLS, nicht per Code).
 *   2. Klient:innen legen keine Chats an und nehmen niemanden auf; sie schreiben in
 *      Chats, in die sie aufgenommen wurden.
 *   3. Gruppen: nur Admins verwalten; der letzte Admin vererbt beim Gehen.
 *   4. Nachrichten sind append-only: loeschen ja (nur Absender), bearbeiten nein.
 *   5. Die App-Rolle kann Policies, Trigger und gesperrte Spalten nicht umgehen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import sharp from "sharp";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";

describe("Chat", () => {
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
  let klientBId: string; // anderer Mandant

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
    del: (p: string) => request(http()).delete(p).set("Authorization", `Bearer ${token}`),
    roh: (p: string, typ: string, body: Buffer) =>
      request(http()).post(p).set("Authorization", `Bearer ${token}`).set("Content-Type", typ).send(body),
  });

  const zeit = (tag: string, uhr: string) => `2026-${tag}T${uhr}:00+01:00`;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    const slugA = `test-chat-a-${suffix}`;
    const slugB = `test-chat-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Chat A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Chat B ${suffix}`, slugB])).rows[0].id;

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
    klient1Id = await neuerKlient(mandantAId, "Max", "Muster", "CHT1");
    klient2Id = await neuerKlient(mandantAId, "Erika", "Beispiel", "CHT2");
    klient3Id = await neuerKlient(mandantAId, "Karl", "Ohnezugang", "CHT3");
    klientBId = await neuerKlient(mandantBId, "Britta", "Fremd", "CHTB");
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
      await admin.query("DELETE FROM chat_anhang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_nachricht WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat WHERE mandant_id = ANY($1)", [ids]);
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

  async function sqlCode(ctx: Parameters<typeof alsAppRolle>[0], sql: string, params: unknown[] = []): Promise<string> {
    return alsAppRolle(ctx, async (c) => {
      try {
        await c.query(sql, params);
        return "ok";
      } catch (err) {
        return (err as { code: string }).code;
      }
    });
  }

  const ausSichtLeitung = () => ({ mandantId: mandantAId, benutzerId: leitungId });
  const ausSichtBetreuer = () => ({ mandantId: mandantAId, benutzerId: betreuerId });
  const ausSichtVollzugriff = () => ({ mandantId: mandantAId, benutzerId: vollzugriffId });

  let direktId: string; // leitung <-> betreuer
  let gruppeId: string; // leitung (Admin), betreuer, klient1

  // --- Direktchats ---------------------------------------------------------

  it("Direktchat: wird angelegt (201), ein zweiter Aufruf - auch von der Gegenseite - liefert denselben Chat (200)", async () => {
    const neu = await als(tokenLeitung).post("/chat/direkt", { benutzerId: betreuerId });
    expect(neu.status).toBe(201);
    direktId = neu.body.id;
    expect(neu.body).toMatchObject({ art: "direkt", name: null, anzeigename: "Bernd Betreuer", binAdmin: false, ungelesen: 0, letzteNachricht: null });
    expect(neu.body.teilnehmer.map((t: any) => t.name).sort()).toEqual(["Anna Leitung", "Bernd Betreuer"]);

    const nochmal = await als(tokenLeitung).post("/chat/direkt", { benutzerId: betreuerId });
    expect(nochmal.status).toBe(200);
    expect(nochmal.body.id).toBe(direktId);

    const gegenseite = await als(tokenBetreuer).post("/chat/direkt", { benutzerId: leitungId });
    expect(gegenseite.status).toBe(200);
    expect(gegenseite.body.id).toBe(direktId);
    expect(gegenseite.body.anzeigename).toBe("Anna Leitung");
  });

  it("Direktchat: gleichzeitige Anfrage beider Seiten erzeugt genau einen Chat", async () => {
    const [a, b] = await Promise.all([
      als(tokenVollzugriff).post("/chat/direkt", { benutzerId: eingeschraenktId }),
      als(tokenEingeschraenkt).post("/chat/direkt", { benutzerId: vollzugriffId }),
    ]);
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    expect(a.body.id).toBe(b.body.id);
    const { rows } = await admin.query("SELECT 1 FROM chat WHERE mandant_id = $1 AND direkt_schluessel LIKE $2", [mandantAId, `%${vollzugriffId}%`]);
    expect(rows).toHaveLength(1);
  });

  it("Direktchat: Eingabefehler und unzulaessige Gegenueber -> 400", async () => {
    const l = als(tokenLeitung);
    expect((await l.post("/chat/direkt", {})).status).toBe(400);
    expect((await l.post("/chat/direkt", { benutzerId: "kein-uuid" })).status).toBe(400);
    expect((await l.post("/chat/direkt", { benutzerId: leitungId })).status).toBe(400); // mit sich selbst
    expect((await l.post("/chat/direkt", { benutzerId: inaktivId })).status).toBe(400);
    expect((await l.post("/chat/direkt", { benutzerId: leitungBId })).status).toBe(400); // anderer Mandant
    expect((await l.post("/chat/direkt", { benutzerId: randomUUID() })).status).toBe(400);
    expect((await l.post("/chat/direkt", { klientId: klient3Id })).status).toBe(400); // ohne Zugang
    expect((await l.post("/chat/direkt", { klientId: klientBId })).status).toBe(400);
    // Standort-Einschraenkung: Klient 1 (keine Belegung) ist fuer den eingeschraenkten Kollegen unsichtbar.
    expect((await als(tokenEingeschraenkt).post("/chat/direkt", { klientId: klient1Id })).status).toBe(400);
    expect((await als(tokenEingeschraenkt).post("/chat/direkt", { klientId: klient2Id })).status).toBe(201);
    // Kein halb angelegter Chat nach einem Fehlschlag.
    const { rows } = await admin.query("SELECT 1 FROM chat WHERE mandant_id = $1 AND direkt_schluessel LIKE $2", [mandantAId, `%${klient3Id}%`]);
    expect(rows).toHaveLength(0);
  });

  it("Ohne Token -> 401", async () => {
    expect((await request(http()).get("/chat")).status).toBe(401);
    expect((await request(http()).get("/chat/ereignisse")).status).toBe(401);
  });

  // --- Klient:innen --------------------------------------------------------

  it("Klient:in legt keine Chats an, nimmt niemanden auf, sieht keine Kontakte -> 403 bzw. leere Liste", async () => {
    const k = als(tokenKlient1);
    expect((await k.post("/chat/direkt", { benutzerId: leitungId })).status).toBe(403);
    expect((await k.post("/chat/gruppe", { name: "Meine Gruppe", teilnehmer: [{ benutzerId: leitungId }] })).status).toBe(403);
    const kontakte = await k.get("/chat/kontakte");
    expect(kontakte.status).toBe(200);
    expect(kontakte.body).toEqual([]);
    expect((await k.get("/chat")).body).toEqual([]);
  });

  it("Kontakte fuer Mitarbeitende: aktive Kolleg:innen und sichtbare Klient:innen mit Zugang; bestehende Direktchats sind verknuepft", async () => {
    const res = await als(tokenLeitung).get("/chat/kontakte");
    expect(res.status).toBe(200);
    const nachName = Object.fromEntries(res.body.map((p: any) => [p.name, p]));
    expect(nachName["Bernd Betreuer"]).toMatchObject({ art: "benutzer", id: betreuerId, direktChatId: direktId });
    expect(nachName["Max Muster"]).toMatchObject({ art: "klient", id: klient1Id, direktChatId: null });
    expect(nachName["Erika Beispiel"]).toBeDefined();
    expect(nachName["Ida Inaktiv"]).toBeUndefined();
    expect(nachName["Anna Leitung"]).toBeUndefined();
    expect(nachName["Karl Ohnezugang"]).toBeUndefined();
    expect(nachName["Lena Leitung B"]).toBeUndefined();
    expect(nachName["Britta Fremd"]).toBeUndefined();

    const eingeschraenkt = (await als(tokenEingeschraenkt).get("/chat/kontakte")).body.map((p: any) => p.name);
    expect(eingeschraenkt).toContain("Erika Beispiel");
    expect(eingeschraenkt).not.toContain("Max Muster");
  });

  // --- Gruppen -------------------------------------------------------------

  it("Gruppe anlegen: Ersteller:in ist Admin, Klient:in ist dabei und sieht Mitarbeitende mit Namen", async () => {
    const t = als(tokenLeitung);
    expect((await t.post("/chat/gruppe", { name: "  ", teilnehmer: [{ benutzerId: betreuerId }] })).status).toBe(400);
    expect((await t.post("/chat/gruppe", { name: "Leer", teilnehmer: [] })).status).toBe(400);
    expect((await t.post("/chat/gruppe", { name: "Nur ich", teilnehmer: [{ benutzerId: leitungId }] })).status).toBe(400);
    expect((await t.post("/chat/gruppe", { name: "Mit Fremden", teilnehmer: [{ benutzerId: leitungBId }] })).status).toBe(400);

    const res = await t.post("/chat/gruppe", {
      name: "  Hilfeplan Max  ",
      teilnehmer: [{ benutzerId: betreuerId }, { klientId: klient1Id }, { benutzerId: betreuerId }, { benutzerId: leitungId }],
    });
    expect(res.status).toBe(201);
    gruppeId = res.body.id;
    expect(res.body).toMatchObject({ art: "gruppe", name: "Hilfeplan Max", anzeigename: "Hilfeplan Max", binAdmin: true });
    expect(res.body.teilnehmer).toHaveLength(3);
    expect(res.body.teilnehmer.find((x: any) => x.id === leitungId).istAdmin).toBe(true);
    expect(res.body.teilnehmer.find((x: any) => x.id === klient1Id)).toMatchObject({ art: "klient", name: "Max Muster", istAdmin: false });

    const sichtKlient = await als(tokenKlient1).get(`/chat/${gruppeId}`);
    expect(sichtKlient.status).toBe(200);
    expect(sichtKlient.body.binAdmin).toBe(false);
    expect(sichtKlient.body.teilnehmer.find((x: any) => x.id === leitungId).name).toBe("Anna Leitung");
    expect(sichtKlient.body.teilnehmer.find((x: any) => x.id === klient1Id).name).toBe("Max");
  });

  it("Gruppe: nur Admins benennen um, fuegen hinzu und entfernen; Direktchats nicht", async () => {
    const nichtAdmin = als(tokenBetreuer);
    expect((await nichtAdmin.patch(`/chat/${gruppeId}`, { name: "Gekapert" })).status).toBe(403);
    expect((await nichtAdmin.post(`/chat/${gruppeId}/teilnehmer`, { benutzerId: eingeschraenktId })).status).toBe(403);
    const ansicht = (await als(tokenLeitung).get(`/chat/${gruppeId}`)).body;
    const klientZeile = ansicht.teilnehmer.find((x: any) => x.id === klient1Id).teilnehmerId;
    expect((await nichtAdmin.del(`/chat/${gruppeId}/teilnehmer/${klientZeile}`)).status).toBe(403);
    // Klient:in: weder umbenennen noch hinzufuegen.
    expect((await als(tokenKlient1).patch(`/chat/${gruppeId}`, { name: "x" })).status).toBe(403);
    expect((await als(tokenKlient1).post(`/chat/${gruppeId}/teilnehmer`, { benutzerId: eingeschraenktId })).status).toBe(403);

    const admin1 = als(tokenLeitung);
    const umbenannt = await admin1.patch(`/chat/${gruppeId}`, { name: "Hilfeplan Max 2026" });
    expect(umbenannt.status).toBe(200);
    expect(umbenannt.body.anzeigename).toBe("Hilfeplan Max 2026");
    expect((await admin1.patch(`/chat/${gruppeId}`, { name: "   " })).status).toBe(400);
    expect((await admin1.patch(`/chat/${direktId}`, { name: "Neu" })).status).toBe(400);
    expect((await admin1.post(`/chat/${direktId}/teilnehmer`, { benutzerId: eingeschraenktId })).status).toBe(400);

    // Hinzufuegen: Pruefungen wie bei Direktchats, idempotent.
    expect((await admin1.post(`/chat/${gruppeId}/teilnehmer`, { benutzerId: inaktivId })).status).toBe(400);
    expect((await admin1.post(`/chat/${gruppeId}/teilnehmer`, { klientId: klient3Id })).status).toBe(400);
    const dazu = await admin1.post(`/chat/${gruppeId}/teilnehmer`, { klientId: klient2Id });
    expect(dazu.status).toBe(200);
    expect(dazu.body.teilnehmer).toHaveLength(4);
    expect((await admin1.post(`/chat/${gruppeId}/teilnehmer`, { klientId: klient2Id })).body.teilnehmer).toHaveLength(4);
  });

  it("Entfernen und Wiedereintritt: Entfernte sehen nichts mehr, der Wiedereintritt ist eine NEUE Zeile", async () => {
    const l = als(tokenLeitung);
    const nachricht = await l.post(`/chat/${gruppeId}/nachrichten`, { art: "text", text: "Vor dem Entfernen" });
    expect(nachricht.status).toBe(201);

    const zeile = (await l.get(`/chat/${gruppeId}`)).body.teilnehmer.find((x: any) => x.id === klient2Id).teilnehmerId;
    expect((await l.del(`/chat/${gruppeId}/teilnehmer/${zeile}`)).status).toBe(200);
    const entfernt = als(tokenKlient2);
    expect((await entfernt.get(`/chat/${gruppeId}`)).status).toBe(404);
    expect((await entfernt.get(`/chat/${gruppeId}/nachrichten`)).status).toBe(404);
    expect((await entfernt.post(`/chat/${gruppeId}/nachrichten`, { art: "text", text: "Hallo?" })).status).toBe(404);
    expect((await entfernt.get("/chat")).body.map((c: any) => c.id)).not.toContain(gruppeId);
    expect((await l.del(`/chat/${gruppeId}/teilnehmer/${zeile}`)).status).toBe(404); // nicht mehr aktiv

    const wieder = await l.post(`/chat/${gruppeId}/teilnehmer`, { klientId: klient2Id });
    expect(wieder.status).toBe(200);
    const { rows } = await admin.query("SELECT verlassen_am FROM chat_teilnehmer WHERE chat_id = $1 AND klient_id = $2 ORDER BY beigetreten_am", [gruppeId, klient2Id]);
    expect(rows).toHaveLength(2);
    expect(rows[0].verlassen_am).not.toBeNull();
    expect(rows[1].verlassen_am).toBeNull();
    // Der Wiedereintritt zaehlt die Historie nicht als ungelesen.
    expect((await entfernt.get(`/chat/${gruppeId}`)).body.ungelesen).toBe(0);

    // Wieder entfernen, damit die folgenden Tests mit leitung/betreuer/klient1 rechnen koennen.
    const zeile2 = (await l.get(`/chat/${gruppeId}`)).body.teilnehmer.find((x: any) => x.id === klient2Id).teilnehmerId;
    expect((await l.del(`/chat/${gruppeId}/teilnehmer/${zeile2}`)).status).toBe(200);
  });

  it("Direktchats kann man nicht verlassen (409)", async () => {
    const zeile = (await als(tokenBetreuer).get(`/chat/${direktId}`)).body.teilnehmer.find((x: any) => x.id === betreuerId).teilnehmerId;
    expect((await als(tokenBetreuer).del(`/chat/${direktId}/teilnehmer/${zeile}`)).status).toBe(409);
  });

  // --- Nicht-Teilnehmer ------------------------------------------------------

  it("Nicht-Teilnehmer (auch ist_vollzugriff, anderer Mandant, andere:r Klient:in) sehen Chat, Nachrichten und Anhaenge nicht -> 404", async () => {
    const l = als(tokenLeitung);
    await l.post(`/chat/${gruppeId}/nachrichten`, { art: "text", text: "Geheim" });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c00" } }).png().toBuffer();
    const bild = await l.roh(`/chat/${gruppeId}/bilder?dateiname=a.png`, "image/png", png);
    expect(bild.status).toBe(201);
    const anhangId = bild.body.anhaenge[0].id;

    for (const token of [tokenVollzugriff, tokenLeitungB, tokenKlient2]) {
      const t = als(token);
      expect((await t.get(`/chat/${gruppeId}`)).status).toBe(404);
      expect((await t.patch(`/chat/${gruppeId}`, { name: "x" })).status).toBe(404);
      expect((await t.get(`/chat/${gruppeId}/nachrichten`)).status).toBe(404);
      expect((await t.post(`/chat/${gruppeId}/nachrichten`, { art: "text", text: "rein" })).status).toBe(404);
      expect((await t.roh(`/chat/${gruppeId}/bilder`, "image/png", png)).status).toBe(404);
      expect((await t.post(`/chat/${gruppeId}/teilnehmer`, { benutzerId: vollzugriffId })).status).toBe(404);
      expect((await t.post(`/chat/${gruppeId}/gelesen`)).status).toBe(404);
      expect((await t.get(`/chat/anhaenge/${anhangId}`)).status).toBe(404);
      expect((await t.get("/chat")).body.map((c: any) => c.id)).not.toContain(gruppeId);
    }
    const ersteNachricht = (await l.get(`/chat/${gruppeId}/nachrichten`)).body.nachrichten[0].id;
    expect((await als(tokenVollzugriff).del(`/chat/nachrichten/${ersteNachricht}`)).status).toBe(404);
    // Gegenprobe: Teilnehmer:innen sehen alles.
    expect((await als(tokenBetreuer).get(`/chat/anhaenge/${anhangId}`)).status).toBe(200);
    expect((await als(tokenKlient1).get(`/chat/${gruppeId}/nachrichten`)).status).toBe(200);
  });

  // --- Nachrichten -----------------------------------------------------------

  it("Text: senden, trimmen, Grenzen; Absender, eigene-Flag und Namen (Klient:in sieht sich und andere nur mit Vornamen)", async () => {
    const chat = (await als(tokenLeitung).post("/chat/direkt", { klientId: klient1Id })).body;
    const k = als(tokenKlient1);
    const l = als(tokenLeitung);
    expect((await l.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "   " })).status).toBe(400);
    expect((await l.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "x".repeat(4001) })).status).toBe(400);
    expect((await l.post(`/chat/${chat.id}/nachrichten`, { art: "unbekannt" })).status).toBe(400);
    expect((await l.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "a", extra: 1 })).status).toBe(400);

    const gesendet = await l.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "  Hallo Max  " });
    expect(gesendet.status).toBe(201);
    expect(gesendet.body).toMatchObject({
      chatId: chat.id, art: "text", text: "Hallo Max", eigene: true, geloescht: false, standort: null, termin: null, anhaenge: [],
      absender: { art: "benutzer", id: leitungId, name: "Anna Leitung" },
    });

    const antwort = await k.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "Hallo Anna" });
    expect(antwort.status).toBe(201);
    expect(antwort.body).toMatchObject({ eigene: true, absender: { art: "klient", id: klient1Id, name: "Max" } });

    const ausSichtLeitungListe = (await l.get(`/chat/${chat.id}/nachrichten`)).body.nachrichten;
    expect(ausSichtLeitungListe[0]).toMatchObject({ text: "Hallo Anna", eigene: false, absender: { art: "klient", name: "Max Muster" } });
    expect(ausSichtLeitungListe[1]).toMatchObject({ text: "Hallo Max", eigene: true });

    // Anonymisierung beim Lesen: der eingeschraenkte Kollege sieht Max in einer Gruppe nur mit Initialen.
    const gruppe = await l.post("/chat/gruppe", { name: "Mit Egon", teilnehmer: [{ benutzerId: eingeschraenktId }, { klientId: klient1Id }] });
    expect(gruppe.status).toBe(201);
    await k.post(`/chat/${gruppe.body.id}/nachrichten`, { art: "text", text: "Moin" });
    const egon = als(tokenEingeschraenkt);
    expect((await egon.get(`/chat/${gruppe.body.id}`)).body.teilnehmer.find((x: any) => x.id === klient1Id).name).toBe("M. M.");
    expect((await egon.get(`/chat/${gruppe.body.id}/nachrichten`)).body.nachrichten[0].absender.name).toBe("M. M.");
    expect((await egon.get("/chat")).body.find((c: any) => c.id === gruppe.body.id).letzteNachricht.absender.name).toBe("M. M.");
  });

  it("Paging: neueste zuerst, Cursor 'vor', limit <= 100, ungueltige Parameter -> 400", async () => {
    const chat = (await als(tokenLeitung).post("/chat/gruppe", { name: "Paging", teilnehmer: [{ benutzerId: betreuerId }] })).body;
    const l = als(tokenLeitung);
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await l.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: `Nr ${i}` })).body.id);

    const s1 = (await l.get(`/chat/${chat.id}/nachrichten?limit=2`)).body;
    expect(s1.nachrichten.map((n: any) => n.text)).toEqual(["Nr 5", "Nr 4"]);
    expect(s1.weitere).toBe(true);
    const s2 = (await l.get(`/chat/${chat.id}/nachrichten?limit=2&vor=${s1.nachrichten[1].id}`)).body;
    expect(s2.nachrichten.map((n: any) => n.text)).toEqual(["Nr 3", "Nr 2"]);
    expect(s2.weitere).toBe(true);
    const s3 = (await l.get(`/chat/${chat.id}/nachrichten?limit=2&vor=${s2.nachrichten[1].id}`)).body;
    expect(s3.nachrichten.map((n: any) => n.text)).toEqual(["Nr 1"]);
    expect(s3.weitere).toBe(false);
    expect((await l.get(`/chat/${chat.id}/nachrichten`)).body.nachrichten).toHaveLength(5);

    expect((await l.get(`/chat/${chat.id}/nachrichten?limit=101`)).status).toBe(400);
    expect((await l.get(`/chat/${chat.id}/nachrichten?limit=0`)).status).toBe(400);
    expect((await l.get(`/chat/${chat.id}/nachrichten?vor=kein-uuid`)).status).toBe(400);
    expect((await l.get(`/chat/${chat.id}/nachrichten?vor=${randomUUID()}`)).status).toBe(400);
    // Cursor aus einem anderen Chat wird nicht akzeptiert.
    const fremd = (await l.post(`/chat/${direktId}/nachrichten`, { art: "text", text: "anderer Chat" })).body.id;
    expect((await l.get(`/chat/${chat.id}/nachrichten?vor=${fremd}`)).status).toBe(400);
    expect(ids).toHaveLength(5);
  });

  it("Standort: gueltige Position und Bezeichnung; ungueltige Werte -> 400", async () => {
    const l = als(tokenLeitung);
    const ok = await l.post(`/chat/${direktId}/nachrichten`, { art: "standort", lat: 52.520008, lng: 13.404954, genauigkeitM: 12.4, bezeichnung: "  Alexanderplatz  " });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ art: "standort", text: null, standort: { lat: 52.520008, lng: 13.404954, genauigkeitM: 12, bezeichnung: "Alexanderplatz" } });
    const ohneZusatz = await l.post(`/chat/${direktId}/nachrichten`, { art: "standort", lat: -90, lng: 180 });
    expect(ohneZusatz.body.standort).toEqual({ lat: -90, lng: 180, genauigkeitM: null, bezeichnung: null });

    for (const body of [
      { art: "standort", lat: 90.1, lng: 0 },
      { art: "standort", lat: -91, lng: 0 },
      { art: "standort", lat: 0, lng: 180.5 },
      { art: "standort", lat: 0, lng: -181 },
      { art: "standort", lat: 0 },
      { art: "standort", lng: 0 },
      { art: "standort", lat: "52.5", lng: 13 },
      { art: "standort", lat: 0, lng: 0, genauigkeitM: -1 },
      { art: "standort", lat: 0, lng: 0, bezeichnung: "x".repeat(201) },
    ]) {
      expect((await l.post(`/chat/${direktId}/nachrichten`, body)).status).toBe(400);
    }
  });

  it("Bild: Upload, Abruf nur fuer Teilnehmende mit privatem Cache, Bildunterschrift; falsches Format, falscher Typ, zu gross -> 400/413", async () => {
    const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#0a0" } }).png().toBuffer();
    const l = als(tokenLeitung);
    const res = await l.roh(`/chat/${direktId}/bilder?dateiname=${encodeURIComponent("Foto 1.png")}&text=${encodeURIComponent("Schaden am Fenster")}`, "image/png", png);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ art: "bild", text: "Schaden am Fenster", eigene: true });
    expect(res.body.anhaenge).toHaveLength(1);
    expect(res.body.anhaenge[0]).toMatchObject({ dateiname: "Foto 1.png", mimeType: "image/png", groesse: png.length });

    const abruf = await als(tokenBetreuer)
      .get(`/chat/anhaenge/${res.body.anhaenge[0].id}`)
      .buffer(true)
      .parse((r, cb) => {
        const teile: Buffer[] = [];
        r.on("data", (t: Buffer) => teile.push(t));
        r.on("end", () => cb(null, Buffer.concat(teile)));
      });
    expect(abruf.status).toBe(200);
    expect(abruf.headers["content-type"]).toBe("image/png");
    expect(abruf.headers["cache-control"]).toMatch(/^private, max-age=\d+$/);
    expect(abruf.headers["x-content-type-options"]).toBe("nosniff");
    expect((abruf.body as Buffer).equals(png)).toBe(true);
    expect((await als(tokenBetreuer).get(`/chat/anhaenge/${randomUUID()}`)).status).toBe(404);
    expect((await als(tokenBetreuer).get(`/chat/anhaenge/kein-uuid`)).status).toBe(404);

    // Standardname und Verlauf
    const ohneName = await l.roh(`/chat/${direktId}/bilder`, "image/png", png);
    expect(ohneName.body.anhaenge[0].dateiname).toBe("bild");
    expect(ohneName.body.text).toBeNull();
    const liste = (await l.get("/chat")).body.find((c: any) => c.id === direktId);
    expect(liste.letzteNachricht).toMatchObject({ art: "bild", vorschau: "Bild" });

    // Kein Bild / Typ stimmt nicht mit dem Inhalt ueberein
    expect((await l.roh(`/chat/${direktId}/bilder`, "image/png", Buffer.from("das ist kein Bild"))).status).toBe(400);
    expect((await l.roh(`/chat/${direktId}/bilder`, "image/jpeg", png)).status).toBe(400);
    expect((await l.roh(`/chat/${direktId}/bilder`, "text/html", Buffer.from("<script>alert(1)</script>"))).status).toBe(400);
    expect((await l.roh(`/chat/${direktId}/bilder`, "image/png", Buffer.alloc(0))).status).toBe(400);
    expect((await l.roh(`/chat/${direktId}/bilder?text=${"x".repeat(1001)}`, "image/png", png)).status).toBe(400);

    // Obergrenze 8 MB
    const zuGross = Buffer.concat([png, Buffer.alloc(8_000_001)]);
    expect((await l.roh(`/chat/${direktId}/bilder`, "image/png", zuGross)).status).toBe(413);

    // Klient:innen duerfen Bilder in ihre Chats senden
    const vonKlient = await als(tokenKlient1).roh(`/chat/${gruppeId}/bilder`, "image/png", png);
    expect(vonKlient.status).toBe(201);
    expect(vonKlient.body.absender).toMatchObject({ art: "klient", id: klient1Id });
  });

  it("Loeschen: nur der Absender; Inhalt leer, Zeile bleibt, Bild ist weg; idempotent", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00c" } }).png().toBuffer();
    const l = als(tokenLeitung);
    const bild = (await l.roh(`/chat/${direktId}/bilder?text=weg`, "image/png", png)).body;
    const standort = (await l.post(`/chat/${direktId}/nachrichten`, { art: "standort", lat: 1, lng: 2, bezeichnung: "Ort" })).body;

    expect((await als(tokenBetreuer).del(`/chat/nachrichten/${bild.id}`)).status).toBe(403);
    expect((await als(tokenVollzugriff).del(`/chat/nachrichten/${bild.id}`)).status).toBe(404);
    expect((await l.del(`/chat/nachrichten/kein-uuid`)).status).toBe(404);

    const weg = await l.del(`/chat/nachrichten/${bild.id}`);
    expect(weg.status).toBe(200);
    expect(weg.body).toMatchObject({ id: bild.id, geloescht: true, text: null, anhaenge: [], art: "bild" });
    expect((await als(tokenBetreuer).get(`/chat/anhaenge/${bild.anhaenge[0].id}`)).status).toBe(404);
    expect((await l.del(`/chat/nachrichten/${bild.id}`)).status).toBe(200);

    const standortWeg = await l.del(`/chat/nachrichten/${standort.id}`);
    expect(standortWeg.body).toMatchObject({ geloescht: true, standort: null });

    const { rows } = await admin.query("SELECT text, standort_lat, geloescht_am, art FROM chat_nachricht WHERE id = ANY($1)", [[bild.id, standort.id]]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.text === null && r.standort_lat === null && r.geloescht_am !== null)).toBe(true);
    expect((await admin.query("SELECT 1 FROM chat_anhang WHERE nachricht_id = $1", [bild.id])).rows).toHaveLength(0);

    // Der Verlauf zeigt sie als geloeschte Platzhalter, die Chatliste mit passender Vorschau.
    const verlauf = (await als(tokenBetreuer).get(`/chat/${direktId}/nachrichten`)).body.nachrichten;
    expect(verlauf.find((n: any) => n.id === bild.id)).toMatchObject({ geloescht: true, text: null });
    const liste = (await als(tokenBetreuer).get("/chat")).body.find((c: any) => c.id === direktId);
    expect(liste.letzteNachricht).toMatchObject({ geloescht: true, vorschau: "Nachricht gelöscht" });
  });

  // --- Termine im Chat ---------------------------------------------------------

  it("Termin im Chat anlegen und teilen: andere Teilnehmende lesen und uebernehmen ihn, Nicht-Teilnehmende nicht", async () => {
    const l = als(tokenLeitung);
    const res = await l.post(`/chat/${gruppeId}/nachrichten`, {
      art: "termin",
      termin: { titel: "Hilfeplangespräch", ort: "Büro 3", beginn: zeit("11-05", "09:00"), ende: zeit("11-05", "10:00") },
    });
    expect(res.status).toBe(201);
    expect(res.body.termin).toMatchObject({
      titel: "Hilfeplangespräch", ort: "Büro 3", ganztaegig: false, abgesagtAm: null, meineAntwort: "zugesagt", uebernommen: true,
      beginn: "2026-11-05T08:00:00.000Z",
    });
    const terminId = res.body.termin.id;
    // Ersteller = Absender
    const { rows } = await admin.query("SELECT erstellt_von_benutzer_id FROM termin WHERE id = $1", [terminId]);
    expect(rows[0].erstellt_von_benutzer_id).toBe(leitungId);

    // Fremde: weder Termin noch Liste
    for (const token of [tokenVollzugriff, tokenLeitungB, tokenKlient2]) {
      expect((await als(token).get(`/kalender/termine/${terminId}`)).status).toBe(404);
      expect((await als(token).post(`/kalender/termine/${terminId}/uebernehmen`)).status).toBe(404);
    }

    // Betreuer (Chat-Teilnehmer, nicht eingeladen): sieht die Karte und den Termin, noch nicht in seinem Kalender
    const b = als(tokenBetreuer);
    const karte = (await b.get(`/chat/${gruppeId}/nachrichten`)).body.nachrichten.find((n: any) => n.art === "termin");
    expect(karte.termin).toMatchObject({ id: terminId, meineAntwort: null, uebernommen: false });
    const einzeln = await b.get(`/kalender/termine/${terminId}`);
    expect(einzeln.status).toBe(200);
    expect(einzeln.body.meineAntwort).toBeNull();
    expect((await b.get("/kalender/termine?von=2026-11-01&bis=2026-12-01")).body.map((t: any) => t.id)).not.toContain(terminId);

    const uebernommen = await b.post(`/kalender/termine/${terminId}/uebernehmen`);
    expect(uebernommen.status).toBe(200);
    expect(uebernommen.body.meineAntwort).toBe("zugesagt");
    expect((await b.post(`/kalender/termine/${terminId}/uebernehmen`)).status).toBe(200); // idempotent
    expect((await b.get("/kalender/termine?von=2026-11-01&bis=2026-12-01")).body.map((t: any) => t.id)).toContain(terminId);
    const karte2 = (await b.get(`/chat/${gruppeId}/nachrichten`)).body.nachrichten.find((n: any) => n.art === "termin");
    expect(karte2.termin).toMatchObject({ meineAntwort: "zugesagt", uebernommen: true });
    expect((await als(tokenKlient1).post(`/kalender/termine/${terminId}/uebernehmen`)).status).toBe(200);
  });

  it("Geteilter Termin: wer den Chat verlaesst oder die Nachricht geloescht wird, verliert den Zugriff; bestehender Termin kann geteilt werden", async () => {
    const l = als(tokenLeitung);
    const privat = (await l.post("/kalender/termine", { titel: "Privat", beginn: zeit("11-06", "09:00"), ende: zeit("11-06", "10:00") })).body.id;

    // Nur selbst sichtbare Termine lassen sich teilen: Betreuer kennt "Privat" nicht -> 404, auch bei erratener ID.
    expect((await als(tokenBetreuer).post(`/chat/${direktId}/nachrichten`, { art: "termin", terminId: privat })).status).toBe(404);
    expect((await l.post(`/chat/${direktId}/nachrichten`, { art: "termin", terminId: randomUUID() })).status).toBe(404);
    expect((await l.post(`/chat/${direktId}/nachrichten`, { art: "termin" })).status).toBe(400);
    expect((await l.post(`/chat/${direktId}/nachrichten`, { art: "termin", terminId: privat, termin: { titel: "x", beginn: "a", ende: "b" } })).status).toBe(400);
    // Ungueltiger Termin im selben Aufruf: weder Termin noch Nachricht entstehen.
    const vorher = (await admin.query("SELECT count(*)::int AS n FROM termin WHERE mandant_id = $1", [mandantAId])).rows[0].n;
    expect((await l.post(`/chat/${direktId}/nachrichten`, { art: "termin", termin: { titel: "Kaputt", beginn: "morgen", ende: "uebermorgen" } })).status).toBe(400);
    expect((await admin.query("SELECT count(*)::int AS n FROM termin WHERE mandant_id = $1", [mandantAId])).rows[0].n).toBe(vorher);

    expect((await als(tokenBetreuer).get(`/kalender/termine/${privat}`)).status).toBe(404);
    const geteilt = await l.post(`/chat/${direktId}/nachrichten`, { art: "termin", terminId: privat });
    expect(geteilt.status).toBe(201);
    expect(geteilt.body.termin).toMatchObject({ id: privat, titel: "Privat" });
    expect((await als(tokenBetreuer).get(`/kalender/termine/${privat}`)).status).toBe(200);
    expect((await als(tokenVollzugriff).get(`/kalender/termine/${privat}`)).status).toBe(404);

    // Loeschen der Nachricht widerruft die Freigabe.
    expect((await l.del(`/chat/nachrichten/${geteilt.body.id}`)).status).toBe(200);
    expect((await als(tokenBetreuer).get(`/kalender/termine/${privat}`)).status).toBe(404);

    // Verlassen des Chats ebenfalls: Termin in der Gruppe teilen, Klient:in verlaesst die Gruppe.
    const gruppe = (await l.post("/chat/gruppe", { name: "Kurz", teilnehmer: [{ klientId: klient1Id }] })).body;
    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "termin", terminId: privat });
    const k = als(tokenKlient1);
    expect((await k.get(`/kalender/termine/${privat}`)).status).toBe(200);
    const meineZeile = (await k.get(`/chat/${gruppe.id}`)).body.teilnehmer.find((x: any) => x.id === klient1Id).teilnehmerId;
    expect((await k.del(`/chat/${gruppe.id}/teilnehmer/${meineZeile}`)).status).toBe(200);
    expect((await k.get(`/kalender/termine/${privat}`)).status).toBe(404);
    expect((await k.get(`/chat/${gruppe.id}`)).status).toBe(404);
  });

  it("Klient:in darf beim Termin Mitarbeitende eintragen, mit denen sie einen aktiven gemeinsamen Chat hat", async () => {
    const k = als(tokenKlient1);
    const basis = { titel: "Arzttermin", beginn: zeit("11-20", "09:00"), ende: zeit("11-20", "09:30") };
    // Betreuer ist mit Klient 1 in der Gruppe "Hilfeplan Max"; Vollzugriff teilt keinen Chat mit ihr/ihm.
    const ok = await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: betreuerId }] });
    expect(ok.status).toBe(201);
    expect(ok.body.teilnehmer.map((t: any) => t.id).sort()).toEqual([betreuerId, klient1Id].sort());
    expect(ok.body.teilnehmer.find((t: any) => t.id === betreuerId).antwort).toBe("offen");
    expect((await als(tokenBetreuer).get(`/kalender/termine/${ok.body.id}`)).status).toBe(200);

    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: vollzugriffId }] })).status).toBe(403);
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: inaktivId }] })).status).toBe(403);
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: leitungBId }] })).status).toBe(403);
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ klientId: klient2Id }] })).status).toBe(403);
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: betreuerId }, { benutzerId: vollzugriffId }] })).status).toBe(403);

    // Nach dem Entfernen aus der Gruppe fehlt der gemeinsame Chat.
    const l = als(tokenLeitung);
    const zeile = (await l.get(`/chat/${gruppeId}`)).body.teilnehmer.find((x: any) => x.id === betreuerId).teilnehmerId;
    expect((await l.del(`/chat/${gruppeId}/teilnehmer/${zeile}`)).status).toBe(200);
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: betreuerId }] })).status).toBe(403);
    // ... aber Leitung (Direktchat/Gruppe mit Klient 1) geht weiter.
    expect((await k.post("/kalender/termine", { ...basis, teilnehmer: [{ benutzerId: leitungId }] })).status).toBe(201);
    // Wiederherstellen fuer die folgenden Tests.
    expect((await l.post(`/chat/${gruppeId}/teilnehmer`, { benutzerId: betreuerId })).status).toBe(200);
  });

  // --- Gelesen / ungelesen / Liste ---------------------------------------------

  it("Ungelesen: zaehlt Nachrichten anderer nach dem Lesestand (nicht eigene, nicht geloeschte); gelesen setzt zurueck; Gesamtzahl fuer das Badge", async () => {
    const chat = (await als(tokenVollzugriff).post("/chat/direkt", { benutzerId: leitungId })).body;
    const v = als(tokenVollzugriff);
    const l = als(tokenLeitung);
    const gesamtVorher = (await l.get("/chat/ungelesen")).body.ungelesen;
    await v.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "eins" });
    const zwei = (await v.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "zwei" })).body;
    await v.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "drei" });
    await l.post(`/chat/${chat.id}/nachrichten`, { art: "text", text: "eigene Antwort" });

    const ansicht = (await l.get("/chat")).body.find((c: any) => c.id === chat.id);
    // "eigene Antwort" ist die letzte Nachricht, zaehlt aber nicht als ungelesen.
    expect(ansicht.ungelesen).toBe(3);
    expect((await v.get("/chat")).body.find((c: any) => c.id === chat.id).ungelesen).toBe(1);
    expect((await l.get("/chat/ungelesen")).body.ungelesen).toBe(gesamtVorher + 3);

    await v.del(`/chat/nachrichten/${zwei.id}`);
    expect((await l.get(`/chat/${chat.id}`)).body.ungelesen).toBe(2);

    expect((await l.post(`/chat/${chat.id}/gelesen`)).status).toBe(200);
    expect((await l.get(`/chat/${chat.id}`)).body.ungelesen).toBe(0);
    expect((await l.get("/chat/ungelesen")).body.ungelesen).toBe(gesamtVorher);
    // Der Lesestand der anderen Person bleibt unberuehrt.
    expect((await v.get(`/chat/${chat.id}`)).body.ungelesen).toBe(1);
    expect((await l.post(`/chat/${randomUUID()}/gelesen`)).status).toBe(404);
  });

  it("Chatliste: Anzeigename, Vorschau mit Platzhaltern, sortiert nach letzter Aktivitaet", async () => {
    const l = als(tokenLeitung);
    const gruppe = (await l.post("/chat/gruppe", { name: "Ganz neu", teilnehmer: [{ benutzerId: betreuerId }] })).body;
    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "standort", lat: 1, lng: 1 });
    let liste = (await l.get("/chat")).body;
    expect(liste[0].id).toBe(gruppe.id);
    expect(liste[0]).toMatchObject({ anzeigename: "Ganz neu", letzteNachricht: { art: "standort", vorschau: "Standort", eigene: true } });

    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "termin", termin: { titel: "Teamsitzung", beginn: zeit("12-01", "09:00"), ende: zeit("12-01", "10:00") } });
    expect((await l.get("/chat")).body[0].letzteNachricht.vorschau).toBe("Termin: Teamsitzung");

    await l.post(`/chat/${direktId}/nachrichten`, { art: "text", text: "x ".repeat(100) });
    liste = (await l.get("/chat")).body;
    expect(liste[0].id).toBe(direktId);
    expect(liste[0].anzeigename).toBe("Bernd Betreuer");
    expect(liste[0].letzteNachricht.vorschau.length).toBeLessThanOrEqual(120);
    const zeiten = liste.map((c: any) => c.letzteAktivitaetAm);
    expect([...zeiten].sort().reverse()).toEqual(zeiten);
    expect((await l.get("/chat/kein-uuid")).status).toBe(404);
  });

  // --- Gruppen: Admin-Vererbung ---------------------------------------------------

  it("Letzter Admin geht: Adminrechte erbt die dienstaelteste andere Benutzer-Teilnahme (nie eine Klient:in)", async () => {
    const l = als(tokenLeitung);
    // Reihenfolge des Beitritts: Leitung (Admin), Klient 1, Egon, Betreuer
    const g = (await l.post("/chat/gruppe", { name: "Vererbung", teilnehmer: [{ klientId: klient1Id }, { benutzerId: eingeschraenktId }, { benutzerId: betreuerId }] })).body;
    expect(g.teilnehmer.filter((t: any) => t.istAdmin)).toHaveLength(1);
    const meine = g.teilnehmer.find((t: any) => t.id === leitungId).teilnehmerId;
    expect((await l.del(`/chat/${g.id}/teilnehmer/${meine}`)).status).toBe(200);
    expect((await l.get(`/chat/${g.id}`)).status).toBe(404);

    const egon = (await als(tokenEingeschraenkt).get(`/chat/${g.id}`)).body;
    expect(egon.teilnehmer.map((t: any) => `${t.name}:${t.istAdmin}`).sort()).toEqual(
      ["Bernd Betreuer:false", "Egon Eingeschraenkt:true", "M. M.:false"].sort() // Egon darf Klient 1 nicht sehen -> Initialen
    );
    expect(egon.binAdmin).toBe(true);
    // Der neue Admin darf verwalten, ein ehemaliger nicht mehr.
    expect((await als(tokenEingeschraenkt).patch(`/chat/${g.id}`, { name: "Neu verwaltet" })).status).toBe(200);
    expect((await l.patch(`/chat/${g.id}`, { name: "Zurueck" })).status).toBe(404);

    // Verlaesst ein Nicht-Admin die Gruppe, aendert sich nichts bei den Admins.
    const bz = egon.teilnehmer.find((t: any) => t.id === betreuerId).teilnehmerId;
    expect((await als(tokenBetreuer).del(`/chat/${g.id}/teilnehmer/${bz}`)).status).toBe(200);
    expect((await als(tokenEingeschraenkt).get(`/chat/${g.id}`)).body.teilnehmer.filter((t: any) => t.istAdmin)).toHaveLength(1);
    // Admin entfernt eine Klientin / einen Klienten.
    const kz = egon.teilnehmer.find((t: any) => t.id === klient1Id).teilnehmerId;
    expect((await als(tokenEingeschraenkt).del(`/chat/${g.id}/teilnehmer/${kz}`)).status).toBe(200);
    expect((await als(tokenKlient1).get(`/chat/${g.id}`)).status).toBe(404);
    expect((await als(tokenEingeschraenkt).del(`/chat/${g.id}/teilnehmer/${randomUUID()}`)).status).toBe(404);
  });

  // --- Mandantentrennung ------------------------------------------------------------

  it("Mandantentrennung: der andere Mandant sieht und erreicht nichts, auch nicht auf DB-Ebene", async () => {
    const b = als(tokenLeitungB);
    expect((await b.get("/chat")).body).toEqual([]);
    expect((await b.get(`/chat/${direktId}`)).status).toBe(404);
    const eigener = await b.post("/chat/direkt", { klientId: klientBId });
    expect(eigener.status).toBe(201);
    expect((await als(tokenLeitung).get(`/chat/${eigener.body.id}`)).status).toBe(404);
    expect((await als(tokenLeitung).get("/chat")).body.map((c: any) => c.id)).not.toContain(eigener.body.id);

    // Mandant A sieht via RLS keine Zeilen von B und umgekehrt - auch nicht mit dem richtigen Benutzer-Kontext.
    const sichtA = await alsAppRolle(ausSichtLeitung(), async (c) => (await c.query("SELECT count(*)::int AS n FROM chat WHERE mandant_id = $1", [mandantBId])).rows[0].n);
    expect(sichtA).toBe(0);
    const sichtB = await alsAppRolle({ mandantId: mandantBId, benutzerId: leitungBId }, async (c) => (await c.query("SELECT count(*)::int AS n FROM chat WHERE id = $1", [direktId])).rows[0].n);
    expect(sichtB).toBe(0);
    // Schreiben in fremden Mandanten ueber einen eigenen Kontext scheitert.
    expect(
      await sqlCode({ mandantId: mandantBId, benutzerId: leitungBId }, "INSERT INTO chat_nachricht (mandant_id, chat_id, absender_benutzer_id, art, text) VALUES ($1, $2, $3, 'text', 'x')", [mandantBId, direktId, leitungBId])
    ).toBe("42501");
  });

  // --- App-Rolle direkt (RLS, Trigger, Spaltenrechte) -------------------------------

  describe("direkt mit der App-Rolle", () => {
    it("Sichtbarkeit: Teilnehmende ja, ist_vollzugriff-Konto und Fremde nein", async () => {
      const zaehle = (ctx: Parameters<typeof alsAppRolle>[0], tabelle: string) =>
        alsAppRolle(ctx, async (c) =>
          (await c.query(`SELECT count(*)::int AS n FROM ${tabelle} WHERE ${tabelle === "chat" ? "id" : "chat_id"} = $1`, [gruppeId])).rows[0].n
        );
      for (const tabelle of ["chat", "chat_teilnehmer", "chat_nachricht"]) {
        expect(await zaehle(ausSichtLeitung(), tabelle)).toBeGreaterThan(0);
        expect(await zaehle(ausSichtVollzugriff(), tabelle)).toBe(0);
        expect(await zaehle({ mandantId: mandantAId, klientId: klient2Id }, tabelle)).toBe(0);
      }
      const anhangId = (await admin.query("SELECT a.id FROM chat_anhang a JOIN chat_nachricht m ON m.id = a.nachricht_id WHERE m.chat_id = $1 LIMIT 1", [gruppeId])).rows[0].id;
      const lesen = (ctx: Parameters<typeof alsAppRolle>[0]) =>
        alsAppRolle(ctx, async (c) => (await c.query("SELECT count(*)::int AS n FROM chat_anhang WHERE id = $1", [anhangId])).rows[0].n);
      expect(await lesen(ausSichtLeitung())).toBe(1);
      expect(await lesen(ausSichtVollzugriff())).toBe(0);
    });

    it("Nachrichten: nur als man selbst und nur in eigene Chats senden; kein Bearbeiten, kein DELETE", async () => {
      const einfuegen = "INSERT INTO chat_nachricht (mandant_id, chat_id, absender_benutzer_id, art, text) VALUES ($1, $2, $3, 'text', 'x')";
      expect(await sqlCode(ausSichtBetreuer(), einfuegen, [mandantAId, gruppeId, betreuerId])).toBe("ok");
      // im Namen einer anderen Person
      expect(await sqlCode(ausSichtBetreuer(), einfuegen, [mandantAId, gruppeId, leitungId])).toBe("42501");
      // als Nicht-Teilnehmer
      expect(await sqlCode(ausSichtVollzugriff(), einfuegen, [mandantAId, gruppeId, vollzugriffId])).toBe("42501");
      // als Klient:in im Namen eines Benutzers
      expect(await sqlCode({ mandantId: mandantAId, klientId: klient1Id }, einfuegen, [mandantAId, gruppeId, leitungId])).toBe("42501");
      // art 'system' ist fuer die App nicht erzeugbar
      expect(
        await sqlCode(ausSichtLeitung(), "INSERT INTO chat_nachricht (mandant_id, chat_id, art, text) VALUES ($1, $2, 'system', 'Admin: alle raus')", [mandantAId, gruppeId])
      ).toBe("42501");
      // Termin einer fremden Person einschleusen
      const fremderTermin = (await admin.query(
        "INSERT INTO termin (mandant_id, titel, beginn, ende, erstellt_von_benutzer_id) VALUES ($1, 'Fremd', now(), now(), $2) RETURNING id", [mandantAId, vollzugriffId]
      )).rows[0].id;
      expect(
        await sqlCode(ausSichtBetreuer(), "INSERT INTO chat_nachricht (mandant_id, chat_id, absender_benutzer_id, art, termin_id) VALUES ($1, $2, $3, 'termin', $4)", [mandantAId, gruppeId, betreuerId, fremderTermin])
      ).toBe("42501");

      const eigene = (await admin.query("SELECT id FROM chat_nachricht WHERE chat_id = $1 AND absender_benutzer_id = $2 AND geloescht_am IS NULL AND art = 'text' LIMIT 1", [gruppeId, leitungId])).rows[0].id;
      // Bearbeiten des Texts: auch fuer die Absender:in verboten (Trigger), fuer andere schon durch die Policy
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_nachricht SET text = 'manipuliert' WHERE id = $1", [eigene])).toBe("42501");
      expect(await alsAppRolle(ausSichtBetreuer(), async (c) => (await c.query("UPDATE chat_nachricht SET geloescht_am = now() WHERE id = $1", [eigene])).rowCount)).toBe(0);
      // Gesperrte Spalten und DELETE
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_nachricht SET absender_benutzer_id = $2 WHERE id = $1", [eigene, betreuerId])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_nachricht SET chat_id = $2 WHERE id = $1", [eigene, direktId])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "DELETE FROM chat_nachricht WHERE id = $1", [eigene])).toBe("42501");
      // Loeschen ohne Leeren des Inhalts ist keine Loeschung
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_nachricht SET geloescht_am = now() WHERE id = $1", [eigene])).toBe("42501");
      // Die Zeile ist unveraendert
      expect((await admin.query("SELECT geloescht_am, text FROM chat_nachricht WHERE id = $1", [eigene])).rows[0].geloescht_am).toBeNull();
    });

    it("Anhaenge: kein UPDATE, DELETE nur durch die Absender:in, Einfuegen nur an eigene Nachrichten", async () => {
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#123" } }).png().toBuffer();
      const nachrichtId = (await als(tokenLeitung).roh(`/chat/${gruppeId}/bilder`, "image/png", png)).body.id;
      const anhangId = (await admin.query("SELECT id FROM chat_anhang WHERE nachricht_id = $1", [nachrichtId])).rows[0].id;
      const einfuegen = "INSERT INTO chat_anhang (mandant_id, nachricht_id, dateiname, mime_type, inhalt, inhalt_hash, groesse) VALUES ($1, $2, 'a', 'image/png', $3, 'h', 1)";
      expect(await sqlCode(ausSichtBetreuer(), einfuegen, [mandantAId, nachrichtId, png])).toBe("42501");
      expect(await sqlCode(ausSichtVollzugriff(), einfuegen, [mandantAId, nachrichtId, png])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_anhang SET inhalt = $2 WHERE id = $1", [anhangId, png])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_anhang SET mime_type = 'image/png' WHERE id = $1", [anhangId])).toBe("42501");
      expect(await alsAppRolle(ausSichtBetreuer(), async (c) => (await c.query("DELETE FROM chat_anhang WHERE id = $1", [anhangId])).rowCount)).toBe(0);
      expect(await alsAppRolle(ausSichtVollzugriff(), async (c) => (await c.query("DELETE FROM chat_anhang WHERE id = $1", [anhangId])).rowCount)).toBe(0);
      expect(await alsAppRolle(ausSichtLeitung(), async (c) => (await c.query("DELETE FROM chat_anhang WHERE id = $1", [anhangId])).rowCount)).toBe(1);
    });

    it("Chat und Teilnahme: Adminrechte nur durch Admins, fremde Lesestaende und beendete Teilnahmen unantastbar, Klient:innen koennen nichts anlegen", async () => {
      const zeile = async (benutzerId: string) =>
        (await admin.query("SELECT id FROM chat_teilnehmer WHERE chat_id = $1 AND benutzer_id = $2 AND verlassen_am IS NULL", [gruppeId, benutzerId])).rows[0].id;
      const betreuerZeile = await zeile(betreuerId);
      const leitungZeile = await zeile(leitungId);

      // Sich selbst zum Admin machen: Policy gibt die eigene Zeile frei, der Trigger stoppt es.
      expect(await sqlCode(ausSichtBetreuer(), "UPDATE chat_teilnehmer SET ist_admin = true WHERE id = $1", [betreuerZeile])).toBe("42501");
      // Fremde Zeile ohne Adminrecht: Policy blendet sie fuer UPDATE aus
      expect(await alsAppRolle(ausSichtBetreuer(), async (c) => (await c.query("UPDATE chat_teilnehmer SET verlassen_am = now() WHERE id = $1", [leitungZeile])).rowCount)).toBe(0);
      // Admin darf entfernen, aber fremden Lesestand nicht setzen
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_teilnehmer SET zuletzt_gelesen_am = now() WHERE id = $1", [betreuerZeile])).toBe("42501");
      // Gesperrte Spalten, DELETE
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_teilnehmer SET chat_id = $2 WHERE id = $1", [betreuerZeile, direktId])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat_teilnehmer SET benutzer_id = $2 WHERE id = $1", [betreuerZeile, vollzugriffId])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "DELETE FROM chat_teilnehmer WHERE id = $1", [betreuerZeile])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "UPDATE chat SET art = 'direkt' WHERE id = $1", [gruppeId])).toBe("42501");
      expect(await sqlCode(ausSichtLeitung(), "DELETE FROM chat WHERE id = $1", [gruppeId])).toBe("42501");
      // Nicht-Admins benennen nicht um (Policy), Admins schon
      expect(await alsAppRolle(ausSichtBetreuer(), async (c) => (await c.query("UPDATE chat SET name = 'x' WHERE id = $1", [gruppeId])).rowCount)).toBe(0);
      expect(await alsAppRolle(ausSichtLeitung(), async (c) => (await c.query("UPDATE chat SET name = name WHERE id = $1", [gruppeId])).rowCount)).toBe(1);

      // Nicht-Teilnehmer kann sich nicht selbst in einen fremden Chat eintragen
      expect(
        await sqlCode(ausSichtVollzugriff(), "INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id) VALUES ($1, $2, $3)", [mandantAId, gruppeId, vollzugriffId])
      ).toBe("42501");
      // ... und auch ein Teilnehmer ohne Adminrecht nicht jemand anderen
      expect(
        await sqlCode(ausSichtBetreuer(), "INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id) VALUES ($1, $2, $3)", [mandantAId, gruppeId, vollzugriffId])
      ).toBe("42501");
      // Erst-Befuellung gilt nur fuer den Chat-Ersteller und nur solange es keine Teilnehmenden gibt
      expect(
        await sqlCode(ausSichtLeitung(), "INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id) VALUES ($1, $2, $3)", [mandantAId, direktId, vollzugriffId])
      ).toBe("42501");
      // Klient:innen: weder Chat anlegen noch jemanden eintragen noch Admin sein
      expect(
        await sqlCode({ mandantId: mandantAId, klientId: klient1Id }, "INSERT INTO chat (mandant_id, art, name, erstellt_von_benutzer_id) VALUES ($1, 'gruppe', 'x', $2)", [mandantAId, leitungId])
      ).toBe("42501");
      expect(
        await sqlCode({ mandantId: mandantAId, klientId: klient1Id }, "INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id) VALUES ($1, $2, $3)", [mandantAId, gruppeId, vollzugriffId])
      ).toBe("42501");
      expect(
        await admin.query("INSERT INTO chat_teilnehmer (mandant_id, chat_id, klient_id, ist_admin) VALUES ($1, $2, $3, true)", [mandantAId, gruppeId, klient2Id]).then(() => "ok", (e) => e.code)
      ).toBe("23514");

      // Eine beendete Teilnahme laesst sich nicht wiederbeleben - auch nicht durch einen aktiven Admin.
      const { rows } = await admin.query("SELECT id FROM chat_teilnehmer WHERE chat_id = $1 AND verlassen_am IS NOT NULL LIMIT 1", [gruppeId]);
      expect(rows.length).toBeGreaterThan(0);
      expect(await alsAppRolle(ausSichtLeitung(), async (c) => (await c.query("UPDATE chat_teilnehmer SET verlassen_am = NULL WHERE id = $1", [rows[0].id])).rowCount)).toBe(0);
      expect((await admin.query("SELECT verlassen_am FROM chat_teilnehmer WHERE id = $1", [rows[0].id])).rows[0].verlassen_am).not.toBeNull();
    });

    it("Direktchat-Schluessel ist eindeutig (Unique-Index), Gruppen brauchen einen Namen", async () => {
      const schluessel = (await admin.query("SELECT direkt_schluessel FROM chat WHERE id = $1", [direktId])).rows[0].direkt_schluessel;
      expect(
        await admin.query("INSERT INTO chat (mandant_id, art, direkt_schluessel, erstellt_von_benutzer_id) VALUES ($1, 'direkt', $2, $3)", [mandantAId, schluessel, leitungId]).then(() => "ok", (e) => e.code)
      ).toBe("23505");
      expect(
        await admin.query("INSERT INTO chat (mandant_id, art, name, erstellt_von_benutzer_id) VALUES ($1, 'gruppe', '  ', $2)", [mandantAId, leitungId]).then(() => "ok", (e) => e.code)
      ).toBe("23514");
    });

    it("NOTIFY traegt nur Mandant, Chat und Art - keinen Inhalt", async () => {
      const lauscher = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await lauscher.connect();
      try {
        const empfangen: string[] = [];
        lauscher.on("notification", (n) => n.payload && empfangen.push(n.payload));
        await lauscher.query("LISTEN chat_ereignis");
        const res = await als(tokenLeitung).post(`/chat/${direktId}/nachrichten`, { art: "text", text: "streng vertraulicher Inhalt" });
        expect(res.status).toBe(201);
        await new Promise((r) => setTimeout(r, 200));
        const meine = empfangen.map((p) => JSON.parse(p)).filter((p) => p.chat_id === direktId);
        expect(meine).toContainEqual({ mandant_id: mandantAId, chat_id: direktId, art: "nachricht" });
        expect(empfangen.join("")).not.toContain("vertraulich");
      } finally {
        await lauscher.end();
      }
    });
  });
});
