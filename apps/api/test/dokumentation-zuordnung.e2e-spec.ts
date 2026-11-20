/**
 * Dokumente ohne Klient:in (Rueckmeldung „Dokumentation“, Migration 0083).
 *
 * Geprueft wird, was nicht nur die Oberflaeche zusichern darf:
 *  - die Zuordnung der Version entscheidet, ob Klient:in/Standort Pflicht,
 *    erlaubt oder verboten ist -- im Service UND per Trigger in der Datenbank
 *  - Standort-Dokumente sehen und bearbeiten nur Personen, die den Standort
 *    sehen duerfen; ein Formular, das fuer keinen ihrer Standorte zugelassen
 *    ist, wird ihnen gar nicht angeboten
 *  - ein Formular ohne Klient:in darf keine Klientendaten anzeigen oder
 *    vorausfuellen (pruefeDefinition beim Veroeffentlichen)
 *  - Klientenakte und Tagesbericht bieten nur Klienten-Formulare an
 *  - Zusammengesetzter FK: kein Protokoll auf einen fremden Standort
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import type { FormularDefinition } from "@zimmerakte/shared";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf, type AlteRolle } from "./support/konto-mit-rolle";

describe("Dokumentation: Zuordnung Klient:in, Standort, ohne (Migration 0083)", () => {
  let app: INestApplication;
  let admin: Client;
  let appRolle: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const mandanten: string[] = [];

  let mandantA: string;
  let mandantB: string;
  let leitungA: string;
  let betreuerA: string;
  let leitungB: string;
  let eingeschraenktA: string;
  let standortB: string;
  const standorte: Record<"lindenweg" | "park" | "sued", string> = { lindenweg: "", park: "", sued: "" };
  let klientLinden: string;
  let klientSued: string;
  let klientOhne: string;

  async function mandant(name: string) {
    const slug = `test-doku-${name}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
      `Testmandant Doku ${name} ${suffix}`,
      slug,
    ]);
    mandanten.push(rows[0].id);
    return { id: rows[0].id, slug };
  }

  async function konto(m: { id: string; slug: string }, rolle: AlteRolle, kurz: string) {
    const email = `${kurz}-${suffix}@beispiel.test`;
    await kontoMitAlterRolle(admin, { mandantId: m.id, rolle, email, name: `Person ${kurz}`, passwortHash: await bcrypt.hash(passwort, 4) });
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: m.slug, email, passwort });
    return res.body.accessToken as string;
  }

  async function standort(mandantId: string, name: string) {
    const { rows } = await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Weg 1') RETURNING id", [
      mandantId,
      name,
    ]);
    return rows[0].id;
  }

  async function klient(mandantId: string, nachname: string, standortId: string | null) {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, 'Mira', $2, '2004-05-06', $3, 'Jugendamt') RETURNING id",
      [mandantId, nachname, `AZ-${randomUUID().slice(0, 8)}`]
    );
    if (standortId) {
      const z = await admin.query<{ id: string }>("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id", [
        mandantId,
        standortId,
        `Z-${randomUUID().slice(0, 4)}`,
      ]);
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
        mandantId,
        z.rows[0].id,
        rows[0].id,
      ]);
    }
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
    mandantB = b.id;
    leitungA = await konto(a, "einrichtungsleitung", "d-leitung-a");
    betreuerA = await konto(a, "betreuer", "d-betreuer-a");
    eingeschraenktA = await konto(a, "betreuer", "d-eingeschraenkt-a");
    leitungB = await konto(b, "bereichsleitung", "d-leitung-b");

    standorte.lindenweg = await standort(a.id, "Haus Lindenweg");
    standorte.park = await standort(a.id, "Haus am Park");
    standorte.sued = await standort(a.id, "WG Südstadt");
    standortB = await standort(b.id, "Fremder Standort");
    klientLinden = await klient(a.id, "Lindenweg", standorte.lindenweg);
    klientSued = await klient(a.id, "Suedstadt", standorte.sued);
    klientOhne = await klient(a.id, "OhneBelegung", null);
    const eid = (await admin.query("SELECT id FROM benutzer WHERE email = $1", [`d-eingeschraenkt-a-${suffix}@beispiel.test`])).rows[0].id;
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [a.id, eid, standorte.lindenweg]);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE formular_version DISABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll DISABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert DISABLE TRIGGER protokoll_wert_protokoll");
      for (const m of mandanten) {
        for (const t of [
          "protokoll_aenderung",
          "protokoll_wert",
          "protokoll",
          "tagesbericht_tag",
          "tagesbericht_aenderung",
          "tagesbericht_dokument",
          "tagesbericht",
          "formular_anheftung",
          "formular_standort",
          "formular_version",
          "formular",
          "belegung",
          "zimmer",
          "klient_stammdaten",
          "klient",
          "benutzer_standort",
          "standort",
        ]) {
          await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [m]);
        }
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

  async function alsApp<T>(mandantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
    await appRolle.query("BEGIN");
    try {
      await appRolle.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      return await fn(appRolle);
    } finally {
      await appRolle.query("ROLLBACK");
    }
  }


  const def = (zuordnung: FormularDefinition["zuordnung"], extra: FormularDefinition["bausteine"] = []): FormularDefinition => ({
    zuordnung,
    bausteine: [{ typ: "langtext", schluessel: "inhalt", beschriftung: "Inhalt" }, ...extra],
  });

  async function formular(name: string, d: FormularDefinition): Promise<string> {
    const neu = await als(leitungA).post("/formulare", { name });
    expect(neu.status).toBe(201);
    expect((await als(leitungA).put(`/formulare/${neu.body.id}/entwurf`, { definition: d })).status).toBe(200);
    const v = await als(leitungA).post(`/formulare/${neu.body.id}/veroeffentlichen`);
    expect(v.status).toBe(201);
    return neu.body.id;
  }

  async function einstellungen(id: string, e: { standortIds?: string[]; aufDokumentation?: boolean }) {
    const res = await als(leitungA).put(`/formulare/${id}/einstellungen`, {
      name: (await als(leitungA).get(`/formulare/${id}`)).body.name,
      standortIds: e.standortIds ?? [],
      anheftungen: [],
      aufDokumentation: e.aufDokumentation ?? true,
    });
    expect(res.status).toBe(200);
    return res.body;
  }

  const angebot = async (token: string) => {
    const res = await als(token).get("/formulare/dokumentation");
    expect(res.status).toBe(200);
    return res.body as { id: string; zuordnung: string; standorte: { id: string }[] }[];
  };

  let teamId: string;
  let fahrzeugId: string;
  let kriseId: string;
  let pflichtId: string;

  it("ein Formular ohne Klient:in darf keine Klientendaten anzeigen oder vorausfuellen", async () => {
    const neu = await als(leitungA).post("/formulare", { name: "Falsch gebaut" });
    await als(leitungA).put(`/formulare/${neu.body.id}/entwurf`, {
      definition: def("standort", [
        { typ: "anzeige", schluessel: "name", beschriftung: "Name", quelle: "klient.name" },
        { typ: "kurztext", schluessel: "wo", beschriftung: "Wohnung", vorausfuellen: { quelle: "belegung.wohnung", art: "vorschlag" } },
      ]),
    });
    const res = await als(leitungA).post(`/formulare/${neu.body.id}/veroeffentlichen`);
    expect(res.status).toBe(400);
    const text = res.body.pruefung.join(" ");
    expect(text).toMatch(/„Name“: zeigt Klientendaten/);
    expect(text).toMatch(/„Wohnung“: wird aus Klientendaten vorausgefüllt/);
    // Unbekannte Zuordnung wird ebenfalls abgelehnt.
    const falsch = await als(leitungA).put(`/formulare/${neu.body.id}/entwurf`, { definition: { ...def("ohne"), zuordnung: "gruppe" } });
    expect(falsch.status).toBe(400);
    expect(falsch.body.message).toMatch(/Unbekannte Zuordnung/);
  });

  it("Angebot der Seite Dokumentation: Zuordnung, Standorte je Person, auf_dokumentation", async () => {
    teamId = await formular("Teambesprechung", def("standort", [{ typ: "kurztext", schluessel: "wer", beschriftung: "Ausgefüllt von", vorausfuellen: { quelle: "ausfuellende.name", art: "vorschlag" } }]));
    fahrzeugId = await formular("Fahrzeugcheck", def("ohne"));
    kriseId = await formular("Krisengespräch", def("klient_wahlweise", [{ typ: "anzeige", schluessel: "name", beschriftung: "Name", quelle: "klient.name" }]));
    pflichtId = await formular("Hausbesuch", def(undefined));

    const alle = await angebot(betreuerA);
    const team = alle.find((a) => a.id === teamId)!;
    expect(team.zuordnung).toBe("standort");
    expect(team.standorte.map((s) => s.id).sort()).toEqual([standorte.lindenweg, standorte.park, standorte.sued].sort());
    expect(alle.find((a) => a.id === pflichtId)?.zuordnung).toBe("klient");

    // Eingeschraenkt auf Lindenweg: nur dieser Standort.
    const eng = await angebot(eingeschraenktA);
    expect(eng.find((a) => a.id === teamId)!.standorte.map((s) => s.id)).toEqual([standorte.lindenweg]);

    // Nur fuer den Park zugelassen: die eingeschraenkte Person bekommt es gar nicht angeboten.
    await einstellungen(teamId, { standortIds: [standorte.park] });
    expect((await angebot(eingeschraenktA)).some((a) => a.id === teamId)).toBe(false);
    expect((await angebot(betreuerA)).find((a) => a.id === teamId)!.standorte.map((s) => s.id)).toEqual([standorte.park]);
    await einstellungen(teamId, {});

    // Nicht auf der Seite Dokumentation: weder angeboten noch ohne Klient:in anlegbar.
    const detail = await einstellungen(fahrzeugId, { aufDokumentation: false });
    expect(detail.aufDokumentation).toBe(false);
    expect((await angebot(betreuerA)).some((a) => a.id === fahrzeugId)).toBe(false);
    expect((await als(betreuerA).post("/protokolle", { formularId: fahrzeugId })).status).toBe(404);
    await einstellungen(fahrzeugId, {});

    // Klientenakte bietet nur Klienten-Formulare an.
    const akte = (await als(betreuerA).get(`/formulare/angebot?klientId=${klientLinden}`)).body.map((f: { id: string }) => f.id);
    expect(akte).toEqual(expect.arrayContaining([kriseId, pflichtId]));
    expect(akte).not.toContain(teamId);
    expect(akte).not.toContain(fahrzeugId);
  });

  let parkDoku: string;

  it("Standort-Dokument: Standort Pflicht, nur erlaubte Standorte, Sichtbarkeit nach Standort", async () => {
    expect((await als(betreuerA).post("/protokolle", { formularId: teamId })).status).toBe(400);
    expect((await als(betreuerA).post("/protokolle", { formularId: teamId, standortId: standortB })).status).toBe(404);
    expect((await als(betreuerA).post("/protokolle", { formularId: teamId, klientId: klientLinden })).status).toBe(404);
    expect((await als(eingeschraenktA).post("/protokolle", { formularId: teamId, standortId: standorte.park })).status).toBe(404);

    const linden = await als(eingeschraenktA).post("/protokolle", { formularId: teamId, standortId: standorte.lindenweg });
    expect(linden.status).toBe(201);
    expect(linden.body).toMatchObject({ zuordnung: "standort", klientId: null, standortId: standorte.lindenweg, standortName: "Haus Lindenweg" });
    // Vorbelegung ohne Klient:in: die ausfuellende Person gibt es trotzdem.
    expect(linden.body.werte.wer).toBe("Person d-eingeschraenkt-a");

    const park = await als(betreuerA).post("/protokolle", { formularId: teamId, standortId: standorte.park });
    expect(park.status).toBe(201);
    parkDoku = park.body.id;
    const fertig = await als(betreuerA).post(`/protokolle/${parkDoku}/abschliessen`, { werte: { inhalt: "Dienstplan Dezember" } });
    expect(fertig.status).toBe(201);
    const fertigLinden = await als(eingeschraenktA).post(`/protokolle/${linden.body.id}/abschliessen`, { werte: { inhalt: "Brandschutz" } });
    expect(fertigLinden.status).toBe(201);

    // Eingeschraenkt: Park-Dokument weder einzeln noch in der Liste.
    expect((await als(eingeschraenktA).get(`/protokolle/${parkDoku}`)).status).toBe(404);
    const engListe = (await als(eingeschraenktA).get(`/protokolle?formularId=${teamId}`)).body.map((p: { id: string }) => p.id);
    expect(engListe).toEqual([linden.body.id]);
    const volleListe = (await als(betreuerA).get(`/protokolle?formularId=${teamId}`)).body.map((p: { id: string }) => p.id);
    expect(volleListe.sort()).toEqual([linden.body.id, parkDoku].sort());
    // Fremder Traeger sieht nichts.
    expect((await als(leitungB).get(`/protokolle/${parkDoku}`)).status).toBe(404);
  });

  it("ohne Zuordnung und Klient:in wahlweise", async () => {
    const ohne = await als(eingeschraenktA).post("/protokolle", { formularId: fahrzeugId });
    expect(ohne.status).toBe(201);
    expect(ohne.body).toMatchObject({ zuordnung: "ohne", klientId: null, standortId: null });
    expect((await als(betreuerA).post("/protokolle", { formularId: fahrzeugId, standortId: standorte.park })).status).toBe(400);
    expect((await als(betreuerA).post("/protokolle", { formularId: fahrzeugId, klientId: klientLinden })).status).toBe(404);

    const ohneKlient = await als(betreuerA).post("/protokolle", { formularId: kriseId });
    expect(ohneKlient.status).toBe(201);
    expect(ohneKlient.body.anzeige.name).toBeNull();
    const mitKlient = await als(betreuerA).post("/protokolle", { formularId: kriseId, klientId: klientLinden });
    expect(mitKlient.status).toBe(201);
    expect(mitKlient.body.anzeige.name).toBe("Mira Lindenweg");

    // Klient:in Pflicht: ohne geht nicht.
    expect((await als(betreuerA).post("/protokolle", { formularId: pflichtId })).status).toBe(400);
  });

  it("Datenbank: Trigger und Fremdschluessel halten Zuordnung und Traeger, auch am Service vorbei", async () => {
    const version = async (formularId: string) =>
      (await admin.query("SELECT id FROM formular_version WHERE formular_id = $1 AND veroeffentlicht_am IS NOT NULL", [formularId])).rows[0].id;
    const benutzer = (await admin.query("SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1", [mandantA])).rows[0].id;
    const insert = (versionId: string, klientId: string | null, standortId: string | null) =>
      alsApp(mandantA, (c) =>
        c.query("INSERT INTO protokoll (mandant_id, formular_version_id, klient_id, standort_id, autor_id, bezugsdatum) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)", [
          mandantA, versionId, klientId, standortId, benutzer,
        ])
      );
    await expect(insert(await version(pflichtId), null, null)).rejects.toThrow(/gehört zu einer Klient:in/);
    await expect(insert(await version(teamId), klientLinden, null)).rejects.toThrow(/gehört zu einem Standort/);
    await expect(insert(await version(fahrzeugId), null, standorte.park)).rejects.toThrow(/keine Zuordnung/);
    await expect(insert(await version(kriseId), null, standorte.park)).rejects.toThrow(/zu keinem Standort/);
    await expect(insert(await version(teamId), null, standortB)).rejects.toThrow(/foreign key|violates/);
    await expect(insert(await version(teamId), null, standorte.park)).resolves.toBeDefined();
    // Standort nachtraeglich umhaengen: keine Spaltenberechtigung.
    await expect(alsApp(mandantA, (c) => c.query("UPDATE protokoll SET standort_id = $2 WHERE id = $1", [parkDoku, standorte.sued]))).rejects.toThrow(/permission denied/);
  });
});
