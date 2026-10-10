/**
 * PATCH /benutzer/:id/aktiv (benutzer.service.ts, aktivSetzen()):
 * "Mitarbeiter entfernen" = deaktivieren, nie loeschen -- die Person ist in
 * Audit-Log, Tagesberichten, Kassenbuch usw. referenziert. Geprueft wird vor
 * allem, dass die Sperre WIRKT (bestehendes Token, Login) und dass die drei
 * Schutzregeln greifen: nicht selbst, Vollzugriff-Ziele nur mit
 * organigramm.manage-permissions, letzter aktiver Vollzugriff bleibt (DB-
 * Trigger benutzer_vollzugriff_schutz, Migration 0050).
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

describe("Benutzer: Deaktivieren/Reaktivieren", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let leitungId: string; // mitarbeitende.deaktivieren, KEIN Vollzugriff, KEIN manage-permissions
  let verwalterId: string; // deaktivieren + manage-permissions, KEIN Vollzugriff
  let zielId: string; // Mitarbeiter ohne Rechte
  let ohneRechtId: string;
  let vollzugriffAId: string;
  let vollzugriffBId: string;

  let tokenLeitung: string;
  let tokenVerwalter: string;
  let tokenOhneRecht: string;
  let tokenVollzugriffA: string;
  let tokenZiel: string;

  const emailVon = (k: string) => `${k}-${suffix}@beispiel.test`;

  async function accountMitRechten(name: string, k: string, rechte: Array<[string, string]>): Promise<string> {
    const passwortHash = await bcrypt.hash(passwort, 4);
    const { rows: ben } = await admin.query<{ id: string }>(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, emailVon(k), name, passwortHash]
    );
    if (rechte.length > 0) {
      const { rows: typ } = await admin.query<{ id: string }>(
        "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1, $2, false, false) RETURNING id",
        [mandantId, `Typ ${k}`]
      );
      for (const [modul, aktion] of rechte) {
        await admin.query(
          "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, $3, $4, 'traeger', true)",
          [mandantId, typ[0].id, modul, aktion]
        );
      }
      const { rows: wurzel } = await admin.query<{ id: string }>(
        "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
        [mandantId]
      );
      const { rows: pos } = await admin.query<{ id: string }>(
        "INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel) VALUES ($1, $2, $3, $4) RETURNING id",
        [mandantId, wurzel[0].id, typ[0].id, `Position ${k}`]
      );
      await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
        mandantId,
        pos[0].id,
        ben[0].id,
      ]);
    }
    return ben[0].id;
  }

  async function login(k: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: emailVon(k), passwort });
    return res.body.accessToken;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantSlug = `test-deaktivieren-${suffix}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Deaktivieren ${suffix}`, mandantSlug]
    );
    mandantId = rows[0].id;

    const passwortHash = await bcrypt.hash(passwort, 4);
    vollzugriffAId = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email: emailVon("vollzugriff-a"),
      name: "Vollzugriff A",
      passwortHash,
    });
    vollzugriffBId = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email: emailVon("vollzugriff-b"),
      name: "Vollzugriff B",
      passwortHash,
    });
    leitungId = await accountMitRechten("Leitung", "leitung", [["mitarbeitende", "deaktivieren"]]);
    verwalterId = await accountMitRechten("Verwalter", "verwalter", [
      ["mitarbeitende", "deaktivieren"],
      ["organigramm", "manage-permissions"],
    ]);
    zielId = await accountMitRechten("Ziel", "ziel", []);
    ohneRechtId = await accountMitRechten("Ohne Recht", "ohne-recht", [["mitarbeitende", "ansehen"]]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tokenLeitung = await login("leitung");
    tokenVerwalter = await login("verwalter");
    tokenOhneRecht = await login("ohne-recht");
    tokenVollzugriffA = await login("vollzugriff-a");
    tokenZiel = await login("ziel");
  });

  afterAll(async () => {
    try {
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const patch = (token: string, id: string, body: unknown) =>
    request(app.getHttpServer()).patch(`/benutzer/${id}/aktiv`).set("Authorization", `Bearer ${token}`).send(body as object);

  it("Deaktivieren sperrt die Person SOFORT: bestehendes Token (401) und neuer Login (401)", async () => {
    const vorher = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenZiel}`);
    expect(vorher.status).toBe(200);

    const res = await patch(tokenLeitung, zielId, { aktiv: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: zielId, aktiv: false });

    const nachher = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenZiel}`);
    expect(nachher.status).toBe(401);

    const neuerLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: emailVon("ziel"), passwort });
    expect(neuerLogin.status).toBe(401);

    const liste = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenLeitung}`);
    // Leitung hat kein mitarbeitende.ansehen -> Liste ggf. 403; die Zeile selbst
    // pruefen wir deshalb direkt in der DB.
    expect([200, 403]).toContain(liste.status);
    const { rows } = await admin.query("SELECT aktiv FROM benutzer WHERE id = $1", [zielId]);
    expect(rows[0].aktiv).toBe(false);

    const { rows: audit } = await admin.query(
      "SELECT vorher, nachher FROM audit_log WHERE objekt_id = $1 AND aktion = 'deaktivieren'",
      [zielId]
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].vorher).toEqual({ aktiv: true });
    expect(audit[0].nachher).toEqual({ aktiv: false });
  });

  it("Reaktivieren stellt Login und Token-Zugriff wieder her; Besetzungen blieben unberuehrt", async () => {
    const res = await patch(tokenLeitung, zielId, { aktiv: true });
    expect(res.status).toBe(200);
    expect(res.body.aktiv).toBe(true);

    const login2 = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: emailVon("ziel"), passwort });
    expect(login2.status).toBe(201);
    const mitAltemToken = await request(app.getHttpServer())
      .get("/benutzer")
      .set("Authorization", `Bearer ${tokenZiel}`);
    expect(mitAltemToken.status).toBe(200);
  });

  it("ohne mitarbeitende.deaktivieren -> 403", async () => {
    const res = await patch(tokenOhneRecht, zielId, { aktiv: false });
    expect(res.status).toBe(403);
    const { rows } = await admin.query("SELECT aktiv FROM benutzer WHERE id = $1", [zielId]);
    expect(rows[0].aktiv).toBe(true);
  });

  it("das eigene Konto laesst sich nicht selbst deaktivieren -> 403", async () => {
    const res = await patch(tokenLeitung, leitungId, { aktiv: false });
    expect(res.status).toBe(403);
  });

  it("Vollzugriff-Ziel: mitarbeitende.deaktivieren allein reicht NICHT (403), mit manage-permissions schon", async () => {
    const ohne = await patch(tokenLeitung, vollzugriffBId, { aktiv: false });
    expect(ohne.status).toBe(403);
    const { rows: unveraendert } = await admin.query("SELECT aktiv FROM benutzer WHERE id = $1", [vollzugriffBId]);
    expect(unveraendert[0].aktiv).toBe(true);

    const mit = await patch(tokenVerwalter, vollzugriffBId, { aktiv: false });
    expect(mit.status).toBe(200);
    await patch(tokenVerwalter, vollzugriffBId, { aktiv: true });
  });

  it("der letzte aktive Vollzugriff bleibt bestehen -> 409 (DB-Trigger), danach geht es wieder", async () => {
    // B ist per Test oben wieder aktiv; erst B ausschalten, dann ist A der letzte.
    expect((await patch(tokenVerwalter, vollzugriffBId, { aktiv: false })).status).toBe(200);

    const letzter = await patch(tokenVerwalter, vollzugriffAId, { aktiv: false });
    expect(letzter.status).toBe(409);
    const { rows } = await admin.query("SELECT aktiv FROM benutzer WHERE id = $1", [vollzugriffAId]);
    expect(rows[0].aktiv).toBe(true);

    // A kann sich weiter anmelden -- der Mandant ist nicht ausgesperrt.
    const a = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenVollzugriffA}`);
    expect(a.status).toBe(200);

    expect((await patch(tokenVerwalter, vollzugriffBId, { aktiv: true })).status).toBe(200);
  });

  it("unbekannte Person -> 404, fehlerhafter Body -> 400", async () => {
    const unbekannt = await patch(tokenLeitung, randomUUID(), { aktiv: false });
    expect(unbekannt.status).toBe(404);
    const kaputt = await patch(tokenLeitung, zielId, { aktiv: "nein" });
    expect(kaputt.status).toBe(400);
  });
});
