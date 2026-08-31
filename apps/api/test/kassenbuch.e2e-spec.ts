/**
 * Die Abnahmekriterien aus dem Bauplan, Phase 2: "eine zweite HZL-Buchung
 * für dieselbe Woche wird abgelehnt, eine Auszahlung ohne Unterschrift
 * kann nicht gespeichert werden, und ein Änderungsversuch an einer
 * bestehenden Buchung scheitert an der Datenbank."
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

// Eine winzige, aber gueltige 1x1-PNG-Datei -- reicht als Testsignatur.
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Kassenbuch: HZL-Eindeutigkeit, Unterschriftspflicht, Aenderungsschutz", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let tokenBereichsleitung: string;
  let klientWoechentlich: string;
  let klientMonatlich: string;
  let standortHaus: string;
  let mitarbeiterTeilnehmerId: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-kassenbuch-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Kassenbuch ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: bereichsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung') RETURNING id`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: klientWoRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Wochen', 'Klientin', '1990-01-01', $2, 'Testamt', 'woechentlich') RETURNING id`,
      [mandantId, `AZ-WO-${suffix}`]
    );
    klientWoechentlich = klientWoRows[0].id;

    const { rows: klientMoRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
       VALUES ($1, 'Monats', 'Klient', '1990-01-01', $2, 'Testamt', 'monatlich') RETURNING id`,
      [mandantId, `AZ-MO-${suffix}`]
    );
    klientMonatlich = klientMoRows[0].id;

    const { rows: standortRows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus am Park', 'Teststr. 1') RETURNING id",
      [mandantId]
    );
    standortHaus = standortRows[0].id;

    const { rows: mitarbeiterRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Betreuerin Teilnahme', $3, 'betreuer') RETURNING id`,
      [mandantId, `betreuerin-${suffix}@beispiel.test`, passwortHash]
    );
    mitarbeiterTeilnehmerId = mitarbeiterRows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: `bereichsleitung-${suffix}@beispiel.test`, passwort });
    tokenBereichsleitung = res.body.accessToken;
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM unterschrift WHERE kassenbuchung_id IN (SELECT id FROM kassenbuchung WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query(
      "DELETE FROM kassenbuchung_teilnehmer WHERE kassenbuchung_id IN (SELECT id FROM kassenbuchung WHERE mandant_id = $1)",
      [mandantId]
    );
    await admin.query("DELETE FROM kassenbuchung_stornoantrag WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${tokenBereichsleitung}`).send(body);
  }
  function get(path: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${tokenBereichsleitung}`);
  }

  it("lehnt eine Auszahlung ohne Unterschrift ab", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-17",
      betragCent: -2000,
      verwendungszweck: "HZL",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
    });
    expect(res.status).toBe(400);
  });

  it("speichert eine Auszahlung mit Unterschrift, und das Bild lässt sich abrufen", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-17",
      betragCent: -2000,
      verwendungszweck: "HZL",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
      unterschriftBase64: TEST_PNG_BASE64,
    });
    expect(res.status).toBe(201);
    expect(res.body.hatUnterschrift).toBe(true);

    const bildRes = await get(`/kassenbuchungen/${res.body.id}/unterschrift`);
    expect(bildRes.status).toBe(200);
    expect(bildRes.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(bildRes.body).length).toBeGreaterThan(0);
  });

  it("speichert eine Einzahlung (positiver Betrag) auch ohne Unterschrift", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-01",
      betragCent: 5000,
      verwendungszweck: "Einzahlung Taschengeldkonto",
      typ: "einzahlung",
    });
    expect(res.status).toBe(201);
    expect(res.body.hatUnterschrift).toBe(false);
  });

  it("lehnt eine zweite HZL-Buchung für dieselbe Woche mit 409 ab", async () => {
    const res = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-19",
      betragCent: -2000,
      verwendungszweck: "HZL nochmal",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
      unterschriftBase64: TEST_PNG_BASE64,
    });
    expect(res.status).toBe(409);
  });

  it("zeigt in der Wochenübersicht korrekt bezahlt/offen", async () => {
    const res = await get("/kassenbuchungen/wochenuebersicht?jahr=2026&kw=34");
    const woechentlich = res.body.find((e: { klientId: string }) => e.klientId === klientWoechentlich);
    expect(woechentlich.bezahlt).toBe(true);

    // Monatlicher Klient darf in der woechentlichen Übersicht gar nicht erst auftauchen.
    expect(res.body.find((e: { klientId: string }) => e.klientId === klientMonatlich)).toBeUndefined();
  });

  it("nach Storno ist die Woche wieder frei für eine neue HZL-Buchung", async () => {
    const liste = await get(`/kassenbuchungen?klientId=${klientWoechentlich}`);
    const offeneHzl = liste.body.find((b: { typ: string; storniert: boolean }) => b.typ === "hzl" && !b.storniert);

    // Bereichsleitung beantragt und bewilligt sich damit im selben Zug
    // selbst (siehe kassenbuchung.service.ts, stornoBeantragen()).
    const stornoRes = await request(app.getHttpServer())
      .post(`/kassenbuchungen/${offeneHzl.id}/storno-antrag`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "Falscher Betrag eingegeben" });
    expect(stornoRes.status).toBe(201);
    expect(stornoRes.body.storniert).toBe(true);
    expect(stornoRes.body.stornoGrund).toBe("Falscher Betrag eingegeben");
    expect(stornoRes.body.offenerStornoantrag).toBeNull();

    const neueBuchung = await post("/kassenbuchungen", {
      klientId: klientWoechentlich,
      datum: "2026-08-20",
      betragCent: -2000,
      verwendungszweck: "HZL korrigiert",
      typ: "hzl",
      isoJahr: 2026,
      isoWoche: 34,
      unterschriftBase64: TEST_PNG_BASE64,
    });
    expect(neueBuchung.status).toBe(201);

    // Die ursprüngliche, stornierte Buchung bleibt als Zeile erhalten -- sie
    // wird nicht ersetzt oder gelöscht.
    const listeNachStorno = await get(`/kassenbuchungen?klientId=${klientWoechentlich}`);
    expect(listeNachStorno.body.find((b: { id: string }) => b.id === offeneHzl.id).storniert).toBe(true);
  });

  it("lehnt einen Storno-Antrag für eine bereits stornierte Buchung ab", async () => {
    const liste = await get(`/kassenbuchungen?klientId=${klientWoechentlich}`);
    const bereitsStorniert = liste.body.find((b: { storniert: boolean }) => b.storniert);

    const res = await request(app.getHttpServer())
      .post(`/kassenbuchungen/${bereitsStorniert.id}/storno-antrag`)
      .set("Authorization", `Bearer ${tokenBereichsleitung}`)
      .send({ grund: "Nochmal" });
    expect(res.status).toBe(409);
  });

  describe("Standort-Buchungen (Spaßgeld/Freizeitveranstaltungen, Migration 0030)", () => {
    it("lehnt eine Buchung ohne klientId und ohne standortId ab", async () => {
      const res = await post("/kassenbuchungen", {
        datum: "2026-08-21",
        betragCent: 1000,
        verwendungszweck: "weder noch",
        typ: "sonstiges",
      });
      expect(res.status).toBe(400);
    });

    it("lehnt eine Buchung mit klientId UND standortId gleichzeitig ab", async () => {
      const res = await post("/kassenbuchungen", {
        klientId: klientMonatlich,
        standortId: standortHaus,
        datum: "2026-08-21",
        betragCent: 1000,
        verwendungszweck: "beides",
        typ: "sonstiges",
      });
      expect(res.status).toBe(400);
    });

    it("lehnt HZL für einen Standort ab", async () => {
      const res = await post("/kassenbuchungen", {
        standortId: standortHaus,
        datum: "2026-08-21",
        betragCent: 2000,
        verwendungszweck: "HZL für alle?",
        typ: "hzl",
      });
      expect(res.status).toBe(400);
    });

    it("legt eine Einzahlung für den Standort an -- ohne Klient, mit Teilnehmern", async () => {
      const res = await post("/kassenbuchungen", {
        standortId: standortHaus,
        datum: "2026-08-21",
        betragCent: 8000,
        verwendungszweck: "Grillfest im Garten",
        typ: "einzahlung",
        teilnehmerKlientIds: [klientWoechentlich, klientMonatlich],
        teilnehmerBenutzerIds: [mitarbeiterTeilnehmerId],
      });
      expect(res.status).toBe(201);
      expect(res.body.klientId).toBeNull();
      expect(res.body.standortId).toBe(standortHaus);
      expect(res.body.standortName).toBe("Haus am Park");
      expect(res.body.teilnehmer).toHaveLength(3);
      const teilnehmerKlientIds = res.body.teilnehmer.map((t: { klientId: string | null }) => t.klientId).filter(Boolean);
      expect(teilnehmerKlientIds.sort()).toEqual([klientMonatlich, klientWoechentlich].sort());
      expect(res.body.teilnehmer.some((t: { benutzerId: string | null }) => t.benutzerId === mitarbeiterTeilnehmerId)).toBe(
        true
      );
    });

    it("lehnt einen unbekannten Teilnehmer-Klienten mit 404 ab", async () => {
      const res = await post("/kassenbuchungen", {
        standortId: standortHaus,
        datum: "2026-08-21",
        betragCent: 500,
        verwendungszweck: "sollte scheitern",
        typ: "sonstiges",
        teilnehmerKlientIds: [randomUUID()],
      });
      expect(res.status).toBe(404);
    });

    it("verlangt fuer eine Standort-Auszahlung ebenfalls eine Unterschrift", async () => {
      const ohne = await post("/kassenbuchungen", {
        standortId: standortHaus,
        datum: "2026-08-22",
        betragCent: -3000,
        verwendungszweck: "Kino-Ausflug",
        typ: "sonstiges",
      });
      expect(ohne.status).toBe(400);

      const mit = await post("/kassenbuchungen", {
        standortId: standortHaus,
        datum: "2026-08-22",
        betragCent: -3000,
        verwendungszweck: "Kino-Ausflug",
        typ: "sonstiges",
        unterschriftBase64: TEST_PNG_BASE64,
      });
      expect(mit.status).toBe(201);
      expect(mit.body.hatUnterschrift).toBe(true);
    });

    it("zeigt Klient- und Standort-Buchungen gemeinsam in der Liste, mit korrekt befuellten Feldern", async () => {
      const res = await get("/kassenbuchungen");
      const klientBuchung = res.body.find((b: { klientId: string | null }) => b.klientId === klientWoechentlich);
      const standortBuchung = res.body.find((b: { standortId: string | null }) => b.standortId === standortHaus);
      expect(klientBuchung.standortId).toBeNull();
      expect(klientBuchung.standortName).toBeNull();
      expect(standortBuchung.klientId).toBeNull();
      expect(standortBuchung.klientName).toBeNull();
    });

    it("kann eine Standort-Buchung stornieren", async () => {
      const liste = await get("/kassenbuchungen");
      const grillfest = liste.body.find((b: { verwendungszweck: string }) => b.verwendungszweck === "Grillfest im Garten");

      const res = await request(app.getHttpServer())
        .post(`/kassenbuchungen/${grillfest.id}/storno-antrag`)
        .set("Authorization", `Bearer ${tokenBereichsleitung}`)
        .send({ grund: "Wetter" });
      expect(res.status).toBe(201);
      expect(res.body.storniert).toBe(true);
    });

    /**
     * Gegenproben: die beiden CHECKs aus Migration 0030 muessen auch dann
     * greifen, wenn ein kuenftiger Codepfad an Controller und Service
     * vorbeigeht.
     */
    describe("Zusicherungen der Datenbank (unterhalb der Anwendung)", () => {
      let appRolle: Client;

      beforeAll(async () => {
        appRolle = new Client({ connectionString: process.env.APP_DATABASE_URL });
        await appRolle.connect();
      });

      afterAll(async () => {
        await appRolle.end();
      });

      async function alsMandant<T>(fn: () => Promise<T>): Promise<T> {
        await appRolle.query("BEGIN");
        await appRolle.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        try {
          return await fn();
        } finally {
          await appRolle.query("ROLLBACK");
        }
      }

      it("verhindert per CHECK, dass klient_id und standort_id gleichzeitig NULL oder beide gesetzt sind", async () => {
        await alsMandant(async () => {
          await expect(
            appRolle.query(
              `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, typ)
               VALUES ($1, NULL, NULL, '2026-08-23', 100, 'weder noch', 'sonstiges')`,
              [mandantId]
            )
          ).rejects.toThrow(/check constraint/i);
        });
        await alsMandant(async () => {
          await expect(
            appRolle.query(
              `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, typ)
               VALUES ($1, $2, $3, '2026-08-23', 100, 'beides', 'sonstiges')`,
              [mandantId, klientMonatlich, standortHaus]
            )
          ).rejects.toThrow(/check constraint/i);
        });
      });

      it("verhindert per CHECK eine HZL-Buchung ohne Klient", async () => {
        await alsMandant(async () => {
          await expect(
            appRolle.query(
              `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, typ)
               VALUES ($1, NULL, $2, '2026-08-23', 100, 'HZL ohne Klient', 'hzl')`,
              [mandantId, standortHaus]
            )
          ).rejects.toThrow(/check constraint/i);
        });
      });
    });
  });

  it("verweigert der App-Datenbankrolle jede Änderung an Betrag oder Datum einer Buchung", async () => {
    // Jede Pruefung braucht ihre eigene Transaktion: Nach einem
    // "permission denied" ist die Postgres-Transaktion abgebrochen und
    // jeder weitere Befehl darin schlaegt nur noch deshalb fehl, nicht mehr
    // wegen der Rechteprüfung selbst.
    const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query("UPDATE kassenbuchung SET betrag_cent = -1 WHERE mandant_id = $1", [mandantId])
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId])
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }
  });
});
