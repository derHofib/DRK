/**
 * Leitung & Team als Personenkarten im Standort-Steckbrief
 * (Rueckmeldung "Standorte Mitarbeiter", Konzept standort-team).
 *
 * Sicherheitsrelevant:
 *   - Den GRUND einer Abwesenheit sieht nur die Person selbst und wer
 *     abwesenheiten.art-sehen hat -- wie im Kalender. Alle anderen sehen
 *     nur, DASS und bis wann; "krank" taucht im JSON nicht auf.
 *   - Weitere Standorte einer Person erscheinen nur, wenn die betrachtende
 *     Person diesen Standort selbst sehen darf.
 * Fachlich:
 *   - Leitung zuerst, dann alphabetisch; Zahl = Karten.
 *   - Bezugsbetreuung zaehlt nur Klient:innen mit laufender Belegung an
 *     DIESEM Standort.
 *   - Stornierte und kuenftige Abwesenheiten zaehlen nicht.
 *   - Unbesetzte Leitungsstellen werden gemeldet, andere offene Stellen nicht.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import type { StandortTeamPersonDto } from "@zimmerakte/shared";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

describe("Standort-Steckbrief: Leitung & Team", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let tokenBereichsleitung: string;
  let tokenBetreuer: string;
  let tokenKrank: string;
  let standort1Id: string;
  let standort2Id: string;
  let leitungId: string;
  let betreuerId: string;
  let krankId: string;
  let krankBis: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const mandantSlug = `test-team-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const ins = async (sql: string, p: unknown[]) => (await admin.query<{ id: string }>(sql, p)).rows[0].id;

    mandantId = await ins("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Team ${suffix}`, mandantSlug]);
    standort1Id = await ins("INSERT INTO standort (mandant_id, name, strasse) VALUES ($1, 'Haus 1', 'a') RETURNING id", [mandantId]);
    standort2Id = await ins("INSERT INTO standort (mandant_id, name, strasse) VALUES ($1, 'Haus 2', 'b') RETURNING id", [mandantId]);

    await kontoMitAlterRolle(admin, { mandantId, rolle: "bereichsleitung", email: `bl-${suffix}@beispiel.test`, name: "Bereich", passwortHash });
    betreuerId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "betreuer", email: `bt-${suffix}@beispiel.test`, name: "Ben Wagner", passwortHash,
    });
    krankId = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "betreuer", email: `kr-${suffix}@beispiel.test`, name: "Aylin Demir", passwortHash,
    });
    const zuordnen = (b: string, s: string) =>
      admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, b, s]);
    await zuordnen(betreuerId, standort1Id);
    await zuordnen(krankId, standort1Id);

    // Leitung ueber das Organigramm, zusaetzlich auch Haus 2 zugeordnet.
    const { rows: ou } = await admin.query<{ id: string }>("SELECT id FROM org_unit WHERE standort_id = $1", [standort1Id]);
    const { rows: at } = await admin.query<{ id: string }>("SELECT id FROM account_typ WHERE mandant_id = $1 LIMIT 1", [mandantId]);
    leitungId = await ins(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, 'Sabine Kröger', $3) RETURNING id",
      [mandantId, `leitung-${suffix}@beispiel.test`, passwortHash]
    );
    const position = (titel: string) =>
      ins("INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id", [
        mandantId, ou[0].id, titel, at[0].id,
      ]);
    const elPos = await position("Einrichtungsleitung");
    await admin.query(
      "INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id, gueltig_ab) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, elPos, leitungId]
    );
    await zuordnen(leitungId, standort2Id);
    // Zwei offene Stellen: nur die Leitungsstelle soll gemeldet werden.
    await position("Stellv. Einrichtungsleitung");
    await position("Hauswirtschaft");

    // Profil der Leitung.
    await admin.query(
      `INSERT INTO mitarbeiter_profil (benutzer_id, mandant_id, telefon, erreichbarkeit, bevorzugte_kontaktart)
       VALUES ($1, $2, '0123 45 67-11', 'Mo–Fr 8–16 Uhr', 'telefon')`,
      [leitungId, mandantId]
    );

    // Abwesenheiten (Tage relativ zu heute): Aylin heute krank; Ben storniert
    // heute und kuenftig -- beides zaehlt nicht.
    const abw = (b: string, art: string, von: number, bis: number, storniert = false) =>
      admin.query(
        `INSERT INTO abwesenheit (mandant_id, benutzer_id, art, von, bis, eingetragen_von)
         VALUES ($1, $2, $3, CURRENT_DATE + $4::int, CURRENT_DATE + $5::int, $2)
         RETURNING id`,
        [mandantId, b, art, von, bis]
      ).then(async (r) => {
        if (storniert) await admin.query("UPDATE abwesenheit SET storniert_am = now(), storniert_von = $2 WHERE id = $1", [r.rows[0].id, b]);
      });
    await abw(krankId, "krank", -2, 5);
    await abw(betreuerId, "urlaub", -1, 3, true);
    await abw(betreuerId, "urlaub", 10, 20);
    krankBis = (await admin.query<{ d: string }>("SELECT (CURRENT_DATE + 5)::text AS d")).rows[0].d;

    // Bezugsbetreuung: Ben hat je eine Klientin in Haus 1 und Haus 2 und eine ausgezogene in Haus 1.
    const z1 = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '1', 2) RETURNING id", [mandantId, standort1Id]);
    const z2 = await ins("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '2') RETURNING id", [mandantId, standort2Id]);
    const klient = async (name: string) => {
      const id = await ins(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'K', $2, '1990-01-01', $3, 'Amt') RETURNING id`,
        [mandantId, name, `AZ-${name}-${suffix}`]
      );
      await admin.query("INSERT INTO klient_stammdaten (mandant_id, klient_id, bezugsbetreuer_id) VALUES ($1, $2, $3)", [mandantId, id, betreuerId]);
      return id;
    };
    const belegen = (z: string, k: string, auszug: string | null) =>
      admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, '2024-01-01', $4)", [
        mandantId, z, k, auszug,
      ]);
    await belegen(z1, await klient("Eins"), null);
    await belegen(z2, await klient("Zwei"), null);
    await belegen(z1, await klient("Weg"), "2024-06-01");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort })).body.accessToken as string;
    tokenBereichsleitung = await login(`bl-${suffix}@beispiel.test`);
    tokenBetreuer = await login(`bt-${suffix}@beispiel.test`);
    tokenKrank = await login(`kr-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const team = async (token: string) => {
    const res = await request(app.getHttpServer())
      .get(`/standorte/${standort1Id}/steckbrief`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.team as { anzahl: number; personen: StandortTeamPersonDto[]; unbesetzteLeitung: string[] };
  };
  const person = (liste: StandortTeamPersonDto[], id: string) => liste.find((p) => p.benutzerId === id)!;

  it("zeigt Leitung zuerst, dann alphabetisch, und zaehlt genau die Karten", async () => {
    const t = await team(tokenBereichsleitung);
    expect(t.personen.map((p) => p.name)).toEqual(["Sabine Kröger", "Aylin Demir", "Ben Wagner"]);
    expect(t.anzahl).toBe(3);
    expect(t.personen[0]).toMatchObject({ istLeitung: true, positionTitel: "Einrichtungsleitung" });
    expect(t.personen.filter((p) => p.istLeitung)).toHaveLength(1);
  });

  it("liefert Telefon und Erreichbarkeit aus dem Profil, sonst null", async () => {
    const t = await team(tokenBetreuer);
    expect(person(t.personen, leitungId)).toMatchObject({
      telefon: "0123 45 67-11", erreichbarkeit: "Mo–Fr 8–16 Uhr", bevorzugteKontaktart: "telefon",
    });
    expect(person(t.personen, betreuerId)).toMatchObject({ telefon: null, erreichbarkeit: null, bevorzugteKontaktart: null });
  });

  it("verbirgt den Grund einer Abwesenheit ohne Recht, zeigt aber das Ende", async () => {
    const t = await team(tokenBetreuer);
    expect(person(t.personen, krankId).abwesenheit).toEqual({ bis: krankBis, art: null });
    expect(JSON.stringify(t)).not.toContain("krank");
  });

  it("zeigt den Grund der Person selbst und mit abwesenheiten.art-sehen (Gegenprobe)", async () => {
    expect(person((await team(tokenKrank)).personen, krankId).abwesenheit).toEqual({ bis: krankBis, art: "krank" });
    expect(person((await team(tokenBereichsleitung)).personen, krankId).abwesenheit?.art).toBe("krank");
  });

  it("ignoriert stornierte und kuenftige Abwesenheiten", async () => {
    expect(person((await team(tokenBereichsleitung)).personen, betreuerId).abwesenheit).toBeNull();
  });

  it("zaehlt Bezugsbetreuung nur mit laufender Belegung an diesem Standort", async () => {
    expect(person((await team(tokenBereichsleitung)).personen, betreuerId).bezugKlienten).toBe(1);
  });

  it("zeigt weitere Standorte nur, wenn die betrachtende Person sie sehen darf", async () => {
    expect(person((await team(tokenBereichsleitung)).personen, leitungId).weitereStandorte).toEqual([{ id: standort2Id, name: "Haus 2" }]);
    // Ben ist nur Haus 1 zugeordnet: Haus 2 darf er nicht einmal dem Namen nach erfahren.
    const fuerBen = await team(tokenBetreuer);
    expect(person(fuerBen.personen, leitungId).weitereStandorte).toEqual([]);
    expect(JSON.stringify(fuerBen)).not.toContain("Haus 2");
  });

  it("meldet die unbesetzte Leitungsstelle, nicht aber andere offene Stellen", async () => {
    expect((await team(tokenBereichsleitung)).unbesetzteLeitung).toEqual(["Stellv. Einrichtungsleitung"]);
  });

  it("nimmt dieselbe Personenfarbe wie die Mitarbeitendenliste", async () => {
    const liste = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenBereichsleitung}`);
    expect(liste.status).toBe(200);
    const t = await team(tokenBereichsleitung);
    for (const p of t.personen) {
      const eintrag = (liste.body as { id: string; farbIndex: number }[]).find((b) => b.id === p.benutzerId);
      expect(p.farbIndex).toBe(eintrag?.farbIndex);
    }
  });
});
