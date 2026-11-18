/**
 * Formulare selbst bauen, veroeffentlichen, an Standorte binden und an den
 * Tagesbericht anheften (Migration 0076, Rueckmeldung „Formulare").
 *
 * Geprueft wird vor allem, was nicht nur die Oberflaeche zusichern darf:
 *  - ein Formular „in Entwicklung" wird nirgends ausgefuellt
 *  - Veroeffentlichen prueft Definition und Vertraeglichkeit mit frueheren
 *    Versionen (Typ eines Schluessels, benutzte Optionen)
 *  - ein veroeffentlichtes Formular ist nicht loeschbar (auch in der Datenbank)
 *  - die Standort-Zuweisung gilt auch, wenn der Browser etwas anderes schickt
 *  - ein Pflicht-Formular am Tagesbericht wird serverseitig verlangt, und
 *    Tagesbericht und Formular entstehen gemeinsam oder gar nicht
 *  - Mandantentrennung der neuen Tabellen und zusammengesetzte Fremdschluessel
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

const KONTROLLE: FormularDefinition = {
  bausteine: [
    { typ: "anzeige", schluessel: "klient_name", beschriftung: "Name", quelle: "klient.name" },
    { typ: "kurztext", schluessel: "wohnung", beschriftung: "Wohnung", vorausfuellen: { quelle: "belegung.wohnung", art: "festgehalten" } },
    {
      typ: "auswahl",
      schluessel: "schlaf",
      beschriftung: "Schlaf",
      pflicht: true,
      optionen: [
        { wert: "ruhig", label: "ruhig" },
        { wert: "unruhig", label: "unruhig" },
        { wert: "wach", label: "wach" },
      ],
    },
    { typ: "ja_nein", schluessel: "vorfall", beschriftung: "Vorfall in der Nacht?", pflicht: true },
    {
      typ: "langtext",
      schluessel: "vorfall_text",
      beschriftung: "Was ist passiert?",
      sichtbarWenn: { feld: "vorfall", op: "ist", wert: true },
      pflicht: true,
    },
  ],
};

describe("Formulare: Entwicklung, Standorte, Anheften", () => {
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
  let standortB: string;
  const standorte: Record<"lindenweg" | "park" | "sued", string> = { lindenweg: "", park: "", sued: "" };
  let klientLinden: string;
  let klientSued: string;
  let klientOhne: string;

  async function mandant(name: string) {
    const slug = `test-formulare-${name}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
      `Testmandant Formulare ${name} ${suffix}`,
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
    leitungA = await konto(a, "einrichtungsleitung", "f-leitung-a");
    betreuerA = await konto(a, "betreuer", "f-betreuer-a");
    leitungB = await konto(b, "bereichsleitung", "f-leitung-b");

    standorte.lindenweg = await standort(a.id, "Haus Lindenweg");
    standorte.park = await standort(a.id, "Haus am Park");
    standorte.sued = await standort(a.id, "WG Südstadt");
    standortB = await standort(b.id, "Fremder Standort");
    klientLinden = await klient(a.id, "Lindenweg", standorte.lindenweg);
    klientSued = await klient(a.id, "Suedstadt", standorte.sued);
    klientOhne = await klient(a.id, "OhneBelegung", null);
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

  const angebotIds = async (klientId: string, anheftpunkt?: string) => {
    const res = await als(betreuerA).get(`/formulare/angebot?klientId=${klientId}${anheftpunkt ? `&anheftpunkt=${anheftpunkt}` : ""}`);
    expect(res.status).toBe(200);
    return res.body.map((f: { id: string }) => f.id) as string[];
  };

  let formularId: string;

  describe("In Entwicklung und Veroeffentlicht", () => {
    it("ein neues Formular ist in Entwicklung und wird nirgends ausgefuellt", async () => {
      const neu = await als(leitungA).post("/formulare", { name: "Nachtkontrolle" });
      expect(neu.status).toBe(201);
      expect(neu.body).toMatchObject({ status: "in_entwicklung", veroeffentlichteVersion: null, entwurfVersion: 1 });
      formularId = neu.body.id;
      expect((await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: KONTROLLE })).status).toBe(200);

      expect(await angebotIds(klientLinden)).not.toContain(formularId);
      // GEGENPROBE zur Oberflaeche: auch direkt geschickt nimmt der Server es nicht an.
      expect((await als(betreuerA).post("/protokolle", { formularId, klientId: klientLinden })).status).toBe(404);
    });

    it("ohne Recht keine Verwaltung; ein unfertiges Formular laesst sich nicht veroeffentlichen", async () => {
      expect((await als(betreuerA).get("/formulare")).status).toBe(403);
      expect((await als(betreuerA).post(`/formulare/${formularId}/veroeffentlichen`)).status).toBe(403);

      const leer = await als(leitungA).post("/formulare", { name: "Leer" });
      const res = await als(leitungA).post(`/formulare/${leer.body.id}/veroeffentlichen`);
      expect(res.status).toBe(400);
      expect(res.body.pruefung.join(" ")).toMatch(/kein Feld/);

      const ohneBeschriftung = { bausteine: [{ typ: "kurztext", schluessel: "a", beschriftung: "" }] };
      await als(leitungA).put(`/formulare/${leer.body.id}/entwurf`, { definition: ohneBeschriftung });
      expect((await als(leitungA).post(`/formulare/${leer.body.id}/veroeffentlichen`)).body.pruefung.join(" ")).toMatch(/keine Beschriftung/);
      expect((await als(leitungA).put(`/formulare/${leer.body.id}/entwurf`, { definition: { bausteine: [{ typ: "gibtsnicht" }] } })).status).toBe(400);
    });

    it("nach dem Veroeffentlichen wird es angeboten", async () => {
      const res = await als(leitungA).post(`/formulare/${formularId}/veroeffentlichen`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "veroeffentlicht", veroeffentlichteVersion: 1, entwurfVersion: null });
      expect(await angebotIds(klientLinden)).toContain(formularId);
    });

    it("Bearbeiten legt Version 2 in Entwicklung an; bis zur Veroeffentlichung gilt Version 1", async () => {
      const start = await als(leitungA).post(`/formulare/${formularId}/entwurf`);
      expect(start.body).toMatchObject({ status: "veroeffentlicht", veroeffentlichteVersion: 1, entwurfVersion: 2 });
      // Zweimal "Bearbeiten" erzeugt keinen zweiten Entwurf.
      expect((await als(leitungA).post(`/formulare/${formularId}/entwurf`)).body.entwurfVersion).toBe(2);

      const mitNeuemFeld = { bausteine: [...KONTROLLE.bausteine, { typ: "zahl", schluessel: "kontrollgaenge", beschriftung: "Kontrollgänge" }] };
      await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: mitNeuemFeld });
      const angebot = await als(betreuerA).get(`/formulare/angebot?klientId=${klientLinden}`);
      const f = angebot.body.find((x: { id: string }) => x.id === formularId);
      expect(f.versionNummer).toBe(1);
      expect(JSON.stringify(f.definition)).not.toContain("kontrollgaenge");
    });

    it("Veroeffentlichen lehnt einen geaenderten Typ und eine geloeschte benutzte Option ab", async () => {
      const typGeaendert = {
        bausteine: KONTROLLE.bausteine.map((b) => (b.schluessel === "vorfall" ? { typ: "kurztext", schluessel: "vorfall", beschriftung: "Vorfall" } : b)),
      };
      await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: typGeaendert });
      const r1 = await als(leitungA).post(`/formulare/${formularId}/veroeffentlichen`);
      expect(r1.status).toBe(400);
      expect(r1.body.pruefung.join(" ")).toMatch(/Typ/);

      const optionWeg = {
        bausteine: KONTROLLE.bausteine.map((b) =>
          b.typ === "auswahl" ? { ...b, optionen: b.optionen.filter((o) => o.wert !== "wach") } : b
        ),
      };
      await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: optionWeg });
      const r2 = await als(leitungA).post(`/formulare/${formularId}/veroeffentlichen`);
      expect(r2.status).toBe(400);
      expect(r2.body.pruefung.join(" ")).toMatch(/ausblenden statt löschen/);

      const ausgeblendet = {
        bausteine: KONTROLLE.bausteine.map((b) =>
          b.typ === "auswahl" ? { ...b, optionen: b.optionen.map((o) => (o.wert === "wach" ? { ...o, ausgeblendet: true } : o)) } : b
        ),
      };
      await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: ausgeblendet });
      const r3 = await als(leitungA).post(`/formulare/${formularId}/veroeffentlichen`);
      expect(r3.status).toBe(201);
      expect(r3.body.veroeffentlichteVersion).toBe(2);
      expect(r3.body.versionen.map((v: { nummer: number }) => v.nummer)).toEqual([2, 1]);
    });

    it("ein veroeffentlichtes Formular ist nicht loeschbar, ein nie veroeffentlichtes schon", async () => {
      expect((await als(leitungA).del(`/formulare/${formularId}`)).status).toBe(400);
      const weg = await als(leitungA).post("/formulare", { name: "Gleich weg" });
      expect((await als(leitungA).del(`/formulare/${weg.body.id}`)).status).toBe(200);
      expect((await als(leitungA).get(`/formulare/${weg.body.id}`)).status).toBe(404);
    });

    it("Datenbank: auch die App-Rolle kann ein veroeffentlichtes Formular nicht loeschen", async () => {
      await expect(alsApp(mandantA, (c) => c.query("DELETE FROM formular_version WHERE formular_id = $1", [formularId]))).rejects.toThrow(
        /veröffentlichte Formularversion/
      );
      await expect(alsApp(mandantA, (c) => c.query("DELETE FROM formular WHERE id = $1", [formularId]))).rejects.toThrow(/foreign key/);
    });
  });

  describe("Standorte", () => {
    it("nur ausgewaehlte Standorte: Lindenweg ja, Suedstadt und ohne Belegung nein", async () => {
      const res = await als(leitungA).put(`/formulare/${formularId}/einstellungen`, {
        name: "Nachtkontrolle",
        beschreibung: null,
        standortIds: [standorte.lindenweg, standorte.park],
        anheftungen: [],
      });
      expect(res.status).toBe(200);
      expect([...res.body.standortIds].sort()).toEqual([standorte.lindenweg, standorte.park].sort());

      expect(await angebotIds(klientLinden)).toContain(formularId);
      expect(await angebotIds(klientSued)).not.toContain(formularId);
      expect(await angebotIds(klientOhne)).not.toContain(formularId);
    });

    it("GEGENPROBE: ein Protokoll fuer einen nicht zugelassenen Standort lehnt der Server ab", async () => {
      expect((await als(betreuerA).post("/protokolle", { formularId, klientId: klientSued })).status).toBe(404);
      const ok = await als(betreuerA).post("/protokolle", { formularId, klientId: klientLinden });
      expect(ok.status).toBe(201);
      await als(betreuerA).del(`/protokolle/${ok.body.id}`);
    });

    it("ohne Auswahl gilt das Formular fuer alle Standorte", async () => {
      await als(leitungA).put(`/formulare/${formularId}/einstellungen`, { name: "Nachtkontrolle", standortIds: [], anheftungen: [] });
      expect(await angebotIds(klientSued)).toContain(formularId);
      expect(await angebotIds(klientOhne)).toContain(formularId);
    });

    it("ein Standort eines anderen Traegers wird abgelehnt -- auch von der Datenbank", async () => {
      const res = await als(leitungA).put(`/formulare/${formularId}/einstellungen`, {
        name: "Nachtkontrolle",
        standortIds: [standortB],
        anheftungen: [],
      });
      expect(res.status).toBe(400);
      await expect(
        alsApp(mandantA, (c) =>
          c.query("INSERT INTO formular_standort (mandant_id, formular_id, standort_id) VALUES ($1, $2, $3)", [mandantA, formularId, standortB])
        )
      ).rejects.toThrow(/foreign key/);
    });
  });

  describe("Anheften an den Tagesbericht", () => {
    const tagesberichteVon = async (klientId: string) => (await als(betreuerA).get(`/tagesberichte?klientId=${klientId}`)).body as { id: string }[];

    it("Pflicht gibt es nur bei automatisch dabei", async () => {
      const res = await als(leitungA).put(`/formulare/${formularId}/einstellungen`, {
        name: "Nachtkontrolle",
        standortIds: [],
        anheftungen: [{ anheftpunkt: "tagesbericht", modus: "dazunehmen", pflicht: true }],
      });
      expect(res.status).toBe(400);
      expect(
        (
          await als(leitungA).put(`/formulare/${formularId}/einstellungen`, {
            name: "Nachtkontrolle",
            standortIds: [],
            anheftungen: [{ anheftpunkt: "gibtsnicht", modus: "automatisch", pflicht: false }],
          })
        ).status
      ).toBe(400);
    });

    it("angeheftet, automatisch und Pflicht -- nur fuer Lindenweg", async () => {
      const res = await als(leitungA).put(`/formulare/${formularId}/einstellungen`, {
        name: "Nachtkontrolle",
        standortIds: [standorte.lindenweg],
        anheftungen: [{ anheftpunkt: "tagesbericht", modus: "automatisch", pflicht: true }],
      });
      expect(res.status).toBe(200);
      expect(res.body.anheftungen).toEqual([{ anheftpunkt: "tagesbericht", modus: "automatisch", pflicht: true }]);

      const angebot = await als(betreuerA).get(`/formulare/angebot?klientId=${klientLinden}&anheftpunkt=tagesbericht`);
      const f = angebot.body.find((x: { id: string }) => x.id === formularId);
      expect(f).toMatchObject({ modus: "automatisch", pflicht: true });
      // Vorbelegung fuer das Fenster des Tagesberichts, ohne einen Entwurf anzulegen.
      expect(f.anzeige.klient_name).toBe("Mira Lindenweg");
      expect(f.werte.wohnung).toMatch(/^Haus Lindenweg, Zimmer/);
      expect(await angebotIds(klientSued, "tagesbericht")).not.toContain(formularId);
    });

    it("GEGENPROBE: ohne das Pflicht-Formular entsteht kein Tagesbericht", async () => {
      const vorher = (await tagesberichteVon(klientLinden)).length;
      const res = await als(betreuerA).post("/tagesberichte", { klientId: klientLinden, datum: "2026-11-01", text: "Ruhige Nacht." });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Nachtkontrolle/);
      expect((await tagesberichteVon(klientLinden)).length).toBe(vorher);
    });

    it("ein unvollstaendiges Formular verhindert auch den Tagesbericht (gemeinsame Transaktion)", async () => {
      const vorher = (await tagesberichteVon(klientLinden)).length;
      const res = await als(betreuerA).post("/tagesberichte", {
        klientId: klientLinden,
        datum: "2026-11-01",
        text: "Unruhige Nacht.",
        protokolle: [{ formularId, werte: { schlaf: "unruhig", vorfall: true } }],
      });
      expect(res.status).toBe(400);
      expect(res.body.formularId).toBe(formularId);
      expect(res.body.fehler).toEqual([{ schluessel: "vorfall_text", meldung: "Bitte ausfüllen." }]);
      expect((await tagesberichteVon(klientLinden)).length).toBe(vorher);
      const { rows } = await admin.query("SELECT count(*)::int AS n FROM protokoll p JOIN formular_version v ON v.id = p.formular_version_id WHERE v.formular_id = $1 AND p.tagesbericht_id IS NOT NULL", [formularId]);
      expect(rows[0].n).toBe(0);
    });

    it("vollstaendig: Tagesbericht und abgeschlossenes Protokoll entstehen zusammen", async () => {
      const res = await als(betreuerA).post("/tagesberichte", {
        klientId: klientLinden,
        datum: "2026-11-01",
        text: "Unruhige Nacht.",
        // Ein manipulierter "festgehaltener" Wert wird ignoriert; der Server liest ihn aus der Belegung.
        protokolle: [{ formularId, werte: { schlaf: "unruhig", vorfall: true, vorfall_text: "Kurz laut.", wohnung: "Erfunden" } }],
      });
      expect(res.status).toBe(201);
      expect(res.body.protokolle).toEqual([{ id: expect.any(String), formularName: "Nachtkontrolle" }]);

      const p = await als(betreuerA).get(`/protokolle/${res.body.protokolle[0].id}`);
      expect(p.body).toMatchObject({ abgeschlossen: true, tagesberichtId: res.body.id, bezugsdatum: "2026-11-01", versionNummer: 2 });
      expect(p.body.werte.wohnung).toMatch(/^Haus Lindenweg, Zimmer/);
      expect(p.body.quellen.wohnung).toBe("festgehalten");
    });

    it("an einem anderen Standort gehoert das Formular nicht dazu -- auch nicht per Request", async () => {
      expect((await als(betreuerA).post("/tagesberichte", { klientId: klientSued, datum: "2026-11-01", text: "Ok." })).status).toBe(201);
      const res = await als(betreuerA).post("/tagesberichte", {
        klientId: klientSued,
        datum: "2026-11-01",
        text: "Ok.",
        protokolle: [{ formularId, werte: { schlaf: "ruhig", vorfall: false } }],
      });
      expect(res.status).toBe(404);
    });

    it("zum Dazunehmen: ohne geht es, mit wird es mitgespeichert", async () => {
      await als(leitungA).put(`/formulare/${formularId}/einstellungen`, {
        name: "Nachtkontrolle",
        standortIds: [],
        anheftungen: [{ anheftpunkt: "tagesbericht", modus: "dazunehmen", pflicht: false }],
      });
      expect((await als(betreuerA).post("/tagesberichte", { klientId: klientSued, datum: "2026-11-02", text: "Ok." })).status).toBe(201);
      const mit = await als(betreuerA).post("/tagesberichte", {
        klientId: klientSued,
        datum: "2026-11-02",
        text: "Ok.",
        protokolle: [{ formularId, werte: { schlaf: "ruhig", vorfall: false } }],
      });
      expect(mit.status).toBe(201);
      expect(mit.body.protokolle).toHaveLength(1);
    });

    it("ein stillgelegtes Formular wird nicht mehr dazugezogen", async () => {
      await als(leitungA).post(`/formulare/${formularId}/archivieren`, { archiviert: true });
      expect(await angebotIds(klientSued, "tagesbericht")).not.toContain(formularId);
      await als(leitungA).post(`/formulare/${formularId}/archivieren`, { archiviert: false });
    });

    it("Datenbank: ein Protokoll kann nur am Tagesbericht DERSELBEN Klient:in haengen", async () => {
      const bericht = (await tagesberichteVon(klientSued))[0];
      const { rows } = await admin.query<{ id: string }>(
        "SELECT p.id FROM protokoll p WHERE p.klient_id = $1 AND p.tagesbericht_id IS NOT NULL LIMIT 1",
        [klientLinden]
      );
      const version = await admin.query<{ id: string }>("SELECT id FROM formular_version WHERE formular_id = $1 AND nummer = 2", [formularId]);
      const benutzer = await admin.query<{ id: string }>("SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1", [mandantA]);
      expect(rows.length).toBe(1);
      await expect(
        alsApp(mandantA, (c) =>
          c.query(
            `INSERT INTO protokoll (mandant_id, formular_version_id, klient_id, autor_id, bezugsdatum, tagesbericht_id)
             VALUES ($1, $2, $3, $4, '2026-11-01', $5)`,
            [mandantA, version.rows[0].id, klientLinden, benutzer.rows[0].id, bericht.id]
          )
        )
      ).rejects.toThrow(/foreign key/);
    });
  });

  it("Mandantentrennung: ein anderer Traeger sieht Formular, Standorte und Anheftungen nicht", async () => {
    expect((await als(leitungB).get("/formulare")).body).toEqual([]);
    expect((await als(leitungB).get(`/formulare/${formularId}`)).status).toBe(404);
    expect((await als(leitungB).put(`/formulare/${formularId}/einstellungen`, { name: "x", standortIds: [], anheftungen: [] })).status).toBe(404);
    expect((await als(leitungB).post(`/formulare/${formularId}/veroeffentlichen`)).status).toBe(404);
    const zeilen = await alsApp(mandantB, async (c) => {
      const s = await c.query("SELECT count(*)::int AS n FROM formular_standort");
      const a = await c.query("SELECT count(*)::int AS n FROM formular_anheftung");
      return s.rows[0].n + a.rows[0].n;
    });
    expect(zeilen).toBe(0);
    // Gegenprobe: im eigenen Traeger gibt es die Zeilen.
    expect(await alsApp(mandantA, async (c) => (await c.query("SELECT count(*)::int AS n FROM formular_anheftung")).rows[0].n)).toBeGreaterThan(0);
  });
});
