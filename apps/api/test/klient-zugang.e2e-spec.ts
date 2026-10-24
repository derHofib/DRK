/**
 * Klienten-Zugang (Chat-Plan, Schritt 1): eigener Login fuer Klient:innen.
 *
 * Kernaussagen:
 *   1. Einladung per einmaligem Link; nur der Hash liegt in der DB. Einloesen
 *      nur einmal, nur vor Ablauf, nur bei aktivem Zugang.
 *   2. Ein Klient-Token kommt an KEINEM bestehenden Endpunkt durch (AuthGuard
 *      laesst nur typ "access" zu) -- nur @TeilnehmerAuthenticated().
 *   3. Deaktivieren, Archivieren und Anonymisieren sperren Login UND bereits
 *      ausgestellte Token sofort.
 *   4. Verwaltung braucht klienten.zugang-verwalten + Sichtbarkeit des
 *      Klienten; Mandanten sind getrennt.
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

describe("Klienten-Zugang", () => {
  let app: INestApplication;
  let admin: Client;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  const klientPasswort = "klient passwort lang genug";

  let mandantAId: string;
  let mandantASlug: string;
  let mandantBId: string;
  let mandantBSlug: string;

  let leitungAId: string;
  let tokenLeitungA: string;
  let tokenBetreuerA: string;
  let tokenLeitungEingeschraenktA: string;
  let tokenLeitungB: string;

  let klient1Id: string; // Hauptfigur
  let klient2Id: string; // Archivierung
  let klient3Id: string; // Anonymisierung
  let klient4Id: string; // zweite Person, Doppel-E-Mail
  let klientFremdId: string; // ohne Belegung am erlaubten Standort

  const email1 = `klient1-${suffix}@beispiel.test`;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    mandantASlug = `test-kz-a-${suffix}`;
    mandantBSlug = `test-kz-b-${suffix}`;
    mandantAId = (
      await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`KZ A ${suffix}`, mandantASlug])
    ).rows[0].id;
    mandantBId = (
      await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`KZ B ${suffix}`, mandantBSlug])
    ).rows[0].id;

    leitungAId = await kontoMitAlterRolle(admin, {
      mandantId: mandantAId, rolle: "einrichtungsleitung", email: `leitung-a-${suffix}@beispiel.test`, name: "Leitung A", passwortHash: hash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantAId, rolle: "betreuer", email: `betreuer-a-${suffix}@beispiel.test`, name: "Betreuer A", passwortHash: hash,
    });
    const eingeschraenktId = await kontoMitAlterRolle(admin, {
      mandantId: mandantAId, rolle: "einrichtungsleitung", email: `eingeschraenkt-a-${suffix}@beispiel.test`, name: "Eingeschraenkt A", passwortHash: hash,
    });
    await kontoMitAlterRolle(admin, {
      mandantId: mandantBId, rolle: "einrichtungsleitung", email: `leitung-b-${suffix}@beispiel.test`, name: "Leitung B", passwortHash: hash,
    });

    // Eingeschraenkte Leitung darf nur Standort S1 sehen; die Klient:innen
    // haben keine Belegung dort und sind damit fuer sie unsichtbar.
    const standortId = (
      await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S1', 'Str. 1') RETURNING id", [mandantAId])
    ).rows[0].id;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantAId, eingeschraenktId, standortId,
    ]);

    async function neuerKlient(nachname: string, az: string): Promise<string> {
      return (
        await admin.query(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, 'Vorname', $2, '2005-01-01', $3, 'Jugendamt') RETURNING id`,
          [mandantAId, nachname, `${az}-${suffix}`]
        )
      ).rows[0].id;
    }
    klient1Id = await neuerKlient("Eins", "KZ1");
    klient2Id = await neuerKlient("Zwei", "KZ2");
    klient3Id = await neuerKlient("Drei", "KZ3");
    klient4Id = await neuerKlient("Vier", "KZ4");
    klientFremdId = await neuerKlient("Fremd", "KZ5");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(slug: string, email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenLeitungA = await login(mandantASlug, `leitung-a-${suffix}@beispiel.test`);
    tokenBetreuerA = await login(mandantASlug, `betreuer-a-${suffix}@beispiel.test`);
    tokenLeitungEingeschraenktA = await login(mandantASlug, `eingeschraenkt-a-${suffix}@beispiel.test`);
    tokenLeitungB = await login(mandantBSlug, `leitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient_archiv_pdf WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM standort WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
  });
  const klientLogin = (slug: string, email: string, pw: string) =>
    request(http()).post("/auth/klient/login").send({ mandantSlug: slug, email, passwort: pw });
  const einloesen = (link: string, pw = klientPasswort) =>
    request(http()).post("/auth/klient/einladung/einloesen").send({ token: tokenAusLink(link), neuesPasswort: pw });
  const tokenAusLink = (link: string) => link.split("klient-einladung=")[1];

  async function einladenUndEinloesen(klientId: string, email: string): Promise<string> {
    const res = await als(tokenLeitungA).post(`/klienten/${klientId}/zugang`, { email });
    expect(res.status).toBe(201);
    expect((await einloesen(res.body.einladungsLink)).status).toBe(201);
    const login = await klientLogin(mandantASlug, email, klientPasswort);
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  let tokenKlient1: string;
  let einladungsLink1: string;

  it("Status ohne Zugang: keiner", async () => {
    const res = await als(tokenLeitungA).get(`/klienten/${klient1Id}/zugang`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("keiner");
  });

  it("Einladen liefert den Link einmalig, speichert nur den Hash und protokolliert ohne Token", async () => {
    const res = await als(tokenLeitungA).post(`/klienten/${klient1Id}/zugang`, { email: email1 });
    expect(res.status).toBe(201);
    einladungsLink1 = res.body.einladungsLink;
    expect(einladungsLink1).toMatch(/^\/\?klient-einladung=[0-9a-f]{64}$/);

    const roh = tokenAusLink(einladungsLink1);
    const { rows } = await admin.query("SELECT einladung_token_hash, eingeladen_von FROM klient_zugang WHERE klient_id = $1", [klient1Id]);
    expect(rows[0].einladung_token_hash).not.toBe(roh);
    expect(rows[0].eingeladen_von).toBe(leitungAId);

    const status = await als(tokenLeitungA).get(`/klienten/${klient1Id}/zugang`);
    expect(status.body).toMatchObject({ status: "eingeladen", email: email1, einladungAbgelaufen: false });
    expect(JSON.stringify(status.body)).not.toContain(roh);

    const { rows: audit } = await admin.query(
      "SELECT aktion, benutzer_id, nachher::text AS nachher FROM audit_log WHERE objekt_typ = 'klient_zugang' AND mandant_id = $1",
      [mandantAId]
    );
    expect(audit.some((a) => a.aktion === "zugang-einladen" && a.benutzer_id === leitungAId)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(roh);
  });

  it("Zweites Einladen desselben Klienten -> 409; dieselbe E-Mail fuer anderen Klienten -> 409", async () => {
    expect((await als(tokenLeitungA).post(`/klienten/${klient1Id}/zugang`, { email: "andere@beispiel.test" })).status).toBe(409);
    expect((await als(tokenLeitungA).post(`/klienten/${klient4Id}/zugang`, { email: email1.toUpperCase() })).status).toBe(409);
  });

  it("Login vor dem Einloesen scheitert mit der nichtssagenden Meldung", async () => {
    const res = await klientLogin(mandantASlug, email1, klientPasswort);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Anmeldedaten ungültig.");
  });

  it("Einloesen setzt das Passwort; derselbe Link funktioniert kein zweites Mal", async () => {
    expect((await einloesen(einladungsLink1)).status).toBe(201);
    expect((await einloesen(einladungsLink1, "ein anderes langes passwort")).status).toBe(401);
    // Das zweite Passwort darf nichts ueberschrieben haben.
    expect((await klientLogin(mandantASlug, email1, "ein anderes langes passwort")).status).toBe(401);
    const login = await klientLogin(mandantASlug, email1, klientPasswort);
    expect(login.status).toBe(201);
    tokenKlient1 = login.body.accessToken;
    expect((await als(tokenLeitungA).get(`/klienten/${klient1Id}/zugang`)).body.status).toBe("aktiv");
  });

  it("Falsches Passwort, unbekannte E-Mail und fremder Mandant geben dieselbe Antwort", async () => {
    const antworten = [
      await klientLogin(mandantASlug, email1, "falsch falsch falsch"),
      await klientLogin(mandantASlug, `gibtsnicht-${suffix}@beispiel.test`, klientPasswort),
      await klientLogin(mandantBSlug, email1, klientPasswort),
    ];
    for (const a of antworten) {
      expect(a.status).toBe(401);
      expect(a.body.message).toBe("Anmeldedaten ungültig.");
    }
  });

  it("GET /auth/klient/ich liefert Vorname, Mandant und die Traegerfarben des Klient-Tokens", async () => {
    const standard = await als(tokenKlient1).get("/auth/klient/ich");
    expect(standard.status).toBe(200);
    const gespeichert = (await admin.query("SELECT akzentfarbe, dunkel_grundfarbe FROM mandant WHERE id = $1", [mandantAId])).rows[0];
    expect(standard.body.mandant).toMatchObject({ akzentfarbe: gespeichert.akzentfarbe, dunkelGrundfarbe: gespeichert.dunkel_grundfarbe });

    await admin.query("UPDATE mandant SET akzentfarbe = '#e11d48', dunkel_grundfarbe = '#1a2b3c' WHERE id = $1", [mandantAId]);
    const res = await als(tokenKlient1).get("/auth/klient/ich");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      klientId: klient1Id,
      anzeigename: "Vorname",
      mandant: { id: mandantAId, name: `KZ A ${suffix}`, akzentfarbe: "#e11d48", dunkelGrundfarbe: "#1a2b3c" },
    });
  });

  it("GET /auth/klient/ich: Benutzer-Token -> 403, ohne Token -> 401", async () => {
    expect((await als(tokenLeitungA).get("/auth/klient/ich")).status).toBe(403);
    expect((await request(http()).get("/auth/klient/ich")).status).toBe(401);
  });

  it("Klient-Token wird an bestehenden @Authenticated()-Endpunkten mit 401 abgewiesen", async () => {
    const t = als(tokenKlient1);
    expect((await t.get("/klienten")).status).toBe(401);
    expect((await t.get(`/klienten/${klient1Id}`)).status).toBe(401);
    expect((await t.get(`/klienten/${klient1Id}/zugang`)).status).toBe(401);
    expect((await t.patch("/auth/passwort", { aktuellesPasswort: klientPasswort, neuesPasswort: "irgendwas langes" })).status).toBe(401);
  });

  it("Neu einladen entwertet den alten Link nicht-eingeloester Einladungen und erlaubt ein neues Passwort", async () => {
    const neu = await als(tokenLeitungA).post(`/klienten/${klient1Id}/zugang/neu-einladen`);
    expect(neu.status).toBe(201);
    // Der erste Link ist laengst verbraucht -> 401; der neue geht genau einmal.
    expect((await einloesen(einladungsLink1)).status).toBe(401);
    expect((await einloesen(neu.body.einladungsLink, "neues klient passwort")).status).toBe(201);
    expect((await klientLogin(mandantASlug, email1, klientPasswort)).status).toBe(401);
    const login = await klientLogin(mandantASlug, email1, "neues klient passwort");
    expect(login.status).toBe(201);
    tokenKlient1 = login.body.accessToken;
  });

  it("Neu einladen ersetzt einen noch offenen Link", async () => {
    const k = await als(tokenLeitungA).post(`/klienten/${klient4Id}/zugang`, { email: `klient4-${suffix}@beispiel.test` });
    const neu = await als(tokenLeitungA).post(`/klienten/${klient4Id}/zugang/neu-einladen`);
    expect((await einloesen(k.body.einladungsLink)).status).toBe(401);
    expect((await einloesen(neu.body.einladungsLink)).status).toBe(201);
  });

  it("Abgelaufene Einladung laesst sich nicht einloesen", async () => {
    const k = await als(tokenLeitungA).post(`/klienten/${klient2Id}/zugang`, { email: `klient2-${suffix}@beispiel.test` });
    await admin.query("UPDATE klient_zugang SET einladung_ablauf = now() - interval '1 minute' WHERE klient_id = $1", [klient2Id]);
    const status = await als(tokenLeitungA).get(`/klienten/${klient2Id}/zugang`);
    expect(status.body.einladungAbgelaufen).toBe(true);
    expect((await einloesen(k.body.einladungsLink)).status).toBe(401);
  });

  it("Deaktivieren sperrt Login und das bereits ausgestellte Token; Reaktivieren hebt beides auf", async () => {
    expect((await als(tokenKlient1).get("/auth/klient/ich")).status).toBe(200);

    const aus = await als(tokenLeitungA).patch(`/klienten/${klient1Id}/zugang`, { aktiv: false });
    expect(aus.status).toBe(200);
    expect(aus.body.status).toBe("deaktiviert");
    expect((await klientLogin(mandantASlug, email1, "neues klient passwort")).status).toBe(401);
    expect((await als(tokenKlient1).get("/auth/klient/ich")).status).toBe(401);

    const an = await als(tokenLeitungA).patch(`/klienten/${klient1Id}/zugang`, { aktiv: true });
    expect(an.body.status).toBe("aktiv");
    expect((await als(tokenKlient1).get("/auth/klient/ich")).status).toBe(200);

    const { rows } = await admin.query(
      "SELECT aktion FROM audit_log WHERE objekt_typ = 'klient_zugang' AND mandant_id = $1",
      [mandantAId]
    );
    const aktionen = rows.map((r) => r.aktion);
    expect(aktionen).toEqual(expect.arrayContaining(["zugang-deaktivieren", "zugang-aktivieren", "zugang-neu-einladen"]));
  });

  it("Deaktivierter Zugang: Einladungslink loest nichts ein, Neu-Einladen -> 409", async () => {
    const k = await als(tokenLeitungA).post(`/klienten/${klient3Id}/zugang`, { email: `klient3-${suffix}@beispiel.test` });
    await als(tokenLeitungA).patch(`/klienten/${klient3Id}/zugang`, { aktiv: false });
    expect((await einloesen(k.body.einladungsLink)).status).toBe(401);
    expect((await als(tokenLeitungA).post(`/klienten/${klient3Id}/zugang/neu-einladen`)).status).toBe(409);
  });

  it("Archivieren deaktiviert den Zugang sofort; Entarchivieren schaltet ihn NICHT automatisch wieder ein", async () => {
    // klient2: abgelaufene Einladung aus dem Test oben -> frisch einladen.
    await als(tokenLeitungA).post(`/klienten/${klient2Id}/zugang/neu-einladen`).then(async (r) => {
      expect((await einloesen(r.body.einladungsLink)).status).toBe(201);
    });
    const login = await klientLogin(mandantASlug, `klient2-${suffix}@beispiel.test`, klientPasswort);
    expect(login.status).toBe(201);
    const tokenKlient2 = login.body.accessToken;
    expect((await als(tokenKlient2).get("/auth/klient/ich")).status).toBe(200);

    expect((await als(tokenLeitungA).patch(`/klienten/${klient2Id}/archivieren`)).status).toBe(200);
    expect((await als(tokenKlient2).get("/auth/klient/ich")).status).toBe(401);
    expect((await klientLogin(mandantASlug, `klient2-${suffix}@beispiel.test`, klientPasswort)).status).toBe(401);
    expect((await als(tokenLeitungA).get(`/klienten/${klient2Id}/zugang`)).body.status).toBe("deaktiviert");
    // Aktivieren und Neu-Einladen sind fuer archivierte Klient:innen gesperrt.
    expect((await als(tokenLeitungA).patch(`/klienten/${klient2Id}/zugang`, { aktiv: true })).status).toBe(409);

    expect((await als(tokenLeitungA).patch(`/klienten/${klient2Id}/entarchivieren`)).status).toBe(200);
    expect((await als(tokenKlient2).get("/auth/klient/ich")).status).toBe(401);
    expect((await als(tokenLeitungA).patch(`/klienten/${klient2Id}/zugang`, { aktiv: true })).status).toBe(200);
    expect((await als(tokenKlient2).get("/auth/klient/ich")).status).toBe(200);
  });

  it("Anonymisieren deaktiviert den Zugang endgueltig und entfernt E-Mail und Passwort", async () => {
    const email3 = `klient3b-${suffix}@beispiel.test`;
    await admin.query("DELETE FROM klient_zugang WHERE klient_id = $1", [klient3Id]);
    const tokenKlient3 = await einladenUndEinloesen(klient3Id, email3);
    expect((await als(tokenKlient3).get("/auth/klient/ich")).status).toBe(200);

    expect((await als(tokenLeitungA).patch(`/klienten/${klient3Id}/anonymisieren`)).status).toBe(200);
    expect((await als(tokenKlient3).get("/auth/klient/ich")).status).toBe(401);
    expect((await klientLogin(mandantASlug, email3, klientPasswort)).status).toBe(401);

    const { rows } = await admin.query("SELECT email, passwort_hash, aktiv FROM klient_zugang WHERE klient_id = $1", [klient3Id]);
    expect(rows[0].aktiv).toBe(false);
    expect(rows[0].passwort_hash).toBeNull();
    expect(rows[0].email).not.toBe(email3);
    expect((await als(tokenLeitungA).patch(`/klienten/${klient3Id}/zugang`, { aktiv: true })).status).toBe(409);
  });

  it("Anonymisierter Klient: Einladen -> 409", async () => {
    expect((await als(tokenLeitungA).post(`/klienten/${klient3Id}/zugang`, { email: "x@beispiel.test" })).status).toBe(409);
  });

  it("Ohne Recht klienten.zugang-verwalten -> 403 auf allen vier Verwaltungs-Endpunkten", async () => {
    const t = als(tokenBetreuerA);
    expect((await t.get(`/klienten/${klient1Id}/zugang`)).status).toBe(403);
    expect((await t.post(`/klienten/${klient1Id}/zugang`, { email: "b@beispiel.test" })).status).toBe(403);
    expect((await t.post(`/klienten/${klient1Id}/zugang/neu-einladen`)).status).toBe(403);
    expect((await t.patch(`/klienten/${klient1Id}/zugang`, { aktiv: false })).status).toBe(403);
    // ... und ohne Wirkung geblieben.
    expect((await als(tokenKlient1).get("/auth/klient/ich")).status).toBe(200);
  });

  it("Standort-Einschraenkung: unsichtbarer Klient -> 404 (kein 403, keine Existenz-Auskunft)", async () => {
    const t = als(tokenLeitungEingeschraenktA);
    expect((await t.get(`/klienten/${klientFremdId}/zugang`)).status).toBe(404);
    expect((await t.post(`/klienten/${klientFremdId}/zugang`, { email: "f@beispiel.test" })).status).toBe(404);
    const { rows } = await admin.query("SELECT 1 FROM klient_zugang WHERE klient_id = $1", [klientFremdId]);
    expect(rows).toHaveLength(0);
  });

  it("Mandantentrennung: Leitung B sieht/verwaltet Zugaenge von Mandant A nicht", async () => {
    const t = als(tokenLeitungB);
    expect((await t.get(`/klienten/${klient1Id}/zugang`)).status).toBe(404);
    expect((await t.patch(`/klienten/${klient1Id}/zugang`, { aktiv: false })).status).toBe(404);
    expect((await t.post(`/klienten/${klient1Id}/zugang/neu-einladen`)).status).toBe(404);
    expect((await als(tokenKlient1).get("/auth/klient/ich")).status).toBe(200);
  });

  it("RLS/Spaltenrechte der App-Rolle: fremder Mandant sieht nichts, klient_id ist nicht aenderbar", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantBId]);
      const { rows } = await app_.query("SELECT 1 FROM klient_zugang");
      expect(rows).toHaveLength(0);
      await app_.query("ROLLBACK");

      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
      await expect(app_.query("UPDATE klient_zugang SET klient_id = $1", [klient4Id])).rejects.toThrow(/permission denied/);
      await app_.query("ROLLBACK");

      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantAId]);
      await expect(app_.query("DELETE FROM klient_zugang")).rejects.toThrow(/permission denied/);
      await app_.query("ROLLBACK");
    } finally {
      await app_.end();
    }
  });
});
