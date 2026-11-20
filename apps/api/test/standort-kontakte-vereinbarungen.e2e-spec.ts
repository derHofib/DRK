/**
 * Standort-Steckbrief Phase 2 (Migration 0081): Kontakte vor Ort und
 * Vereinbarungen mit Erinnerungen.
 *
 * Sicherheitsrelevant:
 *   - Vereinbarungen (inkl. Verguetung) sieht nur, wer standorte.vereinbarungen
 *     hat; ohne das Recht FEHLT das Feld im Steckbrief. Die genehmigten Plaetze
 *     sehen alle -- die Zahl verraet keine Verguetung.
 *   - Schreiben braucht Recht UND Standort: eine auf Haus 1 beschraenkte
 *     Leitung bekommt fuer Haus 2 ein 404.
 *   - Zusammengesetzte FKs: keine Zeile an einem Standort eines fremden Mandanten.
 *   - Eine Vereinbarung ist nicht loeschbar; Partner, Plaetze und Verguetung
 *     sind nicht aenderbar, ein Storno ist endgueltig -- in der Datenbank.
 * Fachlich:
 *   - Status (kuenftig, gueltig, endet bald, verlaengert, abgelaufen,
 *     storniert) wird abgeleitet.
 *   - Erinnerungen 90/60/30 Tage vorher gehen als persoenliche Aufgabe an die
 *     abgeleitete Leitung, ohne Verguetung im Text, idempotent.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { StandortVereinbarungErinnerungService } from "../src/standorte/standort-vereinbarung-erinnerung.service";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

describe("Standort: Kontakte vor Ort und Vereinbarungen", () => {
  let app: INestApplication;
  let admin: Client;
  let dienst: StandortVereinbarungErinnerungService;
  let mandantId: string;
  let fremdMandantId: string;
  let fremderStandortId: string;
  let tokenBL: string;
  let tokenEL: string;
  let tokenBT: string;
  let blId: string;
  let elId: string;
  let standort1Id: string;
  let standort2Id: string;
  let standortInaktivId: string;
  let leitungId: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const mandantSlug = `test-sb2-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const ins = async (sql: string, p: unknown[]) => (await admin.query<{ id: string }>(sql, p)).rows[0].id;

    mandantId = await ins("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`SB2 ${suffix}`, mandantSlug]);
    fremdMandantId = await ins("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Fremd ${suffix}`, `fremd-sb2-${suffix}`]);
    fremderStandortId = await ins("INSERT INTO standort (mandant_id, name, strasse) VALUES ($1, 'Fremd', 'x') RETURNING id", [fremdMandantId]);

    blId = await kontoMitAlterRolle(admin, { mandantId, rolle: "bereichsleitung", email: `bl-${suffix}@beispiel.test`, name: "BL", passwortHash });
    elId = await kontoMitAlterRolle(admin, { mandantId, rolle: "einrichtungsleitung", email: `el-${suffix}@beispiel.test`, name: "EL", passwortHash });
    const btId = await kontoMitAlterRolle(admin, { mandantId, rolle: "betreuer", email: `bt-${suffix}@beispiel.test`, name: "BT", passwortHash });

    standort1Id = await ins("INSERT INTO standort (mandant_id, name, strasse, plz, ort) VALUES ($1, 'Haus 1', 'A 1', '12345', 'X') RETURNING id", [mandantId]);
    standort2Id = await ins("INSERT INTO standort (mandant_id, name, strasse) VALUES ($1, 'Haus 2', 'B 2') RETURNING id", [mandantId]);
    standortInaktivId = await ins("INSERT INTO standort (mandant_id, name, strasse, aktiv) VALUES ($1, 'Alt', 'C 3', false) RETURNING id", [mandantId]);
    for (const b of [elId, btId]) {
      await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, b, standort1Id]);
    }

    // Leitung von Haus 1 im Organigramm (wie in standort-steckbrief.e2e-spec).
    const { rows: ou } = await admin.query<{ id: string }>("SELECT id FROM org_unit WHERE standort_id = $1", [standort1Id]);
    const { rows: at } = await admin.query<{ id: string }>("SELECT id FROM account_typ WHERE mandant_id = $1 LIMIT 1", [mandantId]);
    leitungId = await ins(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Sabine Kröger', $3) RETURNING id",
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
    dienst = app.get(StandortVereinbarungErinnerungService);
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken as string;
    tokenBL = await login(`bl-${suffix}@beispiel.test`);
    tokenEL = await login(`el-${suffix}@beispiel.test`);
    tokenBT = await login(`bt-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const http = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const steckbrief = (t: string, id: string) => request(http()).get(`/standorte/${id}/steckbrief`).set(auth(t));
  const post = (t: string, pfad: string, body: object) => request(http()).post(pfad).set(auth(t)).send(body);
  const patch = (t: string, pfad: string, body: object) => request(http()).patch(pfad).set(auth(t)).send(body);

  /** Vereinbarung direkt anlegen, Daten relativ zu heute (Tage). */
  async function vereinbarung(standortId: string, art: string, vonTage: number, bisTage: number | null, extra: { plaetze?: number; verguetung?: number; von?: string } = {}) {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO standort_vereinbarung (mandant_id, standort_id, art, partner, gueltig_von, gueltig_bis, plaetze, verguetung_tag_cent, erstellt_von)
       VALUES ($1, $2, $3, 'Bezirk Musterland', CURRENT_DATE + $4::int, CURRENT_DATE + $5::int, $6, $7, $8) RETURNING id`,
      [mandantId, standortId, art, vonTage, bisTage, extra.plaetze ?? null, extra.verguetung ?? null, blId]
    );
    return rows[0].id;
  }

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

  describe("Kontakte vor Ort", () => {
    let kontaktId: string;

    it("legt Kontakte an und zeigt sie allen mit Zugriff, Notdienste zuerst", async () => {
      const a = await post(tokenBL, `/standorte/${standort1Id}/kontakte`, { rolle: "hausarzt", name: "Praxis Dr. Linde", telefon: "0123 9" });
      expect(a.status).toBe(201);
      const b = await post(tokenEL, `/standorte/${standort1Id}/kontakte`, {
        rolle: "notdienst", name: "Heizung Müller", telefon: "0800 1", email: "", hinweis: "nur nachts",
      });
      expect(b.status).toBe(201);
      expect(b.body.email).toBeNull(); // leer = nicht eingetragen
      kontaktId = a.body.id;

      const res = await steckbrief(tokenBT, standort1Id);
      expect(res.status).toBe(200);
      expect(res.body.kontakte.map((k: { name: string }) => k.name)).toEqual(["Heizung Müller", "Praxis Dr. Linde"]);
    });

    it("verweigert Mitarbeitenden ohne standorte.bearbeiten das Anlegen (403)", async () => {
      const res = await post(tokenBT, `/standorte/${standort1Id}/kontakte`, { rolle: "apotheke", name: "Apotheke" });
      expect(res.status).toBe(403);
    });

    it("liefert einer auf Haus 1 beschraenkten Leitung fuer Haus 2 ein 404", async () => {
      const res = await post(tokenEL, `/standorte/${standort2Id}/kontakte`, { rolle: "apotheke", name: "Apotheke" });
      expect(res.status).toBe(404);
      const { rows } = await admin.query("SELECT count(*)::int AS n FROM standort_kontakt WHERE standort_id = $1", [standort2Id]);
      expect(rows[0].n).toBe(0);
    });

    it("prueft Rolle und E-Mail (400)", async () => {
      expect((await post(tokenBL, `/standorte/${standort1Id}/kontakte`, { rolle: "freund", name: "X" })).status).toBe(400);
      expect((await post(tokenBL, `/standorte/${standort1Id}/kontakte`, { rolle: "sonstiges", name: "X", email: "kaputt" })).status).toBe(400);
    });

    it("aendert und protokolliert nur geaenderte Felder", async () => {
      const res = await patch(tokenBL, `/standorte/${standort1Id}/kontakte/${kontaktId}`, { name: "Praxis Dr. Linde", telefon: "0123 99" });
      expect(res.status).toBe(200);
      expect(res.body.telefon).toBe("0123 99");
      const { rows } = await admin.query(
        "SELECT vorher, nachher FROM audit_log WHERE objekt_id = $1 AND aktion = 'kontakt-bearbeiten'",
        [kontaktId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].vorher).toEqual({ telefon: "0123 9" });
      expect(rows[0].nachher).toEqual({ telefon: "0123 99" });
    });

    it("loescht nur ueber den eigenen Standort und behaelt den Inhalt im Protokoll", async () => {
      // Kontakt von Haus 1 ueber den Pfad von Haus 2: nicht gefunden.
      expect((await request(http()).delete(`/standorte/${standort2Id}/kontakte/${kontaktId}`).set(auth(tokenBL))).status).toBe(404);
      const res = await request(http()).delete(`/standorte/${standort1Id}/kontakte/${kontaktId}`).set(auth(tokenBL));
      expect(res.status).toBe(204);
      const { rows } = await admin.query("SELECT vorher FROM audit_log WHERE objekt_id = $1 AND aktion = 'kontakt-loeschen'", [kontaktId]);
      expect(rows[0].vorher.name).toBe("Praxis Dr. Linde");
    });

    it("laesst keinen Kontakt an einem Standort eines fremden Mandanten zu (zusammengesetzter FK)", async () => {
      await expect(
        admin.query("INSERT INTO standort_kontakt (mandant_id, standort_id, rolle, name) VALUES ($1, $2, 'polizei', 'X')", [
          mandantId,
          fremderStandortId,
        ])
      ).rejects.toThrow(/foreign key/);
    });

    it("erlaubt der App-Rolle kein Umhaengen an einen anderen Standort", async () => {
      await expect(
        alsApp((c) => c.query("UPDATE standort_kontakt SET standort_id = $1", [standort2Id]))
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("Vereinbarungen: Sichtbarkeit und Rechte", () => {
    let vId: string;

    it("legt mit standorte.vereinbarungen an und protokolliert", async () => {
      const res = await post(tokenBL, `/standorte/${standort1Id}/vereinbarungen`, {
        art: "leistungsvereinbarung",
        partner: "Bezirk Musterland",
        kennung: "LV-2024-17",
        gueltigVon: "2024-01-01",
        plaetze: 12,
        verguetungTagCent: 14250,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("gueltig");
      vId = res.body.id;
      const { rows } = await admin.query("SELECT nachher FROM audit_log WHERE objekt_id = $1 AND aktion = 'vereinbarung-anlegen'", [vId]);
      expect(rows[0].nachher.verguetungTagCent).toBe(14250);
    });

    it("zeigt Vereinbarungen nur mit dem Recht; ohne fehlt das Feld ganz", async () => {
      const bl = await steckbrief(tokenBL, standort1Id);
      expect(bl.body.darfVereinbarungen).toBe(true);
      expect(bl.body.vereinbarungen.map((v: { id: string }) => v.id)).toContain(vId);
      for (const t of [tokenEL, tokenBT]) {
        const res = await steckbrief(t, standort1Id);
        expect(res.status).toBe(200);
        expect(res.body.darfVereinbarungen).toBe(false);
        expect("vereinbarungen" in res.body).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain("14250");
      }
    });

    it("zeigt die genehmigten Plaetze allen, die den Standort sehen", async () => {
      expect((await steckbrief(tokenBT, standort1Id)).body.genehmigtePlaetze).toBe(12);
    });

    it("verweigert der Einrichtungsleitung ohne das Recht Anlegen, Aendern und Storno (403)", async () => {
      expect((await post(tokenEL, `/standorte/${standort1Id}/vereinbarungen`, { art: "sonstige", partner: "X", gueltigVon: "2024-01-01" })).status).toBe(403);
      expect((await patch(tokenEL, `/standorte/${standort1Id}/vereinbarungen/${vId}`, { bemerkung: "x" })).status).toBe(403);
      expect((await post(tokenEL, `/standorte/${standort1Id}/vereinbarungen/${vId}/storno`, { grund: "xyz" })).status).toBe(403);
    });

    it("mit dem Recht in der Matrix: Haus 1 ja, Haus 2 nein (404)", async () => {
      const { rows } = await admin.query<{ id: string }>(
        "SELECT id FROM account_typ WHERE mandant_id = $1 AND name = 'Einrichtungsleitung (Testkonto)'",
        [mandantId]
      );
      await admin.query(
        "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, 'standorte', 'vereinbarungen', 'einrichtung', true)",
        [mandantId, rows[0].id]
      );
      try {
        const body = { art: "betriebserlaubnis", partner: "Heimaufsicht", gueltigVon: "2020-01-01" };
        expect((await post(tokenEL, `/standorte/${standort1Id}/vereinbarungen`, body)).status).toBe(201);
        expect((await post(tokenEL, `/standorte/${standort2Id}/vereinbarungen`, body)).status).toBe(404);
        expect("vereinbarungen" in (await steckbrief(tokenEL, standort1Id)).body).toBe(true);
      } finally {
        await admin.query("DELETE FROM account_typ_recht WHERE account_typ_id = $1 AND modul = 'standorte' AND aktion = 'vereinbarungen'", [rows[0].id]);
      }
    });

    it("aendert nur Laufzeitende, Kennung und Bemerkung", async () => {
      const ok = await patch(tokenBL, `/standorte/${standort1Id}/vereinbarungen/${vId}`, { kennung: "LV-2024-17a", bemerkung: "Nachtrag 1" });
      expect(ok.status).toBe(200);
      expect(ok.body.kennung).toBe("LV-2024-17a");
      expect((await patch(tokenBL, `/standorte/${standort1Id}/vereinbarungen/${vId}`, { verguetungTagCent: 1 })).status).toBe(400);
      expect((await patch(tokenBL, `/standorte/${standort1Id}/vereinbarungen/${vId}`, { gueltigBis: "2023-12-31" })).status).toBe(400);
    });

    it("lehnt ein Ende vor dem Beginn schon beim Anlegen ab (400)", async () => {
      const res = await post(tokenBL, `/standorte/${standort1Id}/vereinbarungen`, {
        art: "sonstige", partner: "X", gueltigVon: "2024-05-01", gueltigBis: "2024-04-01",
      });
      expect(res.status).toBe(400);
    });

    it("storniert endgueltig: danach weder per API noch direkt aenderbar", async () => {
      const s = await post(tokenBL, `/standorte/${standort1Id}/vereinbarungen/${vId}/storno`, { grund: "Plätze falsch erfasst" });
      expect(s.status).toBe(201);
      expect(s.body.status).toBe("storniert");
      expect((await patch(tokenBL, `/standorte/${standort1Id}/vereinbarungen/${vId}`, { bemerkung: "x" })).status).toBe(409);
      await expect(
        alsApp((c) => c.query("UPDATE standort_vereinbarung SET storniert_am = NULL, storniert_von = NULL WHERE id = $1", [vId]))
      ).rejects.toThrow(/storniert/);
      // Stornierte zaehlen nicht mehr als genehmigt.
      expect((await steckbrief(tokenBT, standort1Id)).body.genehmigtePlaetze).toBeNull();
    });
  });

  describe("Vereinbarungen: Datenbank", () => {
    it.each(["partner = 'X'", "plaetze = 99", "verguetung_tag_cent = 1", "gueltig_von = '2000-01-01'", "standort_id = standort_id"])(
      "verweigert der App-Rolle UPDATE SET %s",
      async (setzen) => {
        const id = await vereinbarung(standort1Id, "sonstige", -10, null);
        await expect(alsApp((c) => c.query(`UPDATE standort_vereinbarung SET ${setzen} WHERE id = $1`, [id]))).rejects.toThrow(
          /permission denied/
        );
      }
    );

    it("verweigert der App-Rolle das Loeschen", async () => {
      const id = await vereinbarung(standort1Id, "sonstige", -10, null);
      await expect(alsApp((c) => c.query("DELETE FROM standort_vereinbarung WHERE id = $1", [id]))).rejects.toThrow(/permission denied/);
    });

    it("laesst keine Vereinbarung an einem Standort eines fremden Mandanten zu (zusammengesetzter FK)", async () => {
      await expect(
        admin.query(
          "INSERT INTO standort_vereinbarung (mandant_id, standort_id, art, partner, gueltig_von) VALUES ($1, $2, 'sonstige', 'X', '2024-01-01')",
          [mandantId, fremderStandortId]
        )
      ).rejects.toThrow(/foreign key/);
    });

    it("sieht mit dem Kontext eines anderen Mandanten nichts (RLS)", async () => {
      await vereinbarung(standort1Id, "sonstige", -10, null);
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.mandant_id', $1, true)", [fremdMandantId]);
        const { rows } = await c.query("SELECT count(*)::int AS n FROM standort_vereinbarung WHERE standort_id = $1", [standort1Id]);
        expect(rows[0].n).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        await c.end();
      }
    });
  });

  describe("Status und genehmigte Plaetze (abgeleitet)", () => {
    it("leitet den Status aus Laufzeit und Folgevereinbarung ab", async () => {
      const kuenftig = await vereinbarung(standort2Id, "betriebserlaubnis", 30, null);
      const abgelaufen = await vereinbarung(standort2Id, "sonstige", -400, -5);
      const endetBald = await vereinbarung(standort2Id, "leistungsvereinbarung", -300, 45, { plaetze: 10 });
      const verlaengert = await vereinbarung(standort2Id, "verguetungsvereinbarung", -300, 20);
      await vereinbarung(standort2Id, "verguetungsvereinbarung", 21, 400);
      const gueltig = await vereinbarung(standort2Id, "betriebserlaubnis", -1000, null, { plaetze: 8 });

      const res = await steckbrief(tokenBL, standort2Id);
      const status = Object.fromEntries(res.body.vereinbarungen.map((v: { id: string; status: string }) => [v.id, v.status]));
      expect(status[kuenftig]).toBe("kuenftig");
      expect(status[abgelaufen]).toBe("abgelaufen");
      expect(status[endetBald]).toBe("endet_bald");
      expect(status[verlaengert]).toBe("verlaengert");
      expect(status[gueltig]).toBe("gueltig");
      expect(res.body.vereinbarungen.find((v: { id: string }) => v.id === endetBald).endetInTagen).toBe(45);
      // Die engste heute gueltige Grenze bindet.
      expect(res.body.genehmigtePlaetze).toBe(8);
    });
  });

  describe("Erinnerungen", () => {
    const erinnerungen = async (vId: string) =>
      (
        await admin.query(
          `SELECT e.stufe_tage, a.titel, a.beschreibung, a.zugewiesen_an, a.erstellt_von, a.zimmer_id, a.prioritaet
           FROM standort_vereinbarung_erinnerung e LEFT JOIN aufgabe a ON a.id = e.aufgabe_id
           WHERE e.vereinbarung_id = $1 ORDER BY e.stufe_tage DESC`,
          [vId]
        )
      ).rows;

    let v80: string;
    let v20: string;
    let vOhneLeitung: string;
    let vVerlaengert: string;
    let vStorniert: string;
    let vInaktiv: string;
    let vFern: string;

    beforeAll(async () => {
      v80 = await vereinbarung(standort1Id, "leistungsvereinbarung", -300, 80, { verguetung: 9999 });
      v20 = await vereinbarung(standort1Id, "betriebserlaubnis", -300, 20);
      vOhneLeitung = await vereinbarung(standort2Id, "sonstige", -300, 50);
      vVerlaengert = await vereinbarung(standort1Id, "verguetungsvereinbarung", -300, 70);
      await vereinbarung(standort1Id, "verguetungsvereinbarung", 71, null);
      vStorniert = await vereinbarung(standort1Id, "sonstige", -300, 40);
      await admin.query(
        "UPDATE standort_vereinbarung SET storniert_am = now(), storniert_von = $1, storno_grund = 'Test' WHERE id = $2",
        [blId, vStorniert]
      );
      vInaktiv = await vereinbarung(standortInaktivId, "sonstige", -300, 40);
      vFern = await vereinbarung(standort1Id, "sonstige", -300, 120);
    });

    it("legt eine persoenliche Aufgabe fuer die abgeleitete Leitung an, ohne Verguetung im Text", async () => {
      const ergebnis = await dienst.erzeugen();
      expect(ergebnis.find((e) => e.mandantId === mandantId)?.aufgaben).toBeGreaterThanOrEqual(2);
      const e = await erinnerungen(v80);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({ stufe_tage: 90, zugewiesen_an: leitungId, erstellt_von: leitungId, zimmer_id: null, prioritaet: "normal" });
      expect(e[0].titel).toBe("Haus 1: Leistungsvereinbarung endet in 80 Tagen");
      expect(e[0].beschreibung).toContain("Bezirk Musterland");
      expect(`${e[0].titel} ${e[0].beschreibung}`).not.toMatch(/99[,.]?99|9999/);
    });

    it("legt bei spaet erfasster Vereinbarung nur die dringendste Aufgabe an", async () => {
      const e = await erinnerungen(v20);
      expect(e.map((x) => x.stufe_tage)).toEqual([90, 60, 30]);
      expect(e.filter((x) => x.titel !== null)).toHaveLength(1);
      expect(e[2]).toMatchObject({ stufe_tage: 30, prioritaet: "hoch" });
    });

    it("weist ohne Leitung der Person zu, die die Vereinbarung erfasst hat", async () => {
      const e = await erinnerungen(vOhneLeitung);
      expect(e.find((x) => x.titel)?.zugewiesen_an).toBe(blId);
    });

    it("erinnert nicht bei Folgevereinbarung, Storno, inaktivem Standort oder mehr als 90 Tagen", async () => {
      for (const id of [vVerlaengert, vStorniert, vInaktiv, vFern]) {
        expect(await erinnerungen(id)).toHaveLength(0);
      }
    });

    it("ist idempotent: ein zweiter Lauf legt nichts nach", async () => {
      const vorher = (await admin.query("SELECT count(*)::int AS n FROM aufgabe WHERE mandant_id = $1", [mandantId])).rows[0].n;
      const ergebnis = await dienst.erzeugen();
      expect(ergebnis.find((e) => e.mandantId === mandantId)).toBeUndefined();
      const nachher = (await admin.query("SELECT count(*)::int AS n FROM aufgabe WHERE mandant_id = $1", [mandantId])).rows[0].n;
      expect(nachher).toBe(vorher);
    });

    it("zeigt die Aufgabe der Leitung, aber nicht den Mitarbeitenden des Hauses", async () => {
      // Persoenliche Aufgabe: RLS laesst nur Ersteller:in und Zugewiesene sehen.
      const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await c.query("SELECT set_config('app.benutzer_id', $1, true)", [elId]);
        const { rows } = await c.query("SELECT count(*)::int AS n FROM aufgabe WHERE titel LIKE 'Haus 1:%'");
        expect(rows[0].n).toBe(0);
        await c.query("SELECT set_config('app.benutzer_id', $1, true)", [leitungId]);
        const { rows: r2 } = await c.query("SELECT count(*)::int AS n FROM aufgabe WHERE titel LIKE 'Haus 1:%'");
        expect(r2[0].n).toBe(2);
      } finally {
        await c.query("ROLLBACK");
        await c.end();
      }
    });

    it("sperrt die Erinnerungstabelle fuer die App-Rolle", async () => {
      await expect(
        alsApp((c) =>
          c.query("INSERT INTO standort_vereinbarung_erinnerung (mandant_id, vereinbarung_id, stufe_tage) VALUES ($1, $2, 90)", [mandantId, vFern])
        )
      ).rejects.toThrow(/permission denied/);
    });
  });
});
