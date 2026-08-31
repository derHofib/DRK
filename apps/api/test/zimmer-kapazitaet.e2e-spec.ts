/**
 * Zimmer-Kapazitaet (Migration 0032): ein Zimmer kann jetzt mehr als eine
 * Person gleichzeitig tragen. Zwei getrennte Sicherheitsfragen werden hier
 * geprueft:
 * 1. Die Kapazitaetsgrenze selbst -- durchgesetzt per Trigger statt EXCLUDE-
 *    Constraint (der kann "hoechstens N" nicht ausdruecken), inklusive
 *    Race-Condition-Test unter echter Nebenlaeufigkeit.
 * 2. Das Vier-Augen-Prinzip beim AENDERN einer Kapazitaet: wer sie aendert,
 *    kann sie nicht selbst bestaetigen -- das muss zwingend die jeweils
 *    ANDERE Leitungsrolle tun. Anders als beim Kassenbuch-Storno-Antrag
 *    gibt es hier keine Selbstbewilligung.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Zimmer: Kapazitaet und Vier-Augen-Aenderung", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBetreuer: string;

  let standort1Id: string;
  let standort2Id: string;
  let klientIds: string[];

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Kapazitaet ${suffix}`, `test-kapazitaet-${suffix}`]
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
    await neuerBenutzer("bereichsleitung", "bereichsleitung");
    const einrichtungsleitungS1Id = await neuerBenutzer("einrichtungsleitung", "einrichtungsleitung-s1");
    await neuerBenutzer("betreuer", "betreuer");

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

    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       SELECT $1, 'Test', n::text, '1990-01-01', 'AZ-' || $2 || '-' || n, 'Testamt'
       FROM generate_series(1, 6) AS n
       RETURNING id`,
      [mandantId, suffix]
    );
    klientIds = klientRows.map((r) => r.id);

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
    await admin.query("DELETE FROM zimmer_kapazitaetsantrag WHERE mandant_id = $1", [mandantId]);
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
      post: (path: string, body: Record<string, unknown> = {}) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown> = {}) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
    };
  }

  async function neuesZimmer(standortId: string, kapazitaet?: number): Promise<string> {
    const res = await als(tokenBereichsleitung).post("/zimmer", {
      standortId,
      nummer: `Zi-${randomUUID().slice(0, 8)}`,
      ...(kapazitaet ? { kapazitaet } : {}),
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it("legt ein Zimmer mit Kapazität 2 an -- Standard ist 1, wenn nichts angegeben ist", async () => {
    const mitKapazitaet = await als(tokenBereichsleitung).post("/zimmer", {
      standortId: standort1Id,
      nummer: `Zi-${randomUUID().slice(0, 8)}`,
      kapazitaet: 2,
    });
    expect(mitKapazitaet.status).toBe(201);
    expect(mitKapazitaet.body.kapazitaet).toBe(2);

    const ohneKapazitaet = await als(tokenBereichsleitung).post("/zimmer", {
      standortId: standort1Id,
      nummer: `Zi-${randomUUID().slice(0, 8)}`,
    });
    expect(ohneKapazitaet.status).toBe(201);
    expect(ohneKapazitaet.body.kapazitaet).toBe(1);
  });

  it("erlaubt zwei Bewohner in einem Zimmer mit Kapazität 2, lehnt den dritten ab", async () => {
    const zimmerId = await neuesZimmer(standort1Id, 2);

    const erster = await als(tokenBereichsleitung).post("/belegungen", {
      zimmerId,
      klientId: klientIds[0],
      einzug: "2024-01-01",
    });
    expect(erster.status).toBe(201);

    const zweiter = await als(tokenBereichsleitung).post("/belegungen", {
      zimmerId,
      klientId: klientIds[1],
      einzug: "2024-01-01",
    });
    expect(zweiter.status).toBe(201);

    const liste = await als(tokenBereichsleitung).get("/zimmer");
    const zimmer = liste.body.find((z: { id: string }) => z.id === zimmerId);
    expect(zimmer.status).toBe("vergeben");
    expect(zimmer.bewohner).toHaveLength(2);

    const dritter = await als(tokenBereichsleitung).post("/belegungen", {
      zimmerId,
      klientId: klientIds[2],
      einzug: "2024-01-01",
    });
    expect(dritter.status).toBe(409);
    expect(dritter.body.message).toMatch(/keine freien Plätze/i);
  });

  it("zeigt 'teilweise' bei einem halb belegten Mehrbettzimmer", async () => {
    const zimmerId = await neuesZimmer(standort1Id, 2);
    await als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId: klientIds[3], einzug: "2024-01-01" });

    const liste = await als(tokenBereichsleitung).get("/zimmer");
    const zimmer = liste.body.find((z: { id: string }) => z.id === zimmerId);
    expect(zimmer.status).toBe("teilweise");
    expect(zimmer.bewohner).toHaveLength(1);
  });

  it("lehnt zwei gleichzeitige Zuweisungen zu einem Ein-Platz-zu-wenig-Zimmer korrekt ab (Race Condition)", async () => {
    const zimmerId = await neuesZimmer(standort2Id, 2);
    const [k1, k2, k3] = [klientIds[4], klientIds[5], (await neuerZusatzKlient()).id];

    // Drei echte, gleichzeitig gefeuerte HTTP-Requests fuer ein Zimmer mit
    // Kapazitaet 2 -- das ist der eigentliche Beweis fuer das
    // "SELECT ... FOR UPDATE" im Trigger (siehe migrations/0032): ohne die
    // Zeilensperre koennten alle drei parallel "noch Platz frei" lesen und
    // durchkommen.
    const ergebnisse = await Promise.all(
      [k1, k2, k3].map((klientId) =>
        als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId, einzug: "2024-01-01" })
      )
    );
    const erfolgreich = ergebnisse.filter((r) => r.status === 201);
    const abgelehnt = ergebnisse.filter((r) => r.status === 409);
    expect(erfolgreich).toHaveLength(2);
    expect(abgelehnt).toHaveLength(1);

    const { rows } = await admin.query("SELECT count(*) AS anzahl FROM belegung WHERE zimmer_id = $1 AND auszug IS NULL", [
      zimmerId,
    ]);
    expect(Number(rows[0].anzahl)).toBe(2);
  });

  async function neuerZusatzKlient(): Promise<{ id: string }> {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Zusatz', $2, '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-zusatz-${randomUUID().slice(0, 8)}`]
    );
    return { id: rows[0].id };
  }

  describe("Vier-Augen-Prinzip bei Kapazitätsänderung", () => {
    it("Betreuer darf die Kapazität nicht ändern (403)", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const res = await als(tokenBetreuer).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      expect(res.status).toBe(403);
    });

    it("Bereichsleitung beantragt eine Änderung -- die Kapazität wirkt noch NICHT sofort", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const res = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 3 });
      expect(res.status).toBe(200);
      expect(res.body.kapazitaet).toBe(1);
      expect(res.body.offenerKapazitaetsantrag).toMatchObject({
        alteKapazitaet: 1,
        neueKapazitaet: 3,
        beantragtVonRolle: "bereichsleitung",
      });
    });

    it("KERN: Bereichsleitung darf den eigenen Antrag nicht selbst bestätigen", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const antrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      const res = await als(tokenBereichsleitung).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "bestaetigt",
      });
      expect(res.status).toBe(403);

      const geladen = await als(tokenBereichsleitung).get("/zimmer");
      const zimmer = geladen.body.find((z: { id: string }) => z.id === zimmerId);
      expect(zimmer.kapazitaet).toBe(1);
      expect(zimmer.offenerKapazitaetsantrag).not.toBeNull();
    });

    it("Einrichtungsleitung (Gegenrolle) bestätigt den Antrag der Bereichsleitung -- Kapazität wirkt danach", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const antrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      const res = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "bestaetigt",
      });
      expect(res.status).toBe(200);
      expect(res.body.kapazitaet).toBe(2);
      expect(res.body.offenerKapazitaetsantrag).toBeNull();
    });

    it("Gegenprobe umgekehrt: Einrichtungsleitung beantragt, Einrichtungsleitung darf nicht selbst bestätigen, Bereichsleitung schon", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const antrag = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/${zimmerId}/kapazitaet`, {
        neueKapazitaet: 2,
      });
      expect(antrag.status).toBe(200);
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      const selbst = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "bestaetigt",
      });
      expect(selbst.status).toBe(403);

      const bereichsleitung = await als(tokenBereichsleitung).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "bestaetigt",
      });
      expect(bereichsleitung.status).toBe(200);
      expect(bereichsleitung.body.kapazitaet).toBe(2);
    });

    it("Einrichtungsleitung-S1 darf nur über Anträge des eigenen Standorts entscheiden, nicht über Standort 2", async () => {
      const zimmerS2 = await neuesZimmer(standort2Id, 1);
      const antrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerS2}/kapazitaet`, { neueKapazitaet: 2 });
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      const res = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "bestaetigt",
      });
      expect(res.status).toBe(404);
    });

    it("eine Ablehnung braucht einen Grund, wirkt dann sofort, und erlaubt einen erneuten Antrag", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const antrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      const ohneGrund = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "abgelehnt",
      });
      expect(ohneGrund.status).toBe(400);

      const mitGrund = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "abgelehnt",
        grund: "Brandschutz lässt das nicht zu",
      });
      expect(mitGrund.status).toBe(200);
      expect(mitGrund.body.kapazitaet).toBe(1);
      expect(mitGrund.body.offenerKapazitaetsantrag).toBeNull();

      const zweiterAntrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, {
        neueKapazitaet: 2,
      });
      expect(zweiterAntrag.status).toBe(200);
      expect(zweiterAntrag.body.offenerKapazitaetsantrag.neueKapazitaet).toBe(2);
    });

    it("lehnt einen zweiten gleichzeitig offenen Antrag für dasselbe Zimmer ab (409)", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const erster = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      expect(erster.status).toBe(200);

      const zweiter = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 3 });
      expect(zweiter.status).toBe(409);
    });

    it("lehnt eine Reduzierung unter die aktuelle Bewohnerzahl beim Beantragen ab", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 2);
      await als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId: (await neuerZusatzKlient()).id, einzug: "2024-01-01" });
      await als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId: (await neuerZusatzKlient()).id, einzug: "2024-01-01" });

      const res = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 1 });
      expect(res.status).toBe(409);
    });

    it("lehnt eine Bestätigung ab, wenn die Bewohnerzahl zwischen Antrag und Bestätigung zu hoch geworden ist", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 3);
      await als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId: (await neuerZusatzKlient()).id, einzug: "2024-01-01" });

      // Antrag auf Reduzierung 3 -> 2 ist beim Beantragen noch gueltig (1 Bewohner).
      const antrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      expect(antrag.status).toBe(200);
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      // Zwischenzeitlich ziehen zwei weitere Personen ein (Zimmer hat noch Kapazitaet 3).
      await als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId: (await neuerZusatzKlient()).id, einzug: "2024-01-02" });
      await als(tokenBereichsleitung).post("/belegungen", { zimmerId, klientId: (await neuerZusatzKlient()).id, einzug: "2024-01-02" });

      const bestaetigung = await als(tokenEinrichtungsleitungS1).patch(`/zimmer/kapazitaetsantraege/${antragId}`, {
        entscheidung: "bestaetigt",
      });
      expect(bestaetigung.status).toBe(409);

      const geladen = await als(tokenBereichsleitung).get("/zimmer");
      const zimmer = geladen.body.find((z: { id: string }) => z.id === zimmerId);
      expect(zimmer.kapazitaet).toBe(3);
    });

    it("verweigert der App-Datenbankrolle Änderungen an Antragsteller/Kapazitätswerten eines Kapazitätsantrags", async () => {
      const zimmerId = await neuesZimmer(standort1Id, 1);
      const antrag = await als(tokenBereichsleitung).patch(`/zimmer/${zimmerId}/kapazitaet`, { neueKapazitaet: 2 });
      const antragId = antrag.body.offenerKapazitaetsantrag.id;

      const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await appClient.connect();
      try {
        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(
          appClient.query("UPDATE zimmer_kapazitaetsantrag SET neue_kapazitaet = 99 WHERE id = $1", [antragId])
        ).rejects.toThrow(/permission denied/i);
        await appClient.query("ROLLBACK");

        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        const erlaubt = await appClient.query(
          "UPDATE zimmer_kapazitaetsantrag SET status = 'abgelehnt', ablehnung_grund = 'x', entschieden_von = beantragt_von, entschieden_am = now() WHERE id = $1",
          [antragId]
        );
        expect(erlaubt.rowCount).toBe(1);
        await appClient.query("ROLLBACK");
      } finally {
        await appClient.end();
      }
    });
  });
});
