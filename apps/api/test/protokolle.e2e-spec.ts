/**
 * Protokolle aus Formularen (Migration 0075). Prueft neben dem Ablauf
 * (Formular anlegen, Entwurf, Abschliessen, Korrektur) vor allem das, was
 * Datenbank und gemeinsamer Auswerter erzwingen sollen:
 *  - Mandantentrennung und Sichtbarkeit fremder Entwuerfe
 *  - verborgene Felder werden verworfen, Pflicht/bedingte Pflicht greift
 *  - Name der Klient:in wird nie als Wert gespeichert (Anonymisierung)
 *  - veroeffentlichte Versionen und abgeschlossene Protokolle sind in der
 *    Datenbank eingefroren, Korrekturen landen per Trigger mit Grund in der Historie
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { pruefeDefinition, typFehler, werteAus, zeichenGrenze, type FormularDefinition, type TextBaustein } from "@zimmerakte/shared";
import { FORMULAR_VORLAGEN } from "./support/formular-beispiele";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf, type AlteRolle } from "./support/konto-mit-rolle";

describe("Protokolle", () => {
  let app: INestApplication;
  let admin: Client;
  let appRolle: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const mandanten: string[] = [];

  let mandantA: string;
  let leitungA: string;
  let betreuerA: string;
  let betreuerA2: string;
  let betreuerA2Id: string;
  let betreuerAId: string;
  let tokenB: string;
  let klientA: string;
  let klientB: string;

  async function mandant(name: string) {
    const slug = `test-protokoll-${name}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
      `Testmandant Protokoll ${name} ${suffix}`,
      slug,
    ]);
    mandanten.push(rows[0].id);
    return { id: rows[0].id, slug };
  }

  async function konto(m: { id: string; slug: string }, rolle: AlteRolle, kurz: string) {
    const email = `${kurz}-${suffix}@beispiel.test`;
    const id = await kontoMitAlterRolle(admin, {
      mandantId: m.id,
      rolle,
      email,
      name: `Person ${kurz}`,
      passwortHash: await bcrypt.hash(passwort, 4),
    });
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: m.slug, email, passwort });
    return { id, token: res.body.accessToken as string };
  }

  async function klient(mandantId: string, vorname: string, nachname: string) {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, $2, $3, '2003-03-04', $4, 'Jugendamt Musterstadt') RETURNING id`,
      [mandantId, vorname, nachname, `AZ-${randomUUID().slice(0, 8)}`]
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    appRolle = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appRolle.connect();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const a = await mandant("a");
    const b = await mandant("b");
    mandantA = a.id;
    leitungA = (await konto(a, "einrichtungsleitung", "leitung-a")).token;
    const be = await konto(a, "betreuer", "betreuer-a");
    betreuerA = be.token;
    betreuerAId = be.id;
    const be2 = await konto(a, "betreuer", "betreuer-a2");
    betreuerA2 = be2.token;
    betreuerA2Id = be2.id;
    tokenB = (await konto(b, "bereichsleitung", "leitung-b")).token;

    klientA = await klient(a.id, "Maximilian", "Sonnenberg");
    klientB = await klient(b.id, "Fremd", "Klientin");
    const s = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Lindenweg', 'Lindenweg 4') RETURNING id",
      [a.id]
    );
    const z = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '12') RETURNING id",
      [a.id, s.rows[0].id]
    );
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
      a.id,
      z.rows[0].id,
      klientA,
    ]);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE formular_version DISABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll DISABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert DISABLE TRIGGER protokoll_wert_protokoll");
      for (const m of mandanten) {
        for (const t of ["protokoll_aenderung", "protokoll_wert", "protokoll", "formular_version", "formular", "belegung", "zimmer"]) {
          await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [m]);
        }
        await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM klient_kontakt WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM klient WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM standort WHERE mandant_id = $1", [m]);
        await raeumeKontoMitRolleAuf(admin, m);
        await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [m]).catch(() => undefined);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m]);
      }
    } finally {
      await admin.query("ALTER TABLE formular_version ENABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll ENABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert ENABLE TRIGGER protokoll_wert_protokoll");
      await appRolle.end();
      await admin.end();
      await app.close();
    }
  });

  const http = () => request(app.getHttpServer());
  const als = (token: string) => ({
    get: (url: string) => http().get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => http().post(url).set("Authorization", `Bearer ${token}`).send(body),
    put: (url: string, body: object) => http().put(url).set("Authorization", `Bearer ${token}`).send(body),
    del: (url: string) => http().delete(url).set("Authorization", `Bearer ${token}`),
  });

  /** Statement als App-Rolle im Kontext eines Mandanten -- der Weg, den auch die API nimmt. */
  async function alsApp<T>(mandantId: string, fn: (c: Client) => Promise<T>, grund?: string): Promise<T> {
    await appRolle.query("BEGIN");
    try {
      await appRolle.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      if (grund) await appRolle.query("SELECT set_config('app.aenderungsgrund', $1, true)", [grund]);
      return await fn(appRolle);
    } finally {
      await appRolle.query("ROLLBACK");
    }
  }

  describe("Auswerter und Beispielformulare (ohne Datenbank)", () => {
    it("alle Beispielformulare sind gueltig", () => {
      for (const v of FORMULAR_VORLAGEN) expect([v.schluessel, pruefeDefinition(v.definition)]).toEqual([v.schluessel, []]);
    });

    it("lehnt Namen als festgehaltenen Wert ab und Verweise nach unten", () => {
      const def: FormularDefinition = {
        bausteine: [
          { typ: "kurztext", schluessel: "name", beschriftung: "Name", vorausfuellen: { quelle: "klient.name", art: "festgehalten" } },
          { typ: "kurztext", schluessel: "a", beschriftung: "A", sichtbarWenn: { feld: "b", op: "nicht_leer" } },
          { typ: "kurztext", schluessel: "b", beschriftung: "B" },
        ],
      };
      const fehler = pruefeDefinition(def);
      expect(fehler.some((f) => f.includes("darf nur angezeigt"))).toBe(true);
      expect(fehler.some((f) => f.includes("weiter oben"))).toBe(true);
    });

    it("„Höchstens Zeichen“ 0 sperrt das Feld nicht, sondern gilt als keine Grenze -- und wird vor dem Veroeffentlichen gemeldet", () => {
      // Rueckmeldung 95d08c6a: maxLaenge 0 landete als maxlength="0" im Feld, man konnte nichts tippen.
      const null0: TextBaustein = { typ: "langtext", schluessel: "t", beschriftung: "T", maxLaenge: 0 };
      expect(zeichenGrenze(null0)).toBeUndefined();
      expect(zeichenGrenze({ maxLaenge: -3 })).toBeUndefined();
      expect(zeichenGrenze({ maxLaenge: 2.5 })).toBeUndefined();
      expect(zeichenGrenze({ maxLaenge: 1 })).toBe(1);
      expect(typFehler(null0, "beliebig lang")).toBeNull();
      expect(typFehler({ ...null0, maxLaenge: 3 }, "vier")).toMatch(/Höchstens 3/);
      expect(pruefeDefinition({ bausteine: [null0] }).join(" ")).toMatch(/Höchstens Zeichen/);
      expect(pruefeDefinition({ bausteine: [{ ...null0, maxLaenge: 200 }] })).toEqual([]);
      expect(pruefeDefinition({ bausteine: [{ ...null0, maxLaenge: undefined }] })).toEqual([]);
    });

    it("verborgener Abschnitt verbirgt Kinder; Dauer rechnet ueber Mitternacht", () => {
      const def = FORMULAR_VORLAGEN.find((v) => v.schluessel === "nachtdienst")!.definition;
      const mit = werteAus(def, { vorfall: true, vorfall_beginn: "23:10", vorfall_ende: "00:35", vorfall_art: "konflikt" });
      expect(mit.werte.vorfall_dauer).toBe(85);
      const ohne = werteAus(def, { vorfall: false, vorfall_beginn: "23:10", vorfall_ende: "00:35", vorfall_art: "konflikt" });
      expect(ohne.werte.vorfall_art).toBeUndefined();
      expect(ohne.werte.vorfall_dauer).toBeUndefined();
      expect(ohne.sichtbar.has("vorfall_beschreibung")).toBe(false);
    });
  });

  let formularId: string;

  it("nur wer Formulare verwalten darf, legt ein Formular an und veroeffentlicht es", async () => {
    const nacht = FORMULAR_VORLAGEN.find((v) => v.schluessel === "nachtdienst")!;
    expect((await als(betreuerA).post("/formulare", { name: nacht.name })).status).toBe(403);
    const neu = await als(leitungA).post("/formulare", { name: nacht.name, beschreibung: nacht.beschreibung });
    expect(neu.status).toBe(201);
    expect(neu.body.status).toBe("in_entwicklung");
    formularId = neu.body.id;
    expect((await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: nacht.definition })).status).toBe(200);
    const pub = await als(leitungA).post(`/formulare/${formularId}/veroeffentlichen`);
    expect(pub.status).toBe(201);
    expect(pub.body.veroeffentlichteVersion).toBe(1);
    // Betreuende bekommen das Formular in der Klientenakte angeboten.
    const angebot = await als(betreuerA).get(`/formulare/angebot?klientId=${klientA}`);
    expect(angebot.body.map((f: { id: string }) => f.id)).toContain(formularId);
  });

  let protokollId: string;

  it("legt einen Entwurf an und fuellt vor; Name wird angezeigt, aber nicht gespeichert", async () => {
    const res = await als(betreuerA).post("/protokolle", { formularId, klientId: klientA });
    expect(res.status).toBe(201);
    protokollId = res.body.id;
    expect(res.body.abgeschlossen).toBe(false);
    expect(res.body.anzeige.klient_name).toBe("Maximilian Sonnenberg");
    expect(res.body.werte.wohnung).toBe("Lindenweg, Zimmer 12");
    expect(res.body.quellen.wohnung).toBe("festgehalten");
    expect(res.body.quellen.datum).toBe("vorschlag");
    expect(res.body.bearbeitbar).toBe(true);

    const { rows } = await admin.query(
      "SELECT count(*)::int AS n FROM protokoll_wert WHERE protokoll_id = $1 AND (wert_text ILIKE '%Sonnenberg%' OR wert_text ILIKE '%Maximilian%')",
      [protokollId]
    );
    expect(rows[0].n).toBe(0);
  });

  it("ein fremder Entwurf ist fuer andere unsichtbar", async () => {
    expect((await als(betreuerA2).get(`/protokolle/${protokollId}`)).status).toBe(404);
    const liste = await als(betreuerA2).get(`/protokolle?klientId=${klientA}`);
    expect(liste.body.map((p: { id: string }) => p.id)).not.toContain(protokollId);
    expect((await als(betreuerA2).put(`/protokolle/${protokollId}/entwurf`, { werte: {} })).status).toBe(404);
  });

  it("Entwurf: falscher Typ ist 400 mit Feldbezug; festgehaltene Werte kommen nie aus dem Request", async () => {
    const falsch = await als(betreuerA).put(`/protokolle/${protokollId}/entwurf`, { werte: { vorfall: "vielleicht" } });
    expect(falsch.status).toBe(400);
    expect(falsch.body.fehler).toEqual([{ schluessel: "vorfall", meldung: "Bitte Ja oder Nein wählen." }]);

    const ok = await als(betreuerA).put(`/protokolle/${protokollId}/entwurf`, {
      werte: { wohnung: "Gefälscht", vorfall: true, vorfall_art: "selbstgefaehrdung", vorfall_beginn: "23:10" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.werte.wohnung).toBe("Lindenweg, Zimmer 12");
    expect(ok.body.werte.vorfall_art).toBe("selbstgefaehrdung");
  });

  it("verborgene Angaben werden beim Speichern verworfen", async () => {
    const res = await als(betreuerA).put(`/protokolle/${protokollId}/entwurf`, {
      werte: { vorfall: false, vorfall_art: "selbstgefaehrdung", vorfall_beginn: "23:10" },
    });
    expect(res.status).toBe(200);
    expect(res.body.werte.vorfall_art).toBeUndefined();
    const { rows } = await admin.query("SELECT feld_schluessel FROM protokoll_wert WHERE protokoll_id = $1", [protokollId]);
    expect(rows.map((r) => r.feld_schluessel)).not.toContain("vorfall_art");
  });

  it("Abschliessen prueft Pflicht und bedingte Pflicht", async () => {
    const res = await als(betreuerA).post(`/protokolle/${protokollId}/abschliessen`, {
      werte: { vorfall: true, vorfall_art: "selbstgefaehrdung", vorfall_beginn: "23:10", vorfall_ende: "00:35", datum: "2026-01-10" },
    });
    expect(res.status).toBe(400);
    const felder = res.body.fehler.map((f: { schluessel: string }) => f.schluessel).sort();
    // anwesend, schlaf_qualitaet: immer Pflicht; leitung_informiert: nur bei Selbstgefaehrdung;
    // vorfall_beschreibung: Pflicht im eingeblendeten Abschnitt.
    expect(felder).toEqual(["anwesend", "leitung_informiert", "schlaf_qualitaet", "vorfall_beschreibung"]);
  });

  it("lehnt Mitarbeitende eines fremden Traegers ab", async () => {
    const fremd = (await admin.query("SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1", [mandanten[1]])).rows[0].id;
    const res = await als(betreuerA).put(`/protokolle/${protokollId}/entwurf`, { werte: { anwesend: [fremd] } });
    expect(res.status).toBe(400);
    expect(res.body.fehler[0].schluessel).toBe("anwesend");
  });

  it("schliesst ab: Berechnung und Quellen werden mitgespeichert", async () => {
    const res = await als(betreuerA).post(`/protokolle/${protokollId}/abschliessen`, {
      werte: {
        datum: "2026-01-10",
        anwesend: [betreuerAId, betreuerA2Id],
        schlaf_qualitaet: "unruhig",
        vorfall: true,
        vorfall_art: "konflikt",
        vorfall_beginn: "23:10",
        vorfall_ende: "00:35",
        vorfall_beschreibung: "Streit um Musik, beide beruhigt.",
        intern_einschaetzung: "Bitte beobachten.",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.abgeschlossen).toBe(true);
    expect(res.body.bezugsdatum).toBe("2026-01-10");
    expect(res.body.werte.vorfall_dauer).toBe(85);
    expect(res.body.quellen.vorfall_dauer).toBe("berechnet");
    expect(res.body.quellen.datum).toBe("vorschlag_geaendert");
    expect(res.body.quellen.wohnung).toBe("festgehalten");
    expect(res.body.personen[betreuerA2Id]).toBe("Person betreuer-a2");
    expect(res.body.anzahlAenderungen).toBe(0);

    // Jetzt fuer alle mit Recht sichtbar, aber nicht mehr als Entwurf speicherbar.
    expect((await als(betreuerA2).get(`/protokolle/${protokollId}`)).status).toBe(200);
    expect((await als(betreuerA).put(`/protokolle/${protokollId}/entwurf`, { werte: {} })).status).toBe(400);
    expect((await als(betreuerA).del(`/protokolle/${protokollId}`)).status).toBe(400);
  });

  it("Korrektur: fremde Betreuende nein, Leitung ja -- mit Grund und Historie", async () => {
    const detail = (await als(leitungA).get(`/protokolle/${protokollId}`)).body;
    const neu = { ...detail.werte, vorfall_beginn: "23:20" };

    const fremd = await als(betreuerA2).post(`/protokolle/${protokollId}/korrektur`, { werte: neu, grund: "Tippfehler" });
    expect(fremd.status).toBe(403);
    const ohneGrund = await als(leitungA).post(`/protokolle/${protokollId}/korrektur`, { werte: neu, grund: "  " });
    expect(ohneGrund.status).toBe(400);

    const ok = await als(leitungA).post(`/protokolle/${protokollId}/korrektur`, { werte: neu, grund: "Uhrzeit laut Dienstbuch" });
    expect(ok.status).toBe(201);
    expect(ok.body.werte.vorfall_dauer).toBe(75);
    expect(ok.body.werte.wohnung).toBe("Lindenweg, Zimmer 12");

    const historie = await als(betreuerA).get(`/protokolle/${protokollId}/historie`);
    const felder = historie.body.map((h: { feldSchluessel: string }) => h.feldSchluessel).sort();
    // Genau die zwei tatsaechlich geaenderten Datenpunkte: die Eingabe und die davon abhaengige Berechnung.
    expect(felder).toEqual(["vorfall_beginn", "vorfall_dauer"]);
    const beginn = historie.body.find((h: { feldSchluessel: string }) => h.feldSchluessel === "vorfall_beginn");
    expect(beginn).toMatchObject({ wertAlt: "23:10", wertNeu: "23:20", grund: "Uhrzeit laut Dienstbuch", geaendertVonName: "Person leitung-a" });
  });

  it("die eigene Autor:in darf korrigieren", async () => {
    const detail = (await als(betreuerA).get(`/protokolle/${protokollId}`)).body;
    const res = await als(betreuerA).post(`/protokolle/${protokollId}/korrektur`, {
      werte: { ...detail.werte, uebergabe: "Gespräch am Morgen vereinbart." },
      grund: "Nachtrag",
    });
    expect(res.status).toBe(201);
    expect(res.body.anzahlAenderungen).toBe(3);
  });

  describe("Datenbank erzwingt (App-Rolle, ohne API)", () => {
    it("Aenderung eines abgeschlossenen Protokolls ohne Grund scheitert, mit Grund wird sie protokolliert", async () => {
      await expect(
        alsApp(mandantA, (c) => c.query("UPDATE protokoll_wert SET wert_text = 'still' WHERE protokoll_id = $1 AND feld_schluessel = 'uebergabe'", [protokollId]))
      ).rejects.toThrow(/brauchen einen Grund/);
      const n = await alsApp(
        mandantA,
        async (c) => {
          await c.query("SELECT set_config('app.benutzer_id', $1, true)", [betreuerAId]);
          await c.query("UPDATE protokoll_wert SET wert_text = 'mit Grund' WHERE protokoll_id = $1 AND feld_schluessel = 'uebergabe'", [protokollId]);
          return (await c.query("SELECT count(*)::int AS n FROM protokoll_aenderung WHERE protokoll_id = $1", [protokollId])).rows[0].n;
        },
        "Test"
      );
      expect(n).toBe(4);
    });

    it("Historie ist append-only", async () => {
      await expect(alsApp(mandantA, (c) => c.query("DELETE FROM protokoll_aenderung WHERE protokoll_id = $1", [protokollId]))).rejects.toThrow(/permission denied/);
      await expect(alsApp(mandantA, (c) => c.query("UPDATE protokoll_aenderung SET grund = 'x' WHERE protokoll_id = $1", [protokollId]))).rejects.toThrow(/permission denied/);
    });

    it("abgeschlossene Protokolle sind nicht loeschbar und nicht wieder zu oeffnen", async () => {
      await expect(alsApp(mandantA, (c) => c.query("DELETE FROM protokoll WHERE id = $1", [protokollId]))).rejects.toThrow(/nicht gelöscht/);
      await expect(alsApp(mandantA, (c) => c.query("UPDATE protokoll SET abgeschlossen_am = NULL, abgeschlossen_von = NULL WHERE id = $1", [protokollId]))).rejects.toThrow(/wieder geöffnet/);
      await expect(alsApp(mandantA, (c) => c.query("UPDATE protokoll SET autor_id = $2 WHERE id = $1", [protokollId, betreuerA2Id]))).rejects.toThrow(/permission denied/);
    });

    it("eine veroeffentlichte Formularversion ist eingefroren", async () => {
      await expect(
        alsApp(mandantA, (c) => c.query("UPDATE formular_version SET definition = '{\"bausteine\": []}' WHERE formular_id = $1", [formularId]))
      ).rejects.toThrow(/nicht mehr geändert/);
      await expect(alsApp(mandantA, (c) => c.query("DELETE FROM formular_version WHERE formular_id = $1", [formularId]))).rejects.toThrow(/nicht mehr geändert/);
    });

    it("ein Datenpunkt kann nicht auf ein Protokoll eines fremden Traegers zeigen", async () => {
      await expect(
        alsApp(mandanten[1], (c) =>
          c.query(
            "INSERT INTO protokoll_wert (mandant_id, protokoll_id, feld_schluessel, datentyp, wert_text, quelle) VALUES ($1, $2, 'x', 'text', 'y', 'eingabe')",
            [mandanten[1], protokollId]
          )
        )
      ).rejects.toThrow(/foreign key/);
    });
  });

  it("Mandantentrennung: ein anderer Traeger sieht weder Formular noch Protokoll", async () => {
    expect((await als(tokenB).get(`/protokolle/${protokollId}`)).status).toBe(404);
    expect((await als(tokenB).get("/formulare")).body).toEqual([]);
    expect((await als(tokenB).post("/protokolle", { formularId, klientId: klientB })).status).toBe(404);
    expect((await als(tokenB).post("/protokolle", { formularId, klientId: klientA })).status).toBe(404);
  });

  it("ein stillgelegtes Formular nimmt keine neuen Protokolle an", async () => {
    expect((await als(betreuerA).post(`/formulare/${formularId}/archivieren`, { archiviert: true })).status).toBe(403);
    expect((await als(leitungA).post(`/formulare/${formularId}/archivieren`, { archiviert: true })).body.status).toBe("stillgelegt");
    expect((await als(betreuerA).post("/protokolle", { formularId, klientId: klientA })).status).toBe(404);
    await als(leitungA).post(`/formulare/${formularId}/archivieren`, { archiviert: false });
  });

  it("ein Entwurf kann von der Autor:in verworfen werden", async () => {
    const neu = await als(betreuerA).post("/protokolle", { formularId, klientId: klientA });
    expect((await als(betreuerA2).del(`/protokolle/${neu.body.id}`)).status).toBe(404);
    expect((await als(betreuerA).del(`/protokolle/${neu.body.id}`)).status).toBe(200);
    expect((await als(betreuerA).get(`/protokolle/${neu.body.id}`)).status).toBe(404);
  });

  it("nach der Anonymisierung zeigt auch das Protokoll keinen Namen mehr", async () => {
    const anonym = await http().patch(`/klienten/${klientA}/anonymisieren`).set("Authorization", `Bearer ${leitungA}`).send();
    expect(anonym.status).toBe(200);
    const res = await als(leitungA).get(`/protokolle/${protokollId}`);
    expect(res.status).toBe(200);
    expect(res.body.anzeige.klient_name).not.toMatch(/Sonnenberg|Maximilian/);
    expect(res.body.anzeige.klient_geburtsdatum).not.toBe("2003-03-04");
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM protokoll_wert w
       WHERE w.protokoll_id = $1 AND (w.wert_text ILIKE '%Sonnenberg%' OR array_to_string(w.wert_liste, ' ') ILIKE '%Sonnenberg%')`,
      [protokollId]
    );
    expect(rows[0].n).toBe(0);
  });
});
