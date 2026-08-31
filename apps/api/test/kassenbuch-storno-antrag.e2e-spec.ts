/**
 * Storno-Antragsworkflow (Migration 0031, kassenbuchung.service.ts
 * stornoBeantragen()/stornoEntscheiden()): ein Betreuer durfte bislang gar
 * nicht stornieren, jetzt darf er einen Antrag stellen -- entscheiden darf
 * weiterhin nur Bereichs- oder Einrichtungsleitung. Bei einer Leitung wird
 * der eigene Antrag im selben Zug automatisch bewilligt (kein Sinn, auf die
 * eigene Bewilligung zu warten); bei einem Betreuer bleibt er offen.
 *
 * Aufbau: zwei Standorte S1/S2, je ein Klient mit einer Buchung, dazu
 * "einrichtungsleitung-s1" (auf S1 eingeschraenkt) als Gegenprobe zur
 * unrestricted "bereichsleitung" -- dasselbe Standort-Muster wie
 * standort-einschraenkung.e2e-spec.ts, hier aber fokussiert auf den
 * Entscheidungspfad (wer DARF entscheiden, nicht nur wer SIEHT).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Kassenbuch: Storno-Antragsworkflow", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBetreuer: string;

  let standort1Id: string;
  let standort2Id: string;
  let klient1: string;
  let klient2: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Storno ${suffix}`, `test-storno-${suffix}`]
    );
    mandantId = mandantRows[0].id;

    async function neuerBenutzer(rolle: string, emailPrefix: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, `${emailPrefix}-${suffix}@beispiel.test`, `${emailPrefix} Test`, passwortHash, rolle]
      );
      return rows[0].id;
    }
    const bereichsleitungId = await neuerBenutzer("bereichsleitung", "bereichsleitung");
    const einrichtungsleitungS1Id = await neuerBenutzer("einrichtungsleitung", "einrichtungsleitung-s1");
    const betreuerId = await neuerBenutzer("betreuer", "betreuer");

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    standort1Id = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    standort2Id = standort2Rows[0].id;

    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId,
      einrichtungsleitungS1Id,
      standort1Id,
    ]);

    async function neuerKlient(name: string, standortId: string): Promise<string> {
      const { rows: klientRows } = await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, $2, 'Test', '1990-01-01', $3, 'Testamt') RETURNING id`,
        [mandantId, name, `AZ-${name}-${suffix}`]
      );
      const klientId = klientRows[0].id;
      const { rows: zimmerRows } = await admin.query<{ id: string }>(
        "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id",
        [mandantId, standortId, `Zi-${name}`]
      );
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
        mandantId,
        zimmerRows[0].id,
        klientId,
      ]);
      return klientId;
    }
    klient1 = await neuerKlient("Eins", standort1Id);
    klient2 = await neuerKlient("Zwei", standort2Id);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const { rows: slugRows } = await admin.query<{ slug: string }>("SELECT slug FROM mandant WHERE id = $1", [mandantId]);
    const mandantSlug = slugRows[0].slug;
    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken;
    }
    tokenBereichsleitung = await login(`bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`einrichtungsleitung-s1-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`betreuer-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM kassenbuchung_stornoantrag WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown>) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
    };
  }

  async function neueBuchung(klientId: string, zweck: string): Promise<string> {
    const res = await als(tokenBereichsleitung).post("/kassenbuchungen", {
      klientId,
      datum: "2026-08-30",
      betragCent: 500,
      verwendungszweck: zweck,
      typ: "einzahlung",
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it("Betreuer stellt einen Antrag -- die Buchung bleibt aktiv, bis eine Leitung entscheidet", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung A");
    const res = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, {
      grund: "Falscher Betrag",
    });
    expect(res.status).toBe(201);
    expect(res.body.storniert).toBe(false);
    expect(res.body.offenerStornoantrag).toMatchObject({ grund: "Falscher Betrag", beantragtVonName: "betreuer Test" });
  });

  it("Betreuer darf nicht selbst entscheiden -- 403, Buchung bleibt unveraendert", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung B");
    const antrag = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, { grund: "Grund" });
    const antragId = antrag.body.offenerStornoantrag.id;

    const res = await als(tokenBetreuer).patch(`/kassenbuchungen/storno-antraege/${antragId}`, {
      entscheidung: "genehmigt",
    });
    expect(res.status).toBe(403);

    const geladen = await als(tokenBereichsleitung).get("/kassenbuchungen");
    const buchung = geladen.body.find((b: { id: string }) => b.id === buchungId);
    expect(buchung.storniert).toBe(false);
    expect(buchung.offenerStornoantrag).not.toBeNull();
  });

  it("Bereichsleitung genehmigt den Antrag eines Betreuers -- Buchung wird storniert", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung C");
    const antrag = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, { grund: "Grund C" });
    const antragId = antrag.body.offenerStornoantrag.id;

    const res = await als(tokenBereichsleitung).patch(`/kassenbuchungen/storno-antraege/${antragId}`, {
      entscheidung: "genehmigt",
    });
    expect(res.status).toBe(200);
    expect(res.body.storniert).toBe(true);
    expect(res.body.stornoGrund).toBe("Grund C");
    expect(res.body.offenerStornoantrag).toBeNull();
  });

  it("Bereichsleitung lehnt einen Antrag ab -- Grund ist Pflicht, Buchung bleibt aktiv", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung D");
    const antrag = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, { grund: "Grund D" });
    const antragId = antrag.body.offenerStornoantrag.id;

    const ohneGrund = await als(tokenBereichsleitung).patch(`/kassenbuchungen/storno-antraege/${antragId}`, {
      entscheidung: "abgelehnt",
    });
    expect(ohneGrund.status).toBe(400);

    const mitGrund = await als(tokenBereichsleitung).patch(`/kassenbuchungen/storno-antraege/${antragId}`, {
      entscheidung: "abgelehnt",
      grund: "Beleg fehlt",
    });
    expect(mitGrund.status).toBe(200);
    expect(mitGrund.body.storniert).toBe(false);
    expect(mitGrund.body.offenerStornoantrag).toBeNull();

    // Nach einer Ablehnung darf erneut beantragt werden.
    const zweiterAntrag = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, {
      grund: "Zweiter Versuch",
    });
    expect(zweiterAntrag.status).toBe(201);
    expect(zweiterAntrag.body.offenerStornoantrag.grund).toBe("Zweiter Versuch");
  });

  it("lehnt einen zweiten gleichzeitig offenen Antrag fuer dieselbe Buchung ab (409)", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung E");
    const erster = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, { grund: "Erster" });
    expect(erster.status).toBe(201);

    const zweiter = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, { grund: "Zweiter" });
    expect(zweiter.status).toBe(409);
  });

  it("Bereichsleitung storniert direkt -- ihr eigener Antrag wird im selben Zug bewilligt", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung F");
    const res = await als(tokenBereichsleitung).post(`/kassenbuchungen/${buchungId}/storno-antrag`, {
      grund: "Direkt storniert",
    });
    expect(res.status).toBe(201);
    expect(res.body.storniert).toBe(true);
    expect(res.body.offenerStornoantrag).toBeNull();
  });

  it("Einrichtungsleitung-S1 darf ueber einen Antrag ihres Standorts entscheiden, nicht ueber einen fremden", async () => {
    const eigeneBuchung = await neueBuchung(klient1, "Testbuchung G (S1)");
    const fremdeBuchung = await neueBuchung(klient2, "Testbuchung H (S2)");

    const eigenerAntrag = await als(tokenBetreuer).post(`/kassenbuchungen/${eigeneBuchung}/storno-antrag`, {
      grund: "S1-Antrag",
    });
    const fremderAntrag = await als(tokenBetreuer).post(`/kassenbuchungen/${fremdeBuchung}/storno-antrag`, {
      grund: "S2-Antrag",
    });

    const eigeneEntscheidung = await als(tokenEinrichtungsleitungS1).patch(
      `/kassenbuchungen/storno-antraege/${eigenerAntrag.body.offenerStornoantrag.id}`,
      { entscheidung: "genehmigt" }
    );
    expect(eigeneEntscheidung.status).toBe(200);
    expect(eigeneEntscheidung.body.storniert).toBe(true);

    const fremdeEntscheidung = await als(tokenEinrichtungsleitungS1).patch(
      `/kassenbuchungen/storno-antraege/${fremderAntrag.body.offenerStornoantrag.id}`,
      { entscheidung: "genehmigt" }
    );
    expect(fremdeEntscheidung.status).toBe(404);

    // Gegenprobe: Bereichsleitung darf standortuebergreifend genau diesen
    // Antrag entscheiden, den Einrichtungsleitung-S1 eben nicht durfte.
    const bereichsleitungEntscheidung = await als(tokenBereichsleitung).patch(
      `/kassenbuchungen/storno-antraege/${fremderAntrag.body.offenerStornoantrag.id}`,
      { entscheidung: "genehmigt" }
    );
    expect(bereichsleitungEntscheidung.status).toBe(200);
    expect(bereichsleitungEntscheidung.body.storniert).toBe(true);
  });

  it("verweigert der App-Datenbankrolle Aenderungen an Grund/Antragsteller eines Storno-Antrags", async () => {
    const buchungId = await neueBuchung(klient1, "Testbuchung I");
    const antrag = await als(tokenBetreuer).post(`/kassenbuchungen/${buchungId}/storno-antrag`, { grund: "Grund I" });
    const antragId = antrag.body.offenerStornoantrag.id;

    const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query("UPDATE kassenbuchung_stornoantrag SET grund = 'manipuliert' WHERE id = $1", [antragId])
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");

      // Gegenprobe zum GRANT: die freigegebene Spalte "status" muss
      // weiterhin aenderbar sein -- sonst waere der Test oben nur deshalb
      // gruen, weil appClient generell keine Rechte auf der Tabelle hat.
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      const erlaubt = await appClient.query(
        "UPDATE kassenbuchung_stornoantrag SET status = 'abgelehnt', ablehnung_grund = 'x', entschieden_von = beantragt_von, entschieden_am = now() WHERE id = $1",
        [antragId]
      );
      expect(erlaubt.rowCount).toBe(1);
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }
  });
});
