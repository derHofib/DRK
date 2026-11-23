/**
 * Reaktionen auf Chatnachrichten (migrations/0086).
 *
 * Kernaussagen:
 *   1. Reagieren kann, wer die Nachricht sieht -- als man selbst, eine
 *      Reaktion pro Person und Nachricht; eine andere ersetzt die alte,
 *      Zuruecknehmen loescht sie wirklich.
 *   2. Nur genau ein Emoji, kein Text -- im Controller und (Rueckfallgrenze)
 *      im CHECK der Datenbank.
 *   3. Reaktionen sieht nur, wer im Chat ist (auch ist_vollzugriff nicht,
 *      auch nicht der andere Mandant); Namen wie beim Absender.
 *   4. Reaktionen sind leise: kein "ungelesen", keine neue Aktivitaet.
 *   5. Reaktionen ueberleben ihre Nachricht nie: weich geloescht, Loeschfrist,
 *      Anonymisierung (dort auch die Reaktionen der Person auf FREMDE
 *      Nachrichten).
 *   6. Die App-Rolle kann daran nichts vorbei aendern (kein UPDATE, nur eigene).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ChatLoeschfristService } from "../src/chat/chat-loeschfrist.service";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";

describe("Chat-Reaktionen", () => {
  let app: INestApplication;
  let admin: Client;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";

  let mandantAId: string;
  let mandantBId: string;
  let leitungId: string;
  let betreuerId: string;
  let vollzugriffId: string;
  let leitungBId: string;
  let klient1Id: string;
  let klient2Id: string;

  let tokenLeitung: string;
  let tokenBetreuer: string;
  let tokenVollzugriff: string;
  let tokenLeitungB: string;
  let tokenKlient1: string;
  let tokenKlient2: string;

  let gruppeId: string; // leitung (Admin), betreuer, klient1, klient2

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    put: (p: string, body: object = {}) => request(http()).put(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
    del: (p: string) => request(http()).delete(p).set("Authorization", `Bearer ${token}`),
  });

  const reagiere = (token: string, nachrichtId: string, zeichen: unknown) => als(token).put(`/chat/nachrichten/${nachrichtId}/reaktion`, { zeichen });
  const sende = async (token: string, chatId: string, text: string): Promise<string> => {
    const res = await als(token).post(`/chat/${chatId}/nachrichten`, { art: "text", text });
    expect(res.status).toBe(201);
    return res.body.id;
  };
  const anzahlInDb = async (nachrichtId: string): Promise<number> =>
    (await admin.query("SELECT count(*)::int AS n FROM chat_reaktion WHERE nachricht_id = $1", [nachrichtId])).rows[0].n;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    const slugA = `test-reaktion-a-${suffix}`;
    const slugB = `test-reaktion-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Reaktion A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Reaktion B ${suffix}`, slugB])).rows[0].id;

    const konto = (mandantId: string, rolle: "bereichsleitung" | "einrichtungsleitung" | "betreuer", kurz: string, name: string) =>
      kontoMitAlterRolle(admin, { mandantId, rolle, email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash: hash });
    leitungId = await konto(mandantAId, "einrichtungsleitung", "leitung", "Anna Leitung");
    betreuerId = await konto(mandantAId, "betreuer", "betreuer", "Bernd Betreuer");
    vollzugriffId = await konto(mandantAId, "bereichsleitung", "vollzugriff", "Vera Vollzugriff");
    leitungBId = await konto(mandantBId, "einrichtungsleitung", "leitung-b", "Lena Leitung B");

    const neuerKlient = async (vorname: string, nachname: string, az: string): Promise<string> =>
      (
        await admin.query(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, $2, $3, '2005-01-01', $4, 'Jugendamt') RETURNING id`,
          [mandantAId, vorname, nachname, `${az}-${suffix}`]
        )
      ).rows[0].id;
    klient1Id = await neuerKlient("Max", "Muster", "RKT1");
    klient2Id = await neuerKlient("Erika", "Beispiel", "RKT2");
    const zugang = (klientId: string, kurz: string) =>
      legeKlientZugangAn(admin, { mandantId: mandantAId, klientId, email: `${kurz}-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: leitungId });
    await zugang(klient1Id, "klient1");
    await zugang(klient2Id, "klient2");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = async (slug: string, kurz: string) =>
      (await request(http()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenLeitung = await login(slugA, "leitung");
    tokenBetreuer = await login(slugA, "betreuer");
    tokenVollzugriff = await login(slugA, "vollzugriff");
    tokenLeitungB = await login(slugB, "leitung-b");
    tokenKlient1 = await klientToken(app, slugA, `klient1-${suffix}@beispiel.test`, passwort);
    tokenKlient2 = await klientToken(app, slugA, `klient2-${suffix}@beispiel.test`, passwort);

    const gruppe = await als(tokenLeitung).post("/chat/gruppe", {
      name: "Reaktionen",
      teilnehmer: [{ benutzerId: betreuerId }, { klientId: klient1Id }, { klientId: klient2Id }],
    });
    expect(gruppe.status).toBe(201);
    gruppeId = gruppe.body.id;
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      await admin.query("DELETE FROM chat_reaktion WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_anhang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_nachricht WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM chat WHERE mandant_id = ANY($1)", [ids]);
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
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

  it("Reagieren, ersetzen, mit-reagieren und zuruecknehmen; gruppiert nach Zeichen, haeufigste zuerst, eigene Person vorn", async () => {
    const id = await sende(tokenLeitung, gruppeId, "Heizung in Zimmer 4 läuft wieder.");

    let res = await reagiere(tokenBetreuer, id, "👍");
    expect(res.status).toBe(200);
    expect(res.body.reaktionen).toEqual([{ zeichen: "👍", anzahl: 1, meine: true, personen: [{ art: "benutzer", id: betreuerId, name: "Bernd Betreuer" }] }]);

    // Andere Reaktion ersetzt die alte: weiterhin genau eine Zeile.
    res = await reagiere(tokenBetreuer, id, "✅");
    expect(res.body.reaktionen.map((r: { zeichen: string }) => r.zeichen)).toEqual(["✅"]);
    expect(await anzahlInDb(id)).toBe(1);

    // Zweimal dasselbe ist idempotent.
    expect((await reagiere(tokenBetreuer, id, "✅")).status).toBe(200);
    expect(await anzahlInDb(id)).toBe(1);

    await reagiere(tokenKlient1, id, "👍");
    await reagiere(tokenKlient2, id, "👍");
    res = await als(tokenKlient1).get(`/chat/nachrichten/${id}`);
    expect(res.status).toBe(200);
    // 👍 (2) vor ✅ (1); Klient:in sieht sich selbst zuerst und andere Klient:innen nur mit Vornamen.
    expect(res.body.reaktionen).toEqual([
      { zeichen: "👍", anzahl: 2, meine: true, personen: [{ art: "klient", id: klient1Id, name: "Max" }, { art: "klient", id: klient2Id, name: "Erika" }] },
      { zeichen: "✅", anzahl: 1, meine: false, personen: [{ art: "benutzer", id: betreuerId, name: "Bernd Betreuer" }] },
    ]);
    // Mitarbeitende sehen den vollen Namen.
    res = await als(tokenLeitung).get(`/chat/nachrichten/${id}`);
    expect(res.body.reaktionen[0].personen.map((p: { name: string }) => p.name)).toEqual(["Max Muster", "Erika Beispiel"]);
    expect(res.body.reaktionen[0].meine).toBe(false);

    // Auch in der Seite des Verlaufs enthalten.
    const seite = await als(tokenLeitung).get(`/chat/${gruppeId}/nachrichten`);
    expect(seite.body.nachrichten.find((n: { id: string }) => n.id === id).reaktionen).toHaveLength(2);

    // Zuruecknehmen loescht wirklich; zweimal ist idempotent.
    res = await als(tokenKlient1).del(`/chat/nachrichten/${id}/reaktion`);
    expect(res.status).toBe(200);
    // Gleichstand 1:1 -- das zuerst gesetzte Zeichen bleibt vorn, damit die Knoepfe nicht springen.
    expect(res.body.reaktionen).toEqual([
      { zeichen: "✅", anzahl: 1, meine: false, personen: [{ art: "benutzer", id: betreuerId, name: "Bernd Betreuer" }] },
      { zeichen: "👍", anzahl: 1, meine: false, personen: [{ art: "klient", id: klient2Id, name: "Erika" }] },
    ]);
    expect((await als(tokenKlient1).del(`/chat/nachrichten/${id}/reaktion`)).status).toBe(200);
    expect(await anzahlInDb(id)).toBe(2);
  });

  it("Nur genau ein Emoji: Text, zwei Emojis, leer, Spitzklammern und Zusatzfelder -> 400; Hautton, Flagge und ZWJ-Folge gehen", async () => {
    const id = await sende(tokenLeitung, gruppeId, "Eingabepruefung");
    for (const falsch of ["a", "ok", "👍👍", "", " 👍", "<b>", "❤", 5, null]) {
      const res = await reagiere(tokenBetreuer, id, falsch);
      expect([falsch, res.status]).toEqual([falsch, 400]);
    }
    expect((await als(tokenBetreuer).put(`/chat/nachrichten/${id}/reaktion`, { zeichen: "👍", extra: 1 })).status).toBe(400);
    expect((await als(tokenBetreuer).put(`/chat/nachrichten/${id}/reaktion`, {})).status).toBe(400);
    for (const richtig of ["👍🏽", "🇩🇪", "👨‍👩‍👧", "❤️"]) {
      const res = await reagiere(tokenBetreuer, id, richtig);
      expect([richtig, res.status]).toEqual([richtig, 200]);
    }
    expect(await anzahlInDb(id)).toBe(1);
  });

  it("Nicht-Teilnehmende (ist_vollzugriff, anderer Mandant), unbekannte und ungueltige IDs -> 404; geloeschte Nachricht -> 409", async () => {
    const id = await sende(tokenLeitung, gruppeId, "Nur fuer die Gruppe");
    await reagiere(tokenBetreuer, id, "👀");
    for (const token of [tokenVollzugriff, tokenLeitungB]) {
      expect((await reagiere(token, id, "👍")).status).toBe(404);
      expect((await als(token).del(`/chat/nachrichten/${id}/reaktion`)).status).toBe(404);
      expect((await als(token).get(`/chat/nachrichten/${id}`)).status).toBe(404);
    }
    expect((await reagiere(tokenBetreuer, randomUUID(), "👍")).status).toBe(404);
    expect((await reagiere(tokenBetreuer, "keine-id", "👍")).status).toBe(404);
    expect((await request(http()).put(`/chat/nachrichten/${id}/reaktion`).send({ zeichen: "👍" })).status).toBe(401);
    expect(await anzahlInDb(id)).toBe(1);

    await als(tokenLeitung).del(`/chat/nachrichten/${id}`);
    expect((await reagiere(tokenBetreuer, id, "👍")).status).toBe(409);
  });

  it("Leise: eine Reaktion zaehlt nicht als ungelesen und aendert weder Vorschau noch letzte Aktivitaet", async () => {
    const id = await sende(tokenLeitung, gruppeId, "Lesestand-Test");
    await als(tokenLeitung).post(`/chat/${gruppeId}/gelesen`);
    const vorher = (await als(tokenLeitung).get("/chat")).body.find((c: { id: string }) => c.id === gruppeId);
    const ungelesenVorher = (await als(tokenLeitung).get("/chat/ungelesen")).body.ungelesen;

    expect((await reagiere(tokenBetreuer, id, "❤️")).status).toBe(200);

    const nachher = (await als(tokenLeitung).get("/chat")).body.find((c: { id: string }) => c.id === gruppeId);
    expect(nachher.ungelesen).toBe(0);
    expect(nachher.letzteAktivitaetAm).toBe(vorher.letzteAktivitaetAm);
    expect(nachher.letzteNachricht).toEqual(vorher.letzteNachricht);
    expect((await als(tokenLeitung).get("/chat/ungelesen")).body.ungelesen).toBe(ungelesenVorher);
  });

  it("Loescht die Absender:in ihre Nachricht, verschwinden ALLE Reaktionen darauf (auch fremde) -- in der Datenbank, nicht nur in der Anzeige", async () => {
    const id = await sende(tokenLeitung, gruppeId, "Gleich weg");
    await reagiere(tokenBetreuer, id, "👍");
    await reagiere(tokenKlient2, id, "🙏");
    expect(await anzahlInDb(id)).toBe(2);
    const res = await als(tokenLeitung).del(`/chat/nachrichten/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.reaktionen).toEqual([]);
    expect(await anzahlInDb(id)).toBe(0);
  });

  it("Loeschfrist: mit der abgelaufenen Nachricht verschwinden auch ihre Reaktionen", async () => {
    const alt = (
      await admin.query(
        `INSERT INTO chat_nachricht (mandant_id, chat_id, absender_benutzer_id, art, text, erstellt_am)
         VALUES ($1, $2, $3, 'text', 'uralt', now() - interval '400 days') RETURNING id`,
        [mandantAId, gruppeId, leitungId]
      )
    ).rows[0].id;
    const jung = await sende(tokenLeitung, gruppeId, "frisch");
    await admin.query("INSERT INTO chat_reaktion (mandant_id, nachricht_id, benutzer_id, zeichen) VALUES ($1, $2, $3, '👍')", [mandantAId, alt, betreuerId]);
    await reagiere(tokenBetreuer, jung, "👍");

    await app.get(ChatLoeschfristService).anwenden();

    expect(await anzahlInDb(alt)).toBe(0);
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_nachricht WHERE id = $1", [alt])).rows[0].n).toBe(0);
    expect(await anzahlInDb(jung)).toBe(1);
  });

  it("Anonymisierung: auch die Reaktionen der Person auf Nachrichten ANDERER verschwinden; die anderer Personen bleiben", async () => {
    const fremd = await sende(tokenBetreuer, gruppeId, "Termin Donnerstag");
    await reagiere(tokenKlient1, fremd, "👍");
    await reagiere(tokenKlient2, fremd, "✅");
    await reagiere(tokenLeitung, fremd, "👀");
    expect(await anzahlInDb(fremd)).toBe(3);

    const res = await als(tokenVollzugriff).patch(`/klienten/${klient1Id}/anonymisieren`);
    expect(res.status).toBe(200);

    expect((await admin.query("SELECT count(*)::int AS n FROM chat_reaktion WHERE klient_id = $1", [klient1Id])).rows[0].n).toBe(0);
    // Die fremde Nachricht bleibt (0061), ebenso die Reaktionen der anderen.
    expect((await admin.query("SELECT count(*)::int AS n FROM chat_nachricht WHERE id = $1", [fremd])).rows[0].n).toBe(1);
    expect(await anzahlInDb(fremd)).toBe(2);
  });

  describe("direkt mit der App-Rolle", () => {
    let nachrichtId: string;
    let reaktionBetreuer: string;

    beforeAll(async () => {
      nachrichtId = await sende(tokenLeitung, gruppeId, "App-Rolle");
      await reagiere(tokenBetreuer, nachrichtId, "👍");
      reaktionBetreuer = (await admin.query("SELECT id FROM chat_reaktion WHERE nachricht_id = $1 AND benutzer_id = $2", [nachrichtId, betreuerId])).rows[0].id;
    });

    const einfuegen = "INSERT INTO chat_reaktion (mandant_id, nachricht_id, benutzer_id, klient_id, zeichen) VALUES ($1, $2, $3, $4, $5)";

    it("Lesen: Teilnehmende ja, ist_vollzugriff und anderer Mandant nein", async () => {
      const zaehle = (ctx: Parameters<typeof alsAppRolle>[0]) =>
        alsAppRolle(ctx, async (c) => (await c.query("SELECT count(*)::int AS n FROM chat_reaktion WHERE nachricht_id = $1", [nachrichtId])).rows[0].n);
      expect(await zaehle({ mandantId: mandantAId, benutzerId: leitungId })).toBe(1);
      expect(await zaehle({ mandantId: mandantAId, klientId: klient2Id })).toBe(1);
      expect(await zaehle({ mandantId: mandantAId, benutzerId: vollzugriffId })).toBe(0);
      expect(await zaehle({ mandantId: mandantBId, benutzerId: leitungBId })).toBe(0);
    });

    it("Setzen nur als man selbst, nur als Teilnehmer:in, nur im eigenen Mandanten", async () => {
      const leitung = { mandantId: mandantAId, benutzerId: leitungId };
      expect(await sqlCode(leitung, einfuegen, [mandantAId, nachrichtId, leitungId, null, "👍"])).toBe("ok");
      // im Namen einer anderen Person (Benutzer und Klient:in)
      expect(await sqlCode(leitung, einfuegen, [mandantAId, nachrichtId, vollzugriffId, null, "👍"])).toBe("42501");
      expect(await sqlCode(leitung, einfuegen, [mandantAId, nachrichtId, null, klient2Id, "👍"])).toBe("42501");
      // als Nicht-Teilnehmer:in
      expect(await sqlCode({ mandantId: mandantAId, benutzerId: vollzugriffId }, einfuegen, [mandantAId, nachrichtId, vollzugriffId, null, "👍"])).toBe("42501");
      // fremder Mandant, der die ID kennt
      expect(await sqlCode({ mandantId: mandantBId, benutzerId: leitungBId }, einfuegen, [mandantBId, nachrichtId, leitungBId, null, "👍"])).toBe("42501");
      // zweite Reaktion derselben Person
      expect(await sqlCode({ mandantId: mandantAId, benutzerId: betreuerId }, einfuegen, [mandantAId, nachrichtId, betreuerId, null, "❤️"])).toBe("23505");
    });

    it("Kein Text ueber diesen Weg (CHECK), keine Reaktion auf geloeschte Nachrichten", async () => {
      const leitung = { mandantId: mandantAId, benutzerId: leitungId };
      for (const text of ["Hallo", "123", "a b", "<script>", "👍".repeat(17)]) {
        expect([text, await sqlCode(leitung, einfuegen, [mandantAId, nachrichtId, leitungId, null, text])]).toEqual([text, "23514"]);
      }
      const geloescht = await sende(tokenLeitung, gruppeId, "weg");
      await als(tokenLeitung).del(`/chat/nachrichten/${geloescht}`);
      expect(await sqlCode(leitung, einfuegen, [mandantAId, geloescht, leitungId, null, "👍"])).toBe("42501");
    });

    it("Kein UPDATE; DELETE nur der eigenen Reaktion", async () => {
      expect(await sqlCode({ mandantId: mandantAId, benutzerId: betreuerId }, "UPDATE chat_reaktion SET zeichen = '❤️' WHERE id = $1", [reaktionBetreuer])).toBe("42501");
      expect(await sqlCode({ mandantId: mandantAId, benutzerId: betreuerId }, "UPDATE chat_reaktion SET benutzer_id = $2 WHERE id = $1", [reaktionBetreuer, leitungId])).toBe("42501");
      const loesche = (ctx: Parameters<typeof alsAppRolle>[0]) =>
        alsAppRolle(ctx, async (c) => (await c.query("DELETE FROM chat_reaktion WHERE id = $1", [reaktionBetreuer])).rowCount);
      expect(await loesche({ mandantId: mandantAId, benutzerId: leitungId })).toBe(0);
      expect(await loesche({ mandantId: mandantAId, benutzerId: vollzugriffId })).toBe(0);
      expect(await loesche({ mandantId: mandantAId, benutzerId: betreuerId })).toBe(1);
    });
  });
});
