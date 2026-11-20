/**
 * Standort-Steckbrief (Migration 0079, Konzept standort-daten, Phase 1).
 *
 * Sicherheitsrelevant:
 *   - Kostenstelle und IK-Nummer sieht nur, wer standorte.bearbeiten hat;
 *     ohne das Recht FEHLEN die Felder im JSON (nicht null).
 *   - Der Steckbrief eines nicht zugeordneten oder fremden Standorts ist
 *     404, wie bei uebersicht().
 *   - Die App-Rolle kann adresse, mandant_id und erstellt_am nicht aendern,
 *     jede neue Spalte aus dem GRANT aber schon (eine vergessene Spalte
 *     fiele hier auf).
 * Fachlich:
 *   - adresse wird aus strasse/plz/ort abgeleitet und kann nicht abweichen.
 *   - Plaetze, Leitung und Team werden abgeleitet, nie eingetragen.
 *   - Jede Aenderung landet mit vorher/nachher im audit_log.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

describe("Standort-Steckbrief", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBetreuerS1: string;
  let standort1Id: string;
  let standort2Id: string;
  let fremderStandortId: string;
  let leitungId: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const mandantSlug = `test-steckbrief-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const ins = async (sql: string, p: unknown[]) => (await admin.query<{ id: string }>(sql, p)).rows[0].id;
    mandantId = await ins("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Steckbrief ${suffix}`, mandantSlug]);
    const fremdMandant = await ins("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Fremd ${suffix}`, `fremd-sb-${suffix}`]);
    fremderStandortId = await ins(
      "INSERT INTO standort (mandant_id, name, strasse, kostenstelle) VALUES ($1, 'Fremd', 'x', 'GEHEIM-FREMD') RETURNING id",
      [fremdMandant]
    );

    await kontoMitAlterRolle(admin, { mandantId, rolle: "bereichsleitung", email: `bl-${suffix}@beispiel.test`, name: "BL", passwortHash });
    const elId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "einrichtungsleitung", email: `el-${suffix}@beispiel.test`, name: "EL", passwortHash,
    });
    const betreuerId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "betreuer", email: `bt-${suffix}@beispiel.test`, name: "BT", passwortHash,
    });

    // Altes Muster (INSERT mit adresse) muss weiter funktionieren: der Trigger zerlegt.
    standort1Id = await ins(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus 1', 'Lindenallee 14, 12345 Musterstadt') RETURNING id",
      [mandantId]
    );
    standort2Id = await ins("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus 2', 'Str. 2') RETURNING id", [mandantId]);
    for (const b of [elId, betreuerId]) {
      await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, b, standort1Id]);
    }
    await admin.query(
      "UPDATE standort SET kostenstelle = '4310', ik_nummer = '260512345', telefon = '0123 45 67-10' WHERE id = $1",
      [standort1Id]
    );

    const z1 = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '101', 2) RETURNING id", [mandantId, standort1Id]);
    await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '102') RETURNING id", [mandantId, standort1Id]);
    const k1 = await ins(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Eins', 'Haus1', '1990-01-01', $2, 'Amt') RETURNING id`,
      [mandantId, `AZ1-${suffix}`]
    );
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z1, k1]);

    // Leitung im Organigramm: eine Linienposition am Einrichtungsknoten von
    // Haus 1 (den legt der Trigger aus 0040 beim Standort an), besetzt mit
    // einer eigenen Person. Die Position haengt unter der Traeger-Wurzel,
    // steht am Knoten also ganz oben.
    const { rows: ou } = await admin.query<{ id: string }>("SELECT id FROM org_unit WHERE standort_id = $1", [standort1Id]);
    const { rows: at } = await admin.query<{ id: string }>("SELECT id FROM account_typ WHERE mandant_id = $1 LIMIT 1", [mandantId]);
    leitungId = await ins(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Sabine Kröger', $3) RETURNING id`,
      [mandantId, `leitung-${suffix}@beispiel.test`, passwortHash]
    );
    const posId = await ins(
      "INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, 'Einrichtungsleitung', $3) RETURNING id",
      [mandantId, ou[0].id, at[0].id]
    );
    await admin.query(
      "INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id, gueltig_ab) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, posId, leitungId]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken as string;
    tokenBereichsleitung = await login(`bl-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(`el-${suffix}@beispiel.test`);
    tokenBetreuerS1 = await login(`bt-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const http = () => app.getHttpServer();
  const steckbrief = (token: string, id: string) =>
    request(http()).get(`/standorte/${id}/steckbrief`).set("Authorization", `Bearer ${token}`);
  const patch = (token: string, id: string, body: object) =>
    request(http()).patch(`/standorte/${id}`).set("Authorization", `Bearer ${token}`).send(body);

  describe("Anschrift", () => {
    it("zerlegt ein altes INSERT mit adresse in strasse, plz und ort", async () => {
      const { rows } = await admin.query("SELECT strasse, plz, ort, adresse FROM standort WHERE id = $1", [standort1Id]);
      expect(rows[0]).toEqual({ strasse: "Lindenallee 14", plz: "12345", ort: "Musterstadt", adresse: "Lindenallee 14, 12345 Musterstadt" });
    });

    it("leitet adresse beim Aendern der Teile neu ab", async () => {
      const res = await patch(tokenBereichsleitung, standort2Id, { strasse: "Sonnenhof 3", plz: "12345", ort: "Musterstadt" });
      expect(res.status).toBe(200);
      expect(res.body.adresse).toBe("Sonnenhof 3, 12345 Musterstadt");
    });

    it("nimmt das alte Feld adresse im PATCH noch an (zwischengespeicherte PWA)", async () => {
      const res = await patch(tokenBereichsleitung, standort2Id, { adresse: "Talstraße 21, 12349 Beispielheim" });
      expect(res.status).toBe(200);
      expect(res.body.adresse).toBe("Talstraße 21, 12349 Beispielheim");
      const { rows } = await admin.query("SELECT plz, ort FROM standort WHERE id = $1", [standort2Id]);
      expect(rows[0]).toEqual({ plz: "12349", ort: "Beispielheim" });
    });

    it("lehnt PLZ, IK-Nummer und E-Mail im falschen Format mit 400 ab", async () => {
      expect((await patch(tokenBereichsleitung, standort2Id, { plz: "1234" })).status).toBe(400);
      expect((await patch(tokenBereichsleitung, standort2Id, { ikNummer: "12345" })).status).toBe(400);
      expect((await patch(tokenBereichsleitung, standort2Id, { email: "keine-mail" })).status).toBe(400);
      expect((await patch(tokenBereichsleitung, standort2Id, { angebotsform: "wohnheim" })).status).toBe(400);
      expect((await patch(tokenBereichsleitung, standort2Id, { unbekannt: "x" })).status).toBe(400);
    });

    it("legt einen neuen Standort mit getrennter Anschrift an", async () => {
      const res = await request(http())
        .post("/standorte")
        .set("Authorization", `Bearer ${tokenBereichsleitung}`)
        .send({ name: "Neu", angebotsform: "einzelwohnen", strasse: "Nordring 88", plz: "12347", ort: "Musterstadt" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ adresse: "Nordring 88, 12347 Musterstadt", angebotsform: "einzelwohnen" });
    });
  });

  describe("Sichtbarkeit", () => {
    it("zeigt der Leitung mit standorte.bearbeiten Kostenstelle und IK-Nummer", async () => {
      const res = await steckbrief(tokenEinrichtungsleitungS1, standort1Id);
      expect(res.status).toBe(200);
      expect(res.body.darfBearbeiten).toBe(true);
      expect(res.body.angaben.kostenstelle).toBe("4310");
      expect(res.body.angaben.ikNummer).toBe("260512345");
    });

    it("laesst Kostenstelle und IK-Nummer fuer Mitarbeitende ohne Recht ganz weg", async () => {
      const res = await steckbrief(tokenBetreuerS1, standort1Id);
      expect(res.status).toBe(200);
      expect(res.body.darfBearbeiten).toBe(false);
      expect(res.body.angaben.telefon).toBe("0123 45 67-10");
      expect("kostenstelle" in res.body.angaben).toBe(false);
      expect("ikNummer" in res.body.angaben).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain("4310");
      expect(JSON.stringify(res.body)).not.toContain("260512345");
    });

    it("verweigert Mitarbeitenden ohne Recht das Bearbeiten (403)", async () => {
      expect((await patch(tokenBetreuerS1, standort1Id, { telefon: "1" })).status).toBe(403);
    });

    it("liefert den Steckbrief eines nicht zugeordneten Standorts nicht (404)", async () => {
      expect((await steckbrief(tokenEinrichtungsleitungS1, standort2Id)).status).toBe(404);
      expect((await steckbrief(tokenBetreuerS1, standort2Id)).status).toBe(404);
      // Gegenprobe: ohne Einschraenkung klappt dieselbe Anfrage.
      expect((await steckbrief(tokenBereichsleitung, standort2Id)).status).toBe(200);
    });

    it("liefert den Steckbrief eines fremden Mandanten nicht (RLS) und aendert ihn nicht", async () => {
      const res = await steckbrief(tokenBereichsleitung, fremderStandortId);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("GEHEIM-FREMD");
      expect((await patch(tokenBereichsleitung, fremderStandortId, { kostenstelle: "x" })).status).toBe(404);
      const { rows } = await admin.query("SELECT kostenstelle FROM standort WHERE id = $1", [fremderStandortId]);
      expect(rows[0].kostenstelle).toBe("GEHEIM-FREMD");
    });
  });

  describe("Abgeleitet", () => {
    it("leitet Plaetze, Leitung und Team ab", async () => {
      const res = await steckbrief(tokenBereichsleitung, standort1Id);
      expect(res.body.plaetze).toEqual({ eingerichtet: 3, belegt: 1, frei: 2, zimmer: 2 });
      expect(res.body.leitung).toEqual([{ benutzerId: leitungId, name: "Sabine Kröger", positionTitel: "Einrichtungsleitung" }]);
      // EL und Betreuer ueber benutzer_standort, die Leitung ueber ihre Besetzung am Knoten.
      expect(res.body.team.anzahl).toBe(3);
    });

    it("zaehlt ein neues Zimmer ohne weiteren Schreibvorgang mit", async () => {
      await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '103', 2)", [mandantId, standort1Id]);
      const res = await steckbrief(tokenBereichsleitung, standort1Id);
      expect(res.body.plaetze.eingerichtet).toBe(5);
    });

    it("meldet fehlende Angaben, bis sie eingetragen sind", async () => {
      const vorher = await steckbrief(tokenBereichsleitung, standort1Id);
      expect(vorher.body.fehlendeAngaben).toEqual(["angebotsform", "bereitschaft"]);
      await patch(tokenBereichsleitung, standort1Id, { angebotsform: "besondere_wohnform", bereitschaftTelefon: "0170 000 00 10" });
      const nachher = await steckbrief(tokenBereichsleitung, standort1Id);
      expect(nachher.body.fehlendeAngaben).toEqual([]);
    });

    it("zeigt Plaetze, Leitung und fehlende Angaben auch in der Verwaltungsliste", async () => {
      const res = await request(http()).get("/standorte/verwaltung").set("Authorization", `Bearer ${tokenEinrichtungsleitungS1}`);
      expect(res.status).toBe(200);
      expect(res.body.map((s: { name: string }) => s.name)).toEqual(["Haus 1"]);
      expect(res.body[0]).toMatchObject({ plaetzeEingerichtet: 5, plaetzeBelegt: 1, angebotsform: "besondere_wohnform" });
      expect(res.body[0].leitung[0].name).toBe("Sabine Kröger");
      expect(JSON.stringify(res.body)).not.toContain("4310");
    });
  });

  describe("Protokoll", () => {
    it("schreibt nur die geaenderten Felder mit vorher/nachher ins audit_log", async () => {
      const res = await patch(tokenEinrichtungsleitungS1, standort1Id, { kostenstelle: "4311", telefon: "0123 45 67-10" });
      expect(res.status).toBe(200);
      const { rows } = await admin.query(
        `SELECT vorher, nachher FROM audit_log
         WHERE objekt_id = $1 AND modul = 'standorte' AND aktion = 'bearbeiten'
         ORDER BY erstellt_am DESC LIMIT 1`,
        [standort1Id]
      );
      expect(rows[0]).toEqual({ vorher: { kostenstelle: "4310" }, nachher: { kostenstelle: "4311" } });
    });
  });

  describe("Spaltenrechte der App-Rolle", () => {
    // Als zimmerakte_app, mit gesetztem Mandanten -- so wie die API.
    async function alsApp<T>(fn: (c: Client) => Promise<T>): Promise<T> {
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        return await fn(c);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        await c.end();
      }
    }

    it.each(["adresse = 'Gefälscht'", "mandant_id = mandant_id", "erstellt_am = now()"])(
      "verweigert UPDATE standort SET %s",
      async (setzen) => {
        await expect(alsApp((c) => c.query(`UPDATE standort SET ${setzen} WHERE id = $1`, [standort1Id]))).rejects.toThrow(
          /permission denied/
        );
      }
    );

    it.each([
      ["angebotsform", "'sonstiges'"],
      ["zielgruppe", "'x'"],
      ["betreuungsumfang", "'stundenweise'"],
      ["in_betrieb_seit", "'2009-04-01'"],
      ["strasse", "'x'"],
      ["plz", "'12345'"],
      ["ort", "'x'"],
      ["telefon", "'x'"],
      ["fax", "'x'"],
      ["email", "'x'"],
      ["buerozeiten", "'x'"],
      ["bereitschaft_telefon", "'x'"],
      ["bereitschaft_hinweis", "'x'"],
      ["barrierefreiheit", "'teilweise'"],
      ["barrierefreiheit_hinweis", "'x'"],
      ["oepnv", "'x'"],
      ["zugang", "'x'"],
      ["kostenstelle", "'x'"],
      ["ik_nummer", "'123456789'"],
      ["hinweise", "'x'"],
    ])("erlaubt UPDATE standort SET %s", async (spalte, wert) => {
      const { rowCount } = await alsApp((c) => c.query(`UPDATE standort SET ${spalte} = ${wert} WHERE id = $1`, [standort1Id]));
      expect(rowCount).toBe(1);
    });

    it("erlaubt die eigene Wohnanschrift an einem Zimmer (Einzelwohnen)", async () => {
      const { rowCount } = await alsApp((c) =>
        c.query("UPDATE zimmer SET anschrift = 'Nordring 90, 12347 Musterstadt' WHERE standort_id = $1", [standort1Id])
      );
      expect(rowCount).toBeGreaterThan(0);
    });
  });
});
