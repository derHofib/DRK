/**
 * Loeschfrist fuer Klientendaten nach der Archivierung (migrations/0070).
 *
 * Kernaussagen, jeweils mit Gegenprobe gegen "zu frueh geloescht":
 *   1. Ohne gesetzte Frist (Standard) wird nie etwas anonymisiert.
 *   2. Vor Ablauf der Frist bleibt jede Person unberuehrt -- auch eine
 *      archivierte, auch eine seit Tagen ausgezogene, aber nicht archivierte.
 *   3. Nach Ablauf werden Name, Stammdaten, Kontakte und Aktenauszuege
 *      entfernt; das Aktenzeichen (Referenz der Belege) bleibt.
 *   4. Wer aktuell belegt ist, wird nie angefasst.
 *   5. Die Frist gilt je Mandant; Entarchivieren startet sie neu.
 *   6. Einstellen nur mit Recht und innerhalb 30..7300 Tage.
 *
 * Seed-Daten mit der Admin-Rolle, nur so lassen sich alte Zeitstempel setzen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { KlientLoeschfristService } from "../src/klienten/klient-loeschfrist.service";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Klienten-Löschfrist", () => {
  let app: INestApplication;
  let admin: Client;
  let dienst: KlientLoeschfristService;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const slugA = `test-klf-a-${suffix}`;
  const slugB = `test-klf-b-${suffix}`;
  let mandantAId: string;
  let mandantBId: string;
  let leitungId: string;
  let tokenLeitung: string;
  let tokenBetreuer: string;
  let tokenVollzugriff: string;
  let zimmerId: string;

  const http = () => app.getHttpServer();

  const tageHer = (n: number) => `now() - interval '${n} days'`;

  async function klient(mandantId: string, vorname: string, opts: { archiviertVorTagen?: number } = {}) {
    const id = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, $2, 'Muster', '2005-01-01', $3, 'Jugendamt') RETURNING id`,
        [mandantId, vorname, `KLF-${vorname}-${suffix}`]
      )
    ).rows[0].id as string;
    if (opts.archiviertVorTagen !== undefined) {
      await admin.query(`UPDATE klient SET archiviert_am = ${tageHer(opts.archiviertVorTagen)}, archiviert_von = $2 WHERE id = $1`, [
        id,
        leitungId,
      ]);
    }
    await admin.query("INSERT INTO klient_stammdaten (mandant_id, klient_id, diagnosen) VALUES ($1, $2, 'Diagnose')", [mandantId, id]);
    await admin.query("INSERT INTO klient_kontakt (mandant_id, klient_id, name) VALUES ($1, $2, 'Mutter')", [mandantId, id]);
    await admin.query("INSERT INTO klient_archiv_pdf (mandant_id, klient_id, pdf, pdf_hash) VALUES ($1, $2, 'x', 'h')", [mandantId, id]);
    return id;
  }

  const zeile = async (id: string) =>
    (
      await admin.query(
        `SELECT vorname, anonymisiert_am, anonymisiert_automatisch,
                (SELECT count(*) FROM klient_stammdaten WHERE klient_id = k.id)::int AS stammdaten,
                (SELECT count(*) FROM klient_kontakt WHERE klient_id = k.id)::int AS kontakte,
                (SELECT count(*) FROM klient_archiv_pdf WHERE klient_id = k.id)::int AS pdfs
         FROM klient k WHERE id = $1`,
        [id]
      )
    ).rows[0];

  const setzeFrist = (mandantId: string, tage: number | null) =>
    admin.query("UPDATE mandant SET klient_loeschfrist_tage = $2 WHERE id = $1", [mandantId, tage]);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`KLF A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`KLF B ${suffix}`, slugB])).rows[0].id;
    leitungId = await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "einrichtungsleitung", email: `leitung-${suffix}@beispiel.test`, name: "Anna Leitung", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "bereichsleitung", email: `vollzugriff-${suffix}@beispiel.test`, name: "Vera Vollzugriff", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "betreuer", email: `betreuer-${suffix}@beispiel.test`, name: "Bernd Betreuer", passwortHash: hash });

    const standortId = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S', 'Weg 1') RETURNING id", [mandantAId])).rows[0].id;
    zimmerId = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '1') RETURNING id", [mandantAId, standortId])).rows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dienst = app.get(KlientLoeschfristService);

    const login = async (kurz: string) =>
      (await request(http()).post("/auth/login").send({ mandantSlug: slugA, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenLeitung = await login("leitung");
    tokenVollzugriff = await login("vollzugriff");
    tokenBetreuer = await login("betreuer");
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      for (const t of ["belegung", "klient_archiv_pdf", "klient_kontakt", "klient_stammdaten", "klient_zugang", "zimmer", "standort"]) {
        await admin.query(`DELETE FROM ${t} WHERE mandant_id = ANY($1)`, [ids]).catch(() => undefined);
      }
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = ANY($1)", [ids]).catch(() => undefined);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  afterEach(async () => {
    await setzeFrist(mandantAId, null);
    await setzeFrist(mandantBId, null);
  });

  it("ohne gesetzte Frist wird nichts anonymisiert, auch nach 10 Jahren nicht", async () => {
    const id = await klient(mandantAId, "Ohne", { archiviertVorTagen: 3650 });
    const ergebnis = (await dienst.anwenden()).filter((e) => e.mandantId === mandantAId);
    expect(ergebnis).toEqual([]);
    expect((await zeile(id)).anonymisiert_am).toBeNull();
  });

  it("vor Ablauf der Frist bleibt alles stehen: archiviert vor 29 Tagen bei Frist 30", async () => {
    const id = await klient(mandantAId, "Frisch", { archiviertVorTagen: 29 });
    await setzeFrist(mandantAId, 30);
    await dienst.anwenden();
    const z = await zeile(id);
    expect(z.anonymisiert_am).toBeNull();
    expect(z.vorname).toBe("Frisch");
    expect([z.stammdaten, z.kontakte, z.pdfs]).toEqual([1, 1, 1]);
  });

  it("nicht archivierte Person bleibt, auch wenn sie seit Jahren ausgezogen ist", async () => {
    const id = await klient(mandantAId, "Ausgezogen");
    await admin.query("INSERT INTO belegung (mandant_id, klient_id, zimmer_id, einzug, auszug) VALUES ($1, $2, $3, '2015-01-01', '2016-01-01')", [mandantAId, id, zimmerId]);
    await setzeFrist(mandantAId, 30);
    await dienst.anwenden();
    expect((await zeile(id)).anonymisiert_am).toBeNull();
  });

  it("nach Ablauf: Name, Stammdaten, Kontakte, Aktenauszug weg; Aktenzeichen bleibt", async () => {
    const id = await klient(mandantAId, "Alt", { archiviertVorTagen: 31 });
    await setzeFrist(mandantAId, 30);
    const ergebnis = (await dienst.anwenden()).find((e) => e.mandantId === mandantAId);
    expect(ergebnis?.klienten).toBeGreaterThanOrEqual(1);
    const z = await zeile(id);
    expect(z.vorname).toBe("Anonymisiert");
    expect(z.anonymisiert_am).not.toBeNull();
    expect(z.anonymisiert_automatisch).toBe(true);
    expect([z.stammdaten, z.kontakte, z.pdfs]).toEqual([0, 0, 0]);
    const az = (await admin.query("SELECT aktenzeichen FROM klient WHERE id = $1", [id])).rows[0].aktenzeichen;
    expect(az).toBe(`KLF-Alt-${suffix}`);
  });

  it("aktuell belegte Person wird nie angefasst, selbst bei widerspruechlichen Daten", async () => {
    const id = await klient(mandantAId, "Belegt", { archiviertVorTagen: 400 });
    await admin.query("INSERT INTO belegung (mandant_id, klient_id, zimmer_id, einzug, auszug) VALUES ($1, $2, $3, '2020-01-01', NULL)", [mandantAId, id, zimmerId]);
    await setzeFrist(mandantAId, 30);
    await dienst.anwenden();
    expect((await zeile(id)).anonymisiert_am).toBeNull();
  });

  it("die Frist gilt je Mandant: Mandant B ohne Frist behaelt seine alte Person", async () => {
    const a = await klient(mandantAId, "AltA", { archiviertVorTagen: 100 });
    const b = await klient(mandantBId, "AltB", { archiviertVorTagen: 100 });
    await setzeFrist(mandantAId, 30);
    await dienst.anwenden();
    expect((await zeile(a)).anonymisiert_am).not.toBeNull();
    expect((await zeile(b)).anonymisiert_am).toBeNull();
  });

  it("Entarchivieren startet die Frist neu", async () => {
    const id = await klient(mandantAId, "Zurueck", { archiviertVorTagen: 400 });
    await setzeFrist(mandantAId, 30);
    const res = await request(http()).patch(`/klienten/${id}/entarchivieren`).set("Authorization", `Bearer ${tokenLeitung}`);
    expect(res.status).toBeLessThan(300);
    await dienst.anwenden();
    expect((await zeile(id)).anonymisiert_am).toBeNull();
    // erneut archivieren: archiviert_am ist jetzt, nicht vor 400 Tagen.
    await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [id, leitungId]);
    await dienst.anwenden();
    expect((await zeile(id)).anonymisiert_am).toBeNull();
  });

  it("manuelle Anonymisierung entfernt jetzt ebenfalls Stammdaten, Kontakte und Aktenauszuege", async () => {
    const id = await klient(mandantAId, "Manuell");
    const res = await request(http()).patch(`/klienten/${id}/anonymisieren`).set("Authorization", `Bearer ${tokenLeitung}`);
    expect(res.status).toBeLessThan(300);
    const z = await zeile(id);
    expect(z.anonymisiert_automatisch).toBe(false);
    expect([z.stammdaten, z.kontakte, z.pdfs]).toEqual([0, 0, 0]);
  });

  describe("Einstellung", () => {
    const patch = (token: string, body: object) =>
      request(http()).patch("/mandant/me/klient-loeschfrist").set("Authorization", `Bearer ${token}`).send(body);

    it("Leitung setzt und loescht die Frist", async () => {
      const a = await patch(tokenVollzugriff, { tage: 365 });
      expect(a.status).toBe(200);
      expect(a.body.klientLoeschfristTage).toBe(365);
      const b = await patch(tokenVollzugriff, { tage: null });
      expect(b.status).toBe(200);
      expect(b.body.klientLoeschfristTage).toBeNull();
    });

    it("Betreuer:in bekommt 403 und die Frist bleibt", async () => {
      await setzeFrist(mandantAId, 500);
      const res = await patch(tokenBetreuer, { tage: 30 });
      expect(res.status).toBe(403);
      expect((await admin.query("SELECT klient_loeschfrist_tage t FROM mandant WHERE id = $1", [mandantAId])).rows[0].t).toBe(500);
    });

    it.each([[29], [7301], [0], [1.5]])("%p Tage werden mit 400 abgelehnt", async (tage) => {
      expect((await patch(tokenVollzugriff, { tage })).status).toBe(400);
    });

    it("die Datenbank lehnt 7 Tage auch an der API vorbei ab", async () => {
      await expect(setzeFrist(mandantAId, 7)).rejects.toThrow();
    });
  });
});
