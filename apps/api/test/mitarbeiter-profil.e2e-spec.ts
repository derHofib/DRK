/**
 * Mitarbeiter-Profil (migrations/0058): selbst gepflegt, je Feld fuer
 * "zugeordnete" (Bezugsbetreuung) und "andere" Klient:innen freigebbar.
 *
 * Aufbau: Standorte S1/S2. Klient:in A wohnt in S1 und hat BB als
 * Bezugsbetreuung (zugeordnet), Klient:in B wohnt ebenfalls in S1, aber ohne
 * Bezug zu BB (andere), Klient:in C wohnt in S2 (BB liegt ausserhalb ihres
 * Sichtkreises). BB ist dem Standort S1 zugeordnet. FREI hat keine
 * Standort-Zuordnung und kommt nur ueber einen gemeinsamen Chat in Cs Kreis.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Mitarbeiter-Profil", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantId: string;
  let slug: string;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let bbId: string;
  let kollegeId: string;
  let freiId: string;
  let fremderStandortId: string;
  let s1: string;
  let s2: string;

  let tokenBb: string;
  let tokenKollege: string;
  let tokenFrei: string;
  let tokenA: string; // zugeordnet
  let tokenB: string; // andere, gleicher Standort
  let tokenC: string; // anderer Standort

  const PROFIL = {
    telefon: "0151 1234567",
    bevorzugteKontaktart: "telefon" as const,
    erreichbarkeit: "Mo-Fr 8-16 Uhr",
    emailDienstlich: "bb@traeger.example",
    ueberMich: "Ich spreche Deutsch und Türkisch.",
    sichtbarkeit: {
      telefon: { zugeordnet: true, andere: false },
      kontakt: { zugeordnet: true, andere: true },
      email: { zugeordnet: false, andere: false },
      ueberMich: { zugeordnet: true, andere: false },
    },
  };

  async function benutzer(kurz: string, name: string): Promise<string> {
    const hash = await bcrypt.hash(passwort, 4);
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, `${kurz}-${suffix}@beispiel.test`, name, hash]
    );
    return rows[0].id;
  }

  async function klient(kurz: string, nachname: string, standortId: string, bezugId: string | null): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Test', $2, '1990-01-01', $3, 'Amt', 'monatlich') RETURNING id`,
      [mandantId, nachname, `AZ-${kurz}-${suffix}`]
    );
    const id = rows[0].id;
    const { rows: z } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id",
      [mandantId, standortId, kurz]
    );
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
      mandantId,
      z[0].id,
      id,
    ]);
    await admin.query("INSERT INTO klient_stammdaten (mandant_id, klient_id, bezugsbetreuer_id) VALUES ($1, $2, $3)", [
      mandantId,
      id,
      bezugId,
    ]);
    await legeKlientZugangAn(admin, {
      mandantId,
      klientId: id,
      email: `klient-${kurz}-${suffix}@beispiel.test`,
      passwortHash: await bcrypt.hash(passwort, 4),
      eingeladenVon: bbId,
    });
    return id;
  }

  const als = (token: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set("Authorization", `Bearer ${token}`),
    put: (p: string, body: unknown) => request(app.getHttpServer()).put(p).set("Authorization", `Bearer ${token}`).send(body as object),
    post: (p: string, body: unknown) => request(app.getHttpServer()).post(p).set("Authorization", `Bearer ${token}`).send(body as object),
  });

  async function alsAppRolle<T>(ctx: { benutzerId?: string; klientId?: string }, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await c.query("SELECT set_config('app.benutzer_id', $1, true)", [ctx.benutzerId ?? ""]);
      await c.query("SELECT set_config('app.klient_id', $1, true)", [ctx.klientId ?? ""]);
      const r = await fn(c);
      await c.query("ROLLBACK");
      return r;
    } finally {
      await c.end();
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    slug = `test-profil-${suffix}`;
    mandantId = (
      await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Testmandant Profil ${suffix}`, slug])
    ).rows[0].id;

    // Ohne aktiven Vollzugriff-Account verweigert der Schutz-Trigger aus 0050 jede
    // Deaktivierung (siehe der Test dazu weiter unten).
    await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email: `voll-${suffix}@beispiel.test`,
      name: "Voll Zugriff",
      passwortHash: await bcrypt.hash(passwort, 4),
    });
    bbId = await benutzer("bb", "Berta Bezug");
    kollegeId = await benutzer("kollege", "Karl Kollege");
    freiId = await benutzer("frei", "Frieda Frei");
    s1 = (await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Eins', 'a') RETURNING id", [mandantId])).rows[0].id;
    s2 = (await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Zwei', 'b') RETURNING id", [mandantId])).rows[0].id;
    fremderStandortId = s2;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, bbId, s1]);
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [mandantId, kollegeId, s1]);

    await klient("A", "Alpha", s1, bbId);
    await klient("B", "Beta", s1, kollegeId);
    await klient("C", "Gamma", fremderStandortId, null);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = async (kurz: string) =>
      (await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken;
    tokenBb = await login("bb");
    tokenKollege = await login("kollege");
    tokenFrei = await login("frei");
    tokenA = await klientToken(app, slug, `klient-A-${suffix}@beispiel.test`, passwort);
    tokenB = await klientToken(app, slug, `klient-B-${suffix}@beispiel.test`, passwort);
    tokenC = await klientToken(app, slug, `klient-C-${suffix}@beispiel.test`, passwort);
  });

  afterAll(async () => {
    try {
      const m = [mandantId];
      await admin.query("DELETE FROM chat_nachricht WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM chat_teilnehmer WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM chat WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM mitarbeiter_profil WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM belegung WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM zimmer WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM standort WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [m]);
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = ANY($1)", [m]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [m]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("ohne gespeichertes Profil: leer, nichts freigegeben -- und Klient:innen sehen nur den Namen", async () => {
    const ich = await als(tokenBb).get("/profil/ich");
    expect(ich.status).toBe(200);
    expect(ich.body.telefon).toBeNull();
    expect(Object.values(ich.body.sichtbarkeit).every((f: any) => !f.zugeordnet && !f.andere)).toBe(true);

    const a = await als(tokenA).get(`/mitarbeiter-profil/${bbId}`);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ name: "Berta Bezug", zugeordnet: true, telefon: null, bevorzugteKontaktart: null, erreichbarkeit: null, emailDienstlich: null, ueberMich: null });
  });

  it("speichern: das eigene Profil kommt unveraendert zurueck, Leerstrings werden zu null", async () => {
    const res = await als(tokenBb).put("/profil/ich", PROFIL);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(PROFIL);

    const leer = await als(tokenFrei).put("/profil/ich", { ...PROFIL, telefon: "  ", erreichbarkeit: "", sichtbarkeit: PROFIL.sichtbarkeit });
    expect(leer.status).toBe(200);
    expect(leer.body.telefon).toBeNull();
    expect(leer.body.erreichbarkeit).toBeNull();
  });

  it("zugeordnete Klient:in sieht genau die fuer 'zugeordnet' freigegebenen Felder", async () => {
    const res = await als(tokenA).get(`/mitarbeiter-profil/${bbId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      benutzerId: bbId,
      name: "Berta Bezug",
      zugeordnet: true,
      telefon: PROFIL.telefon,
      bevorzugteKontaktart: "telefon",
      erreichbarkeit: PROFIL.erreichbarkeit,
      emailDienstlich: null, // nicht freigegeben
      ueberMich: PROFIL.ueberMich,
    });
  });

  it("nicht zugeordnete Klient:in (gleicher Standort) sieht nur die fuer 'andere' freigegebenen Felder", async () => {
    const res = await als(tokenB).get(`/mitarbeiter-profil/${bbId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      benutzerId: bbId,
      name: "Berta Bezug",
      zugeordnet: false,
      telefon: null,
      bevorzugteKontaktart: "telefon",
      erreichbarkeit: PROFIL.erreichbarkeit,
      emailDienstlich: null,
      ueberMich: null,
    });
  });

  it("ausserhalb des Sichtkreises: 404, genau wie bei einer unbekannten Person", async () => {
    const ausserhalb = await als(tokenC).get(`/mitarbeiter-profil/${bbId}`);
    const unbekannt = await als(tokenC).get(`/mitarbeiter-profil/${randomUUID()}`);
    expect(ausserhalb.status).toBe(404);
    expect(unbekannt.status).toBe(404);
    expect(ausserhalb.body.message).toBe(unbekannt.body.message);
  });

  it("ein gemeinsamer Chat zieht die Person in den Sichtkreis (auch ohne Standort-Zuordnung)", async () => {
    expect((await als(tokenC).get(`/mitarbeiter-profil/${freiId}`)).status).toBe(404);
    const chat = await als(tokenFrei).post("/chat/direkt", { klientId: (await admin.query("SELECT klient_id FROM klient_zugang WHERE email = $1", [`klient-C-${suffix}@beispiel.test`])).rows[0].klient_id });
    expect(chat.status).toBe(201);
    const res = await als(tokenC).get(`/mitarbeiter-profil/${freiId}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Frieda Frei");
    expect(res.body.telefon).toBeNull(); // gar nicht freigegeben
  });

  it("deaktivierte Mitarbeiter:in ist fuer Klient:innen nicht mehr sichtbar", async () => {
    await admin.query("UPDATE benutzer SET aktiv = false WHERE id = $1", [bbId]);
    try {
      expect((await als(tokenA).get(`/mitarbeiter-profil/${bbId}`)).status).toBe(404);
    } finally {
      await admin.query("UPDATE benutzer SET aktiv = true WHERE id = $1", [bbId]);
    }
  });

  it("Kolleg:innen sehen ALLE Angaben, auch die fuer Klient:innen gesperrten", async () => {
    const res = await als(tokenKollege).get(`/profil/kollegen/${bbId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      benutzerId: bbId,
      name: "Berta Bezug",
      telefon: PROFIL.telefon,
      bevorzugteKontaktart: "telefon",
      erreichbarkeit: PROFIL.erreichbarkeit,
      emailDienstlich: PROFIL.emailDienstlich,
      ueberMich: PROFIL.ueberMich,
    });
    const liste = await als(tokenKollege).get("/profil/kollegen");
    expect(liste.status).toBe(200);
    expect(liste.body.find((p: any) => p.benutzerId === bbId).emailDienstlich).toBe(PROFIL.emailDienstlich);
  });

  it("fremde Profile aendert niemand -- auch nicht mit direktem SQL unter der App-Rolle", async () => {
    const kollegeAendert = await alsAppRolle({ benutzerId: kollegeId }, (c) =>
      c.query("UPDATE mitarbeiter_profil SET telefon = 'gekapert' WHERE benutzer_id = $1", [bbId])
    );
    expect(kollegeAendert.rowCount).toBe(0);
    const anlegen = alsAppRolle({ benutzerId: kollegeId }, (c) =>
      c.query("INSERT INTO mitarbeiter_profil (benutzer_id, mandant_id) VALUES ($1, $2)", [bbId, mandantId])
    );
    await expect(anlegen).rejects.toThrow();
    const loeschen = alsAppRolle({ benutzerId: bbId }, (c) => c.query("DELETE FROM mitarbeiter_profil WHERE benutzer_id = $1", [bbId]));
    await expect(loeschen).rejects.toThrow(/permission denied/i);
    const { rows } = await admin.query("SELECT telefon FROM mitarbeiter_profil WHERE benutzer_id = $1", [bbId]);
    expect(rows[0].telefon).toBe(PROFIL.telefon);
  });

  it("Klient-Sitzungen kommen an die Tabelle selbst nicht heran -- nur ueber die gefilterte Funktion", async () => {
    const klientId = (await admin.query("SELECT klient_id FROM klient_zugang WHERE email = $1", [`klient-A-${suffix}@beispiel.test`])).rows[0].klient_id;
    const direkt = await alsAppRolle({ klientId }, (c) => c.query("SELECT * FROM mitarbeiter_profil"));
    expect(direkt.rowCount).toBe(0);
  });

  it("Eingaben pruefen: 'andere' ohne 'zugeordnet' und ungueltige E-Mail -> 400, nichts gespeichert", async () => {
    const widerspruch = await als(tokenBb).put("/profil/ich", {
      ...PROFIL,
      sichtbarkeit: { ...PROFIL.sichtbarkeit, email: { zugeordnet: false, andere: true } },
    });
    expect(widerspruch.status).toBe(400);
    const mail = await als(tokenBb).put("/profil/ich", { ...PROFIL, emailDienstlich: "keine-mail" });
    expect(mail.status).toBe(400);
    expect((await als(tokenBb).get("/profil/ich")).body.emailDienstlich).toBe(PROFIL.emailDienstlich);
  });

  it("falsche Prinzipale: Klient-Token an /profil -> 401, Mitarbeiter-Token an die Klient-Sicht -> 403", async () => {
    expect((await als(tokenA).get("/profil/ich")).status).toBe(401);
    expect((await als(tokenKollege).get(`/mitarbeiter-profil/${bbId}`)).status).toBe(403);
  });
});
