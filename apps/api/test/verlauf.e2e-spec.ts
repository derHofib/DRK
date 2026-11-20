/**
 * Verlauf der Klientenakte (Migration 0078): Eintraege anlegen (vier Arten),
 * abgeleitete Ereignisse, Korrektur mit Historie, Rechte, Standort-
 * Einschraenkung, Unveraenderlichkeit in der Datenbank und Mandantentrennung.
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

describe("Verlauf (klient_eintrag)", () => {
  let app: INestApplication;
  let admin: Client;
  let appClient: Client;

  let mandantId: string;
  let mandantBId: string;
  let klient1: string; // Standort 1
  let klient2: string; // Standort 2
  let klientArchiv: string;
  let klientB: string; // Mandant B
  let leitungId: string;
  let betreuerS1Id: string;

  let tokenLeitung: string;
  let tokenBetreuerS1: string;
  let tokenBetreuer2: string;
  let tokenB: string;

  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    const hash = await bcrypt.hash(passwort, 4);

    const slug = `test-verlauf-${suffix}`;
    const slugB = `test-verlauf-b-${suffix}`;
    mandantId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Verlauf ${suffix}`, slug])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Verlauf B ${suffix}`, slugB])).rows[0].id;

    // Vollzugriff (Bereichsleitung): ein Konto ohne Position haette gar keine Rechte.
    leitungId = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email: `leitung-${suffix}@beispiel.test`,
      name: "Leitung Verlauf",
      passwortHash: hash,
    });
    betreuerS1Id = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "betreuer",
      email: `betreuer-s1-${suffix}@beispiel.test`,
      name: "Betreuer S1",
      passwortHash: hash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "betreuer",
      email: `betreuer-2-${suffix}@beispiel.test`,
      name: "Betreuer Zwei",
      passwortHash: hash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantBId,
      rolle: "bereichsleitung",
      email: `leitung-b-${suffix}@beispiel.test`,
      name: "Leitung B",
      passwortHash: hash,
    });

    const s1 = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S1', 'x') RETURNING id", [mandantId])).rows[0].id;
    const s2 = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S2', 'x') RETURNING id", [mandantId])).rows[0].id;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, betreuerS1Id, s1]);
    const z1 = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id", [mandantId, s1])).rows[0].id;
    const z2 = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id", [mandantId, s2])).rows[0].id;

    async function klient(m: string, name: string) {
      return (
        await admin.query(
          "INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, $2, 'Test', '2008-01-01', $3, 'Amt') RETURNING id",
          [m, name, `AZ-${name}-${suffix}`]
        )
      ).rows[0].id as string;
    }
    klient1 = await klient(mandantId, "Eins");
    klient2 = await klient(mandantId, "Zwei");
    klientArchiv = await klient(mandantId, "Archiv");
    klientB = await klient(mandantBId, "Bee");
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2026-03-01')", [mandantId, z1, klient1]);
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2026-03-01')", [mandantId, z2, klient2]);
    await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [klientArchiv, leitungId]);
    await admin.query("INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, bis) VALUES ($1, $2, 'Jugendamt', '2026-03-01', '2027-02-28')", [mandantId, klient1]);
    await admin.query("INSERT INTO tagesbericht (mandant_id, klient_id, autor_id, datum, text) VALUES ($1, $2, $3, '2026-03-02', 'Erster Tag.')", [mandantId, klient1, leitungId]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(s: string, email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: s, email, passwort });
      return res.body.accessToken as string;
    }
    tokenLeitung = await login(slug, `leitung-${suffix}@beispiel.test`);
    tokenBetreuerS1 = await login(slug, `betreuer-s1-${suffix}@beispiel.test`);
    tokenBetreuer2 = await login(slug, `betreuer-2-${suffix}@beispiel.test`);
    tokenB = await login(slugB, `leitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    const ids = [mandantId, mandantBId];
    await admin.query("ALTER TABLE aufgabe DISABLE TRIGGER aufgabe_eintrag_bezug_fest");
    await admin.query("DELETE FROM aufgabe WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("ALTER TABLE aufgabe ENABLE TRIGGER aufgabe_eintrag_bezug_fest");
    await admin.query("DELETE FROM klient_eintrag_aenderung WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM klient_eintrag_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM klient_eintrag WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM tagesbericht WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM standort WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
    await raeumeKontoMitRolleAuf(admin, mandantId);
    await raeumeKontoMitRolleAuf(admin, mandantBId);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
    await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    await appClient.end();
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (p: string) => request(http).get(p).set("Authorization", `Bearer ${token}`),
      post: (p: string, b: object) => request(http).post(p).set("Authorization", `Bearer ${token}`).send(b),
      patch: (p: string, b: object) => request(http).patch(p).set("Authorization", `Bearer ${token}`).send(b),
    };
  }

  it("legt ein Telefonat mit Richtung, Dauer und Gegenüber an", async () => {
    const res = await als(tokenBetreuerS1).post(`/klienten/${klient1}/eintraege`, {
      art: "telefonat",
      text: "Hilfeplan-Termin vereinbart.",
      gegenueber: "Jugendamt, Fr. Test",
      richtung: "ausgehend",
      dauerMinuten: 12,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ art: "telefonat", richtung: "ausgehend", dauerMinuten: 12, gegenueber: "Jugendamt, Fr. Test", autorName: "Betreuer S1" });
    expect(res.body.korrigierbar).toBe(true);
    expect(res.body.korrekturBrauchtGrund).toBe(false);
  });

  it("Gespräch speichert Art und teilnehmende Mitarbeitende", async () => {
    const res = await als(tokenBetreuerS1).post(`/klienten/${klient1}/eintraege`, {
      art: "gespraech",
      gespraechArt: "team",
      text: "Fallberatung.",
      ergebnis: "Siehe Entscheidung.",
      teilnehmendeIds: [leitungId, betreuerS1Id],
    });
    expect(res.status).toBe(201);
    expect(res.body.gespraechArt).toBe("team");
    expect(res.body.teilnehmende.map((t: { name: string }) => t.name)).toEqual(["Betreuer S1", "Leitung Verlauf"]);
  });

  it("Entscheidungen nur mit eigenem Recht: Betreuer 403, Leitung 201 mit Wiedervorlage", async () => {
    const verboten = await als(tokenBetreuerS1).post(`/klienten/${klient1}/eintraege`, { art: "entscheidung", text: "Taschengeld wöchentlich." });
    expect(verboten.status).toBe(403);
    const ok = await als(tokenLeitung).post(`/klienten/${klient1}/eintraege`, {
      art: "entscheidung",
      text: "Taschengeld wöchentlich.",
      wiedervorlageAm: "2099-01-15",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.entschiedenVonName).toBe("Leitung Verlauf");
  });

  it("nächster Schritt wird auf Wunsch eine Aufgabe für mich -- ohne Klientennamen im Titel", async () => {
    const res = await als(tokenBetreuerS1).post(`/klienten/${klient1}/eintraege`, {
      art: "telefonat",
      richtung: "eingehend",
      text: "Unterlagen angefordert.",
      naechsterSchritt: "Unterlagen schicken",
      aufgabeFaelligAm: "2099-02-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.aufgabe).toMatchObject({ faelligAm: "2099-02-01", erledigt: false });
    const { rows } = await admin.query("SELECT titel, zugewiesen_an FROM aufgabe WHERE klient_eintrag_id = $1", [res.body.id]);
    expect(rows[0]).toEqual({ titel: "Unterlagen schicken", zugewiesen_an: betreuerS1Id });
  });

  it("Verlauf mischt Einträge mit abgeleiteten Ereignissen, neueste zuerst, und liefert Wiedervorlagen", async () => {
    const res = await als(tokenBetreuerS1).get(`/klienten/${klient1}/verlauf`);
    expect(res.status).toBe(200);
    const quellen = res.body.zeilen.map((z: { quelle: string }) => z.quelle);
    expect(quellen).toEqual(expect.arrayContaining(["telefonat", "gespraech", "entscheidung", "tagesbericht", "belegung", "kostenuebernahme"]));
    const zeiten = res.body.zeilen.map((z: { zeitpunkt: string }) => z.zeitpunkt);
    expect([...zeiten].sort().reverse()).toEqual(zeiten);
    const einzug = res.body.zeilen.find((z: { schluessel: string }) => z.schluessel.endsWith(":einzug"));
    expect(einzug).toMatchObject({ titel: "Einzug in Zimmer 101, S1", ganztaegig: true });
    const herkunft = res.body.wiedervorlagen.map((w: { herkunft: string }) => w.herkunft).sort();
    expect(herkunft).toEqual(["aufgabe", "entscheidung"]);
  });

  it("Zeitraum grenzt ein; kaputtes Datum ist 400, kein 500", async () => {
    const res = await als(tokenLeitung).get(`/klienten/${klient1}/verlauf?von=2026-03-01&bis=2026-03-01`);
    expect(res.status).toBe(200);
    expect(res.body.zeilen.every((z: { zeitpunkt: string }) => z.zeitpunkt.startsWith("2026-03-01"))).toBe(true);
    expect(res.body.zeilen.length).toBe(2); // Einzug + Beginn Kostenuebernahme
    expect((await als(tokenLeitung).get(`/klienten/${klient1}/verlauf?von=kaputt`)).status).toBe(400);
  });

  it("lehnt ungültige Einträge mit 400 ab (leer, Zukunft, Aufgabe ohne Schritt)", async () => {
    expect((await als(tokenLeitung).post(`/klienten/${klient1}/eintraege`, { art: "notiz", text: "  " })).status).toBe(400);
    expect((await als(tokenLeitung).post(`/klienten/${klient1}/eintraege`, { art: "fax", text: "x" })).status).toBe(400);
    const zukunft = new Date(Date.now() + 3600_000).toISOString();
    expect((await als(tokenLeitung).post(`/klienten/${klient1}/eintraege`, { art: "notiz", text: "x", zeitpunkt: zukunft })).status).toBe(400);
    expect((await als(tokenLeitung).post(`/klienten/${klient1}/eintraege`, { art: "telefonat", richtung: "eingehend", text: "x", aufgabeFaelligAm: "2099-01-01" })).status).toBe(400);
  });

  it("archivierte Akte: keine neuen Einträge", async () => {
    const res = await als(tokenLeitung).post(`/klienten/${klientArchiv}/eintraege`, { art: "notiz", text: "Nachtrag" });
    expect(res.status).toBe(400);
  });

  it("Standort-Einschränkung: Betreuer S1 sieht die Klient:in an S2 nicht (404 lesen und schreiben)", async () => {
    expect((await als(tokenBetreuerS1).get(`/klienten/${klient2}/verlauf`)).status).toBe(404);
    expect((await als(tokenBetreuerS1).post(`/klienten/${klient2}/eintraege`, { art: "notiz", text: "x" })).status).toBe(404);
  });

  it("Korrektur: eigene frische ohne Grund, Historie per Trigger; fremde nur mit Recht und Grund", async () => {
    const e = await als(tokenBetreuerS1).post(`/klienten/${klient1}/eintraege`, { art: "notiz", text: "Tippfeler" });
    const eigene = await als(tokenBetreuerS1).patch(`/klient-eintraege/${e.body.id}`, { text: "Tippfehler" });
    expect(eigene.status).toBe(200);
    expect(eigene.body).toMatchObject({ text: "Tippfehler", anzahlKorrekturen: 1 });

    // Kollege ohne korrigieren-fremde: verboten.
    expect((await als(tokenBetreuer2).patch(`/klient-eintraege/${e.body.id}`, { text: "Anders" })).status).toBe(403);
    // Leitung: nur mit Grund.
    expect((await als(tokenLeitung).patch(`/klient-eintraege/${e.body.id}`, { text: "Anders" })).status).toBe(400);
    const fremd = await als(tokenLeitung).patch(`/klient-eintraege/${e.body.id}`, { text: "Anders", grund: "Falsche Klient:in genannt" });
    expect(fremd.status).toBe(200);

    const hist = await als(tokenLeitung).get(`/klient-eintraege/${e.body.id}/historie`);
    expect(hist.body).toHaveLength(2);
    expect(hist.body[0]).toMatchObject({ textAlt: "Tippfehler", textNeu: "Anders", grund: "Falsche Klient:in genannt", geaendertVonName: "Leitung Verlauf" });
    expect(hist.body[1]).toMatchObject({ textAlt: "Tippfeler", textNeu: "Tippfehler", grund: null, geaendertVonName: "Betreuer S1" });
  });

  it("nach 24 Stunden darf auch die Autor:in nicht mehr ohne Recht korrigieren", async () => {
    const e = await als(tokenBetreuerS1).post(`/klienten/${klient1}/eintraege`, { art: "notiz", text: "Alt" });
    await admin.query("UPDATE klient_eintrag SET erstellt_am = now() - interval '25 hours' WHERE id = $1", [e.body.id]);
    expect((await als(tokenBetreuerS1).patch(`/klient-eintraege/${e.body.id}`, { text: "Neu" })).status).toBe(403);
  });

  it("Datenbank: App-Rolle kann Art, Klient:in oder Autor nicht ändern und nichts löschen", async () => {
    const { rows } = await admin.query("SELECT id FROM klient_eintrag WHERE mandant_id = $1 LIMIT 1", [mandantId]);
    for (const sql of ["UPDATE klient_eintrag SET art = 'notiz' WHERE id = $1", "UPDATE klient_eintrag SET klient_id = klient_id WHERE id = $1", "DELETE FROM klient_eintrag WHERE id = $1", "UPDATE klient_eintrag SET autor_id = NULL WHERE id = $1", "DELETE FROM klient_eintrag_aenderung WHERE eintrag_id = $1"]) {
      await appClient.query("BEGIN");
      try {
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(appClient.query(sql, [rows[0].id])).rejects.toThrow(/permission denied/);
      } finally {
        await appClient.query("ROLLBACK");
      }
    }
  });

  it("Datenbank: der Aufgaben-Bezug lässt sich nicht umhängen", async () => {
    const { rows } = await admin.query("SELECT id FROM aufgabe WHERE mandant_id = $1 AND klient_eintrag_id IS NOT NULL LIMIT 1", [mandantId]);
    await expect(admin.query("UPDATE aufgabe SET klient_eintrag_id = NULL WHERE id = $1", [rows[0].id])).rejects.toThrow(/nicht geändert/);
  });

  it("Datenbank: Telefonat ohne Richtung und Entscheidung ohne Entscheider:in sind unmöglich", async () => {
    await expect(
      admin.query(
        "INSERT INTO klient_eintrag (mandant_id, klient_id, art, zeitpunkt, text, autor_id) VALUES ($1, $2, 'telefonat', now(), 'x', $3)",
        [mandantId, klient1, leitungId]
      )
    ).rejects.toThrow(/check constraint/);
    await expect(
      admin.query(
        "INSERT INTO klient_eintrag (mandant_id, klient_id, art, zeitpunkt, text, autor_id) VALUES ($1, $2, 'entscheidung', now(), 'x', $3)",
        [mandantId, klient1, leitungId]
      )
    ).rejects.toThrow(/check constraint/);
  });

  describe("Mandantentrennung", () => {
    it("API: Träger B sieht weder Verlauf noch kann er schreiben (404)", async () => {
      expect((await als(tokenB).get(`/klienten/${klient1}/verlauf`)).status).toBe(404);
      expect((await als(tokenB).post(`/klienten/${klient1}/eintraege`, { art: "notiz", text: "x" })).status).toBe(404);
      const { rows } = await admin.query("SELECT id FROM klient_eintrag WHERE mandant_id = $1 LIMIT 1", [mandantId]);
      expect((await als(tokenB).patch(`/klient-eintraege/${rows[0].id}`, { text: "x", grund: "y" })).status).toBe(404);
      expect((await als(tokenB).get(`/klient-eintraege/${rows[0].id}/historie`)).status).toBe(404);
    });

    it("RLS: im Kontext von Träger B sind die Einträge, Teilnehmenden und Korrekturen von A unsichtbar", async () => {
      await appClient.query("BEGIN");
      try {
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantBId]);
        for (const t of ["klient_eintrag", "klient_eintrag_teilnehmer", "klient_eintrag_aenderung"]) {
          const { rows } = await appClient.query(`SELECT count(*)::int AS n FROM ${t}`);
          expect({ t, n: rows[0].n }).toEqual({ t, n: 0 });
        }
        await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        const { rows } = await appClient.query("SELECT count(*)::int AS n FROM klient_eintrag");
        expect(rows[0].n).toBeGreaterThan(0);
      } finally {
        await appClient.query("ROLLBACK");
      }
    });

    it("zusammengesetzter FK: ein Eintrag von Träger A kann nicht auf eine Klient:in von B zeigen", async () => {
      await expect(
        admin.query(
          "INSERT INTO klient_eintrag (mandant_id, klient_id, art, zeitpunkt, text, autor_id) VALUES ($1, $2, 'notiz', now(), 'x', $3)",
          [mandantId, klientB, leitungId]
        )
      ).rejects.toThrow(/foreign key/);
    });
  });
});
