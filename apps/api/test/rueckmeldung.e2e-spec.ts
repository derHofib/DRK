/**
 * Rückmeldungen (migrations/0073): Melden mit Screenshot, Freigabe durch die
 * Geschäftsführung, Hersteller-Zugang für Claude.
 *
 * Kernaussagen, jeweils mit Gegenprobe:
 *   1. Melden darf jede angemeldete Person; Sichten/Freigeben nur mit dem Recht
 *      rueckmeldungen.verwalten (die Einrichtungsleitung hat es NICHT -- es
 *      hängt am Recht, nicht an einer Rolle).
 *   2. Träger B sieht nie Rückmeldungen von Träger A.
 *   3. Der Kontext wird serverseitig bereinigt (UUIDs, Query), Unbekanntes fällt weg.
 *   4. Nur das Freigeben schaltet den Hersteller-Zugang frei -- und nur bei
 *      eingeschalteter Weitergabe des Trägers. Nicht freigegeben = 404, nicht
 *      "verboten" (nicht unterscheidbar von "gibt es nicht").
 *   5. in_arbeit/umgesetzt kann die App-Rolle nie setzen (Trigger), und kein Weg
 *      führt zu einem Status "in Arbeit" ohne Freigabe (CHECK).
 *   6. Falsches Token 401, kein Hash konfiguriert 404, zehn Fehlversuche sperren.
 *   7. Jeder Hersteller-Zugriff steht im Protokoll; die App-Rolle kann es nicht schreiben.
 *   8. Löschfrist: Bild 30 Tage, Eintrag 365 Tage nach Abschluss; Offenes bleibt.
 */
