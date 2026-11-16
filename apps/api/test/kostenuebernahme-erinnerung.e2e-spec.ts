/**
 * Erinnerungen vor Ablauf einer Kostenuebernahme (migrations/0071).
 *
 * Kernaussagen:
 *   1. In den 90 Tagen vor "bis" entsteht je Zeitraum genau eine Zimmer-Aufgabe
 *      pro Stufe (90/60/30), der Bezugsbetreuung zugewiesen, ohne Klientenname.
 *   2. Der Lauf ist idempotent: ein zweiter Lauf legt nichts nach.
 *   3. Wer erst bei 20 Tagen erfasst wird, bekommt nur EINE Aufgabe (die
 *      dringendste), nicht drei.
 *   4. Keine Aufgabe bei Folge-Zeitraum, ohne Belegung, zu weit entfernt,
 *      anonymisierten oder archivierten Klient:innen.
 *   5. Der naechste Schwellenuebergang loest die naechste Aufgabe aus.
 *   6. Mandanten bleiben getrennt; die App-Rolle kann die Erinnerungstabelle
 *      nicht beschreiben.
 *
 * Seed-Daten mit der Admin-Rolle, damit "bis" relativ zu heute gesetzt werden kann.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { KostenuebernahmeErinnerungService } from "../src/kostenuebernahmen/kostenuebernahme-erinnerung.service";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Kostenübernahme-Erinnerungen", () => {
  let app: INestApplication;
  let admin: Client;
  let dienst: KostenuebernahmeErinnerungService;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";
  let mandantAId: string;
  let mandantBId: string;
  let betreuerId: string;
  let zimmerAId: string;
  let tokenBetreuerA: string;

  let k90: string;
  let k30: string;
  let kFolge: string;
  let kFern: string;
  let kOhneZimmer: string;
  let kAnonym: string;
  let kArchiv: string;
  let kB: string;
  let kuK90: string;
  const alleKlienten: string[] = [];

  const aufgabenFuer = async (kuId: string) =>
    (
      await admin.query(
        `SELECT e.stufe_tage, a.id AS aufgabe_id, a.titel, a.beschreibung, a.prioritaet, a.zugewiesen_an, a.zimmer_id
         FROM kostenuebernahme_erinnerung e LEFT JOIN aufgabe a ON a.id = e.aufgabe_id
         WHERE e.kostenuebernahme_id = $1 ORDER BY e.stufe_tage DESC`,
        [kuId]
      )
    ).rows;

  async function neuerKlient(mandantId: string, vorname: string, extra = "") {
    const id = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, $2, 'Erinnerung', '1990-01-01', $3, 'Amt') RETURNING id`,
        [mandantId, vorname, `AZ-${randomUUID().slice(0, 8)}`]
      )
    ).rows[0].id as string;
    alleKlienten.push(id);
    if (extra === "anonym") await admin.query("UPDATE klient SET anonymisiert_am = now(), anonymisiert_von = (SELECT id FROM benutzer WHERE mandant_id = $2 LIMIT 1) WHERE id = $1", [id, mandantId]);
    return id;
  }
  const einziehen = (mandantId: string, klientId: string, zimmerId: string) =>
    admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, CURRENT_DATE - 100)", [
      mandantId,
      zimmerId,
      klientId,
    ]);
  const ku = async (mandantId: string, klientId: string, von: string, bisInTagen: number) =>
    (
      await admin.query(
        "INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, bis) VALUES ($1, $2, 'Amt Test', $3::date, CURRENT_DATE + $4::int) RETURNING id",
        [mandantId, klientId, von, bisInTagen]
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Erinnerung A ${suffix}`, `test-erinnerung-a-${suffix}`])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Erinnerung B ${suffix}`, `test-erinnerung-b-${suffix}`])).rows[0].id;

    await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "einrichtungsleitung", email: `leitung-${suffix}@beispiel.test`, name: "Leitung", passwortHash: hash });
    betreuerId = await kontoMitAlterRolle(admin, { mandantId: mandantAId, rolle: "betreuer", email: `betreuer-${suffix}@beispiel.test`, name: "Betreuer", passwortHash: hash });
    await kontoMitAlterRolle(admin, { mandantId: mandantBId, rolle: "einrichtungsleitung", email: `leitung-b-${suffix}@beispiel.test`, name: "Leitung B", passwortHash: hash });

    const standortA = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S', 'Str') RETURNING id", [mandantAId])).rows[0].id;
    zimmerAId = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '7', 10) RETURNING id", [mandantAId, standortA])).rows[0].id;
    const standortB = (await admin.query("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'S', 'Str') RETURNING id", [mandantBId])).rows[0].id;
    const zimmerBId = (await admin.query("INSERT INTO zimmer (mandant_id, standort_id, nummer, kapazitaet) VALUES ($1, $2, '9', 10) RETURNING id", [mandantBId, standortB])).rows[0].id;

    k90 = await neuerKlient(mandantAId, "K90");
    k30 = await neuerKlient(mandantAId, "K30");
    kFolge = await neuerKlient(mandantAId, "KFolge");
    kFern = await neuerKlient(mandantAId, "KFern");
    kOhneZimmer = await neuerKlient(mandantAId, "KOhne");
    kAnonym = await neuerKlient(mandantAId, "KAnonym", "anonym");
    kArchiv = await neuerKlient(mandantAId, "KArchiv");
    await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [kArchiv, betreuerId]);
    kB = await neuerKlient(mandantBId, "KB");
    for (const k of [k90, k30, kFolge, kFern, kAnonym, kArchiv]) await einziehen(mandantAId, k, zimmerAId);
    await einziehen(mandantBId, kB, zimmerBId);

    // Nur k90 hat eine Bezugsbetreuung.
    await admin.query("INSERT INTO klient_stammdaten (mandant_id, klient_id, bezugsbetreuer_id) VALUES ($1, $2, $3)", [mandantAId, k90, betreuerId]);

    kuK90 = await ku(mandantAId, k90, "2025-01-01", 80);
    await ku(mandantAId, k30, "2025-01-01", 20);
    await ku(mandantAId, kFolge, "2025-01-01", 20);
    await admin.query("INSERT INTO kostenuebernahme (mandant_id, klient_id, amt, von, bis) VALUES ($1, $2, 'Folge', CURRENT_DATE + 20, NULL)", [mandantAId, kFolge]);
    await ku(mandantAId, kFern, "2025-01-01", 120);
    await ku(mandantAId, kOhneZimmer, "2025-01-01", 20);
    await ku(mandantAId, kAnonym, "2025-01-01", 20);
    await ku(mandantAId, kArchiv, "2025-01-01", 20);
    await ku(mandantBId, kB, "2025-01-01", 20);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dienst = app.get(KostenuebernahmeErinnerungService);

    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: `test-erinnerung-a-${suffix}`, email: `betreuer-${suffix}@beispiel.test`, passwort });
    tokenBetreuerA = res.body.accessToken;
  });

  afterAll(async () => {
    try {
      for (const m of [mandantAId, mandantBId]) {
        await admin.query("DELETE FROM kostenuebernahme_erinnerung WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM aufgabe WHERE mandant_id = $1", [m]);
        await raeumeKontoMitRolleAuf(admin, m);
        await admin.query("DELETE FROM kostenuebernahme WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM klient_stammdaten WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM klient WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM standort WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [m]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m]);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("legt je Zeitraum eine Zimmer-Aufgabe an, zugewiesen an die Bezugsbetreuung, ohne Klientennamen", async () => {
    const ergebnis = await dienst.erzeugen();
    expect(ergebnis.find((e) => e.mandantId === mandantAId)?.aufgaben).toBe(2); // k90 + k30
    expect(ergebnis.find((e) => e.mandantId === mandantBId)?.aufgaben).toBe(1);

    const zeilen = await aufgabenFuer(kuK90);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].stufe_tage).toBe(90);
    expect(zeilen[0].zugewiesen_an).toBe(betreuerId);
    expect(zeilen[0].zimmer_id).toBe(zimmerAId);
    expect(zeilen[0].prioritaet).toBe("normal");
    expect(zeilen[0].titel).toContain("80 Tagen");
    expect(`${zeilen[0].titel} ${zeilen[0].beschreibung}`).not.toMatch(/K90|Erinnerung/);

    // Die Betreuerin sieht die Aufgabe über die normale API.
    const liste = await request(app.getHttpServer()).get("/aufgaben").set("Authorization", `Bearer ${tokenBetreuerA}`);
    expect(JSON.stringify(liste.body)).toContain(zeilen[0].aufgabe_id);
  });

  it("legt bei spät erfasstem Zeitraum nur die dringendste Aufgabe an und vermerkt die übersprungenen Stufen", async () => {
    const kuId = (await admin.query("SELECT id FROM kostenuebernahme WHERE klient_id = $1", [k30])).rows[0].id;
    const zeilen = await aufgabenFuer(kuId);
    expect(zeilen.map((z) => z.stufe_tage)).toEqual([90, 60, 30]);
    expect(zeilen.filter((z) => z.aufgabe_id)).toHaveLength(1);
    expect(zeilen[2].aufgabe_id).not.toBeNull();
    expect(zeilen[2].prioritaet).toBe("hoch");
    expect(zeilen[2].zugewiesen_an).toBeNull(); // keine Bezugsbetreuung -> offener Posten
  });

  it("legt nichts an bei Folge-Zeitraum, ohne Belegung, zu fern, anonymisiert oder archiviert", async () => {
    for (const k of [kFolge, kFern, kOhneZimmer, kAnonym, kArchiv]) {
      const { rows } = await admin.query("SELECT count(*)::int AS n FROM kostenuebernahme_erinnerung e JOIN kostenuebernahme ko ON ko.id = e.kostenuebernahme_id WHERE ko.klient_id = $1", [k]);
      expect(rows[0].n).toBe(0);
    }
  });

  it("ist idempotent: ein zweiter Lauf legt nichts nach, auch nicht nach Erledigen der Aufgabe", async () => {
    const vorher = (await admin.query("SELECT count(*)::int AS n FROM aufgabe WHERE mandant_id = $1", [mandantAId])).rows[0].n;
    await admin.query("UPDATE aufgabe SET erledigt_am = now(), erledigt_von = $2 WHERE mandant_id = $1", [mandantAId, betreuerId]);
    const ergebnis = await dienst.erzeugen();
    expect(ergebnis.find((e) => e.mandantId === mandantAId)).toBeUndefined();
    const nachher = (await admin.query("SELECT count(*)::int AS n FROM aufgabe WHERE mandant_id = $1", [mandantAId])).rows[0].n;
    expect(nachher).toBe(vorher);
  });

  it("löst beim Übergang zur nächsten Stufe die nächste Aufgabe aus", async () => {
    await admin.query("UPDATE kostenuebernahme SET bis = CURRENT_DATE + 20 WHERE id = $1", [kuK90]);
    await dienst.erzeugen();
    const zeilen = await aufgabenFuer(kuK90);
    expect(zeilen.map((z) => z.stufe_tage)).toEqual([90, 60, 30]);
    expect(zeilen.filter((z) => z.aufgabe_id)).toHaveLength(2);
    expect(zeilen[2].prioritaet).toBe("hoch");
  });

  it("hält Mandanten getrennt und sperrt Schreiben für die App-Rolle", async () => {
    const liste = await request(app.getHttpServer()).get("/aufgaben").set("Authorization", `Bearer ${tokenBetreuerA}`);
    const bAufgaben = (await admin.query("SELECT id FROM aufgabe WHERE mandant_id = $1", [mandantBId])).rows;
    expect(bAufgaben).toHaveLength(1);
    expect(JSON.stringify(liste.body)).not.toContain(bAufgaben[0].id);

    const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    try {
      await expect(
        appClient.query("INSERT INTO kostenuebernahme_erinnerung (mandant_id, kostenuebernahme_id, stufe_tage) VALUES ($1, $2, 30)", [mandantAId, kuK90])
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appClient.end();
    }
  });
});
