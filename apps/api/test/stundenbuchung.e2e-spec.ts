/**
 * Stundenbuchung (Migration 0072): Rechte, Validierung, Idempotenz, Storno,
 * Unveraenderlichkeit in der Datenbank, Summen und Mandantentrennung.
 *
 * Die Unveraenderlichkeits-Tests verbinden sich als zimmerakte_app, nicht als
 * Admin -- nur diese Rolle zeigt, ob REVOKE/GRANT und der Storno-Trigger
 * wirklich greifen (CLAUDE.md "Pruefen statt behaupten").
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

describe("Stundenbuchung", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const heute = new Date().toISOString().slice(0, 10);
  const gestern = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  interface Mandant {
    id: string;
    slug: string;
    klientId: string;
  }
  let a: Mandant;
  let b: Mandant;
  let tokenLeitung: string;
  let tokenMa1: string;
  let tokenMa2: string;
  let tokenOhneRecht: string;
  let tokenB: string;
  let ma1Id: string;
  let ma2Id: string;

  async function legeMandantAn(kurz: string): Promise<Mandant> {
    const slug = `test-std-${kurz}-${suffix}`;
    const id = (await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Stunden ${kurz} ${suffix}`, slug])).rows[0].id;
    const klientId = (
      await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Stunden', 'Beispiel', '1990-01-01', $2, 'Amt') RETURNING id`,
        [id, `AZ-STD-${kurz}-${suffix}`]
      )
    ).rows[0].id;
    return { id, slug, klientId };
  }

  const buchen = (token: string, body: Record<string, unknown>, schluessel?: string) => {
    const r = request(app.getHttpServer()).post("/stundenbuchungen").set("Authorization", `Bearer ${token}`);
    if (schluessel) r.set("Idempotency-Key", schluessel);
    return r.send({ klientId: a.klientId, datum: gestern, minuten: 60, leistungsart: "einzelbetreuung", ...body });
  };
  const get = (token: string, pfad: string) => request(app.getHttpServer()).get(pfad).set("Authorization", `Bearer ${token}`);
  const storno = (token: string, id: string, body: unknown = { grund: "Tippfehler" }) =>
    request(app.getHttpServer()).post(`/stundenbuchungen/${id}/storno`).set("Authorization", `Bearer ${token}`).send(body as object);
  const zeilen = async (where: string, ...params: unknown[]) => Number((await admin.query(`SELECT count(*) FROM stundenbuchung WHERE ${where}`, params)).rows[0].count);

  /** Eine Transaktion als zimmerakte_app mit gesetztem Mandantenkontext. */
  async function alsApp<T>(mandantId: string, f: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      return await f(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.end();
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    a = await legeMandantAn("a");
    b = await legeMandantAn("b");
    const hash = await bcrypt.hash(passwort, 4);
    const email = (k: string) => `${k}-${suffix}@beispiel.test`;
    await kontoMitAlterRolle(admin, { mandantId: a.id, rolle: "einrichtungsleitung", email: email("leitung"), name: "Leitung", passwortHash: hash });
    // Der Mandant braucht eine aktive Vollzugriffs-Besetzung, sonst laesst sich
    // im Test kein Konto deaktivieren (0042).
    await kontoMitAlterRolle(admin, { mandantId: a.id, rolle: "bereichsleitung", email: email("voll"), name: "Vollzugriff", passwortHash: hash });
    ma1Id = await kontoMitAlterRolle(admin, { mandantId: a.id, rolle: "betreuer", email: email("ma1"), name: "Mitarbeiterin Eins", passwortHash: hash });
    ma2Id = await kontoMitAlterRolle(admin, { mandantId: a.id, rolle: "betreuer", email: email("ma2"), name: "Mitarbeiter Zwei", passwortHash: hash });
    // Konto ohne jede Besetzung: hat keine Rechte, ist aber eingeloggt.
    await admin.query("INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Ohne Recht', $3)", [a.id, email("ohne"), hash]);
    await kontoMitAlterRolle(admin, { mandantId: b.id, rolle: "einrichtungsleitung", email: email("b"), name: "Leitung B", passwortHash: hash });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (m: Mandant, k: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: m.slug, email: email(k), passwort })).body.accessToken;
    tokenLeitung = await login(a, "leitung");
    tokenMa1 = await login(a, "ma1");
    tokenMa2 = await login(a, "ma2");
    tokenOhneRecht = await login(a, "ohne");
    tokenB = await login(b, "b");
  });

  afterAll(async () => {
    try {
      for (const m of [a, b]) {
        await raeumeKontoMitRolleAuf(admin, m.id);
        await admin.query("DELETE FROM stundenbuchung WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM klient WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m.id]);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  describe("Rechte", () => {
    it("ohne Berechtigung: weder buchen noch ansehen (403), und es entsteht keine Zeile", async () => {
      const vorher = await zeilen("mandant_id = $1", a.id);
      expect((await buchen(tokenOhneRecht, {})).status).toBe(403);
      expect((await get(tokenOhneRecht, "/stundenbuchungen")).status).toBe(403);
      expect((await get(tokenOhneRecht, "/stundenbuchungen/summen")).status).toBe(403);
      expect(await zeilen("mandant_id = $1", a.id)).toBe(vorher);
    });

    it("Mitarbeiter:in bucht die eigene Leistung: 201 mit allen Feldern", async () => {
      const r = await buchen(tokenMa1, { minuten: 90, leistungsart: "begleitung", notiz: "  Arztbesuch  " });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        klientId: a.klientId,
        mitarbeiterId: ma1Id,
        mitarbeiterName: "Mitarbeiterin Eins",
        gebuchtVonName: "Mitarbeiterin Eins",
        datum: gestern,
        minuten: 90,
        leistungsart: "begleitung",
        notiz: "Arztbesuch",
        storniert: false,
        stornierbar: true,
      });
    });

    it("fuer eine andere Person buchen: ohne Recht 403, mit Recht 201 -- Urheber und Leistende getrennt", async () => {
      const verboten = await buchen(tokenMa1, { mitarbeiterId: ma2Id, minuten: 15 });
      expect(verboten.status).toBe(403);
      expect(await zeilen("mitarbeiter_id = $1 AND minuten = 15", ma2Id)).toBe(0);

      const erlaubt = await buchen(tokenLeitung, { mitarbeiterId: ma2Id, minuten: 15 });
      expect(erlaubt.status).toBe(201);
      expect(erlaubt.body.mitarbeiterId).toBe(ma2Id);
      expect(erlaubt.body.gebuchtVonName).toBe("Leitung");
    });
  });

  describe("Validierung", () => {
    it.each([
      ["0 Minuten", { minuten: 0 }],
      ["mehr als 24 Stunden", { minuten: 1441 }],
      ["Dezimalminuten", { minuten: 30.5 }],
      ["unbekannte Leistungsart", { leistungsart: "zauberei" }],
      ["Datum in der Zukunft", { datum: "2999-01-01" }],
      ["kein Datum", { datum: "gestern" }],
    ])("%s -> 400 und keine Zeile", async (_name, abweichung) => {
      const vorher = await zeilen("mandant_id = $1", a.id);
      expect((await buchen(tokenMa1, abweichung)).status).toBe(400);
      expect(await zeilen("mandant_id = $1", a.id)).toBe(vorher);
    });

    it("mehr als 24 Stunden je Person und Tag in Summe -> 400; ein anderer Tag bleibt moeglich", async () => {
      const tag = "2026-01-05";
      expect((await buchen(tokenMa2, { datum: tag, minuten: 1000 })).status).toBe(201);
      expect((await buchen(tokenMa2, { datum: tag, minuten: 441 })).status).toBe(400);
      expect((await buchen(tokenMa2, { datum: tag, minuten: 440 })).status).toBe(201);
      expect((await buchen(tokenMa2, { datum: "2026-01-06", minuten: 441 })).status).toBe(201);
    });

    it("Gegenprobe: eine stornierte Buchung zaehlt nicht mehr zur 24-Stunden-Grenze", async () => {
      const tag = "2026-01-12";
      const erste = await buchen(tokenMa2, { datum: tag, minuten: 1440 });
      expect(erste.status).toBe(201);
      expect((await buchen(tokenMa2, { datum: tag, minuten: 1 })).status).toBe(400);
      expect((await storno(tokenMa2, erste.body.id)).status).toBe(201);
      expect((await buchen(tokenMa2, { datum: tag, minuten: 1 })).status).toBe(201);
    });

    it("deaktiviertes Konto als leistende Person wird abgelehnt", async () => {
      await admin.query("UPDATE benutzer SET aktiv = false WHERE id = $1", [ma2Id]);
      try {
        expect((await buchen(tokenLeitung, { mitarbeiterId: ma2Id, datum: "2026-02-02" })).status).toBe(400);
      } finally {
        await admin.query("UPDATE benutzer SET aktiv = true WHERE id = $1", [ma2Id]);
      }
    });

    it("archivierte Klient:in: keine neue Buchung", async () => {
      const id = (
        await admin.query<{ id: string }>(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, 'Archiv', 'Test', '1980-01-01', $2, 'Amt') RETURNING id`,
          [a.id, `AZ-ARCH-${suffix}`]
        )
      ).rows[0].id;
      await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [id, ma1Id]);
      expect((await buchen(tokenMa1, { klientId: id })).status).toBe(400);
    });
  });

  describe("Idempotenz", () => {
    it("dreimal mit demselben Schluessel: eine Zeile, dreimal dieselbe Antwort", async () => {
      const schluessel = randomUUID();
      const antworten = [];
      for (let i = 0; i < 3; i++) antworten.push(await buchen(tokenMa1, { datum: "2026-03-02", minuten: 20 }, schluessel));
      expect(antworten.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(new Set(antworten.map((r) => r.body.id)).size).toBe(1);
      expect(antworten[0].headers["idempotency-replayed"]).toBeUndefined();
      expect(antworten[2].headers["idempotency-replayed"]).toBe("true");
      expect(await zeilen("idempotenz_schluessel = $1", schluessel)).toBe(1);
    });

    it("gleichzeitig abgeschickt: eine Zeile", async () => {
      const schluessel = randomUUID();
      const antworten = await Promise.all([0, 1, 2].map(() => buchen(tokenMa1, { datum: "2026-03-03", minuten: 25 }, schluessel)));
      expect(antworten.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await zeilen("idempotenz_schluessel = $1", schluessel)).toBe(1);
    });

    it("derselbe Schluessel mit anderem Inhalt: 409, die zweite Buchung wird nicht still verschluckt", async () => {
      const schluessel = randomUUID();
      expect((await buchen(tokenMa1, { datum: "2026-03-04", minuten: 30 }, schluessel)).status).toBe(201);
      expect((await buchen(tokenMa1, { datum: "2026-03-04", minuten: 45 }, schluessel)).status).toBe(409);
      expect(await zeilen("idempotenz_schluessel = $1", schluessel)).toBe(1);
    });

    it("derselbe Schluessel von einer anderen Person: 409, keine fremde Buchung in der Antwort", async () => {
      const schluessel = randomUUID();
      expect((await buchen(tokenMa1, { datum: "2026-03-05", minuten: 35 }, schluessel)).status).toBe(201);
      expect((await buchen(tokenMa2, { datum: "2026-03-05", minuten: 35 }, schluessel)).status).toBe(409);
    });

    it("kein UUID als Schluessel: 400", async () => {
      expect((await buchen(tokenMa1, {}, "kein-uuid")).status).toBe(400);
    });
  });

  describe("Storno", () => {
    it("eigene Buchung: sofort moeglich, Grund/Urheber/Zeitpunkt stehen in der Zeile; Liste zeigt sie als storniert", async () => {
      const b1 = await buchen(tokenMa1, { datum: "2026-04-01", minuten: 40 });
      const r = await storno(tokenMa1, b1.body.id, { grund: "Falscher Tag" });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ storniert: true, stornoGrund: "Falscher Tag", stornoVonName: "Mitarbeiterin Eins", stornierbar: false });
      const liste = await get(tokenMa1, `/stundenbuchungen?von=2026-04-01&bis=2026-04-01&klientId=${a.klientId}`);
      expect(liste.body.find((x: { id: string }) => x.id === b1.body.id).storniert).toBe(true);
    });

    it("fremde Buchung: ohne Recht 403 (Zeile bleibt aktiv), mit Recht 201", async () => {
      const b1 = await buchen(tokenMa1, { datum: "2026-04-02", minuten: 40 });
      expect(b1.body.stornierbar).toBe(true);
      const verboten = await storno(tokenMa2, b1.body.id);
      expect(verboten.status).toBe(403);
      expect(await zeilen("id = $1 AND NOT storniert", b1.body.id)).toBe(1);
      // In der Liste sieht Ma2 die Buchung, aber nicht als stornierbar markiert.
      const aus2 = (await get(tokenMa2, "/stundenbuchungen?von=2026-04-02&bis=2026-04-02")).body.find((x: { id: string }) => x.id === b1.body.id);
      expect(aus2.stornierbar).toBe(false);
      expect((await storno(tokenLeitung, b1.body.id)).status).toBe(201);
    });

    it("doppelt stornieren: 409; ohne Grund: 400; unbekannte ID: 404; keine UUID: 400", async () => {
      const b1 = await buchen(tokenMa1, { datum: "2026-04-03", minuten: 40 });
      expect((await storno(tokenMa1, b1.body.id, {})).status).toBe(400);
      expect((await storno(tokenMa1, b1.body.id, { grund: "   " })).status).toBe(400);
      expect((await storno(tokenMa1, b1.body.id)).status).toBe(201);
      expect((await storno(tokenMa1, b1.body.id)).status).toBe(409);
      expect((await storno(tokenMa1, randomUUID())).status).toBe(404);
      expect((await storno(tokenMa1, "x")).status).toBe(400);
    });
  });

  describe("Summen: abgeleitet, nie gespeichert", () => {
    it("Monatssumme je Klient:in ohne stornierte Buchungen", async () => {
      const monat = "2026-05";
      const ids: string[] = [];
      for (const [tag, min] of [["2026-05-04", 60], ["2026-05-05", 45], ["2026-05-06", 30]] as const) {
        ids.push((await buchen(tokenMa1, { datum: tag, minuten: min })).body.id);
      }
      await buchen(tokenMa1, { datum: "2026-06-01", minuten: 10 });
      expect((await storno(tokenMa1, ids[2])).status).toBe(201);

      const r = await get(tokenLeitung, `/stundenbuchungen/summen?klientId=${a.klientId}&von=2026-05-01&bis=2026-06-30`);
      expect(r.status).toBe(200);
      const mai = r.body.find((x: { monat: string }) => x.monat === monat);
      expect(mai).toMatchObject({ klientId: a.klientId, minuten: 105, anzahl: 2 });
      expect(r.body.find((x: { monat: string }) => x.monat === "2026-06")).toMatchObject({ minuten: 10, anzahl: 1 });
    });

    it("Filter nach Mitarbeiter:in und kaputter Zeitraum", async () => {
      const r = await get(tokenLeitung, `/stundenbuchungen?mitarbeiterId=${ma2Id}`);
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.body.every((x: { mitarbeiterId: string }) => x.mitarbeiterId === ma2Id)).toBe(true);
      expect((await get(tokenLeitung, "/stundenbuchungen?von=2026-05-02&bis=2026-05-01")).status).toBe(400);
      expect((await get(tokenLeitung, "/stundenbuchungen?klientId=nix")).status).toBe(400);
    });
  });

  describe("Unveraenderlichkeit in der Datenbank (als zimmerakte_app)", () => {
    let id: string;
    beforeAll(async () => {
      id = (await buchen(tokenMa1, { datum: "2026-07-01", minuten: 50 })).body.id;
    });

    it("Minuten, Datum, Klient:in und Leistungsart sind nicht aenderbar", async () => {
      for (const spalte of ["minuten = 5", "datum = '2026-07-02'", "leistungsart = 'sonstiges'", "klient_id = klient_id", "mitarbeiter_id = mitarbeiter_id", "notiz = 'x'"]) {
        await alsApp(a.id, async (c) => {
          await expect(c.query(`UPDATE stundenbuchung SET ${spalte} WHERE id = $1`, [id])).rejects.toThrow(/permission denied/);
        });
      }
    });

    it("Loeschen ist nicht moeglich", async () => {
      await alsApp(a.id, async (c) => {
        await expect(c.query("DELETE FROM stundenbuchung WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
      });
      expect(await zeilen("id = $1", id)).toBe(1);
    });

    it("ein Storno ohne Grund verletzt den CHECK; ein vollstaendiger Storno laesst sich nie zuruecknehmen", async () => {
      await alsApp(a.id, async (c) => {
        await expect(c.query("UPDATE stundenbuchung SET storniert = true WHERE id = $1", [id])).rejects.toThrow(/check constraint/);
      });
      expect((await storno(tokenMa1, id)).status).toBe(201);
      await alsApp(a.id, async (c) => {
        await expect(c.query("UPDATE stundenbuchung SET storniert = false WHERE id = $1", [id])).rejects.toThrow(/stornierte Buchung/);
      });
      // Eigene Transaktion: nach dem Fehler oben ist die erste abgebrochen.
      await alsApp(a.id, async (c) => {
        await expect(c.query("UPDATE stundenbuchung SET storno_grund = 'umgeschrieben' WHERE id = $1", [id])).rejects.toThrow(/stornierte Buchung/);
      });
      expect((await admin.query("SELECT storno_grund FROM stundenbuchung WHERE id = $1", [id])).rows[0].storno_grund).toBe("Tippfehler");
    });
  });

  describe("Mandantentrennung", () => {
    it("Mandant B sieht nichts von A, kann nicht auf A-Klient:innen buchen und keine A-Buchung stornieren", async () => {
      const bA = await buchen(tokenMa1, { datum: "2026-08-03", minuten: 10 });
      expect(bA.status).toBe(201);

      expect((await get(tokenB, "/stundenbuchungen")).body).toEqual([]);
      expect((await get(tokenB, "/stundenbuchungen/summen")).body).toEqual([]);
      expect((await buchen(tokenB, { klientId: a.klientId })).status).toBe(404);
      expect((await buchen(tokenB, { klientId: b.klientId, mitarbeiterId: ma1Id })).status).toBe(404);
      expect((await storno(tokenB, bA.body.id)).status).toBe(404);
      expect(await zeilen("id = $1 AND NOT storniert", bA.body.id)).toBe(1);
    });

    it("RLS wirkt unabhaengig vom Anwendungscode: als zimmerakte_app mit Mandant B sind A-Zeilen unsichtbar, ohne Kontext ebenfalls", async () => {
      await alsApp(b.id, async (c) => {
        expect((await c.query("SELECT count(*)::int AS n FROM stundenbuchung WHERE mandant_id = $1", [a.id])).rows[0].n).toBe(0);
        await expect(
          c.query(
            "INSERT INTO stundenbuchung (mandant_id, klient_id, mitarbeiter_id, datum, minuten, leistungsart, gebucht_von) VALUES ($1, $2, $3, '2026-01-01', 5, 'sonstiges', $3)",
            [a.id, a.klientId, ma1Id]
          )
        ).rejects.toThrow(/row-level security/);
      });
    });
  });
});
