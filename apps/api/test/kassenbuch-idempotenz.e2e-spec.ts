/**
 * Offlinebetrieb, Serverseite (Bauplan Phase 4): "eine im Flugmodus erfasste
 * Auszahlung kommt nach dem Wiederverbinden genau einmal an -- auch wenn der
 * Uebertragungsversuch dreimal ausgeloest wird." Die Warteschlange im
 * Web-Client schickt jeden Versuch mit demselben Idempotency-Key; hier wird
 * gezaehlt, wie viele Zeilen in der Datenbank tatsaechlich entstehen --
 * nacheinander, gleichzeitig, und an den Raendern (anderer Inhalt, andere
 * Person, anderer Mandant).
 *
 * Bewusst mit einer Auszahlung vom Typ "Sonstiges" statt HZL: fuer HZL haelt
 * schon hzl_einmal_je_woche (0011) jede zweite Zeile ab, ein gruener Test
 * wuerde dort nichts ueber den neuen Index beweisen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { fingerabdruck } from "../src/kassenbuch/kassenbuchung.service";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

const TEST_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("Kassenbuch: Idempotenz fuer die Offline-Warteschlange", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  interface Mandant {
    id: string;
    slug: string;
    klientId: string;
    sonstigesTypId: string;
    hzlTypId: string;
  }
  let a: Mandant;
  let b: Mandant;
  let tokenA: string;
  let tokenA2: string;
  let tokenB: string;

  async function legeMandantAn(kurz: string): Promise<Mandant> {
    const slug = `test-idem-${kurz}-${suffix}`;
    const id = (
      await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Idempotenz ${kurz} ${suffix}`, slug])
    ).rows[0].id;
    const klientId = (
      await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, 'Offline', 'Beispiel', '1990-01-01', $2, 'Amt', 'woechentlich') RETURNING id`,
        [id, `AZ-IDEM-${kurz}-${suffix}`]
      )
    ).rows[0].id;
    const typen = await admin.query<{ id: string; bezeichnung: string }>("SELECT id, bezeichnung FROM kassenbuchung_typ WHERE mandant_id = $1", [id]);
    return {
      id,
      slug,
      klientId,
      sonstigesTypId: typen.rows.find((t) => t.bezeichnung === "Sonstiges")!.id,
      hzlTypId: typen.rows.find((t) => t.bezeichnung === "HZL")!.id,
    };
  }

  const post = (token: string, schluessel: string | null, body: unknown) => {
    const r = request(app.getHttpServer()).post("/kassenbuchungen").set("Authorization", `Bearer ${token}`);
    if (schluessel) r.set("Idempotency-Key", schluessel);
    return r.send(body as object);
  };

  const auszahlung = (m: Mandant, extra: Record<string, unknown> = {}) => ({
    klientId: m.klientId,
    datum: "2026-10-20",
    betragCent: -1500,
    verwendungszweck: "Fahrkarte",
    typId: m.sonstigesTypId,
    unterschriftBase64: TEST_PNG_BASE64,
    ...extra,
  });

  const zeilenMitSchluessel = async (schluessel: string) =>
    Number((await admin.query("SELECT count(*) FROM kassenbuchung WHERE idempotenz_schluessel = $1", [schluessel])).rows[0].count);
  const zeilenMitZweck = async (m: Mandant, zweck: string) =>
    Number(
      (await admin.query("SELECT count(*) FROM kassenbuchung WHERE mandant_id = $1 AND verwendungszweck = $2", [m.id, zweck])).rows[0].count
    );
  const zaehlerstand = async (m: Mandant) =>
    Number((await admin.query("SELECT letzte FROM kassenbuch_nummernkreis WHERE mandant_id = $1", [m.id])).rows[0]?.letzte ?? 0);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    a = await legeMandantAn("a");
    b = await legeMandantAn("b");
    const hash = await bcrypt.hash(passwort, 4);
    for (const [m, kurz] of [
      [a, "a1"],
      [a, "a2"],
      [b, "b1"],
    ] as const) {
      await kontoMitAlterRolle(admin, { mandantId: m.id, rolle: "bereichsleitung", email: `${kurz}-${suffix}@beispiel.test`, name: kurz, passwortHash: hash });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (m: Mandant, kurz: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: m.slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body
        .accessToken;
    tokenA = await login(a, "a1");
    tokenA2 = await login(a, "a2");
    tokenB = await login(b, "b1");
  });

  afterAll(async () => {
    try {
      for (const m of [a, b]) {
        await raeumeKontoMitRolleAuf(admin, m.id);
        await admin.query("DELETE FROM unterschrift WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [m.id]);
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

  it("dreimal nacheinander gesendet: genau eine Buchung, dreimal dieselbe Antwort, keine verbrauchte Belegnummer", async () => {
    const schluessel = randomUUID();
    const vorher = await zaehlerstand(a);

    const antworten = [];
    for (let i = 0; i < 3; i++) antworten.push(await post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "dreimal nacheinander" })));

    expect(antworten.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(antworten.map((r) => r.body.id)).size).toBe(1);
    expect(new Set(antworten.map((r) => r.body.belegnummer)).size).toBe(1);
    expect(antworten[0].headers["idempotency-replayed"]).toBeUndefined();
    expect(antworten[1].headers["idempotency-replayed"]).toBe("true");
    expect(antworten[2].headers["idempotency-replayed"]).toBe("true");
    expect(await zeilenMitSchluessel(schluessel)).toBe(1);
    // Lueckenlose Belegnummer (0059): eine Wiederholung darf keine Nummer ziehen.
    expect(await zaehlerstand(a)).toBe(vorher + 1);
  });

  // Abgeschickt wie zwei Tabs plus ein Tippen auf "Jetzt übertragen". Ob
  // sich die drei dabei wirklich ueberholen, entscheidet der Zufall -- das
  // erzwungene Rennen steht im naechsten Test.
  it("dreimal parallel abgeschickt: genau eine Buchung, alle drei 201 mit derselben ID", async () => {
    const schluessel = randomUUID();
    const antworten = await Promise.all(
      [0, 1, 2].map(() => post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "dreimal gleichzeitig" })))
    );
    expect(antworten.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(antworten.map((r) => r.body.id)).size).toBe(1);
    expect(await zeilenMitSchluessel(schluessel)).toBe(1);
    expect(await zeilenMitZweck(a, "dreimal gleichzeitig")).toBe(1);
  });

  it("echtes Wettrennen: die Anfrage wartet am Index auf eine offene Transaktion mit demselben Schluessel -- danach Wiederholung, keine zweite Zeile", async () => {
    // Die Tests mit Promise.all oben laufen im selben Prozess und ueberholen
    // sich in der Praxis nicht (Gegenprobe: ohne den eindeutigen Index blieben
    // sie gruen). Hier wird das Rennen erzwungen: eine zweite Verbindung hat
    // die Buchung unter dem Schluessel schon geschrieben, aber noch nicht
    // committet. Die Anfrage sieht sie bei der Vorab-Suche nicht, laeuft bis
    // zum INSERT und MUSS dort am Index warten. Erst dann wird committet.
    const schluessel = randomUUID();
    const body = auszahlung(a, { verwendungszweck: "erzwungenes Rennen" });
    const benutzerId = (await admin.query<{ id: string }>("SELECT id FROM benutzer WHERE email = $1", [`a1-${suffix}@beispiel.test`])).rows[0].id;

    const andere = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await andere.connect();
    try {
      await andere.query("BEGIN");
      const vorhandeneId = (
        await andere.query<{ id: string }>(
          `INSERT INTO kassenbuchung (mandant_id, klient_id, datum, betrag_cent, verwendungszweck, typ_id, ist_hzl, gebucht_von,
                                      idempotenz_schluessel, idempotenz_fingerabdruck)
           VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9) RETURNING id`,
          [a.id, a.klientId, body.datum, body.betragCent, body.verwendungszweck, a.sonstigesTypId, benutzerId, schluessel, fingerabdruck(body)]
        )
      ).rows[0].id;

      const anfrage = post(tokenA, schluessel, body).then((r) => r);
      let wartetAmIndex = false;
      for (let i = 0; i < 100 && !wartetAmIndex; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const { rows } = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE usename = 'zimmerakte_app' AND wait_event_type = 'Lock' AND query LIKE 'INSERT INTO kassenbuchung %'"
        );
        wartetAmIndex = rows.length > 0;
      }
      expect(wartetAmIndex).toBe(true);
      await andere.query("COMMIT");

      const res = await anfrage;
      expect(res.status).toBe(201);
      expect(res.headers["idempotency-replayed"]).toBe("true");
      expect(res.body.id).toBe(vorhandeneId);
      expect(await zeilenMitSchluessel(schluessel)).toBe(1);
    } finally {
      await andere.query("ROLLBACK").catch(() => {});
      await andere.end();
    }
  });

  it("HZL gleichzeitig mit demselben Schluessel: Wiederholung statt 409 -- egal, welcher Index zuerst anschlaegt", async () => {
    const schluessel = randomUUID();
    const hzl = auszahlung(a, { typId: a.hzlTypId, verwendungszweck: "HZL", isoJahr: 2026, isoWoche: 43, betragCent: -2000 });
    const antworten = await Promise.all([0, 1, 2].map(() => post(tokenA, schluessel, hzl)));
    expect(antworten.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await zeilenMitSchluessel(schluessel)).toBe(1);
  });

  it("HZL bleibt doppelt abgesichert: zweite Auszahlung derselben Woche mit NEUEM Schluessel ist weiter 409", async () => {
    const hzl = auszahlung(a, { typId: a.hzlTypId, verwendungszweck: "HZL", isoJahr: 2026, isoWoche: 44, betragCent: -2000 });
    expect((await post(tokenA, randomUUID(), hzl)).status).toBe(201);
    const zweite = await post(tokenA, randomUUID(), hzl);
    expect(zweite.status).toBe(409);
    expect(zweite.body.message).toMatch(/HZL/);
  });

  it("gleicher Schluessel, anderer Inhalt: 409 und keine zweite Buchung", async () => {
    const schluessel = randomUUID();
    expect((await post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "Inhalt eins" }))).status).toBe(201);
    const anders = await post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "Inhalt eins", betragCent: -9900 }));
    expect(anders.status).toBe(409);
    expect(anders.body.message).toMatch(/Idempotenzschlüssel/);
    expect(await zeilenMitSchluessel(schluessel)).toBe(1);
  });

  it("Zweck mit Leerzeichen gilt als derselbe Inhalt (normalisiert wie anlegen())", async () => {
    const schluessel = randomUUID();
    expect((await post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "Normalisiert" }))).status).toBe(201);
    const wieder = await post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "  Normalisiert  " }));
    expect(wieder.status).toBe(201);
    expect(wieder.headers["idempotency-replayed"]).toBe("true");
    expect(await zeilenMitSchluessel(schluessel)).toBe(1);
  });

  it("gleicher Schluessel von einer ANDEREN Person desselben Mandanten: 409, die fremde Buchung wird nicht ausgeliefert", async () => {
    const schluessel = randomUUID();
    const body = auszahlung(a, { verwendungszweck: "Person eins" });
    expect((await post(tokenA, schluessel, body)).status).toBe(201);
    const fremd = await post(tokenA2, schluessel, body);
    expect(fremd.status).toBe(409);
    expect(fremd.body.id).toBeUndefined();
    expect(await zeilenMitSchluessel(schluessel)).toBe(1);
  });

  it("gleicher Schluessel in einem anderen Mandanten: unabhaengig, beide buchen -- nichts ueber die Grenze sichtbar", async () => {
    const schluessel = randomUUID();
    const inA = await post(tokenA, schluessel, auszahlung(a, { verwendungszweck: "Mandantengrenze" }));
    const inB = await post(tokenB, schluessel, auszahlung(b, { verwendungszweck: "Mandantengrenze" }));
    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
    expect(inB.headers["idempotency-replayed"]).toBeUndefined();
    expect(inB.body.id).not.toBe(inA.body.id);
    expect(await zeilenMitSchluessel(schluessel)).toBe(2);
  });

  it("eine Wiederholung gilt auch dann, wenn der Klient inzwischen archiviert wurde", async () => {
    const klientId = (
      await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, 'Spaeter', 'Archiviert', '1990-01-01', $2, 'Amt', 'woechentlich') RETURNING id`,
        [a.id, `AZ-IDEM-ARCH-${suffix}`]
      )
    ).rows[0].id;
    const schluessel = randomUUID();
    const body = auszahlung(a, { klientId, verwendungszweck: "vor Archivierung" });
    expect((await post(tokenA, schluessel, body)).status).toBe(201);
    await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = (SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1) WHERE id = $2", [
      a.id,
      klientId,
    ]);
    const wieder = await post(tokenA, schluessel, body);
    expect(wieder.status).toBe(201);
    expect(wieder.headers["idempotency-replayed"]).toBe("true");
  });

  it("ohne Schluessel bleibt alles wie bisher: zwei gleiche Posts ergeben zwei Buchungen", async () => {
    const body = auszahlung(a, { verwendungszweck: "ohne Schluessel" });
    expect((await post(tokenA, null, body)).status).toBe(201);
    expect((await post(tokenA, null, body)).status).toBe(201);
    expect(await zeilenMitZweck(a, "ohne Schluessel")).toBe(2);
  });

  it("ein Schluessel, der keine UUID ist: 400 und keine Buchung", async () => {
    const res = await post(tokenA, "nochmal-bitte", auszahlung(a, { verwendungszweck: "kaputter Schluessel" }));
    expect(res.status).toBe(400);
    expect(await zeilenMitZweck(a, "kaputter Schluessel")).toBe(0);
  });

  it("eine Auszahlung ohne Unterschrift wird auch mit Schluessel nicht gespeichert", async () => {
    const schluessel = randomUUID();
    const res = await post(tokenA, schluessel, auszahlung(a, { unterschriftBase64: undefined, verwendungszweck: "ohne Unterschrift" }));
    expect(res.status).toBe(400);
    expect(await zeilenMitSchluessel(schluessel)).toBe(0);
  });

  it("die App-Rolle kann den Schluessel einer Buchung nicht nachtraeglich aendern", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [a.id]);
      await expect(app_.query("UPDATE kassenbuchung SET idempotenz_schluessel = gen_random_uuid()")).rejects.toThrow(/permission denied/);
    } finally {
      await app_.query("ROLLBACK");
      await app_.end();
    }
  });
});
