/**
 * Die Abnahmekriterien aus dem Bauplan, Phase 1: "eine überlappende
 * Belegung wird von der API mit 409 abgelehnt, nirgends ein Statusfeld
 * existiert, und der Belegungsverlauf für frühere Bewohner:innen nur
 * Initialen ausliefert -- überprüft am API-Antwortkörper, nicht am
 * Bildschirm."
 *
 * Läuft wie der Mandantentrennungs-Test gegen eine echte, migrierte
 * PostgreSQL-Instanz.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Belegung: Überlappungssperre und Belegungsverlauf", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let standortId: string;
  let zimmerId: string;
  let klientEhemalig: { id: string; vorname: string; nachname: string };
  let klientAktuell: { id: string; vorname: string; nachname: string };
  let tokenLeitung: string;
  let tokenBezugsbetreuung: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-belegung-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Belegung ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: leitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Leitung Test', $3, 'leitung') RETURNING id`,
      [mandantId, `leitung-${suffix}@beispiel.test`, passwortHash]
    );
    const { rows: betreuungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Betreuung Test', $3, 'bezugsbetreuung') RETURNING id`,
      [mandantId, `betreuung-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: standortRows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Teststandort', 'Teststr. 1') RETURNING id",
      [mandantId]
    );
    standortId = standortRows[0].id;

    const { rows: zimmerRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standortId]
    );
    zimmerId = zimmerRows[0].id;

    const { rows: klientEhemaligRows } = await admin.query(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Thomas', 'Mueller', '1980-01-01', $2, 'Testamt') RETURNING id, vorname, nachname`,
      [mandantId, `AZ-EHEM-${suffix}`]
    );
    klientEhemalig = klientEhemaligRows[0];

    const { rows: klientAktuellRows } = await admin.query(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Sophie', 'Bergmann', '1991-03-14', $2, 'Testamt') RETURNING id, vorname, nachname`,
      [mandantId, `AZ-AKT-${suffix}`]
    );
    klientAktuell = klientAktuellRows[0];

    // Historische Belegung: bereits beendet.
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug, auszug) VALUES ($1, $2, $3, '2023-01-01', '2024-06-01')",
      [mandantId, zimmerId, klientEhemalig.id]
    );
    // Aktuelle Belegung: offen.
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-06-01')",
      [mandantId, zimmerId, klientAktuell.id]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenLeitung = await login(`leitung-${suffix}@beispiel.test`);
    tokenBezugsbetreuung = await login(`betreuung-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  it("leitet den Zimmerstatus aus der Belegung ab, ohne ein Statusfeld zu speichern", async () => {
    const res = await request(app.getHttpServer()).get("/zimmer").set("Authorization", `Bearer ${tokenLeitung}`);
    const zimmer = res.body.find((z: { id: string }) => z.id === zimmerId);

    expect(zimmer.status).toBe("vergeben");
    expect(zimmer.aktuellerKlient.name).toBe(`${klientAktuell.vorname} ${klientAktuell.nachname}`);
  });

  it("liefert im Belegungsverlauf für Bezugsbetreuung nur Initialen der ehemaligen Person, aber den vollen Namen der aktuellen", async () => {
    const res = await request(app.getHttpServer())
      .get(`/zimmer/${zimmerId}/belegungsverlauf`)
      .set("Authorization", `Bearer ${tokenBezugsbetreuung}`);

    const ehemalig = res.body.find((e: { istAktuell: boolean }) => !e.istAktuell);
    const aktuell = res.body.find((e: { istAktuell: boolean }) => e.istAktuell);

    expect(ehemalig.name).toBe("T. M.");
    expect(ehemalig.name).not.toContain(klientEhemalig.nachname);
    expect(ehemalig.klientId).toBeNull();

    expect(aktuell.name).toBe(`${klientAktuell.vorname} ${klientAktuell.nachname}`);
  });

  it("liefert im Belegungsverlauf für Leitung den vollen Namen, auch für ehemalige Bewohner:innen", async () => {
    const res = await request(app.getHttpServer())
      .get(`/zimmer/${zimmerId}/belegungsverlauf`)
      .set("Authorization", `Bearer ${tokenLeitung}`);

    const ehemalig = res.body.find((e: { istAktuell: boolean }) => !e.istAktuell);
    expect(ehemalig.name).toBe(`${klientEhemalig.vorname} ${klientEhemalig.nachname}`);
  });

  it("lehnt eine überlappende Belegung im selben Zimmer mit 409 ab", async () => {
    // Eigene, sonst unbeteiligte Person -- sonst würde dieser Test auch
    // dann grün bleiben, wenn NUR die Zimmer-Sperre fehlt, weil
    // klientEhemalig zusätzlich durch die Klienten-Sperre abgefangen würde.
    // Das ist beim Schreiben dieses Tests aufgefallen (Gegenprobe mit
    // testweise entfernter Zimmer-Sperre blieb grün) und absichtlich so
    // stehen gelassen, statt es zu verschweigen.
    const suffix = randomUUID().slice(0, 8);
    const { rows } = await admin.query(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Neu', 'Unbeteiligt', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-NEU-${suffix}`]
    );
    const unbeteiligterKlient = rows[0].id;

    const res = await request(app.getHttpServer())
      .post("/belegungen")
      .set("Authorization", `Bearer ${tokenLeitung}`)
      .send({ zimmerId, klientId: unbeteiligterKlient, einzug: "2024-01-01" }); // liegt mitten in der bestehenden Belegung

    expect(res.status).toBe(409);
  });

  it("lehnt eine zweite gleichzeitige Belegung derselben Person in einem anderen Zimmer mit 409 ab", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '102') RETURNING id",
      [mandantId, standortId]
    );
    const zweitesZimmer = rows[0].id;

    const res = await request(app.getHttpServer())
      .post("/belegungen")
      .set("Authorization", `Bearer ${tokenLeitung}`)
      .send({ zimmerId: zweitesZimmer, klientId: klientAktuell.id, einzug: "2025-01-01" });

    expect(res.status).toBe(409);
  });

  it("Auszug beendet die Belegung, danach zeigt das Zimmer 'zugeordnet' statt 'vergeben'", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Zweitstandort', 'Zweitstr. 2') RETURNING id",
      [mandantId]
    );
    const zweiterStandort = rows[0].id;
    const { rows: zimmerRows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, zweiterStandort]
    );
    const auszugZimmer = zimmerRows[0].id;

    const { rows: klientRows } = await admin.query(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Auszugs', 'Test', '1970-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-AUSZUG-${randomUUID().slice(0, 8)}`]
    );
    const auszugKlient = klientRows[0].id;

    const einzugRes = await request(app.getHttpServer())
      .post("/belegungen")
      .set("Authorization", `Bearer ${tokenLeitung}`)
      .send({ zimmerId: auszugZimmer, klientId: auszugKlient, einzug: "2025-01-01" });
    expect(einzugRes.status).toBe(201);

    let zimmerListe = await request(app.getHttpServer()).get("/zimmer").set("Authorization", `Bearer ${tokenLeitung}`);
    expect(zimmerListe.body.find((z: { id: string }) => z.id === auszugZimmer).status).toBe("vergeben");

    const auszugRes = await request(app.getHttpServer())
      .patch(`/belegungen/${einzugRes.body.id}`)
      .set("Authorization", `Bearer ${tokenLeitung}`)
      .send({ auszug: "2025-06-01" });
    expect(auszugRes.status).toBe(200);

    zimmerListe = await request(app.getHttpServer()).get("/zimmer").set("Authorization", `Bearer ${tokenLeitung}`);
    expect(zimmerListe.body.find((z: { id: string }) => z.id === auszugZimmer).status).toBe("zugeordnet");
  });
});
