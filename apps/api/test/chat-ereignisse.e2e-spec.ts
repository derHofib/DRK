/**
 * Chat-Echtzeit per Server-Sent Events (GET /chat/ereignisse).
 *
 * Echte HTTP-Verbindungen gegen die laufende App (Port 0), weil supertest einen
 * Stream nicht offen halten kann. Kernaussagen:
 *   1. Teilnehmende bekommen {chatId, art} -- ohne Inhalt.
 *   2. Nicht-Teilnehmende (auch ist_vollzugriff, auch anderer Mandant) bekommen
 *      nichts. "Nichts" wird deterministisch belegt: ein spaeteres Kontroll-
 *      Ereignis, das SIE erreicht, kommt nach dem fraglichen -- die Reihenfolge
 *      je Abonnent ist garantiert, ein Warten auf Stille braeuchte Zeitfenster.
 *   3. Mitgliedschaft wird bei Teilnehmer-Ereignissen neu geprueft (Hinzufuegen,
 *      Entfernen); der Stream endet mit dem Token und mit dem Herunterfahren.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";

interface Strom {
  status: number;
  headers: http.IncomingHttpHeaders;
  roh: () => string;
  ereignisse: { chatId: string | null; art: string }[];
  beendet: () => boolean;
  warteAuf: (bedingung: () => boolean, ms?: number) => Promise<void>;
  schliesse: () => void;
}

describe("Chat-Ereignisse (SSE)", () => {
  let app: INestApplication;
  let admin: Client;
  let port: number;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";

  let mandantAId: string;
  let mandantBId: string;
  let leitungId: string;
  let betreuerId: string;
  let vollzugriffId: string;
  let leitungBId: string;
  let klient1Id: string;
  let klientBId: string;

  let tokenLeitung: string;
  let tokenBetreuer: string;
  let tokenVollzugriff: string;
  let tokenLeitungB: string;
  let tokenKlient1: string;

  const offen: Strom[] = [];
  const http_ = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http_()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http_()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http_()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
    del: (p: string) => request(http_()).delete(p).set("Authorization", `Bearer ${token}`),
  });

  function oeffneStrom(token: string): Promise<Strom> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/chat/ereignisse", headers: { Authorization: `Bearer ${token}` } }, (res) => {
        let roh = "";
        let fertig = false;
        const ereignisse: Strom["ereignisse"] = [];
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          roh += chunk;
          for (const rahmen of chunk.split("\n\n")) {
            const daten = rahmen.split("\n").find((z) => z.startsWith("data: "));
            if (rahmen.startsWith("event: chat") && daten) ereignisse.push(JSON.parse(daten.slice("data: ".length)));
          }
        });
        res.on("end", () => (fertig = true));
        res.on("close", () => (fertig = true));
        const strom: Strom = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          roh: () => roh,
          ereignisse,
          beendet: () => fertig,
          warteAuf: async (bedingung, ms = 4000) => {
            const ende = Date.now() + ms;
            while (!bedingung()) {
              if (Date.now() > ende) throw new Error(`Zeitueberschreitung; bisher: ${JSON.stringify(ereignisse)} / ${roh}`);
              await new Promise((r) => setTimeout(r, 15));
            }
          },
          schliesse: () => req.destroy(),
        };
        offen.push(strom);
        resolve(strom);
      });
      req.on("error", reject);
      req.end();
    });
  }

  const art = (s: Strom, chatId: string) => s.ereignisse.filter((e) => e.chatId === chatId).map((e) => e.art);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    const slugA = `test-sse-a-${suffix}`;
    const slugB = `test-sse-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`SSE A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`SSE B ${suffix}`, slugB])).rows[0].id;
    const konto = (mandantId: string, rolle: "bereichsleitung" | "einrichtungsleitung" | "betreuer", kurz: string, name: string) =>
      kontoMitAlterRolle(admin, { mandantId, rolle, email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash: hash });
    leitungId = await konto(mandantAId, "einrichtungsleitung", "leitung", "Anna Leitung");
    betreuerId = await konto(mandantAId, "betreuer", "betreuer", "Bernd Betreuer");
    vollzugriffId = await konto(mandantAId, "bereichsleitung", "vollzugriff", "Vera Vollzugriff");
    leitungBId = await konto(mandantBId, "einrichtungsleitung", "leitung-b", "Lena Leitung B");

    const neuerKlient = async (mandantId: string, vorname: string, nachname: string, az: string) =>
      (
        await admin.query(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, $2, $3, '2005-01-01', $4, 'Jugendamt') RETURNING id`,
          [mandantId, vorname, nachname, `${az}-${suffix}`]
        )
      ).rows[0].id;
    klient1Id = await neuerKlient(mandantAId, "Max", "Muster", "SSE1");
    klientBId = await neuerKlient(mandantBId, "Britta", "Fremd", "SSEB");
    await legeKlientZugangAn(admin, { mandantId: mandantAId, klientId: klient1Id, email: `klient1-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: leitungId });
    await legeKlientZugangAn(admin, { mandantId: mandantBId, klientId: klientBId, email: `klientb-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: leitungBId });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;

    const login = async (slug: string, kurz: string) =>
      (await request(http_()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenLeitung = await login(slugA, "leitung");
    tokenBetreuer = await login(slugA, "betreuer");
    tokenVollzugriff = await login(slugA, "vollzugriff");
    tokenLeitungB = await login(slugB, "leitung-b");
    tokenKlient1 = await klientToken(app, slugA, `klient1-${suffix}@beispiel.test`, passwort);
  });

  afterAll(async () => {
    try {
      // Absichtlich NICHT alle Streams schliessen: app.close() muss offene Streams selbst beenden,
      // sonst haengt der Testlauf (Jest wartet auf den offenen Server).
      const ids = [mandantAId, mandantBId];
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
      const letzter = offen[offen.length - 1];
      await app.close();
      if (letzter) expect(letzter.beendet()).toBe(true);
    }
  });

  it("Ohne gueltiges Token kein Stream (401); der Stream hat die richtigen Header und meldet sich mit einem Kommentar", async () => {
    expect((await request(http_()).get("/chat/ereignisse")).status).toBe(401);
    expect((await request(http_()).get("/chat/ereignisse").set("Authorization", "Bearer kaputt")).status).toBe(401);

    const s = await oeffneStrom(tokenBetreuer);
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toBe("text/event-stream");
    expect(s.headers["cache-control"]).toBe("no-cache");
    expect(s.headers["x-accel-buffering"]).toBe("no");
    await s.warteAuf(() => s.roh().includes(": verbunden"));
    s.schliesse();
  });

  it("Teilnehmer:in bekommt {chatId, art} bei neuer Nachricht - ohne Inhalt", async () => {
    const chat = (await als(tokenLeitung).post("/chat/direkt", { benutzerId: betreuerId })).body.id;
    const b = await oeffneStrom(tokenBetreuer);
    await b.warteAuf(() => b.roh().includes(": verbunden"));

    await als(tokenLeitung).post(`/chat/${chat}/nachrichten`, { art: "text", text: "streng vertraulicher Inhalt" });
    await b.warteAuf(() => art(b, chat).includes("nachricht"));
    expect(b.roh()).toContain(`event: chat\ndata: {"chatId":"${chat}","art":"nachricht"}\n\n`);
    expect(b.roh()).not.toContain("vertraulich");
    expect(b.roh()).not.toContain("Anna");

    // Loeschen meldet ebenfalls
    const nachrichtId = (await als(tokenLeitung).post(`/chat/${chat}/nachrichten`, { art: "text", text: "zwei" })).body.id;
    const vorher = art(b, chat).length;
    await als(tokenLeitung).del(`/chat/nachrichten/${nachrichtId}`);
    await b.warteAuf(() => art(b, chat).length >= vorher + 2);
    b.schliesse();
  });

  it("Nicht-Teilnehmer (ist_vollzugriff im selben Mandant, anderer Mandant) bekommen weder dieses noch ein anderes fremdes Ereignis", async () => {
    const v = await oeffneStrom(tokenVollzugriff);
    const b = await oeffneStrom(tokenLeitungB);
    await v.warteAuf(() => v.roh().includes(": verbunden"));
    await b.warteAuf(() => b.roh().includes(": verbunden"));

    const fremd = (await als(tokenLeitung).post("/chat/direkt", { benutzerId: betreuerId })).body.id;
    await als(tokenLeitung).post(`/chat/${fremd}/nachrichten`, { art: "text", text: "nur fuer uns zwei" });

    // Kontrolle: danach ein Ereignis in einem Chat, in dem sie WIRKLICH Mitglied sind.
    const kontrolleV = (await als(tokenLeitung).post("/chat/direkt", { benutzerId: vollzugriffId })).body.id;
    await als(tokenLeitung).post(`/chat/${kontrolleV}/nachrichten`, { art: "text", text: "Kontrolle" });
    const kontrolleB = (await als(tokenLeitungB).post("/chat/direkt", { klientId: klientBId })).body.id;
    await als(tokenLeitungB).post(`/chat/${kontrolleB}/nachrichten`, { art: "text", text: "Kontrolle B" });

    await v.warteAuf(() => art(v, kontrolleV).includes("nachricht"));
    await b.warteAuf(() => art(b, kontrolleB).includes("nachricht"));
    expect(v.ereignisse.some((e) => e.chatId === fremd)).toBe(false);
    expect(b.ereignisse.some((e) => e.chatId === fremd || e.chatId === kontrolleV)).toBe(false);
    expect(v.ereignisse.some((e) => e.chatId === kontrolleB)).toBe(false);
    v.schliesse();
    b.schliesse();
  });

  it("Mitgliedschaft wird bei Teilnehmer-Ereignissen neu geprueft: Hinzugefuegte bekommen ab dann Ereignisse, Entfernte einmal 'teilnehmer' und danach nichts mehr", async () => {
    const l = als(tokenLeitung);
    const gruppe = (await l.post("/chat/gruppe", { name: "Ereignisse", teilnehmer: [{ benutzerId: betreuerId }] })).body;
    const v = await oeffneStrom(tokenVollzugriff);
    const b = await oeffneStrom(tokenBetreuer);
    await v.warteAuf(() => v.roh().includes(": verbunden"));

    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "text", text: "eins" });
    await b.warteAuf(() => art(b, gruppe.id).includes("nachricht"));
    // Hier ist die Verneinung bereits im Cache von v.

    await l.post(`/chat/${gruppe.id}/teilnehmer`, { benutzerId: vollzugriffId });
    await v.warteAuf(() => art(v, gruppe.id).includes("teilnehmer"));
    expect(art(v, gruppe.id)).toEqual(["teilnehmer"]);
    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "text", text: "zwei" });
    await v.warteAuf(() => art(v, gruppe.id).includes("nachricht"));

    const zeile = (await l.get(`/chat/${gruppe.id}`)).body.teilnehmer.find((t: any) => t.id === vollzugriffId).teilnehmerId;
    await l.del(`/chat/${gruppe.id}/teilnehmer/${zeile}`);
    await v.warteAuf(() => art(v, gruppe.id).filter((a) => a === "teilnehmer").length === 2);
    const davor = v.ereignisse.length;

    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "text", text: "drei" });
    await l.post(`/chat/${gruppe.id}/nachrichten`, { art: "text", text: "vier" });
    // Kontrolle fuer v (Mitglied eines anderen Chats) und Gegenprobe fuer b (bekommt beide).
    const kontrolle = (await l.post("/chat/direkt", { benutzerId: vollzugriffId })).body.id;
    await l.post(`/chat/${kontrolle}/nachrichten`, { art: "text", text: "Kontrolle" });
    await v.warteAuf(() => art(v, kontrolle).includes("nachricht"));
    await b.warteAuf(() => art(b, gruppe.id).filter((a) => a === "nachricht").length === 4);
    expect(v.ereignisse.slice(davor).filter((e) => e.chatId === gruppe.id)).toEqual([]);

    // Umbenennen meldet 'chat' an Mitglieder
    await l.post(`/chat/${gruppe.id}/teilnehmer`, { benutzerId: vollzugriffId });
    await l.patch(`/chat/${gruppe.id}`, { name: "Umbenannt" });
    await b.warteAuf(() => art(b, gruppe.id).includes("chat"));
    v.schliesse();
    b.schliesse();
  });

  it("Klient:in bekommt Ereignisse ihrer Chats", async () => {
    const chat = (await als(tokenLeitung).post("/chat/direkt", { klientId: klient1Id })).body.id;
    const k = await oeffneStrom(tokenKlient1);
    await k.warteAuf(() => k.roh().includes(": verbunden"));
    await als(tokenLeitung).post(`/chat/${chat}/nachrichten`, { art: "text", text: "Hallo Max" });
    await k.warteAuf(() => art(k, chat).includes("nachricht"));
    k.schliesse();
  });

  it("Heartbeat: in regelmaessigen Abstaenden kommt ein Kommentar", async () => {
    process.env.CHAT_HEARTBEAT_MS = "150";
    try {
      const s = await oeffneStrom(tokenBetreuer);
      await s.warteAuf(() => (s.roh().match(/: ping\n\n/g) ?? []).length >= 2, 3000);
      s.schliesse();
    } finally {
      delete process.env.CHAT_HEARTBEAT_MS;
    }
  });

  it("Der Stream endet, wenn das Token ablaeuft", async () => {
    const kurz = app.get(JwtService).sign({ typ: "access", sub: betreuerId, mandantId: mandantAId }, { expiresIn: 2 });
    const s = await oeffneStrom(kurz);
    expect(s.status).toBe(200);
    await s.warteAuf(() => s.beendet(), 5000);
  });

  it("Bricht die Datenbankverbindung des Dienstes ab, verbindet er sich neu und meldet 'resync'; danach kommen Ereignisse wieder an", async () => {
    const chat = (await als(tokenLeitung).post("/chat/direkt", { benutzerId: betreuerId })).body.id;
    const b = await oeffneStrom(tokenBetreuer);
    await b.warteAuf(() => b.roh().includes(": verbunden"));

    const { rowCount } = await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND usename = 'zimmerakte_app' AND query = 'LISTEN chat_ereignis'"
    );
    expect(rowCount).toBeGreaterThanOrEqual(1);
    await b.warteAuf(() => b.ereignisse.some((e) => e.art === "resync"), 8000);
    expect(b.ereignisse.find((e) => e.art === "resync")).toEqual({ chatId: null, art: "resync" });

    await als(tokenLeitung).post(`/chat/${chat}/nachrichten`, { art: "text", text: "wieder da" });
    await b.warteAuf(() => art(b, chat).includes("nachricht"));
    b.schliesse();
  });

  it("Beim Herunterfahren werden offene Streams beendet (afterAll prueft das am zuletzt geoeffneten)", async () => {
    const s = await oeffneStrom(tokenLeitung);
    await s.warteAuf(() => s.roh().includes(": verbunden"));
    expect(s.beendet()).toBe(false);
  });
});
