/**
 * Standort-Sicht (Migration 0084, Konzept standort-sichtbarkeit):
 *   - mit "Sicht aus dem Rang" sieht, wer laut Rang an einem Haus arbeitet,
 *     nur dieses Haus -- vorher sah er alles, weil keine feste Sicht gesetzt war;
 *   - Rang ohne Einrichtung = sieht nichts (geschlossen statt offen);
 *   - eine GENEHMIGTE, heute laufende Vertretung macht die mitgegebenen
 *     Standorte sichtbar, beantragt/widerrufen/abgelaufen nicht;
 *   - man gibt nur weiter, was man selbst sieht;
 *   - Vorschau und Umschalten nur mit Recht bzw. Vollzugriff;
 *   - die Chat-Funktion aus 0057 folgt derselben Regel.
 *
 * Aufbau: Haus A (Klientin KA) und Haus B (Klientin KB), dazu Haus C ohne
 * Klient:innen. "Mitarbeiter" ist ein Sammelrang am Traeger; Aylin arbeitet
 * an A, Carla an B, Tom hat den Rang ohne Haken. Die Geschaeftsfuehrung
 * (Vollzugriff) ist die eingebaute Gegenprobe: gleiche Endpunkte, alles sichtbar.
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

describe("Standort-Sicht: Regel aus dem Rang, Vertretung, Vorschau", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-sicht-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows: m } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Sicht ${suffix}`, mandantSlug]
    );
    mandantId = m[0].id;

    for (const name of ["A", "B", "C"]) {
      const { rows } = await admin.query<{ id: string }>(
        "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Str. 1') RETURNING id",
        [mandantId, `Haus ${name}`]
      );
      id[`s${name}`] = rows[0].id;
      const { rows: ou } = await admin.query<{ id: string }>("SELECT id FROM org_unit WHERE standort_id = $1", [rows[0].id]);
      id[`ou${name}`] = ou[0].id;
      const { rows: z } = await admin.query<{ id: string }>(
        "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '1') RETURNING id",
        [mandantId, rows[0].id]
      );
      id[`z${name}`] = z[0].id;
    }
    for (const name of ["A", "B"]) {
      const { rows: k } = await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Klient', $2, '1990-01-01', $3, 'Testamt') RETURNING id`,
        [mandantId, `Haus${name}`, `AZ-${name}-${suffix}`]
      );
      id[`k${name}`] = k[0].id;
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
        mandantId,
        id[`z${name}`],
        k[0].id,
      ]);
    }

    id.gf = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "bereichsleitung", email: `gf-${suffix}@beispiel.test`, name: "Geschäftsführung", passwortHash,
    });
    // Einrichtungsleitung am Traeger (kein Sammelrang): sieht mit beiden Regeln alles.
    id.el = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "einrichtungsleitung", email: `el-${suffix}@beispiel.test`, name: "Leitung", passwortHash,
    });
    // Drei Mitarbeitende auf dem Betreuer-Rang -- die Position wird danach zum
    // Sammelrang am Traeger, wie "Mitarbeiter" in echten Traegern (0067).
    for (const [kurz, name] of [["aylin", "Aylin"], ["carla", "Carla"], ["tom", "Tom"]]) {
      id[kurz] = await kontoMitAlterRolle(admin, {
        mandantId, rolle: "betreuer", email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash,
      });
    }
    await admin.query(
      `UPDATE org_position SET ist_sammelrang = true
       WHERE mandant_id = $1 AND titel = 'Mitarbeiter (Testkonto)'`,
      [mandantId]
    );
    for (const [kurz, ou] of [["aylin", id.ouA], ["carla", id.ouB]]) {
      await admin.query(
        `INSERT INTO org_position_besetzung_einheit (mandant_id, besetzung_id, org_unit_id)
         SELECT $1, pb.id, $3 FROM org_position_besetzung pb WHERE pb.benutzer_id = $2`,
        [mandantId, id[kurz], ou]
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    for (const kurz of ["gf", "el", "aylin", "carla", "tom"]) {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug, email: `${kurz}-${suffix}@beispiel.test`, passwort });
      t[kurz] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const http = () => app.getHttpServer();
  const get = (wer: string, pfad: string) => request(http()).get(pfad).set("Authorization", `Bearer ${t[wer]}`);
  const put = (wer: string, pfad: string, body: object) =>
    request(http()).put(pfad).set("Authorization", `Bearer ${t[wer]}`).send(body);
  const post = (wer: string, pfad: string, body: object) =>
    request(http()).post(pfad).set("Authorization", `Bearer ${t[wer]}`).send(body);
  const patch = (wer: string, pfad: string) => request(http()).patch(pfad).set("Authorization", `Bearer ${t[wer]}`);
  const klientenIds = async (wer: string) => ((await get(wer, "/klienten")).body as { id: string }[]).map((k) => k.id);
  const heute = () => new Date().toISOString().slice(0, 10);

  /** Wie die Chat-Policy die Klient:in sieht: als App-Rolle im Tenant-Kontext. */
  async function chatSieht(benutzerId: string, klientId: string): Promise<boolean> {
    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL ROLE zimmerakte_app");
      await admin.query("SELECT set_config('app.mandant_id', $1, true), set_config('app.benutzer_id', $2, true)", [
        mandantId,
        benutzerId,
      ]);
      const { rows } = await admin.query<{ ja: boolean }>("SELECT chat_anfrage_klient_sichtbar($1) AS ja", [klientId]);
      return rows[0].ja;
    } finally {
      await admin.query("ROLLBACK");
    }
  }

  describe("vor dem Umschalten (bisherige Regel)", () => {
    it("Aylin sieht ohne feste Sicht noch beide Haeuser", async () => {
      expect(await klientenIds("aylin")).toEqual(expect.arrayContaining([id.kA, id.kB]));
      expect((await get("aylin", "/benutzer/ich")).body.sicht).toEqual({ alle: true, eintraege: [] });
    });

    it("die Vorschau nennt Aylin, Carla und Tom als 'sieht weniger', nicht die Leitung", async () => {
      const res = await get("gf", "/benutzer/standort-sicht/vorschau");
      expect(res.status).toBe(200);
      expect(res.body.ausRang).toBe(false);
      expect(res.body.darfUmschalten).toBe(true);
      const weniger = (res.body.personen as { benutzerId: string; weniger: boolean }[])
        .filter((p) => p.weniger)
        .map((p) => p.benutzerId)
        .sort();
      expect(weniger).toEqual([id.aylin, id.carla, id.tom].sort());
      const aylin = res.body.personen.find((p: { benutzerId: string }) => p.benutzerId === id.aylin);
      expect(aylin.heute.alle).toBe(true);
      expect(aylin.andereRegel.eintraege).toEqual([
        { standortId: id.sA, standortName: "Haus A", herkunft: "rang", bis: null, vertretenerName: null },
      ]);
    });

    it("Vorschau braucht das Recht, Umschalten den Vollzugriff", async () => {
      expect((await get("aylin", "/benutzer/standort-sicht/vorschau")).status).toBe(403);
      expect((await get("el", "/benutzer/standort-sicht/vorschau")).status).toBe(200);
      expect((await put("el", "/benutzer/standort-sicht/regel", { ausRang: true })).status).toBe(403);
      expect((await put("gf", "/benutzer/standort-sicht/regel", { ausRang: "ja" })).status).toBe(400);
      const { rows } = await admin.query("SELECT standort_sicht_aus_rang FROM mandant WHERE id = $1", [mandantId]);
      expect(rows[0].standort_sicht_aus_rang).toBe(false);
    });
  });

  describe("nach dem Umschalten", () => {
    beforeAll(async () => {
      const res = await put("gf", "/benutzer/standort-sicht/regel", { ausRang: true });
      expect(res.status).toBe(200);
      expect(res.body.ausRang).toBe(true);
    });

    it("steht im audit_log", async () => {
      const { rows } = await admin.query(
        "SELECT nachher FROM audit_log WHERE mandant_id = $1 AND aktion = 'standort-regel'",
        [mandantId]
      );
      expect(rows).toEqual([{ nachher: { standortSichtAusRang: true } }]);
    });

    it("Aylin sieht nur Haus A: Liste, Akte und Chat", async () => {
      expect(await klientenIds("aylin")).toEqual([id.kA]);
      expect((await get("aylin", `/klienten/${id.kA}`)).status).toBe(200);
      expect((await get("aylin", `/klienten/${id.kB}`)).status).toBe(404);
      expect(await chatSieht(id.aylin, id.kB)).toBe(false);
      expect(await chatSieht(id.aylin, id.kA)).toBe(true);
      expect((await get("aylin", "/benutzer/ich")).body.sicht).toEqual({
        alle: false,
        eintraege: [{ standortId: id.sA, standortName: "Haus A", herkunft: "rang", bis: null, vertretenerName: null }],
      });
    });

    it("Gegenprobe: Geschaeftsfuehrung und Leitung am Traeger sehen weiter beide", async () => {
      expect(await klientenIds("gf")).toEqual(expect.arrayContaining([id.kA, id.kB]));
      expect(await klientenIds("el")).toEqual(expect.arrayContaining([id.kA, id.kB]));
      expect(await chatSieht(id.gf, id.kB)).toBe(true);
    });

    it("Tom (Rang ohne Haken) sieht nichts statt alles", async () => {
      expect(await klientenIds("tom")).toEqual([]);
      expect((await get("tom", "/benutzer/ich")).body.sicht).toEqual({ alle: false, eintraege: [] });
    });

    it("eine feste Sicht geht vor dem Rang", async () => {
      await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
        mandantId,
        id.tom,
        id.sB,
      ]);
      try {
        expect(await klientenIds("tom")).toEqual([id.kB]);
        expect((await get("tom", "/benutzer/ich")).body.sicht.eintraege[0].herkunft).toBe("fest");
      } finally {
        await admin.query("DELETE FROM benutzer_standort WHERE benutzer_id = $1", [id.tom]);
      }
    });
  });

  describe("Vertretung", () => {
    let vertretungId: string;

    it("Carla kann nur ihren eigenen Standort weitergeben", async () => {
      const res = await post("carla", "/delegationen", {
        vertreterBenutzerId: id.aylin, von: heute(), bis: heute(), umfang: "alle", standortIds: [id.sC],
      });
      expect(res.status).toBe(403);
      const { rows } = await admin.query("SELECT 1 FROM delegation WHERE vertretener_benutzer_id = $1", [id.carla]);
      expect(rows).toHaveLength(0);
    });

    it("beantragt: Aylin sieht Haus B noch nicht", async () => {
      const res = await post("carla", "/delegationen", {
        vertreterBenutzerId: id.aylin, von: heute(), bis: heute(), umfang: "alle", standortIds: [id.sB],
      });
      expect(res.status).toBe(201);
      expect(res.body.standorte).toEqual([{ id: id.sB, name: "Haus B" }]);
      vertretungId = res.body.id;
      expect(await klientenIds("aylin")).toEqual([id.kA]);
    });

    it("genehmigt und heute laufend: Aylin sieht Haus B mit Herkunft Vertretung", async () => {
      expect((await patch("aylin", `/delegationen/${vertretungId}/genehmigen`)).status).toBe(200);
      expect((await klientenIds("aylin")).sort()).toEqual([id.kA, id.kB].sort());
      expect((await get("aylin", `/klienten/${id.kB}`)).status).toBe(200);
      expect(await chatSieht(id.aylin, id.kB)).toBe(true);
      const sicht = (await get("aylin", "/benutzer/ich")).body.sicht;
      expect(sicht.eintraege).toContainEqual({
        standortId: id.sB, standortName: "Haus B", herkunft: "vertretung", bis: heute(), vertretenerName: "Carla",
      });
    });

    it("keine Kette: Aylin kann den geliehenen Standort nicht weitergeben", async () => {
      const res = await post("aylin", "/delegationen", {
        vertreterBenutzerId: id.tom, von: heute(), bis: heute(), umfang: "alle", standortIds: [id.sB],
      });
      expect(res.status).toBe(403);
    });

    it("abgelaufen: ab dem Tag nach 'bis' wieder nur Haus A", async () => {
      await admin.query("UPDATE delegation SET von = von - 3, bis = CURRENT_DATE - 1 WHERE id = $1", [vertretungId]);
      try {
        expect(await klientenIds("aylin")).toEqual([id.kA]);
      } finally {
        await admin.query("UPDATE delegation SET bis = CURRENT_DATE WHERE id = $1", [vertretungId]);
      }
      expect(await klientenIds("aylin")).toHaveLength(2);
    });

    it("widerrufen: sofort wieder nur Haus A", async () => {
      expect((await patch("carla", `/delegationen/${vertretungId}/widerrufen`)).status).toBe(200);
      expect(await klientenIds("aylin")).toEqual([id.kA]);
      expect(await chatSieht(id.aylin, id.kB)).toBe(false);
    });

    it("delegation_standort ist nicht nachtraeglich aenderbar", async () => {
      await admin.query("BEGIN");
      try {
        await admin.query("SET LOCAL ROLE zimmerakte_app");
        await admin.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(admin.query("UPDATE delegation_standort SET standort_id = standort_id")).rejects.toThrow(/permission denied/);
      } finally {
        await admin.query("ROLLBACK");
      }
    });
  });

  it("zurueckschalten stellt die alte Regel wieder her", async () => {
    expect((await put("gf", "/benutzer/standort-sicht/regel", { ausRang: false })).status).toBe(200);
    expect(await klientenIds("aylin")).toEqual(expect.arrayContaining([id.kA, id.kB]));
  });
});
