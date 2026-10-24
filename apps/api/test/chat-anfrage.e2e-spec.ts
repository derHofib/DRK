/**
 * Chat-Anfragen durch Klient:innen (migrations/0056, chat-anfrage.service.ts).
 *
 * Kernaussagen:
 *   1. Klient:innen duerfen nur Bezugsbetreuer:in, Mitarbeitende des Standorts der aktuellen
 *      Belegung und das Team dieses Standorts anfragen -- die Datenbank erzwingt das selbst.
 *   2. Mitarbeitende sehen nur an sich oder ihr Team gerichtete Anfragen (und nur von
 *      Klient:innen, die sie sehen duerfen); fremde Standorte und Mandanten sehen nichts.
 *   3. Annehmen ist atomar: ein Direktchat, die Anfrage als erste Nachricht der Klient:in,
 *      bei Team-Anfragen gewinnt genau eine Person -- ohne dass die RLS-Insert-Policy von
 *      chat_nachricht aufgeweicht wird.
 *   4. Die App-Rolle kann Policies, Trigger und gesperrte Spalten nicht umgehen.
 *   5. Der SSE-Stream meldet Anfrage-Aenderungen nur an Betroffene (art "anfrage", ohne Inhalt).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";

interface Strom {
  status: number;
  roh: () => string;
  ereignisse: { chatId: string | null; art: string; anfrageId?: string }[];
  warteAuf: (bedingung: () => boolean, ms?: number) => Promise<void>;
}

describe("Chat-Anfragen", () => {
  let app: INestApplication;
  let admin: Client;
  let port: number;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  let slugA: string;
  let slugB: string;

  let mandantAId: string;
  let mandantBId: string;
  let s1Id: string; // "Haus Eins"
  let s2Id: string; // "Haus Zwei"
  let standortBId: string;

  let leitungId: string; // unbeschraenkt
  let vollzugriffId: string; // unbeschraenkt
  let bezugId: string; // Bezugsbetreuer von k1, nur S2
  let s1aId: string;
  let s1bId: string;
  let s1cId: string;
  let s1dId: string;
  let s1eId: string;
  let s2aId: string;
  let inaktivId: string; // S1, deaktiviert
  let leitungBId: string;
  let mitarbeiterBId: string;

  let tokenLeitung: string;
  let tokenVollzugriff: string;
  let tokenBezug: string;
  let tokenS1a: string;
  let tokenS1b: string;
  let tokenS2a: string;
  let tokenLeitungB: string;

  let k1: Konto; // Max Muster, S1, Bezugsbetreuer = bezug
  let k2: Konto; // Erika Beispiel, S2, Bezugsbetreuerin deaktiviert
  let k3: Konto; // ohne Belegung, Bezugsbetreuer = s2a
  let k5: Konto; // ohne Belegung, ohne Bezugsbetreuer
  let kB: Konto; // anderer Mandant, S_B

  interface Konto {
    id: string;
    token: string;
  }

  const http_ = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http_()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http_()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    del: (p: string) => request(http_()).delete(p).set("Authorization", `Bearer ${token}`),
  });

  let zimmerNr = 0;
  async function neuerKlient(opt: { vorname: string; nachname?: string; standortId?: string; bezugId?: string; mandantId?: string; slug?: string; von?: string }): Promise<Konto> {
    const mandantId = opt.mandantId ?? mandantAId;
    const nummer = ++zimmerNr;
    const klientId: string = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, $2, $3, '2005-01-01', $4, 'Jugendamt') RETURNING id`,
        [mandantId, opt.vorname, opt.nachname ?? "Muster", `ANF-${nummer}-${suffix}`]
      )
    ).rows[0].id;
    if (opt.standortId) {
      const zimmerId = (
        await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id", [mandantId, opt.standortId, `Z${nummer}`])
      ).rows[0].id;
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, zimmerId, klientId]);
    }
    if (opt.bezugId) {
      await admin.query("INSERT INTO klient_stammdaten (mandant_id, klient_id, bezugsbetreuer_id) VALUES ($1, $2, $3)", [mandantId, klientId, opt.bezugId]);
    }
    const email = `k${nummer}-${suffix}@beispiel.test`;
    await legeKlientZugangAn(admin, { mandantId, klientId, email, passwortHash: await bcrypt.hash(passwort, 4), eingeladenVon: opt.von ?? leitungId });
    return { id: klientId, token: await klientToken(app, opt.slug ?? slugA, email, passwort) };
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    slugA = `test-anf-a-${suffix}`;
    slugB = `test-anf-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Anfrage A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Anfrage B ${suffix}`, slugB])).rows[0].id;
    s1Id = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Eins', 'Str. 1') RETURNING id", [mandantAId])).rows[0].id;
    s2Id = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Zwei', 'Str. 2') RETURNING id", [mandantAId])).rows[0].id;
    standortBId = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Fremd', 'Str. 9') RETURNING id", [mandantBId])).rows[0].id;

    const konto = (mandantId: string, rolle: "bereichsleitung" | "einrichtungsleitung" | "betreuer", kurz: string, name: string) =>
      kontoMitAlterRolle(admin, { mandantId, rolle, email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash: hash });
    const zuStandort = (mandantId: string, benutzerId: string, standortId: string) =>
      admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, benutzerId, standortId]);
    leitungId = await konto(mandantAId, "einrichtungsleitung", "leitung", "Anna Leitung");
    vollzugriffId = await konto(mandantAId, "bereichsleitung", "vollzugriff", "Vera Vollzugriff");
    bezugId = await konto(mandantAId, "betreuer", "bezug", "Bea Bezug");
    s1aId = await konto(mandantAId, "betreuer", "s1a", "Sven Eins-A");
    s1bId = await konto(mandantAId, "betreuer", "s1b", "Susi Eins-B");
    s1cId = await konto(mandantAId, "betreuer", "s1c", "Sepp Eins-C");
    s1dId = await konto(mandantAId, "betreuer", "s1d", "Sina Eins-D");
    s1eId = await konto(mandantAId, "betreuer", "s1e", "Silke Eins-E");
    s2aId = await konto(mandantAId, "betreuer", "s2a", "Zora Zwei-A");
    inaktivId = await konto(mandantAId, "betreuer", "inaktiv", "Ida Inaktiv");
    leitungBId = await konto(mandantBId, "einrichtungsleitung", "leitung-b", "Lena Leitung B");
    mitarbeiterBId = await konto(mandantBId, "betreuer", "mitarbeiter-b", "Mats Mitarbeiter B");
    for (const id of [s1aId, s1bId, s1cId, s1dId, s1eId, inaktivId]) await zuStandort(mandantAId, id, s1Id);
    for (const id of [bezugId, s2aId]) await zuStandort(mandantAId, id, s2Id);
    await zuStandort(mandantBId, mitarbeiterBId, standortBId);
    await admin.query("UPDATE benutzer SET aktiv = false WHERE id = $1", [inaktivId]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;

    const login = async (slug: string, kurz: string) =>
      (await request(http_()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenLeitung = await login(slugA, "leitung");
    tokenVollzugriff = await login(slugA, "vollzugriff");
    tokenBezug = await login(slugA, "bezug");
    tokenS1a = await login(slugA, "s1a");
    tokenS1b = await login(slugA, "s1b");
    tokenS2a = await login(slugA, "s2a");
    tokenLeitungB = await login(slugB, "leitung-b");

    k1 = await neuerKlient({ vorname: "Max", nachname: "Muster", standortId: s1Id, bezugId });
    k2 = await neuerKlient({ vorname: "Erika", nachname: "Beispiel", standortId: s2Id, bezugId: inaktivId });
    k3 = await neuerKlient({ vorname: "Karl", nachname: "Ohnebelegung", bezugId: s2aId });
    k5 = await neuerKlient({ vorname: "Nora", nachname: "Nirgends" });
    kB = await neuerKlient({ vorname: "Britta", nachname: "Fremd", standortId: standortBId, bezugId: mitarbeiterBId, mandantId: mandantBId, slug: slugB, von: leitungBId });
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      await admin.query("DELETE FROM chat_anfrage WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_anhang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_nachricht WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat WHERE mandant_id = ANY($1)", [ids]);
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = ANY($1)", [ids]);
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
  async function alsAppRolle<T>(ctx: { mandantId: string; benutzerId?: string; klientId?: string }, fn: (c: Client) => Promise<T>): Promise<T> {
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
  const zeilen = (ctx: Parameters<typeof alsAppRolle>[0], sql: string, params: unknown[] = []) =>
    alsAppRolle(ctx, async (c) => (await c.query(sql, params)).rows);
  const ausSicht = (benutzerId: string) => ({ mandantId: mandantAId, benutzerId });
  const ausSichtKlient = (klientId: string) => ({ mandantId: mandantAId, klientId });

  const stelle = (k: Konto, body: object) => als(k.token).post("/chat/anfragen", body);
  const ids = (res: request.Response) => (res.body as { id: string }[]).map((a) => a.id);

  // --- Ziele -------------------------------------------------------------------------

  it("Ziele: Bezugsbetreuer:in zuerst, dann das Team, dann Mitarbeitende des Standorts der aktuellen Belegung", async () => {
    const res = await als(k1.token).get("/chat/anfragen/ziele");
    expect(res.status).toBe(200);
    const kurz = res.body.map((z: any) => (z.art === "team" ? `team:${z.standortId}` : z.benutzerId));
    expect(kurz).toEqual([bezugId, `team:${s1Id}`, s1aId, s1eId, s1cId, s1dId, s1bId].slice(0, 2).concat(
      // Namen sind die Sortierung: Sepp, Silke, Sina, Susi, Sven -> nach Namen, nicht nach ID
      [s1cId, s1eId, s1dId, s1bId, s1aId]
    ));
    expect(res.body[0]).toMatchObject({ art: "benutzer", name: "Bea Bezug", istBezugsbetreuer: true, direktChatId: null });
    expect(res.body[1]).toEqual({ art: "team", standortId: s1Id, name: "Team Haus Eins" });
    // Nie dabei: deaktivierte, Unbeschraenkte (Leitung), Mitarbeitende anderer Standorte, andere Klient:innen
    for (const nicht of [inaktivId, leitungId, vollzugriffId, s2aId, k2.id]) expect(JSON.stringify(res.body)).not.toContain(nicht);
    expect(JSON.stringify(res.body)).not.toContain(s2Id);

    // Ein schon bestehender Direktchat wird angezeigt
    const chat = (await als(tokenS1a).post("/chat/direkt", { klientId: k1.id })).body.id;
    const danach = (await als(k1.token).get("/chat/anfragen/ziele")).body.find((z: any) => z.benutzerId === s1aId);
    expect(danach.direktChatId).toBe(chat);
  });

  it("Ziele: Bezugsbetreuer:in gilt auch ohne Belegung (dann aber ohne Team); ohne beides leer; deaktivierte fehlen", async () => {
    const k3Ziele = (await als(k3.token).get("/chat/anfragen/ziele")).body;
    expect(k3Ziele).toEqual([{ art: "benutzer", benutzerId: s2aId, name: "Zora Zwei-A", istBezugsbetreuer: true, direktChatId: null }]);
    expect((await als(k5.token).get("/chat/anfragen/ziele")).body).toEqual([]);

    // k2: Bezugsbetreuerin ist deaktiviert (und S1-Mitarbeiterin), also bleiben Team und die S2-Mitarbeitenden
    const k2Ziele = (await als(k2.token).get("/chat/anfragen/ziele")).body;
    expect(k2Ziele.map((z: any) => (z.art === "team" ? `team:${z.name}` : z.benutzerId))).toEqual(["team:Team Haus Zwei", bezugId, s2aId]);
    expect(k2Ziele.every((z: any) => z.istBezugsbetreuer !== true)).toBe(true);

    // Anderer Mandant: nur die eigenen
    const kBZiele = (await als(kB.token).get("/chat/anfragen/ziele")).body;
    expect(kBZiele.map((z: any) => z.benutzerId ?? z.standortId).sort()).toEqual([mitarbeiterBId, standortBId].sort());
  });

  it("Rollen: Klient-Endpunkte sind fuer Mitarbeitende 403, Mitarbeiter-Endpunkte fuer Klient:innen 403, ohne Token 401", async () => {
    for (const token of [tokenLeitung, tokenVollzugriff]) {
      expect((await als(token).get("/chat/anfragen/ziele")).status).toBe(403);
      expect((await als(token).post("/chat/anfragen", { benutzerId: s1aId })).status).toBe(403);
    }
    const x = (await stelle(k1, { benutzerId: s1bId })).body.id;
    expect((await als(tokenLeitung).del(`/chat/anfragen/${x}`)).status).toBe(403);
    expect((await als(k1.token).post(`/chat/anfragen/${x}/annehmen`)).status).toBe(403);
    expect((await als(k1.token).post(`/chat/anfragen/${x}/ablehnen`, {})).status).toBe(403);
    for (const pfad of ["/chat/anfragen", "/chat/anfragen/ziele"]) expect((await request(http_()).get(pfad)).status).toBe(401);
    expect((await request(http_()).post("/chat/anfragen").send({ benutzerId: s1aId })).status).toBe(401);
    // Die Routen werden nicht von /chat/:id geschluckt
    expect((await als(tokenS1a).get("/chat/anfragen")).status).toBe(200);
    expect((await als(tokenS1a).get("/chat/anfragen")).body).toBeInstanceOf(Array);
    await als(k1.token).del(`/chat/anfragen/${x}`);
  });

  // --- Stellen -----------------------------------------------------------------------

  it("Stellen: an Person und an Team; Text wird getrimmt; zweite offene Anfrage an dasselbe Ziel -> 409", async () => {
    const k = await neuerKlient({ vorname: "Stella", standortId: s1Id });
    const person = await stelle(k, { benutzerId: s1aId, nachricht: "  Hallo, ich brauche Hilfe  " });
    expect(person.status).toBe(201);
    expect(person.body).toMatchObject({
      zustand: "offen",
      nachricht: "Hallo, ich brauche Hilfe",
      klient: { art: "klient", id: k.id, name: "Stella" },
      ziel: { art: "benutzer", id: s1aId, name: "Sven Eins-A" },
      beantwortetAm: null,
      beantwortetVon: null,
      ablehnungsgrund: null,
      chatId: null,
    });
    const team = await stelle(k, { standortId: s1Id });
    expect(team.status).toBe(201);
    expect(team.body).toMatchObject({ zustand: "offen", nachricht: null, ziel: { art: "team", id: s1Id, name: "Team Haus Eins" } });

    expect((await stelle(k, { benutzerId: s1aId })).status).toBe(409);
    expect((await stelle(k, { standortId: s1Id, nachricht: "nochmal" })).status).toBe(409);
    // Eine andere Klient:in darf dasselbe Ziel anfragen
    expect((await stelle(k1, { benutzerId: s1aId })).status).toBe(201);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_anfrage WHERE klient_id = $1", [k.id])).rows[0].n).toBe(2);
  });

  it("Stellen: unzulaessige Ziele und Eingaben -> 400 (nichts wird angelegt)", async () => {
    const k = await neuerKlient({ vorname: "Ungueltig", standortId: s1Id });
    const vorher = (await admin.query("SELECT count(*)::int AS n FROM chat_anfrage WHERE mandant_id = $1", [mandantAId])).rows[0].n;
    const schlecht: object[] = [
      { benutzerId: s2aId }, // anderer Standort
      { benutzerId: leitungId }, // unbeschraenkt: kein Ziel fuer Personen
      { benutzerId: inaktivId }, // deaktiviert
      { benutzerId: k1.id }, // eine andere Klient:in
      { benutzerId: randomUUID() },
      { benutzerId: mitarbeiterBId }, // anderer Mandant
      { standortId: s2Id }, // nicht mein Standort
      { standortId: standortBId }, // Standort eines anderen Mandanten
      { standortId: randomUUID() },
      { benutzerId: s1aId, standortId: s1Id }, // beides
      {},
      { benutzerId: "kein-uuid" },
      { benutzerId: s1aId, nachricht: "x".repeat(1001) },
      { benutzerId: s1aId, nachricht: 5 },
      { benutzerId: s1aId, kommentar: "unbekanntes Feld" },
    ];
    for (const body of schlecht) {
      const res = await stelle(k, body);
      expect([body, res.status]).toEqual([body, 400]);
    }
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_anfrage WHERE mandant_id = $1", [mandantAId])).rows[0].n).toBe(vorher);
    // Ohne Belegung und ohne Bezugsbetreuung gibt es gar kein Ziel
    expect((await stelle(k5, { standortId: s1Id })).status).toBe(400);
    expect((await stelle(k3, { standortId: s1Id })).status).toBe(400);
    // Leerer Text zaehlt als kein Text
    const leer = await stelle(k, { benutzerId: s1bId, nachricht: "   " });
    expect(leer.status).toBe(201);
    expect(leer.body.nachricht).toBeNull();
  });

  it("Hoechstens 5 offene Anfragen je Klient:in (409); nach Zurueckziehen geht wieder eine", async () => {
    const k = await neuerKlient({ vorname: "Limit", standortId: s1Id });
    const erste: string[] = [];
    for (const benutzerId of [s1aId, s1bId, s1cId, s1dId, s1eId]) {
      const res = await stelle(k, { benutzerId });
      expect(res.status).toBe(201);
      erste.push(res.body.id);
    }
    const sechste = await stelle(k, { standortId: s1Id });
    expect(sechste.status).toBe(409);
    expect(sechste.body.message).toMatch(/5 offene Anfragen/);
    expect((await als(k.token).del(`/chat/anfragen/${erste[0]}`)).status).toBe(200);
    expect((await stelle(k, { benutzerId: s1aId })).status).toBe(201); // das Ziel von eben ist wieder frei
    expect((await stelle(k, { standortId: s1Id })).status).toBe(409); // wieder 5 offen
    expect((await stelle(k, { benutzerId: s1aId })).status).toBe(409);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_anfrage WHERE klient_id = $1 AND beantwortet_am IS NULL", [k.id])).rows[0].n).toBe(5);
  });

  it("Gleichzeitige Anfragen derselben Klient:in ueberschreiten die Obergrenze nicht", async () => {
    const k = await neuerKlient({ vorname: "Parallel", standortId: s1Id });
    const antworten = await Promise.all(
      [s1aId, s1bId, s1cId, s1dId, s1eId].map((benutzerId) => stelle(k, { benutzerId })).concat([stelle(k, { standortId: s1Id }), stelle(k, { standortId: s1Id })])
    );
    const status = antworten.map((r) => r.status).sort();
    // 6 verschiedene Ziele + 1 Duplikat: hoechstens 5 gehen durch
    expect(status.filter((s) => s === 201)).toHaveLength(5);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_anfrage WHERE klient_id = $1 AND beantwortet_am IS NULL", [k.id])).rows[0].n).toBe(5);
  });

  // --- Sichtbarkeit ------------------------------------------------------------------

  it("Mitarbeitende sehen nur an sich oder ihr Team gerichtete offene Anfragen; Klient:innen nur ihre eigenen", async () => {
    const a = await neuerKlient({ vorname: "Alma", standortId: s1Id });
    const b = await neuerKlient({ vorname: "Berta", standortId: s2Id });
    const aPerson = (await stelle(a, { benutzerId: s1aId, nachricht: "an Sven" })).body.id;
    const aTeam = (await stelle(a, { standortId: s1Id })).body.id;
    const bTeam = (await stelle(b, { standortId: s2Id })).body.id;
    const bPerson = (await stelle(b, { benutzerId: s2aId })).body.id;

    const liste = async (token: string) => ids(await als(token).get("/chat/anfragen"));
    const s1a = await liste(tokenS1a);
    expect(s1a).toEqual(expect.arrayContaining([aPerson, aTeam]));
    expect(s1a).not.toContain(bTeam);
    expect(s1a).not.toContain(bPerson);

    const s1b = await liste(tokenS1b);
    expect(s1b).toContain(aTeam);
    for (const nicht of [aPerson, bTeam, bPerson]) expect(s1b).not.toContain(nicht);

    const s2a = await liste(tokenS2a);
    expect(s2a).toEqual(expect.arrayContaining([bTeam, bPerson]));
    for (const nicht of [aPerson, aTeam]) expect(s2a).not.toContain(nicht);

    // Bea ist nur S2 zugeordnet: Team S2 ja, Team S1 nein; Personen-Anfragen an andere nie
    const bezug = await liste(tokenBezug);
    expect(bezug).toContain(bTeam);
    for (const nicht of [aTeam, aPerson, bPerson]) expect(bezug).not.toContain(nicht);

    // Unbeschraenkte sehen jedes Team, aber keine Personen-Anfragen an andere
    for (const token of [tokenLeitung, tokenVollzugriff]) {
      const alle = await liste(token);
      expect(alle).toEqual(expect.arrayContaining([aTeam, bTeam]));
      for (const nicht of [aPerson, bPerson]) expect(alle).not.toContain(nicht);
    }

    // Anfrage-DTO fuer Mitarbeitende: Klient:in mit vollem Namen (sichtbar), Ziel, Text
    const dto = (await als(tokenS1a).get("/chat/anfragen")).body.find((x: any) => x.id === aPerson);
    expect(dto).toMatchObject({ zustand: "offen", nachricht: "an Sven", klient: { art: "klient", id: a.id, name: "Alma Muster" }, ziel: { art: "benutzer", id: s1aId } });

    // Klient:in: nur die eigenen, auch beantwortete
    expect(await liste(a.token)).toEqual(expect.arrayContaining([aPerson, aTeam]));
    expect((await liste(a.token)).some((x) => x === bTeam || x === bPerson)).toBe(false);
    expect(await liste(b.token)).not.toContain(aPerson);

    // Einzelne Aktionen auf unsichtbare Anfragen -> 404, nichts verraten
    for (const [token, anfrage] of [[tokenS1b, aPerson], [tokenS2a, aTeam], [tokenBezug, aTeam], [tokenLeitung, aPerson]] as const) {
      expect([anfrage, (await als(token).post(`/chat/anfragen/${anfrage}/annehmen`)).status]).toEqual([anfrage, 404]);
      expect((await als(token).post(`/chat/anfragen/${anfrage}/ablehnen`, {})).status).toBe(404);
    }
    expect((await als(b.token).del(`/chat/anfragen/${aPerson}`)).status).toBe(404);
    expect((await als(tokenS1a).post(`/chat/anfragen/${randomUUID()}/annehmen`)).status).toBe(404);
    expect((await als(tokenS1a).post("/chat/anfragen/keine-uuid/annehmen")).status).toBe(404);
  });

  it("Klient:in, die ein:e standortbeschraenkte:r Mitarbeitende:r nicht (mehr) sehen darf, taucht dort weder auf noch laesst sie sich annehmen", async () => {
    const w = await neuerKlient({ vorname: "Willi", standortId: s1Id });
    const anfrage = (await stelle(w, { standortId: s1Id })).body.id;
    expect(ids(await als(tokenS1a).get("/chat/anfragen"))).toContain(anfrage);
    const vorher = (await als(tokenS1a).get("/chat/ungelesen")).body.offeneAnfragen;

    // Umzug nach S2: das Team S1 hat die Person nicht mehr im Blick (letzte Belegung liegt in S2)
    await admin.query("UPDATE belegung SET auszug = CURRENT_DATE - 1 WHERE klient_id = $1", [w.id]);
    const zimmerS2 = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id", [mandantAId, s2Id, `W${suffix}`])).rows[0].id;
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, CURRENT_DATE)", [mandantAId, zimmerS2, w.id]);

    expect(ids(await als(tokenS1a).get("/chat/anfragen"))).not.toContain(anfrage);
    expect((await als(tokenS1a).get("/chat/ungelesen")).body.offeneAnfragen).toBe(vorher - 1);
    expect((await als(tokenS1a).post(`/chat/anfragen/${anfrage}/annehmen`)).status).toBe(404);
    expect((await als(tokenS1a).post(`/chat/anfragen/${anfrage}/ablehnen`, {})).status).toBe(404);
    // Die Leitung sieht weiterhin alles und kann annehmen
    expect(ids(await als(tokenLeitung).get("/chat/anfragen"))).toContain(anfrage);
    expect((await als(tokenLeitung).post(`/chat/anfragen/${anfrage}/annehmen`)).status).toBe(200);
  });

  it("Menue-Badge: offeneAnfragen zaehlt genau die Eintraege der Liste; Klient:innen immer 0", async () => {
    const k = await neuerKlient({ vorname: "Badge", standortId: s1Id });
    const vorher = (await als(tokenS1b).get("/chat/ungelesen")).body;
    expect(vorher).toEqual({ ungelesen: expect.any(Number), offeneAnfragen: (await als(tokenS1b).get("/chat/anfragen")).body.length });
    const id = (await stelle(k, { benutzerId: s1bId })).body.id;
    expect((await als(tokenS1b).get("/chat/ungelesen")).body.offeneAnfragen).toBe(vorher.offeneAnfragen + 1);
    await als(tokenS1b).post(`/chat/anfragen/${id}/ablehnen`, {});
    expect((await als(tokenS1b).get("/chat/ungelesen")).body.offeneAnfragen).toBe(vorher.offeneAnfragen);
    expect((await als(k.token).get("/chat/ungelesen")).body.offeneAnfragen).toBe(0);
    expect((await als(tokenS2a).get("/chat/ungelesen")).body.offeneAnfragen).toBe((await als(tokenS2a).get("/chat/anfragen")).body.length);
  });

  // --- Annehmen ----------------------------------------------------------------------

  it("Annehmen: Direktchat entsteht, der Text ist die erste Nachricht der Klient:in, beide Seiten sehen die Anfrage als angenommen", async () => {
    const k = await neuerKlient({ vorname: "Anni", standortId: s1Id });
    const anfrage = (await stelle(k, { benutzerId: s1aId, nachricht: "Ich brauche eine Bescheinigung" })).body.id;

    const res = await als(tokenS1a).post(`/chat/anfragen/${anfrage}/annehmen`);
    expect(res.status).toBe(200);
    const chatId = res.body.chatId;
    expect(res.body.anfrage).toMatchObject({ id: anfrage, zustand: "angenommen", chatId, beantwortetVon: { id: s1aId, name: "Sven Eins-A" } });
    expect(res.body.anfrage.beantwortetAm).not.toBeNull();

    const chat = await als(tokenS1a).get(`/chat/${chatId}`);
    expect(chat.body).toMatchObject({ art: "direkt", anzeigename: "Anni Muster", binAdmin: false });
    expect(chat.body.teilnehmer.map((t: any) => `${t.art}:${t.id}`).sort()).toEqual([`benutzer:${s1aId}`, `klient:${k.id}`].sort());
    const nachrichten = (await als(tokenS1a).get(`/chat/${chatId}/nachrichten`)).body.nachrichten;
    expect(nachrichten).toHaveLength(1);
    expect(nachrichten[0]).toMatchObject({ art: "text", text: "Ich brauche eine Bescheinigung", eigene: false, absender: { art: "klient", id: k.id } });
    // Die Klient:in sieht denselben Chat und die Nachricht als ihre eigene; ungelesen fuer Sven, nicht fuer Anni
    const alsKlient = (await als(k.token).get(`/chat/${chatId}/nachrichten`)).body.nachrichten;
    expect(alsKlient).toHaveLength(1);
    expect(alsKlient[0]).toMatchObject({ eigene: true, text: "Ich brauche eine Bescheinigung" });
    expect((await als(tokenS1a).get(`/chat/${chatId}`)).body.ungelesen).toBe(1);
    expect((await als(k.token).get(`/chat/${chatId}`)).body.ungelesen).toBe(0);

    // Stand fuer die Klient:in und die Liste der Mitarbeitenden
    const eigene = (await als(k.token).get("/chat/anfragen")).body.find((x: any) => x.id === anfrage);
    expect(eigene).toMatchObject({ zustand: "angenommen", chatId, beantwortetVon: { name: "Sven Eins-A" } });
    expect(ids(await als(tokenS1a).get("/chat/anfragen"))).not.toContain(anfrage);
    // Der Direktchat laesst sich weiter normal benutzen (und ist der EINE Chat zwischen beiden)
    expect((await als(k.token).post(`/chat/${chatId}/nachrichten`, { art: "text", text: "Danke" })).status).toBe(201);
    expect((await als(tokenS1a).post("/chat/direkt", { klientId: k.id })).body.id).toBe(chatId);
    // Erneut anfragen ist moeglich, sobald nichts mehr offen ist
    expect((await stelle(k, { benutzerId: s1aId })).status).toBe(201);
  });

  it("Annehmen in einen bestehenden Direktchat: kein zweiter Chat, die Historie bleibt sichtbar, der Text kommt dazu", async () => {
    const k = await neuerKlient({ vorname: "Hist", standortId: s1Id });
    const chat = (await als(tokenS1b).post("/chat/direkt", { klientId: k.id })).body.id;
    await als(tokenS1b).post(`/chat/${chat}/nachrichten`, { art: "text", text: "Willkommen bei uns" });
    const anfrage = (await stelle(k, { benutzerId: s1bId, nachricht: "Habe eine Frage" })).body.id;

    const res = await als(tokenS1b).post(`/chat/anfragen/${anfrage}/annehmen`);
    expect(res.status).toBe(200);
    expect(res.body.chatId).toBe(chat);
    for (const token of [tokenS1b, k.token]) {
      const texte = (await als(token).get(`/chat/${chat}/nachrichten`)).body.nachrichten.map((n: any) => n.text);
      expect(texte).toEqual(["Habe eine Frage", "Willkommen bei uns"]);
    }
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_teilnehmer WHERE chat_id = $1", [chat])).rows[0].n).toBe(2);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat WHERE direkt_schluessel LIKE $1", [`%klient:${k.id}`])).rows[0].n).toBe(1);
  });

  it("Annehmen ohne Text legt den Chat an, aber keine Nachricht; Team-Anfrage: wer annimmt, bekommt den Chat (auch Unbeschraenkte)", async () => {
    const k = await neuerKlient({ vorname: "Stumm", standortId: s1Id });
    const anfrage = (await stelle(k, { standortId: s1Id })).body.id;
    const res = await als(tokenLeitung).post(`/chat/anfragen/${anfrage}/annehmen`);
    expect(res.status).toBe(200);
    expect((await als(tokenLeitung).get(`/chat/${res.body.chatId}/nachrichten`)).body.nachrichten).toEqual([]);
    expect(res.body.anfrage).toMatchObject({ zustand: "angenommen", ziel: { art: "team" }, beantwortetVon: { id: leitungId } });
    expect((await admin.query("SELECT direkt_schluessel FROM chat WHERE id = $1", [res.body.chatId])).rows[0].direkt_schluessel).toBe(`benutzer:${leitungId}|klient:${k.id}`);
  });

  it("Zweites Annehmen/Ablehnen/Zurueckziehen einer beantworteten Anfrage -> 409; Fremde -> 404; Klient:in kann nicht annehmen", async () => {
    const k = await neuerKlient({ vorname: "Zweimal", standortId: s1Id });
    const person = (await stelle(k, { benutzerId: s1aId, nachricht: "eins" })).body.id;
    const team = (await stelle(k, { standortId: s1Id })).body.id;

    expect((await als(tokenS1a).post(`/chat/anfragen/${person}/annehmen`)).status).toBe(200);
    expect((await als(tokenS1a).post(`/chat/anfragen/${person}/annehmen`)).status).toBe(409);
    expect((await als(tokenS1a).post(`/chat/anfragen/${person}/ablehnen`, {})).status).toBe(409);
    expect((await als(k.token).del(`/chat/anfragen/${person}`)).status).toBe(409);
    expect((await als(tokenS1b).post(`/chat/anfragen/${person}/annehmen`)).status).toBe(404);

    // Team: s1a nimmt an, s1b (anderes Teammitglied) kommt zu spaet -> 409, s2a gehoert nicht zum Team -> 404
    expect((await als(tokenS1a).post(`/chat/anfragen/${team}/annehmen`)).status).toBe(200);
    expect((await als(tokenS1b).post(`/chat/anfragen/${team}/annehmen`)).status).toBe(409);
    expect((await als(tokenS1b).post(`/chat/anfragen/${team}/ablehnen`, {})).status).toBe(409);
    expect((await als(tokenS2a).post(`/chat/anfragen/${team}/annehmen`)).status).toBe(404);
    // Beides war derselbe Direktchat; die Nachricht entstand genau einmal
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_nachricht n JOIN chat c ON c.id = n.chat_id WHERE c.direkt_schluessel LIKE $1", [`%klient:${k.id}`])).rows[0].n).toBe(1);
  });

  it("Team-Anfrage, zwei gleichzeitige Annahmen: genau eine Person gewinnt, der Verlierer hinterlaesst weder Chat noch Nachricht", async () => {
    for (let runde = 1; runde <= 4; runde++) {
      const k = await neuerKlient({ vorname: `Rennen${runde}`, standortId: s1Id });
      const anfrage = (await stelle(k, { standortId: s1Id, nachricht: `Runde ${runde}` })).body.id;
      const [a, b] = await Promise.all([
        als(tokenS1a).post(`/chat/anfragen/${anfrage}/annehmen`),
        als(tokenS1b).post(`/chat/anfragen/${anfrage}/annehmen`),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const sieger = a.status === 200 ? s1aId : s1bId;
      const zeile = (await admin.query("SELECT beantwortet_von, angenommen, chat_id FROM chat_anfrage WHERE id = $1", [anfrage])).rows[0];
      expect(zeile).toMatchObject({ beantwortet_von: sieger, angenommen: true });
      const chats = (await admin.query("SELECT id, direkt_schluessel FROM chat WHERE direkt_schluessel LIKE $1", [`%klient:${k.id}`])).rows;
      expect(chats).toEqual([{ id: zeile.chat_id, direkt_schluessel: `benutzer:${sieger}|klient:${k.id}` }]);
      expect((await admin.query("SELECT count(*)::int AS n FROM chat_nachricht WHERE chat_id = $1", [zeile.chat_id])).rows[0].n).toBe(1);
    }
  });

  it("Annehmen und Ablehnen gleichzeitig: nur eines gilt, beim Ablehnen entsteht kein Chat", async () => {
    for (let runde = 1; runde <= 4; runde++) {
      const k = await neuerKlient({ vorname: `Wettlauf${runde}`, standortId: s1Id });
      const anfrage = (await stelle(k, { standortId: s1Id, nachricht: "bitte" })).body.id;
      const [annahme, ablehnung] = await Promise.all([
        als(tokenS1a).post(`/chat/anfragen/${anfrage}/annehmen`),
        als(tokenS1b).post(`/chat/anfragen/${anfrage}/ablehnen`, { begruendung: "keine Zeit" }),
      ]);
      expect([annahme.status, ablehnung.status].sort()).toEqual([200, 409]);
      const zeile = (await admin.query("SELECT angenommen, chat_id, ablehnungsgrund FROM chat_anfrage WHERE id = $1", [anfrage])).rows[0];
      const chats = (await admin.query("SELECT count(*)::int AS n FROM chat WHERE direkt_schluessel LIKE $1", [`%klient:${k.id}`])).rows[0].n;
      if (annahme.status === 200) {
        expect(zeile).toMatchObject({ angenommen: true, ablehnungsgrund: null });
        expect(chats).toBe(1);
      } else {
        expect(zeile).toMatchObject({ angenommen: false, chat_id: null, ablehnungsgrund: "keine Zeit" });
        expect(chats).toBe(0);
      }
    }
  });

  it("Annehmen scheitert (409), wenn die Klient:in keinen aktiven Zugang mehr hat; es entsteht nichts", async () => {
    const k = await neuerKlient({ vorname: "Gesperrt", standortId: s1Id });
    const anfrage = (await stelle(k, { benutzerId: s1aId, nachricht: "hallo" })).body.id;
    await admin.query("UPDATE klient_zugang SET aktiv = false WHERE klient_id = $1", [k.id]);
    const res = await als(tokenS1a).post(`/chat/anfragen/${anfrage}/annehmen`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/aktiven Zugang/);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat WHERE direkt_schluessel LIKE $1", [`%klient:${k.id}`])).rows[0].n).toBe(0);
    expect((await admin.query("SELECT beantwortet_am FROM chat_anfrage WHERE id = $1", [anfrage])).rows[0].beantwortet_am).toBeNull();
    // Ablehnen bleibt moeglich, damit die Anfrage nicht ewig offen haengt
    expect((await als(tokenS1a).post(`/chat/anfragen/${anfrage}/ablehnen`, {})).status).toBe(200);
  });

  // --- Ablehnen / Zurueckziehen ------------------------------------------------------

  it("Ablehnen mit Begruendung: die Klient:in sieht 'abgelehnt' samt Grund, die Anfrage verschwindet aus der Liste, Chat entsteht nicht", async () => {
    const k = await neuerKlient({ vorname: "Abgelehnt", standortId: s1Id });
    const anfrage = (await stelle(k, { benutzerId: s1bId, nachricht: "Hilfe" })).body.id;
    const res = await als(tokenS1b).post(`/chat/anfragen/${anfrage}/ablehnen`, { begruendung: "  Bin die ganze Woche im Urlaub  " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ zustand: "abgelehnt", ablehnungsgrund: "Bin die ganze Woche im Urlaub", beantwortetVon: { id: s1bId, name: "Susi Eins-B" }, chatId: null });

    const eigene = (await als(k.token).get("/chat/anfragen")).body.find((x: any) => x.id === anfrage);
    expect(eigene).toMatchObject({ zustand: "abgelehnt", ablehnungsgrund: "Bin die ganze Woche im Urlaub" });
    expect(ids(await als(tokenS1b).get("/chat/anfragen"))).not.toContain(anfrage);
    expect((await als(tokenS1b).post(`/chat/anfragen/${anfrage}/annehmen`)).status).toBe(409);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat WHERE direkt_schluessel LIKE $1", [`%klient:${k.id}`])).rows[0].n).toBe(0);
    // Danach darf dieselbe Person erneut angefragt werden
    expect((await stelle(k, { benutzerId: s1bId })).status).toBe(201);

    // Ohne oder mit leerer Begruendung -> kein Grund; zu lang -> 400 und nichts geaendert
    const k2x = await neuerKlient({ vorname: "Ohnegrund", standortId: s1Id });
    const a1 = (await stelle(k2x, { benutzerId: s1bId })).body.id;
    expect((await als(tokenS1b).post(`/chat/anfragen/${a1}/ablehnen`, { begruendung: "x".repeat(501) })).status).toBe(400);
    expect((await als(tokenS1b).post(`/chat/anfragen/${a1}/ablehnen`, { begruendung: "  " })).body).toMatchObject({ zustand: "abgelehnt", ablehnungsgrund: null });
    const a2 = (await stelle(k2x, { benutzerId: s1bId })).body.id;
    expect((await als(tokenS1b).post(`/chat/anfragen/${a2}/ablehnen`)).body.zustand).toBe("abgelehnt"); // ganz ohne Body
  });

  it("Team-Anfrage ablehnen beendet sie fuer das ganze Team", async () => {
    const k = await neuerKlient({ vorname: "TeamNein", standortId: s1Id });
    const anfrage = (await stelle(k, { standortId: s1Id })).body.id;
    expect((await als(tokenS1a).post(`/chat/anfragen/${anfrage}/ablehnen`, { begruendung: "Wir sind voll" })).status).toBe(200);
    expect(ids(await als(tokenS1b).get("/chat/anfragen"))).not.toContain(anfrage);
    expect((await als(tokenS1b).post(`/chat/anfragen/${anfrage}/annehmen`)).status).toBe(409);
    expect((await als(k.token).get("/chat/anfragen")).body.find((x: any) => x.id === anfrage)).toMatchObject({ zustand: "abgelehnt", ziel: { art: "team" } });
  });

  it("Zurueckziehen: nur die eigene, nur solange offen; danach nichts mehr annehmbar", async () => {
    const k = await neuerKlient({ vorname: "Zurueck", standortId: s1Id });
    const andere = await neuerKlient({ vorname: "Fremdling", standortId: s1Id });
    const anfrage = (await stelle(k, { benutzerId: s1aId, nachricht: "doch nicht" })).body.id;
    expect((await als(andere.token).del(`/chat/anfragen/${anfrage}`)).status).toBe(404);
    const res = await als(k.token).del(`/chat/anfragen/${anfrage}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ zustand: "zurueckgezogen", beantwortetVon: null, chatId: null, ablehnungsgrund: null });
    expect((await als(k.token).del(`/chat/anfragen/${anfrage}`)).status).toBe(409);
    expect(ids(await als(tokenS1a).get("/chat/anfragen"))).not.toContain(anfrage);
    expect((await als(tokenS1a).post(`/chat/anfragen/${anfrage}/annehmen`)).status).toBe(409);
    expect((await als(tokenS1a).post(`/chat/anfragen/${anfrage}/ablehnen`, {})).status).toBe(409);
    expect((await als(k.token).get("/chat/anfragen")).body.find((x: any) => x.id === anfrage).zustand).toBe("zurueckgezogen");
    expect((await als(k.token).del(`/chat/anfragen/${randomUUID()}`)).status).toBe(404);
    expect((await als(k.token).del("/chat/anfragen/keine-uuid")).status).toBe(404);
    // Zurueckziehen und Annehmen gleichzeitig: genau eines gewinnt
    const rennen = (await stelle(k, { benutzerId: s1aId })).body.id;
    const [weg, rein] = await Promise.all([als(k.token).del(`/chat/anfragen/${rennen}`), als(tokenS1a).post(`/chat/anfragen/${rennen}/annehmen`)]);
    expect([weg.status, rein.status].sort()).toEqual([200, 409]);
    const zeile = (await admin.query("SELECT angenommen, chat_id FROM chat_anfrage WHERE id = $1", [rennen])).rows[0];
    expect(zeile.angenommen === true).toBe(weg.status === 409);
  });

  // --- Mandantentrennung -------------------------------------------------------------

  it("Mandantentrennung: der andere Mandant sieht und erreicht keine Anfragen, auch nicht auf Datenbankebene", async () => {
    const k = await neuerKlient({ vorname: "Mandant", standortId: s1Id });
    const anfrage = (await stelle(k, { standortId: s1Id })).body.id;
    const fremde = await stelle(kB, { standortId: standortBId });
    expect(fremde.status).toBe(201);

    expect(ids(await als(tokenLeitungB).get("/chat/anfragen"))).toEqual([fremde.body.id]);
    expect(ids(await als(kB.token).get("/chat/anfragen"))).toEqual([fremde.body.id]);
    expect((await als(tokenLeitungB).post(`/chat/anfragen/${anfrage}/annehmen`)).status).toBe(404);
    expect((await als(kB.token).del(`/chat/anfragen/${anfrage}`)).status).toBe(404);
    expect((await stelle(kB, { benutzerId: s1aId })).status).toBe(400);

    expect(await zeilen({ mandantId: mandantBId, benutzerId: leitungBId }, "SELECT id FROM chat_anfrage WHERE id = $1", [anfrage])).toEqual([]);
    expect(await zeilen({ mandantId: mandantBId, klientId: kB.id }, "SELECT id FROM chat_anfrage WHERE id = $1", [anfrage])).toEqual([]);
    // Mandant A mit der ID eines Benutzers aus B: weder lesen noch annehmen
    expect(await sqlCode({ mandantId: mandantBId, benutzerId: leitungBId }, "SELECT chat_anfrage_annehmen($1)", [anfrage])).toBe("P0002");
    expect(
      await sqlCode({ mandantId: mandantBId, klientId: kB.id }, "INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id) VALUES ($1, $2, $3)", [mandantBId, kB.id, s1aId])
    ).toBe("42501");
  });

  // --- App-Rolle direkt (RLS, Trigger, Grants) ---------------------------------------

  describe("direkt mit der App-Rolle", () => {
    let personId: string; // k -> s1a
    let teamId: string; // k -> Team S1
    let k: Konto;

    beforeAll(async () => {
      k = await neuerKlient({ vorname: "Direkt", standortId: s1Id });
      personId = (await stelle(k, { benutzerId: s1aId, nachricht: "direkt-text" })).body.id;
      teamId = (await stelle(k, { standortId: s1Id })).body.id;
    });

    it("Sichtbarkeit: Ziel, Team, die Klient:in selbst -- Unbeteiligte, andere Klient:innen und andere Standorte nicht", async () => {
      const sieht = async (ctx: Parameters<typeof alsAppRolle>[0], id: string) => (await zeilen(ctx, "SELECT id FROM chat_anfrage WHERE id = $1", [id])).length;
      expect(await sieht(ausSicht(s1aId), personId)).toBe(1);
      expect(await sieht(ausSichtKlient(k.id), personId)).toBe(1);
      for (const nicht of [ausSicht(s1bId), ausSicht(s2aId), ausSicht(bezugId), ausSicht(leitungId), ausSicht(vollzugriffId), ausSichtKlient(k1.id), ausSichtKlient(k2.id)]) {
        expect([nicht, await sieht(nicht, personId)]).toEqual([nicht, 0]);
      }
      for (const ja of [ausSicht(s1aId), ausSicht(s1bId), ausSicht(leitungId), ausSicht(vollzugriffId), ausSichtKlient(k.id)]) expect(await sieht(ja, teamId)).toBe(1);
      for (const nicht of [ausSicht(s2aId), ausSicht(bezugId), ausSichtKlient(k1.id)]) expect([nicht, await sieht(nicht, teamId)]).toEqual([nicht, 0]);
      // Ein deaktiviertes Konto zaehlt nicht zum Team
      expect(await sieht(ausSicht(inaktivId), teamId)).toBe(0);
      // Ohne Benutzer und ohne Klient sieht niemand etwas
      expect(await sieht({ mandantId: mandantAId }, teamId)).toBe(0);
    });

    it("Stellen: nur im eigenen Namen, nur offen, nur an erlaubte Ziele (42501); Benutzer koennen keine Anfragen stellen", async () => {
      const einfuegen = "INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id, standort_id) VALUES ($1, $2, $3, $4)";
      const k4 = await neuerKlient({ vorname: "Direkt2", standortId: s1Id });
      const eigen = ausSichtKlient(k4.id);
      expect(await sqlCode(eigen, einfuegen, [mandantAId, k4.id, s1bId, null])).toBe("ok");
      expect(await sqlCode(eigen, einfuegen, [mandantAId, k4.id, null, s1Id])).toBe("ok");
      // im Namen einer anderen Klient:in
      expect(await sqlCode(eigen, einfuegen, [mandantAId, k1.id, s1bId, null])).toBe("42501");
      // nicht erlaubte Ziele
      for (const [benutzer, standort] of [[s2aId, null], [leitungId, null], [inaktivId, null], [null, s2Id]]) {
        expect([benutzer, standort, await sqlCode(eigen, einfuegen, [mandantAId, k4.id, benutzer, standort])]).toEqual([benutzer, standort, "42501"]);
      }
      // Mitarbeitende und Konten ohne Klient
      expect(await sqlCode(ausSicht(s1aId), einfuegen, [mandantAId, k4.id, s1bId, null])).toBe("42501");
      expect(await sqlCode({ mandantId: mandantAId }, einfuegen, [mandantAId, k4.id, s1bId, null])).toBe("42501");
      // bereits beantwortet eingefuegt
      expect(
        await sqlCode(eigen, "INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id, beantwortet_am) VALUES ($1, $2, $3, now())", [mandantAId, k4.id, s1cId])
      ).toBe("42501");
      // genau ein Ziel (CHECK, auch fuer Administrator)
      expect(await admin.query(einfuegen, [mandantAId, k4.id, null, null]).then(() => "ok", (e) => e.code)).toBe("23514");
      expect(await admin.query(einfuegen, [mandantAId, k4.id, s1cId, s1Id]).then(() => "ok", (e) => e.code)).toBe("23514");
    });

    it("Obergrenze und Duplikate gelten auch fuer direkte Inserts (53400 / 23505)", async () => {
      const k6 = await neuerKlient({ vorname: "Direkt6", standortId: s1Id });
      const einfuegen = "INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id, standort_id) VALUES ($1, $2, $3, $4)";
      const eigen = ausSichtKlient(k6.id);
      // Alle in EINER Transaktion der App-Rolle, damit der Trigger die eigenen Zeilen mitzaehlt
      const codes = await alsAppRolle(eigen, async (c) => {
        const ergebnis: string[] = [];
        for (const [benutzer, standort] of [[s1aId, null], [s1bId, null], [s1cId, null], [s1dId, null], [s1eId, null], [null, s1Id], [s1aId, null]]) {
          await c.query("SAVEPOINT s");
          try {
            await c.query(einfuegen, [mandantAId, k6.id, benutzer, standort]);
            ergebnis.push("ok");
          } catch (err) {
            ergebnis.push((err as { code: string }).code);
            await c.query("ROLLBACK TO SAVEPOINT s");
          }
        }
        return ergebnis;
      });
      expect(codes).toEqual(["ok", "ok", "ok", "ok", "ok", "53400", "53400"]);
      // Duplikat bei weniger als 5 offenen: Unique-Index
      const k7 = await neuerKlient({ vorname: "Direkt7", standortId: s1Id });
      const dup = await alsAppRolle(ausSichtKlient(k7.id), async (c) => {
        await c.query(einfuegen, [mandantAId, k7.id, s1aId, null]);
        try {
          await c.query(einfuegen, [mandantAId, k7.id, s1aId, null]);
          return "ok";
        } catch (err) {
          return (err as { code: string }).code;
        }
      });
      expect(dup).toBe("23505");
    });

    it("Aendern: Klient:innen koennen nur zurueckziehen, Mitarbeitende nur im eigenen Namen ablehnen; gesperrte Spalten, DELETE und Annahme per UPDATE gehen nicht", async () => {
      const upd = (ctx: Parameters<typeof alsAppRolle>[0], set: string, id = personId) => sqlCode(ctx, `UPDATE chat_anfrage SET ${set} WHERE id = $1`, [id]);
      const zeilenAnzahl = (ctx: Parameters<typeof alsAppRolle>[0], set: string, id: string) =>
        alsAppRolle(ctx, async (c) => (await c.query(`UPDATE chat_anfrage SET ${set} WHERE id = $1`, [id])).rowCount);

      // Klient:in: keine Antwort faelschen
      expect(await upd(ausSichtKlient(k.id), "beantwortet_am = now(), angenommen = true")).toBe("42501");
      expect(await upd(ausSichtKlient(k.id), `beantwortet_am = now(), angenommen = false, beantwortet_von = '${s1aId}'`)).toBe("42501");
      // Mitarbeiter:in: nicht im Namen einer anderen Person und nicht ohne Entscheidung
      expect(await upd(ausSicht(s1aId), `beantwortet_am = now(), angenommen = false, beantwortet_von = '${s1bId}'`)).toBe("42501");
      expect(await upd(ausSicht(s1aId), "beantwortet_am = now()")).toBe("42501");
      // Annahme per UPDATE: chat_id ist gesperrt (Grant) bzw. ohne chat_id verletzt der CHECK die Zustandsregel
      expect(await upd(ausSicht(s1aId), `beantwortet_am = now(), angenommen = true, beantwortet_von = '${s1aId}', chat_id = '${randomUUID()}'`)).toBe("42501");
      expect(await upd(ausSicht(s1aId), `beantwortet_am = now(), angenommen = true, beantwortet_von = '${s1aId}'`)).toBe("23514");
      // Gesperrte Spalten
      for (const set of [`klient_id = '${k1.id}'`, `ziel_benutzer_id = '${s1bId}'`, `standort_id = '${s2Id}'`, "nachricht = 'umgeschrieben'", "mandant_id = mandant_id", "erstellt_am = now()"]) {
        expect([set, await upd(ausSichtKlient(k.id), set)]).toEqual([set, "42501"]);
        expect([set, await upd(ausSicht(s1aId), set)]).toEqual([set, "42501"]);
      }
      expect(await sqlCode(ausSicht(s1aId), "DELETE FROM chat_anfrage WHERE id = $1", [personId])).toBe("42501");
      expect(await sqlCode(ausSichtKlient(k.id), "DELETE FROM chat_anfrage WHERE id = $1", [personId])).toBe("42501");
      // Fremde Zeilen sind fuer UPDATE unsichtbar (0 Zeilen, kein Fehler)
      expect(await zeilenAnzahl(ausSicht(s1bId), `beantwortet_am = now(), angenommen = false, beantwortet_von = '${s1bId}'`, personId)).toBe(0);
      expect(await zeilenAnzahl(ausSicht(s2aId), `beantwortet_am = now(), angenommen = false, beantwortet_von = '${s2aId}'`, teamId)).toBe(0);
      expect(await zeilenAnzahl(ausSichtKlient(k1.id), "beantwortet_am = now()", personId)).toBe(0);
      // Alles unveraendert
      expect((await admin.query("SELECT beantwortet_am, angenommen, nachricht FROM chat_anfrage WHERE id = $1", [personId])).rows[0]).toEqual({
        beantwortet_am: null,
        angenommen: null,
        nachricht: "direkt-text",
      });
      // Erlaubt: ablehnen im eigenen Namen (Ziel), zurueckziehen (Klient:in)
      expect(await zeilenAnzahl(ausSicht(s1aId), `beantwortet_am = now(), angenommen = false, beantwortet_von = '${s1aId}'`, personId)).toBe(1);
      expect(await zeilenAnzahl(ausSichtKlient(k.id), "beantwortet_am = now()", teamId)).toBe(1);
      // Eine beantwortete Zeile ist endgueltig: Policy blendet sie fuer UPDATE aus, der Trigger sperrt sie zusaetzlich
      const fertig = (await stelle(k, { benutzerId: s1bId })).body.id;
      await als(tokenS1b).post(`/chat/anfragen/${fertig}/ablehnen`, {});
      expect(await zeilenAnzahl(ausSicht(s1bId), `ablehnungsgrund = 'spaeter'`, fertig)).toBe(0);
      expect(await zeilenAnzahl(ausSichtKlient(k.id), "beantwortet_am = NULL", fertig)).toBe(0);
      expect(await admin.query("UPDATE chat_anfrage SET ablehnungsgrund = 'spaeter' WHERE id = $1", [fertig]).then(() => "ok", (e) => e.code)).toBe("42501");
    });

    it("chat_anfrage_annehmen(): nur fuer Ziel/Team, nicht fuer Klient:innen oder Fremde; Nachrichten im Namen der Klient:in bleiben ueber INSERT verboten", async () => {
      const fr = await neuerKlient({ vorname: "Funktion", standortId: s1Id });
      const anfrage = (await stelle(fr, { benutzerId: s1cId, nachricht: "funktion-text" })).body.id;
      expect(await sqlCode(ausSichtKlient(fr.id), "SELECT chat_anfrage_annehmen($1)", [anfrage])).toBe("42501");
      expect(await sqlCode({ mandantId: mandantAId }, "SELECT chat_anfrage_annehmen($1)", [anfrage])).toBe("42501");
      expect(await sqlCode(ausSicht(s1aId), "SELECT chat_anfrage_annehmen($1)", [anfrage])).toBe("P0002"); // nicht Ziel
      expect(await sqlCode(ausSicht(inaktivId), "SELECT chat_anfrage_annehmen($1)", [anfrage])).toBe("42501"); // deaktiviert
      expect((await admin.query("SELECT beantwortet_am FROM chat_anfrage WHERE id = $1", [anfrage])).rows[0].beantwortet_am).toBeNull();

      // Die Policy von chat_nachricht ist nicht aufgeweicht: auch ein Teammitglied kann im Namen der Klient:in nichts einfuegen
      const chat = (await als(tokenS1a).post("/chat/direkt", { klientId: fr.id })).body.id;
      expect(
        await sqlCode(ausSicht(s1aId), "INSERT INTO chat_nachricht (mandant_id, chat_id, absender_klient_id, art, text) VALUES ($1, $2, $3, 'text', 'untergeschoben')", [mandantAId, chat, fr.id])
      ).toBe("42501");

      // Der richtige Weg funktioniert und liefert den Chat
      const chatId = await alsAppRolle(ausSicht(s1cId), async (c) => (await c.query("SELECT chat_anfrage_annehmen($1) AS id", [anfrage])).rows[0].id);
      expect(chatId).toBeTruthy();
      expect(await sqlCode(ausSicht(s1cId), "SELECT chat_anfrage_annehmen($1)", [anfrage])).toBe("ok"); // ROLLBACK am Ende: Anfrage bleibt offen
    });
  });

  // --- Echtzeit ----------------------------------------------------------------------

  describe("SSE", () => {
    function oeffneStrom(token: string): Promise<Strom> {
      return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/chat/ereignisse", headers: { Authorization: `Bearer ${token}` } }, (res) => {
          let roh = "";
          const ereignisse: Strom["ereignisse"] = [];
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            roh += chunk;
            for (const rahmen of chunk.split("\n\n")) {
              const daten = rahmen.split("\n").find((z) => z.startsWith("data: "));
              if (rahmen.startsWith("event: chat") && daten) ereignisse.push(JSON.parse(daten.slice("data: ".length)));
            }
          });
          const strom: Strom = {
            status: res.statusCode ?? 0,
            roh: () => roh,
            ereignisse,
            warteAuf: async (bedingung, ms = 4000) => {
              const ende = Date.now() + ms;
              while (!bedingung()) {
                if (Date.now() > ende) throw new Error(`Zeitueberschreitung; bisher: ${JSON.stringify(ereignisse)}`);
                await new Promise((r) => setTimeout(r, 15));
              }
            },
          };
          resolve(strom);
        });
        req.on("error", reject);
        req.end();
      });
    }
    const anfrageEreignisse = (s: Strom) => s.ereignisse.filter((e) => e.art === "anfrage").map((e) => e.anfrageId);

    it("Neue, beantwortete und zurueckgezogene Anfragen gehen nur an Betroffene - ohne Inhalt; Unbeteiligte erhalten nichts", async () => {
      const kSse = await neuerKlient({ vorname: "Streamer", standortId: s1Id });
      const kAndere = await neuerKlient({ vorname: "Anderer", standortId: s1Id });
      const kS2 = await neuerKlient({ vorname: "Zweihaus", standortId: s2Id });

      const strom = {
        klient: await oeffneStrom(kSse.token),
        andereKlient: await oeffneStrom(kAndere.token),
        ziel: await oeffneStrom(tokenS1a),
        team: await oeffneStrom(tokenS1b),
        leitung: await oeffneStrom(tokenLeitung),
        s2: await oeffneStrom(tokenS2a),
        fremd: await oeffneStrom(tokenLeitungB),
      };
      for (const s of Object.values(strom)) {
        expect(s.status).toBe(200);
        await s.warteAuf(() => s.roh().includes(": verbunden"));
      }

      // 1) Personen-Anfrage an s1a
      const person = (await stelle(kSse, { benutzerId: s1aId, nachricht: "streng vertraulicher Anfragetext" })).body.id;
      await strom.ziel.warteAuf(() => anfrageEreignisse(strom.ziel).includes(person));
      await strom.klient.warteAuf(() => anfrageEreignisse(strom.klient).includes(person));
      expect(strom.ziel.roh()).toContain(`event: chat\ndata: {"chatId":null,"art":"anfrage","anfrageId":"${person}"}\n\n`);
      expect(strom.ziel.roh()).not.toContain("vertraulich");
      expect(strom.klient.roh()).not.toContain("vertraulich");

      // 2) Team-Anfrage: s1a, s1b, die unbeschraenkte Leitung und die Klient:in erfahren davon
      const team = (await stelle(kSse, { standortId: s1Id })).body.id;
      for (const s of [strom.ziel, strom.team, strom.leitung, strom.klient]) await s.warteAuf(() => anfrageEreignisse(s).includes(team));

      // 3) s1b nimmt die Team-Anfrage an: das uebrige Team (s1a, Leitung) und die Klient:in erfahren es
      const vorherZiel = anfrageEreignisse(strom.ziel).length;
      expect((await als(tokenS1b).post(`/chat/anfragen/${team}/annehmen`)).status).toBe(200);
      await strom.ziel.warteAuf(() => anfrageEreignisse(strom.ziel).length > vorherZiel);
      await strom.leitung.warteAuf(() => anfrageEreignisse(strom.leitung).filter((id) => id === team).length === 2);
      await strom.klient.warteAuf(() => anfrageEreignisse(strom.klient).filter((id) => id === team).length === 2);

      // 4) Klient:in zieht die Personen-Anfrage zurueck: das Ziel erfaehrt es
      expect((await als(kSse.token).del(`/chat/anfragen/${person}`)).status).toBe(200);
      await strom.ziel.warteAuf(() => anfrageEreignisse(strom.ziel).filter((id) => id === person).length === 2);

      // Kontroll-Ereignisse, die genau die bisher Unbeteiligten erreichen. Die Reihenfolge je Stream ist garantiert:
      // ist die Kontrolle da und davor nichts, ist vorher nichts angekommen.
      const kontrolleS2 = (await stelle(kS2, { standortId: s2Id })).body.id;
      const kontrolleAndere = (await stelle(kAndere, { benutzerId: s1eId })).body.id;
      const kFremd = await neuerKlient({ vorname: "Fremd2", standortId: standortBId, mandantId: mandantBId, slug: slugB, von: leitungBId });
      const kontrolleFremd = (await stelle(kFremd, { standortId: standortBId })).body.id;
      await strom.s2.warteAuf(() => anfrageEreignisse(strom.s2).includes(kontrolleS2));
      await strom.andereKlient.warteAuf(() => anfrageEreignisse(strom.andereKlient).includes(kontrolleAndere));
      await strom.fremd.warteAuf(() => anfrageEreignisse(strom.fremd).includes(kontrolleFremd));

      expect(anfrageEreignisse(strom.s2)).toEqual([kontrolleS2]);
      expect(anfrageEreignisse(strom.andereKlient)).toEqual([kontrolleAndere]);
      expect(anfrageEreignisse(strom.fremd)).toEqual([kontrolleFremd]);
      // s1b gehoert nicht zum Ziel der Personen-Anfrage: nur die Team-Anfrage und deren Annahme
      expect(anfrageEreignisse(strom.team)).not.toContain(person);
      expect(anfrageEreignisse(strom.team).filter((id) => id === team)).toHaveLength(2);
      // Die Leitung (unbeschraenkt) sieht Personen-Anfragen anderer nicht
      expect(anfrageEreignisse(strom.leitung)).not.toContain(person);
      // Die Klient:in bekommt auch die Chat-Ereignisse des neuen Direktchats (Mitgliedschaft), aber alles ohne Inhalt
      expect(strom.klient.roh()).not.toContain("Anfragetext");
    });
  });

  // --- Raten-Schranke ----------------------------------------------------------------

  it("Raten-Schranke auf POST /chat/anfragen: ab der 11. Anfrage je Minute 429", async () => {
    const k = await neuerKlient({ vorname: "Rate", standortId: s1Id });
    process.env.RATE_LIMIT_TESTEN = "1";
    try {
      const status: number[] = [];
      for (let i = 0; i < 12; i++) status.push((await stelle(k, { benutzerId: s1aId })).status);
      // Die ersten 10 werden normal beantwortet (hier 201, danach 409 wegen Duplikat), erst dann greift die Schranke
      expect(status.slice(0, 10)).toEqual([201, ...Array(9).fill(409)]);
      expect(status.slice(10)).toEqual([429, 429]);
      // Andere Endpunkte sind davon nicht betroffen
      expect((await als(k.token).get("/chat/anfragen")).status).toBe(200);
    } finally {
      delete process.env.RATE_LIMIT_TESTEN;
    }
  });
});
