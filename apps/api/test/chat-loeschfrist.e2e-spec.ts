/**
 * Loeschfrist fuer Chatinhalte und Chat-Bereinigung bei Anonymisierung
 * (migrations/0061).
 *
 * Kernaussagen:
 *   1. Nach Ablauf der Frist des eigenen Mandanten verschwinden Nachricht,
 *      Bild und beantwortete Anfrage endgueltig -- juengere Nachrichten,
 *      offene Anfragen und andere Mandanten mit laengerer Frist bleiben.
 *   2. Die Frist ist je Mandant einstellbar, nur mit eigenem Recht und nur
 *      innerhalb 7..3650 Tagen -- auch an der Anwendung vorbei.
 *   3. Die App-Rolle bekommt dadurch KEIN allgemeines DELETE auf Nachrichten.
 *   4. Anonymisieren einer Klient:in leert ihre Direktchats vollstaendig,
 *      entfernt ihre eigenen Gruppennachrichten und Anfragen und beendet ihre
 *      Gruppenteilnahmen. Fremde Gruppennachrichten und andere Klient:innen
 *      bleiben unberuehrt.
 *
 * Seed-Daten werden bewusst mit der Admin-Rolle direkt eingefuegt: nur so
 * lassen sich Nachrichten mit Zeitstempeln von vor 100 Tagen anlegen.
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

describe("Chat-Löschfrist und Anonymisierung", () => {
  let app: INestApplication;
  let admin: Client;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const slugA = `test-loeschfrist-a-${suffix}`;
  const slugB = `test-loeschfrist-b-${suffix}`;

  let mandantAId: string;
  let mandantBId: string;
  let leitungId: string;
  let betreuerId: string;
  let leitungBId: string;
  let klient1Id: string;
  let klient2Id: string;
  let klientBId: string;

  let tokenVollzugriff: string;
  let tokenBetreuer: string;
  let tokenLeitungB: string;
  let tokenKlient1: string;

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
  });

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Frist A ${suffix}`, slugA])).rows[0].id;
    // Mandant B hat eine laengere Frist: seine 100 Tage alten Nachrichten muessen bleiben.
    mandantBId = (
      await admin.query("INSERT INTO mandant (name, slug, chat_loeschfrist_tage) VALUES ($1, $2, 365) RETURNING id", [`Frist B ${suffix}`, slugB])
    ).rows[0].id;

    const konto = (mandantId: string, rolle: "bereichsleitung" | "einrichtungsleitung" | "betreuer", kurz: string, name: string) =>
      kontoMitAlterRolle(admin, { mandantId, rolle, email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash: hash });
    leitungId = await konto(mandantAId, "einrichtungsleitung", "leitung", "Anna Leitung");
    betreuerId = await konto(mandantAId, "betreuer", "betreuer", "Bernd Betreuer");
    await konto(mandantAId, "bereichsleitung", "vollzugriff", "Vera Vollzugriff");
    leitungBId = await konto(mandantBId, "bereichsleitung", "leitung-b", "Lena Leitung B");

    const neuerKlient = async (mandantId: string, vorname: string, az: string) =>
      (
        await admin.query(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, $2, 'Muster', '2005-01-01', $3, 'Jugendamt') RETURNING id`,
          [mandantId, vorname, `${az}-${suffix}`]
        )
      ).rows[0].id as string;
    klient1Id = await neuerKlient(mandantAId, "Max", "LF1");
    klient2Id = await neuerKlient(mandantAId, "Erika", "LF2");
    klientBId = await neuerKlient(mandantBId, "Britta", "LFB");
    await legeKlientZugangAn(admin, { mandantId: mandantAId, klientId: klient1Id, email: `klient1-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: leitungId });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = async (slug: string, kurz: string) =>
      (await request(http()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenVollzugriff = await login(slugA, "vollzugriff");
    tokenBetreuer = await login(slugA, "betreuer");
    tokenLeitungB = await login(slugB, "leitung-b");
    tokenKlient1 = await klientToken(app, slugA, `klient1-${suffix}@beispiel.test`, passwort);
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
      await admin.query("DELETE FROM audit_log WHERE mandant_id = ANY($1)", [ids]).catch(() => undefined);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  // --- Seed-Helfer (Admin-Rolle, an RLS vorbei) ------------------------------

  async function chat(mandantId: string, art: "direkt" | "gruppe", teilnehmer: Array<{ benutzerId?: string; klientId?: string }>, ersteller: string) {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO chat (id, mandant_id, art, name, direkt_schluessel, erstellt_von_benutzer_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, mandantId, art, art === "gruppe" ? "Gruppe" : null, art === "direkt" ? `test:${id}` : null, ersteller]
    );
    for (const t of teilnehmer) {
      await admin.query("INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id, klient_id) VALUES ($1, $2, $3, $4)", [
        mandantId,
        id,
        t.benutzerId ?? null,
        t.klientId ?? null,
      ]);
    }
    return id;
  }

  async function nachricht(mandantId: string, chatId: string, von: { benutzerId?: string; klientId?: string }, alterTage: number, text: string) {
    const { rows } = await admin.query(
      `INSERT INTO chat_nachricht (mandant_id, chat_id, absender_benutzer_id, absender_klient_id, art, text, erstellt_am)
       VALUES ($1, $2, $3, $4, 'text', $5, now() - make_interval(days => $6)) RETURNING id`,
      [mandantId, chatId, von.benutzerId ?? null, von.klientId ?? null, text, alterTage]
    );
    return rows[0].id as string;
  }

  async function bild(mandantId: string, nachrichtId: string) {
    await admin.query(
      `INSERT INTO chat_anhang (mandant_id, nachricht_id, dateiname, mime_type, inhalt, inhalt_hash, groesse)
       VALUES ($1, $2, 'foto.png', 'image/png', '\\x89504e47'::bytea, 'abc', 4)`,
      [mandantId, nachrichtId]
    );
  }

  const gibt = async (sql: string, params: unknown[]) => Number((await admin.query(`SELECT count(*) AS n FROM ${sql}`, params)).rows[0].n);

  // --- 1. Loeschfrist --------------------------------------------------------

  describe("Löschfrist", () => {
    let altId: string;
    let jungId: string;
    let altBId: string;
    let anfrageBeantwortetId: string;
    let anfrageOffenId: string;

    beforeAll(async () => {
      const direkt = await chat(mandantAId, "direkt", [{ benutzerId: leitungId }, { klientId: klient2Id }], leitungId);
      altId = await nachricht(mandantAId, direkt, { benutzerId: leitungId }, 100, "alt");
      await bild(mandantAId, altId);
      jungId = await nachricht(mandantAId, direkt, { klientId: klient2Id }, 10, "jung");

      const direktB = await chat(mandantBId, "direkt", [{ benutzerId: leitungBId }, { klientId: klientBId }], leitungBId);
      altBId = await nachricht(mandantBId, direktB, { benutzerId: leitungBId }, 100, "alt B");

      anfrageBeantwortetId = (
        await admin.query(
          `INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id, nachricht, erstellt_am, beantwortet_am, beantwortet_von, angenommen, ablehnungsgrund)
           VALUES ($1, $2, $3, 'Bitte um Gespräch', now() - interval '101 days', now() - interval '100 days', $3, false, 'Urlaub')
           RETURNING id`,
          [mandantAId, klient2Id, leitungId]
        )
      ).rows[0].id;
      // Offen und genauso alt: muss bleiben, sonst verschwaende die Bitte unbeantwortet.
      anfrageOffenId = (
        await admin.query(
          `INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id, nachricht, erstellt_am)
           VALUES ($1, $2, $3, 'Noch offen', now() - interval '100 days') RETURNING id`,
          [mandantAId, klient2Id, betreuerId]
        )
      ).rows[0].id;
    });

    it("entfernt abgelaufene Nachrichten samt Bild und beantwortete Anfragen endgültig, lässt Jüngeres, Offenes und andere Mandanten stehen", async () => {
      const ergebnis = await app.get(ChatLoeschfristService).anwenden();
      const fuerA = ergebnis.find((e) => e.mandantId === mandantAId);
      expect(fuerA).toEqual({ mandantId: mandantAId, nachrichten: 1, anhaenge: 1, anfragen: 1 });
      expect(ergebnis.find((e) => e.mandantId === mandantBId)).toBeUndefined();

      expect(await gibt("chat_nachricht WHERE id = $1", [altId])).toBe(0);
      expect(await gibt("chat_anhang WHERE nachricht_id = $1", [altId])).toBe(0);
      expect(await gibt("chat_nachricht WHERE id = $1", [jungId])).toBe(1);
      expect(await gibt("chat_nachricht WHERE id = $1", [altBId])).toBe(1);
      expect(await gibt("chat_anfrage WHERE id = $1", [anfrageBeantwortetId])).toBe(0);
      expect(await gibt("chat_anfrage WHERE id = $1", [anfrageOffenId])).toBe(1);
    });

    it("ein zweiter Lauf findet nichts mehr für diese Mandanten", async () => {
      const ergebnis = await app.get(ChatLoeschfristService).anwenden();
      expect(ergebnis.filter((e) => e.mandantId === mandantAId || e.mandantId === mandantBId)).toEqual([]);
    });

    it("die App-Rolle hat weiterhin kein DELETE auf Nachrichten und Anfragen", async () => {
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        for (const sql of ["DELETE FROM chat_nachricht WHERE id = $1", "DELETE FROM chat_anfrage WHERE id = $1"]) {
          await c.query("BEGIN");
          await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
          await c.query("SELECT set_config('app.benutzer_id', $1, true)", [leitungId]);
          const code = await c.query(sql, [jungId]).then(
            () => "ok",
            (err: { code: string }) => err.code
          );
          await c.query("ROLLBACK");
          expect(code).toBe("42501");
        }
      } finally {
        await c.end();
      }
    });
  });

  // --- 2. Einstellung ---------------------------------------------------------

  describe("Einstellung der Frist", () => {
    it("Mitarbeitende und Klient:innen sehen die Frist im Verlauf", async () => {
      const direkt = await chat(mandantAId, "direkt", [{ benutzerId: betreuerId }, { klientId: klient1Id }], betreuerId);
      const mitarbeitend = await als(tokenBetreuer).get(`/chat/${direkt}/nachrichten`);
      expect(mitarbeitend.status).toBe(200);
      expect(mitarbeitend.body.loeschfristTage).toBe(90);
      const klient = await als(tokenKlient1).get(`/chat/${direkt}/nachrichten`);
      expect(klient.status).toBe(200);
      expect(klient.body.loeschfristTage).toBe(90);
    });

    it("ohne Recht 403, mit Recht 200, nur im eigenen Mandanten", async () => {
      expect((await als(tokenBetreuer).patch("/mandant/me/chat-loeschfrist", { tage: 30 })).status).toBe(403);

      const ok = await als(tokenVollzugriff).patch("/mandant/me/chat-loeschfrist", { tage: 30 });
      expect(ok.status).toBe(200);
      expect(ok.body.chatLoeschfristTage).toBe(30);
      expect((await als(tokenVollzugriff).get("/mandant/me")).body.chatLoeschfristTage).toBe(30);
      expect((await als(tokenLeitungB).get("/mandant/me")).body.chatLoeschfristTage).toBe(365);
    });

    it("außerhalb von 7 bis 3650 Tagen 400", async () => {
      for (const tage of [6, 3651, 30.5, "90"]) {
        expect((await als(tokenVollzugriff).patch("/mandant/me/chat-loeschfrist", { tage })).status).toBe(400);
      }
    });

    it("die Grenzen hält die Datenbank auch an der Anwendung vorbei, und andere Mandantenspalten bleiben gesperrt", async () => {
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        const versuch = async (sql: string) => {
          await c.query("BEGIN");
          await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
          const code = await c.query(sql).then(
            () => "ok",
            (err: { code: string }) => err.code
          );
          await c.query("ROLLBACK");
          return code;
        };
        expect(await versuch("UPDATE mandant SET chat_loeschfrist_tage = 1")).toBe("23514");
        expect(await versuch("UPDATE mandant SET slug = 'gekapert'")).toBe("42501");
      } finally {
        await c.end();
      }
    });
  });

  // --- 3. Anonymisierung -------------------------------------------------------

  describe("Anonymisierung", () => {
    let direktKlient1: string;
    let gruppe: string;
    let direktKlient2: string;
    let gruppeFremdId: string;
    let gruppeKlient1Id: string;
    let klient2NachrichtId: string;

    beforeAll(async () => {
      direktKlient1 = await chat(mandantAId, "direkt", [{ benutzerId: leitungId }, { klientId: klient1Id }], leitungId);
      const vonKlient = await nachricht(mandantAId, direktKlient1, { klientId: klient1Id }, 1, "Mir geht es nicht gut");
      await bild(mandantAId, vonKlient);
      const vonLeitung = await nachricht(mandantAId, direktKlient1, { benutzerId: leitungId }, 1, "Ich rufe den Arzt an");
      await bild(mandantAId, vonLeitung);

      gruppe = await chat(mandantAId, "gruppe", [{ benutzerId: leitungId }, { benutzerId: betreuerId }, { klientId: klient1Id }, { klientId: klient2Id }], leitungId);
      gruppeKlient1Id = await nachricht(mandantAId, gruppe, { klientId: klient1Id }, 1, "Hallo Gruppe");
      gruppeFremdId = await nachricht(mandantAId, gruppe, { benutzerId: betreuerId }, 1, "Termin Donnerstag");

      direktKlient2 = await chat(mandantAId, "direkt", [{ benutzerId: leitungId }, { klientId: klient2Id }], leitungId);
      klient2NachrichtId = await nachricht(mandantAId, direktKlient2, { klientId: klient2Id }, 1, "Andere Person");

      await admin.query(
        "INSERT INTO chat_anfrage (mandant_id, klient_id, ziel_benutzer_id, nachricht) VALUES ($1, $2, $3, 'Gespräch bitte')",
        [mandantAId, klient1Id, betreuerId]
      );
    });

    it("leert Direktchats, entfernt eigene Gruppennachrichten und Anfragen, beendet Gruppenteilnahmen", async () => {
      const res = await als(tokenVollzugriff).patch(`/klienten/${klient1Id}/anonymisieren`);
      expect(res.status).toBe(200);

      expect(await gibt("chat_nachricht WHERE chat_id = $1", [direktKlient1])).toBe(0);
      expect(await gibt("chat_anhang a JOIN chat_nachricht n ON n.id = a.nachricht_id WHERE n.chat_id = $1", [direktKlient1])).toBe(0);
      expect(await gibt("chat_anhang WHERE mandant_id = $1", [mandantAId])).toBe(0);
      expect(await gibt("chat_nachricht WHERE id = $1", [gruppeKlient1Id])).toBe(0);
      expect(await gibt("chat_nachricht WHERE absender_klient_id = $1", [klient1Id])).toBe(0);
      expect(await gibt("chat_anfrage WHERE klient_id = $1", [klient1Id])).toBe(0);
      expect(await gibt("chat_teilnehmer WHERE chat_id = $1 AND klient_id = $2 AND verlassen_am IS NULL", [gruppe, klient1Id])).toBe(0);
    });

    it("lässt fremde Gruppennachrichten, andere Klient:innen und deren Teilnahme unberührt", async () => {
      expect(await gibt("chat_nachricht WHERE id = $1", [gruppeFremdId])).toBe(1);
      expect(await gibt("chat_nachricht WHERE id = $1", [klient2NachrichtId])).toBe(1);
      expect(await gibt("chat_teilnehmer WHERE chat_id = $1 AND klient_id = $2 AND verlassen_am IS NULL", [gruppe, klient2Id])).toBe(1);
      expect(await gibt("chat_teilnehmer WHERE chat_id = $1 AND benutzer_id = $2 AND verlassen_am IS NULL", [gruppe, betreuerId])).toBe(1);
    });
  });
});