import "reflect-metadata";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import sharp from "sharp";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { RueckmeldungLoeschfristService } from "../src/rueckmeldung/rueckmeldung-loeschfrist.service";
import { ServiceTokenGuard } from "../src/rueckmeldung/service-token.guard";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Rückmeldungen", () => {
  let app: INestApplication;
  let admin: Client;
  let loeschfrist: RueckmeldungLoeschfristService;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const slugA = `test-rm-a-${suffix}`;
  const slugB = `test-rm-b-${suffix}`;
  const serviceToken = randomBytes(32).toString("base64url");
  const serviceHash = createHash("sha256").update(serviceToken).digest("hex");
  let mandantAId: string;
  let mandantBId: string;
  let betreuerId: string;
  let tokenBetreuer: string;
  let tokenLeitung: string;
  let tokenVollzugriff: string;
  let tokenFremd: string;
  let png: Buffer;

  const http = () => app.getHttpServer();
  const mit = (t: string) => ({ Authorization: `Bearer ${t}` });
  const service = (method: "get" | "patch", pfad: string, token = serviceToken) =>
    request(http())[method](`/service/rueckmeldungen${pfad}`).set(mit(token));

  const eingabe = (extra: Record<string, unknown> = {}) => ({
    art: "idee",
    titel: "Filter merken",
    beschreibung: "Der Filter in der Liste soll sich merken, was zuletzt gewählt war.",
    erwartet: "Weniger Klicks am Morgen",
    prioritaet: "mittel",
    kontext: { seite: "/klienten", appVersion: "1.0.0", browser: "Firefox 130", viewport: "1440x900", theme: "hell" },
    ...extra,
  });

  async function melde(token = tokenBetreuer, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await request(http()).post("/rueckmeldungen").set(mit(token)).send(eingabe(extra));
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const statusInDb = async (id: string) => (await admin.query("SELECT status, freigegeben_am FROM rueckmeldung WHERE id = $1", [id])).rows[0];
  const weitergabe = (mandantId: string, an: boolean) => admin.query("UPDATE mandant SET rueckmeldung_weitergabe = $2 WHERE id = $1", [mandantId, an]);

  async function freigeben(id: string) {
    const res = await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff)).send({ status: "freigegeben" });
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    process.env.RUECKMELDUNG_SERVICE_TOKEN_HASH = serviceHash;
    png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#888888" } }).png().toBuffer();

    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`RM A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`RM B ${suffix}`, slugB])).rows[0].id;
    betreuerId = await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "betreuer", email: `betreuer-${suffix}@beispiel.test`, name: "Bernd Betreuer", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "einrichtungsleitung", email: `leitung-${suffix}@beispiel.test`, name: "Anna Leitung", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "bereichsleitung", email: `vollzugriff-${suffix}@beispiel.test`, name: "Vera Vollzugriff", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantBId, rolle: "bereichsleitung", email: `fremd-${suffix}@beispiel.test`, name: "Frieda Fremd", passwortHash: hash });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    loeschfrist = app.get(RueckmeldungLoeschfristService);

    const login = async (slug: string, kurz: string) =>
      (await request(http()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenBetreuer = await login(slugA, "betreuer");
    tokenLeitung = await login(slugA, "leitung");
    tokenVollzugriff = await login(slugA, "vollzugriff");
    tokenFremd = await login(slugB, "fremd");
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      for (const t of ["rueckmeldung_service_zugriff", "rueckmeldung", "audit_log"]) {
        await admin.query(`DELETE FROM ${t} WHERE mandant_id = ANY($1)`, [ids]).catch(() => undefined);
      }
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    } finally {
      delete process.env.RUECKMELDUNG_SERVICE_TOKEN_HASH;
      await admin.end();
      await app.close();
    }
  });

  afterEach(async () => {
    await weitergabe(mandantAId, false);
    // Alle Anfragen kommen von derselben Loopback-Adresse: ohne Zuruecksetzen
    // wuerden die absichtlichen Fehlversuche einzelner Tests die folgenden sperren.
    app.get(ServiceTokenGuard).fehlversucheVergessen();
  });

  // ---------------------------------------------------------------- Melden

  describe("Melden und Screenshot", () => {
    it("jede angemeldete Person kann melden; Status ist neu, der Kontext ist bereinigt", async () => {
      const id = await melde(tokenBetreuer, {
        kontext: {
          seite: `/klienten/${randomUUID()}/akte?suche=Max+Mustermann#top`,
          browser: "Firefox",
          eingeschleust: "Max Mustermann, Diagnose X",
        },
      });
      const z = (await admin.query("SELECT status, kontext, erstellt_von FROM rueckmeldung WHERE id = $1", [id])).rows[0];
      expect(z.status).toBe("neu");
      expect(z.erstellt_von).toBe(betreuerId);
      expect(z.kontext.seite).toBe("/klienten/:id/akte");
      expect(JSON.stringify(z.kontext)).not.toContain("Mustermann");
      expect(z.kontext.eingeschleust).toBeUndefined();
    });

    it("Pflichtfelder und Obergrenzen: leerer Titel 400, blockierende Idee 400", async () => {
      const leer = await request(http()).post("/rueckmeldungen").set(mit(tokenBetreuer)).send(eingabe({ titel: "   " }));
      expect(leer.status).toBe(400);
      const blockierend = await request(http()).post("/rueckmeldungen").set(mit(tokenBetreuer)).send(eingabe({ prioritaet: "blockierend" }));
      expect(blockierend.status).toBe(400);
      const fehler = await request(http()).post("/rueckmeldungen").set(mit(tokenBetreuer)).send(eingabe({ art: "fehler", prioritaet: "blockierend" }));
      expect(fehler.status).toBe(201);
    });

    it("ohne Anmeldung nicht möglich", async () => {
      expect((await request(http()).post("/rueckmeldungen").send(eingabe())).status).toBe(401);
    });

    it("PNG wird angenommen; Nicht-PNG, zweites Bild und fremde Meldung werden abgewiesen", async () => {
      const id = await melde();
      const ok = await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      expect(ok.status).toBe(204);
      const gespeichert = (await admin.query("SELECT breite, hoehe FROM rueckmeldung_bild WHERE rueckmeldung_id = $1", [id])).rows[0];
      expect(gespeichert).toEqual({ breite: 40, hoehe: 30 });

      const zweites = await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      expect(zweites.status).toBe(409);

      const anderer = await melde();
      const text = await request(http()).put(`/rueckmeldungen/${anderer}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(Buffer.from("<html>kein bild</html>"));
      expect(text.status).toBe(400);

      // Gegenprobe zur Besitzprüfung: dieselbe Meldung, andere Person.
      const frisch = await melde();
      const fremderZugriff = await request(http()).put(`/rueckmeldungen/${frisch}/screenshot`).set(mit(tokenLeitung)).set("Content-Type", "image/png").send(png);
      expect(fremderZugriff.status).toBe(404);
      expect((await admin.query("SELECT 1 FROM rueckmeldung_bild WHERE rueckmeldung_id = $1", [frisch])).rowCount).toBe(0);
    });

    it("zu großes Bild wird beim Lesen abgebrochen (413)", async () => {
      const id = await melde();
      const res = await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(Buffer.alloc(1_600_000, 1));
      expect(res.status).toBe(413);
    });

    it("eigene Meldungen sind lesbar und enthalten kein Bild und keinen Kontext", async () => {
      await melde();
      const res = await request(http()).get("/rueckmeldungen/meine").set(mit(tokenBetreuer));
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(Object.keys(res.body[0]).sort()).toEqual(["art", "entscheidungsnotiz", "erstelltAm", "id", "status", "titel"]);
      // Gegenprobe: eine andere Person sieht diese Meldungen dort nicht.
      const leitung = await request(http()).get("/rueckmeldungen/meine").set(mit(tokenLeitung));
      expect(leitung.body).toEqual([]);
    });
  });

  // ------------------------------------------------- Rechte und Mandanten

  describe("Sichten und Freigeben", () => {
    it("ohne Recht 403 auf Liste, Detail, Bild und Entscheidung -- auch für die Einrichtungsleitung", async () => {
      const id = await melde();
      await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      for (const token of [tokenBetreuer, tokenLeitung]) {
        expect((await request(http()).get("/rueckmeldungen").set(mit(token))).status).toBe(403);
        expect((await request(http()).get(`/rueckmeldungen/${id}`).set(mit(token))).status).toBe(403);
        expect((await request(http()).get(`/rueckmeldungen/${id}/screenshot`).set(mit(token))).status).toBe(403);
        expect((await request(http()).delete(`/rueckmeldungen/${id}/screenshot`).set(mit(token))).status).toBe(403);
        expect((await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(token)).send({ status: "freigegeben" })).status).toBe(403);
      }
      expect((await statusInDb(id)).status).toBe("neu");
      // Gegenprobe: mit dem Recht geht dieselbe Anfrage.
      expect((await request(http()).get(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff))).status).toBe(200);
    });

    it("das Menü fragt über /berechtigung: ohne Recht verwalten=false, mit Recht plus Zähler", async () => {
      await melde();
      expect((await request(http()).get("/rueckmeldungen/berechtigung").set(mit(tokenBetreuer))).body).toEqual({ verwalten: false, anzahlNeu: 0 });
      const mitRecht = await request(http()).get("/rueckmeldungen/berechtigung").set(mit(tokenVollzugriff));
      expect(mitRecht.body.verwalten).toBe(true);
      expect(mitRecht.body.anzahlNeu).toBeGreaterThan(0);
    });

    it("Träger B sieht nichts von Träger A, auch nicht mit Vollzugriff und bekannter Id", async () => {
      const id = await melde();
      await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      const liste = await request(http()).get("/rueckmeldungen").set(mit(tokenFremd));
      expect(liste.status).toBe(200);
      expect(liste.body.find((r: { id: string }) => r.id === id)).toBeUndefined();
      expect((await request(http()).get(`/rueckmeldungen/${id}`).set(mit(tokenFremd))).status).toBe(404);
      expect((await request(http()).get(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenFremd))).status).toBe(404);
      expect((await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenFremd)).send({ status: "freigegeben" })).status).toBe(404);
      expect((await statusInDb(id)).status).toBe("neu");
    });

    it("Fremdschlüssel sind mandantengebunden: eine Meldung auf einen Benutzer eines anderen Trägers scheitert in der Datenbank", async () => {
      const fremderBenutzer = (await admin.query("SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1", [mandantBId])).rows[0].id;
      await expect(
        admin.query(
          "INSERT INTO rueckmeldung (mandant_id, erstellt_von, art, titel, beschreibung) VALUES ($1, $2, 'idee', 'x', 'y')",
          [mandantAId, fremderBenutzer]
        )
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("Freigeben setzt Zeitpunkt und Person; Ablehnen und Rückfrage brauchen einen Text", async () => {
      const id = await melde();
      expect((await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff)).send({ status: "abgelehnt" })).status).toBe(400);
      expect((await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff)).send({ status: "rueckfrage", notiz: "  " })).status).toBe(400);
      expect((await statusInDb(id)).status).toBe("neu");

      const res = await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff)).send({ status: "freigegeben" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("freigegeben");
      expect(res.body.freigegebenVonName).toBe("Vera Vollzugriff");
      expect((await statusInDb(id)).freigegeben_am).not.toBeNull();

      const zurueck = await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff)).send({ status: "abgelehnt", notiz: "Passt nicht zum Konzept." });
      expect(zurueck.status).toBe(200);
      expect((await statusInDb(id)).freigegeben_am).toBeNull();

      const audit = await admin.query("SELECT count(*)::int AS n FROM audit_log WHERE objekt_id = $1 AND modul = 'rueckmeldungen'", [id]);
      expect(audit.rows[0].n).toBe(2);
    });

    it("die Geschäftsführung kann das Bild verwerfen; es ist danach weg", async () => {
      const id = await melde();
      await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      const bild = await request(http()).get(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenVollzugriff)).buffer(true).parse((r, cb) => {
        const teile: Buffer[] = [];
        r.on("data", (t: Buffer) => teile.push(t));
        r.on("end", () => cb(null, Buffer.concat(teile)));
      });
      expect(bild.status).toBe(200);
      expect(bild.headers["content-type"]).toBe("image/png");
      expect(bild.headers["cache-control"]).toBe("no-store");
      expect((await request(http()).delete(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenVollzugriff))).status).toBe(204);
      expect((await request(http()).get(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenVollzugriff))).status).toBe(404);
    });
  });

  // ------------------------------------------------ Datenbank-Garantien

  describe("Garantien in der Datenbank", () => {
    async function alsAppRolle<T>(mandantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        return await fn(c);
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
        await c.end();
      }
    }

    it("die App-Rolle kann nie auf in_arbeit oder umgesetzt setzen (Trigger), der Eigentümer-Pfad schon", async () => {
      const id = await melde();
      await freigeben(id);
      await expect(alsAppRolle(mandantAId, (c) => c.query("UPDATE rueckmeldung SET status = 'in_arbeit' WHERE id = $1", [id]))).rejects.toMatchObject({ code: "P0001" });
      await expect(alsAppRolle(mandantAId, (c) => c.query("UPDATE rueckmeldung SET status = 'umgesetzt' WHERE id = $1", [id]))).rejects.toMatchObject({ code: "P0001" });
      expect((await statusInDb(id)).status).toBe("freigegeben");
      // Gegenprobe: ohne die Prüfung (Eigentümer) wäre der Wechsel möglich -- der Test prüft also wirklich den Trigger.
      await admin.query("UPDATE rueckmeldung SET status = 'in_arbeit' WHERE id = $1", [id]);
      expect((await statusInDb(id)).status).toBe("in_arbeit");
    });

    it("ohne Freigabe gibt es keinen Status in Arbeit (CHECK), auch nicht für den Eigentümer", async () => {
      const id = await melde();
      await expect(admin.query("UPDATE rueckmeldung SET status = 'in_arbeit' WHERE id = $1", [id])).rejects.toMatchObject({ code: "23514" });
      await expect(admin.query("UPDATE rueckmeldung SET freigegeben_am = now(), freigegeben_von = erstellt_von WHERE id = $1", [id])).rejects.toMatchObject({ code: "23514" });
    });

    it("Inhalt und Herkunft sind nach dem Absenden unveränderlich: UPDATE auf Titel, DELETE verweigert", async () => {
      const id = await melde();
      await expect(alsAppRolle(mandantAId, (c) => c.query("UPDATE rueckmeldung SET titel = 'anders' WHERE id = $1", [id]))).rejects.toMatchObject({ code: "42501" });
      await expect(alsAppRolle(mandantAId, (c) => c.query("UPDATE rueckmeldung SET erstellt_von = erstellt_von WHERE id = $1", [id]))).rejects.toMatchObject({ code: "42501" });
      await expect(alsAppRolle(mandantAId, (c) => c.query("DELETE FROM rueckmeldung WHERE id = $1", [id]))).rejects.toMatchObject({ code: "42501" });
    });

    it("die App-Rolle kann das Zugriffsprotokoll weder schreiben noch ändern", async () => {
      await expect(
        alsAppRolle(mandantAId, (c) => c.query("INSERT INTO rueckmeldung_service_zugriff (mandant_id, rueckmeldung_id, aktion) VALUES ($1, $2, 'liste')", [mandantAId, randomUUID()]))
      ).rejects.toMatchObject({ code: "42501" });
      await expect(alsAppRolle(mandantAId, (c) => c.query("DELETE FROM rueckmeldung_service_zugriff"))).rejects.toMatchObject({ code: "42501" });
    });
  });

  // --------------------------------------------------- Hersteller-Zugang

  describe("Hersteller-Zugang (Service-API)", () => {
    it("ohne konfigurierten Hash 404, ohne/mit falschem Token 401", async () => {
      expect((await request(http()).get("/service/rueckmeldungen")).status).toBe(401);
      expect((await service("get", "", "falsch")).status).toBe(401);
      const gemerkt = process.env.RUECKMELDUNG_SERVICE_TOKEN_HASH;
      delete process.env.RUECKMELDUNG_SERVICE_TOKEN_HASH;
      try {
        expect((await service("get", "")).status).toBe(404);
      } finally {
        process.env.RUECKMELDUNG_SERVICE_TOKEN_HASH = gemerkt;
      }
      expect((await service("get", "")).status).toBe(200);
    });

    it("ein Benutzer-JWT ist kein Service-Token", async () => {
      expect((await service("get", "", tokenVollzugriff)).status).toBe(401);
    });

    it("solange die Weitergabe aus ist, sieht der Hersteller nichts -- auch nicht Freigegebenes", async () => {
      const id = await melde();
      await freigeben(id);
      const liste = await service("get", "");
      expect(liste.body.find((r: { id: string }) => r.id === id)).toBeUndefined();
      expect((await service("get", `/${id}`)).status).toBe(404);
      expect((await service("patch", `/${id}/status`).send({ status: "in_arbeit" })).status).toBe(404);
      expect((await statusInDb(id)).status).toBe("freigegeben");

      // Gegenprobe: dieselbe Rückmeldung, Weitergabe an.
      await weitergabe(mandantAId, true);
      expect((await service("get", `/${id}`)).status).toBe(200);
    });

    it("nur Freigegebenes ist lesbar: neu, Rückfrage und abgelehnt sind 404, auch bei eingeschalteter Weitergabe", async () => {
      await weitergabe(mandantAId, true);
      const neu = await melde();
      const abgelehnt = await melde();
      await request(http()).patch(`/rueckmeldungen/${abgelehnt}`).set(mit(tokenVollzugriff)).send({ status: "abgelehnt", notiz: "nein" });
      const frei = await melde();
      await request(http()).put(`/rueckmeldungen/${frei}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      await freigeben(frei);

      const liste = await service("get", "");
      const ids = liste.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(frei);
      expect(ids).not.toContain(neu);
      expect(ids).not.toContain(abgelehnt);
      expect((await service("get", `/${neu}`)).status).toBe(404);
      expect((await service("get", `/${abgelehnt}`)).status).toBe(404);
      expect((await service("get", `/${neu}/bild`)).status).toBe(404);

      const detail = await service("get", `/${frei}`);
      expect(detail.body.hatBild).toBe(true);
      expect(detail.body.titel).toBe("Filter merken");
      expect(detail.body.traeger).toBe(`RM A ${suffix}`);
      expect(detail.body.kontext.seite).toBe("/klienten");
      const bild = await service("get", `/${frei}/bild`);
      expect(bild.status).toBe(200);
      expect(bild.headers["content-type"]).toBe("image/png");
    });

    it("ungültige Ids und Status werden mit 400 abgewiesen", async () => {
      expect((await service("get", "/keine-uuid")).status).toBe(400);
      expect((await service("get", "?status=neu")).status).toBe(400);
      expect((await service("patch", `/${randomUUID()}/status`).send({ status: "freigegeben-und-mehr" })).status).toBe(400);
    });

    it("Statuswechsel: freigegeben → in Arbeit → umgesetzt, Umgesetzt braucht den PR-Link, Freigeben/Ablehnen kann der Hersteller nie", async () => {
      await weitergabe(mandantAId, true);
      const id = await melde();
      await freigeben(id);

      expect((await service("patch", `/${id}/status`).send({ status: "abgelehnt" })).status).toBe(400);
      expect((await service("patch", `/${id}/status`).send({ status: "umgesetzt", prUrl: "https://github.com/x/y/pull/1" })).status).toBe(409);

      expect((await service("patch", `/${id}/status`).send({ status: "in_arbeit", notiz: "Ich fange an." })).status).toBe(200);
      expect((await service("patch", `/${id}/status`).send({ status: "umgesetzt" })).status).toBe(409);
      const fertig = await service("patch", `/${id}/status`).send({ status: "umgesetzt", prUrl: "https://github.com/x/y/pull/1" });
      expect(fertig.status).toBe(200);

      const z = (await admin.query("SELECT status, pr_url, bearbeitungsnotiz, abgeschlossen_am FROM rueckmeldung WHERE id = $1", [id])).rows[0];
      expect(z.status).toBe("umgesetzt");
      expect(z.pr_url).toBe("https://github.com/x/y/pull/1");
      expect(z.abgeschlossen_am).not.toBeNull();

      // Abgeschlossen: weder Hersteller noch Geschäftsführung ändern es noch.
      expect((await service("patch", `/${id}/status`).send({ status: "in_arbeit" })).status).toBe(404);
      expect((await request(http()).patch(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff)).send({ status: "neu" })).status).toBe(409);
    });

    it("eine Rückfrage des Herstellers nimmt die Freigabe zurück -- danach ist die Meldung für ihn wieder unlesbar", async () => {
      await weitergabe(mandantAId, true);
      const id = await melde();
      await freigeben(id);
      expect((await service("patch", `/${id}/status`).send({ status: "rueckfrage" })).status).toBe(409);
      expect((await service("patch", `/${id}/status`).send({ status: "rueckfrage", notiz: "Welche Liste genau?" })).status).toBe(200);
      const z = await statusInDb(id);
      expect(z.status).toBe("rueckfrage");
      expect(z.freigegeben_am).toBeNull();
      expect((await service("get", `/${id}`)).status).toBe(404);
      // Die Geschäftsführung sieht die Frage und kann erneut freigeben.
      const detail = await request(http()).get(`/rueckmeldungen/${id}`).set(mit(tokenVollzugriff));
      expect(detail.body.bearbeitungsnotiz).toBe("Welche Liste genau?");
      await freigeben(id);
      expect((await service("get", `/${id}`)).status).toBe(200);
    });

    it("jeder Zugriff steht im Protokoll", async () => {
      await weitergabe(mandantAId, true);
      const id = await melde();
      await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      await freigeben(id);
      await service("get", "");
      await service("get", `/${id}`);
      await service("get", `/${id}/bild`);
      await service("patch", `/${id}/status`).send({ status: "in_arbeit" });
      const aktionen = (await admin.query("SELECT aktion FROM rueckmeldung_service_zugriff WHERE rueckmeldung_id = $1 ORDER BY zeitpunkt", [id])).rows.map((r) => r.aktion);
      expect(aktionen).toEqual(["liste", "detail", "bild", "status"]);
      // Ein 404 ist kein Zugriff auf Inhalt und hinterlässt keine Zeile für fremde Ids.
      const fremd = randomUUID();
      await service("get", `/${fremd}`);
      expect((await admin.query("SELECT 1 FROM rueckmeldung_service_zugriff WHERE rueckmeldung_id = $1", [fremd])).rowCount).toBe(0);
    });

    it("zehn Fehlversuche sperren auch das richtige Token (429)", async () => {
      for (let i = 0; i < 10; i++) {
        expect((await request(http()).get("/service/rueckmeldungen").set(mit("falsch"))).status).toBe(401);
      }
      expect((await request(http()).get("/service/rueckmeldungen").set(mit(serviceToken))).status).toBe(429);
      // Gegenprobe: nach dem Zuruecksetzen (= Ablauf des Fensters) geht dasselbe Token wieder.
      app.get(ServiceTokenGuard).fehlversucheVergessen();
      expect((await request(http()).get("/service/rueckmeldungen").set(mit(serviceToken))).status).toBe(200);
    });
  });

  // ------------------------------------------------------- Weitergabe

  describe("Schalter Weitergabe", () => {
    it("nur mit dem Datenschutz-Recht; die Einrichtungsleitung hat es nicht", async () => {
      const aus = await request(http()).patch("/mandant/me/rueckmeldung-weitergabe").set(mit(tokenBetreuer)).send({ aktiv: true });
      expect(aus.status).toBe(403);
      expect((await request(http()).patch("/mandant/me/rueckmeldung-weitergabe").set(mit(tokenLeitung)).send({ aktiv: true })).status).toBe(403);
      expect((await admin.query("SELECT rueckmeldung_weitergabe FROM mandant WHERE id = $1", [mandantAId])).rows[0].rueckmeldung_weitergabe).toBe(false);

      const an = await request(http()).patch("/mandant/me/rueckmeldung-weitergabe").set(mit(tokenVollzugriff)).send({ aktiv: true });
      expect(an.status).toBe(200);
      expect(an.body.rueckmeldungWeitergabe).toBe(true);
      // Gegenprobe: gilt nur für den eigenen Träger.
      expect((await admin.query("SELECT rueckmeldung_weitergabe FROM mandant WHERE id = $1", [mandantBId])).rows[0].rueckmeldung_weitergabe).toBe(false);
    });

    it("kein anderer Weg zur Spalte: die App-Rolle darf slug und Weitergabe nicht beliebig setzen, nur die Weitergabe", async () => {
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
        await expect(c.query("UPDATE mandant SET slug = 'x'")).rejects.toMatchObject({ code: "42501" });
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
        await c.end();
      }
    });
  });

  // ------------------------------------------------------- Löschfrist

  describe("Löschfrist", () => {
    const tageHer = (n: number) => `now() - interval '${n} days'`;

    async function abgeschlossen(tage: number, mitBild = true): Promise<string> {
      const id = await melde();
      if (mitBild) await request(http()).put(`/rueckmeldungen/${id}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      await freigeben(id);
      await admin.query("UPDATE rueckmeldung SET status = 'umgesetzt', abgeschlossen_am = now() WHERE id = $1", [id]);
      await admin.query(`UPDATE rueckmeldung SET abgeschlossen_am = ${tageHer(tage)} WHERE id = $1`, [id]);
      return id;
    }
    const bilder = async (id: string) => (await admin.query("SELECT count(*)::int AS n FROM rueckmeldung_bild WHERE rueckmeldung_id = $1", [id])).rows[0].n as number;
    const vorhanden = async (id: string) => (await admin.query("SELECT 1 FROM rueckmeldung WHERE id = $1", [id])).rowCount === 1;

    it("Bild nach 30 Tagen, Eintrag erst nach 365; 29 Tage bleibt alles", async () => {
      const frisch = await abgeschlossen(29);
      const bildAlt = await abgeschlossen(31);
      const eintragAlt = await abgeschlossen(366);
      await loeschfrist.anwenden();
      expect(await bilder(frisch)).toBe(1);
      expect(await bilder(bildAlt)).toBe(0);
      expect(await vorhanden(bildAlt)).toBe(true);
      expect(await vorhanden(eintragAlt)).toBe(false);
      expect(await bilder(eintragAlt)).toBe(0);
    });

    it("Offenes wird nie angefasst, auch wenn es uralt ist", async () => {
      const offen = await melde();
      await request(http()).put(`/rueckmeldungen/${offen}/screenshot`).set(mit(tokenBetreuer)).set("Content-Type", "image/png").send(png);
      await admin.query(`UPDATE rueckmeldung SET erstellt_am = ${tageHer(1000)} WHERE id = $1`, [offen]);
      await loeschfrist.anwenden();
      expect(await vorhanden(offen)).toBe(true);
      expect(await bilder(offen)).toBe(1);
    });

    it("das Zugriffsprotokoll überlebt die Löschung der Meldung", async () => {
      await weitergabe(mandantAId, true);
      const id = await melde();
      await freigeben(id);
      await service("get", `/${id}`);
      await admin.query("UPDATE rueckmeldung SET status = 'umgesetzt', abgeschlossen_am = now() WHERE id = $1", [id]);
      await admin.query(`UPDATE rueckmeldung SET abgeschlossen_am = ${tageHer(400)} WHERE id = $1`, [id]);
      await loeschfrist.anwenden();
      expect(await vorhanden(id)).toBe(false);
      expect((await admin.query("SELECT 1 FROM rueckmeldung_service_zugriff WHERE rueckmeldung_id = $1", [id])).rowCount).toBe(1);
    });
  });
});
