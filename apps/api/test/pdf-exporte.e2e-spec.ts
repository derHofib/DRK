/**
 * PDF-Exporte je Formular (Migration 0082, Konzept „formular-pdf", Fassung 2).
 *
 * Geprueft wird, was nicht nur die Oberflaeche zusichern darf:
 *  - jedes Formular bekommt automatisch den Export „Akte" (Trigger, auch fuer
 *    Formulare, die nicht ueber die API entstehen)
 *  - Speichern legt eine neue Version an; alte Versionen sind in der
 *    Datenbank unveraenderlich (REVOKE), ebenso das Protokoll der Erzeugungen
 *  - ein externer Export laesst Felder „nur intern" weg (mit Gegenprobe)
 *  - externe PDFs nur mit dem Recht protokolles.pdf-extern
 *  - ein Logo in Benutzung ist nicht loeschbar; fremde Traeger sehen nichts
 *  - die Ueberschriftenfarbe bleibt bei jeder Traegerfarbe druckbar lesbar
 */
import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import sharp from "sharp";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import {
  druckUeberschriftFarbe,
  kontrastAufWeiss,
  pdfGestaltungVorgabe,
  type FormularDefinition,
} from "@zimmerakte/shared";
import { AppModule } from "../src/app.module";
import { pdfBloecke } from "../src/pdf-export/pdf-export-render";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf, type AlteRolle } from "./support/konto-mit-rolle";
import { leereGlyphen, pdfSchriften } from "./support/pdf-schriften";

const DEFINITION: FormularDefinition = {
  bausteine: [
    { typ: "kurztext", schluessel: "anlass", beschriftung: "Anlass", pflicht: true },
    { typ: "ja_nein", schluessel: "teilgenommen", beschriftung: "Teilgenommen?" },
    { typ: "langtext", schluessel: "einschaetzung", beschriftung: "Interne Einschätzung", intern: true },
  ],
};

describe("PDF-Exporte je Formular", () => {
  let app: INestApplication;
  let admin: Client;
  let appRolle: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const mandanten: string[] = [];

  let mandantA: string;
  let leitungA: string;
  let betreuerA: string;
  let traegerA: string;
  let leitungB: string;
  let klientA: string;
  let formularId: string;
  let protokollId: string;

  async function mandant(name: string) {
    const slug = `test-pdfexport-${name}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
      `Testmandant PDF ${name} ${suffix}`,
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

  const http = () => request(app.getHttpServer());
  const als = (token: string) => ({
    get: (url: string) => http().get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => http().post(url).set("Authorization", `Bearer ${token}`).send(body),
    put: (url: string, body: object) => http().put(url).set("Authorization", `Bearer ${token}`).send(body),
    del: (url: string) => http().delete(url).set("Authorization", `Bearer ${token}`),
    pdf: (url: string, body: object) =>
      http()
        .post(url)
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .buffer(true)
        .parse((res, cb) => {
          const teile: Buffer[] = [];
          res.on("data", (t: Buffer) => teile.push(t));
          res.on("end", () => cb(null, Buffer.concat(teile)));
        }),
  });

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
    leitungA = await konto(a, "einrichtungsleitung", "p-leitung-a");
    betreuerA = await konto(a, "betreuer", "p-betreuer-a");
    traegerA = await konto(a, "bereichsleitung", "p-traeger-a");
    leitungB = await konto(b, "bereichsleitung", "p-leitung-b");

    const s = await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Lindenweg', 'Lindenweg 3, 14199 Berlin') RETURNING id", [a.id]);
    const k = await admin.query<{ id: string }>(
      "INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, 'Mira', 'Beispiel', '2004-05-06', 'AZ-1', 'Jugendamt') RETURNING id",
      [a.id]
    );
    klientA = k.rows[0].id;
    const z = await admin.query<{ id: string }>("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, 'Z-1') RETURNING id", [a.id, s.rows[0].id]);
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [a.id, z.rows[0].id, klientA]);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE formular_version DISABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll DISABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert DISABLE TRIGGER protokoll_wert_protokoll");
      for (const m of mandanten) {
        for (const t of [
          "pdf_export_erzeugt",
          "pdf_export_version",
          "pdf_export",
          "traeger_datei",
          "traeger_angaben",
          "protokoll_aenderung",
          "protokoll_wert",
          "protokoll",
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

  async function alsApp<T>(mandantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
    await appRolle.query("BEGIN");
    try {
      await appRolle.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      return await fn(appRolle);
    } finally {
      await appRolle.query("ROLLBACK");
    }
  }

  let briefId: string;
  let logoId: string;

  it("jedes neue Formular hat sofort den Export „Akte“ als Standard", async () => {
    const neu = await als(leitungA).post("/formulare", { name: "Hilfeplangespräch" });
    expect(neu.status).toBe(201);
    formularId = neu.body.id;
    const liste = await als(leitungA).get(`/formulare/${formularId}/pdf-exporte`);
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(1);
    expect(liste.body[0]).toMatchObject({ name: "Akte", zielgruppe: "intern", istStandard: true, versionNummer: 1 });
    expect(liste.body[0].gestaltung.vorlage).toBe("akte");
  });

  it("gestalten darf nur, wer Formulare verwaltet; fremde Traeger sehen nichts", async () => {
    expect((await als(betreuerA).get(`/formulare/${formularId}/pdf-exporte`)).status).toBe(403);
    expect((await als(leitungB).get(`/formulare/${formularId}/pdf-exporte`)).status).toBe(404);
    const exportId = (await als(leitungA).get(`/formulare/${formularId}/pdf-exporte`)).body[0].id;
    expect((await als(leitungB).get(`/pdf-exporte/${exportId}`)).status).toBe(404);
  });

  it("Logo hochladen (PNG); fremde Traeger sehen es nicht", async () => {
    const png = await sharp({ create: { width: 400, height: 120, channels: 3, background: "#c00000" } }).png().toBuffer();
    // Mitarbeitende duerfen die Traegerangaben nicht aendern.
    const verboten = await http().post("/traeger-dateien/logo").set("Authorization", `Bearer ${betreuerA}`).set("Content-Type", "image/png").send(png);
    expect(verboten.status).toBe(403);
    const res = await http()
      .post("/traeger-dateien/logo")
      .set("Authorization", `Bearer ${traegerA}`)
      .set("Content-Type", "image/png")
      .set("X-Dateiname", encodeURIComponent("Logo Träger.png"))
      .send(png);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Logo Träger.png", mime: "image/png", benutzt: 0 });
    logoId = res.body.id;
    expect((await als(leitungB).get(`/traeger-dateien/${logoId}`)).status).toBe(404);

    const kaputt = await http().post("/traeger-dateien/logo").set("Authorization", `Bearer ${traegerA}`).set("Content-Type", "text/plain").send("kein Bild");
    expect(kaputt.status).toBe(400);
  });

  it("Traegerangaben speichern und als Platzhalter verfuegbar", async () => {
    const res = await als(traegerA).put("/dokument-angaben", { name: "DRK Kreisverband Beispiel e. V.", telefon: "030 123", iban: "DE00 1234" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "DRK Kreisverband Beispiel e. V.", telefon: "030 123", email: null });
    expect((await als(leitungA).put("/dokument-angaben", { name: "x" })).status).toBe(403);
    expect((await als(leitungB).get("/dokument-angaben")).body.name).toBeNull();
  });

  it("neuer Brief-Export: Speichern legt Versionen an, alte bleiben unveraenderlich", async () => {
    const neu = await als(leitungA).post(`/formulare/${formularId}/pdf-exporte`, { name: "Bericht ans Amt", vorlage: "brief" });
    expect(neu.status).toBe(201);
    briefId = neu.body.id;
    expect(neu.body).toMatchObject({ istStandard: false, versionNummer: 1 });

    const gestaltung = { ...neu.body.gestaltung, titel: "Bericht {formular.name}", farbe: "#e60005" };
    const gespeichert = await als(leitungA).put(`/pdf-exporte/${briefId}`, { name: "Bericht ans Amt", zielgruppe: "extern", logoId, gestaltung });
    expect(gespeichert.status).toBe(200);
    expect(gespeichert.body).toMatchObject({ versionNummer: 2, zielgruppe: "extern", logoId });

    // Grenzwerte gehoeren dem Server, nicht nur dem Formular im Browser.
    const zuKlein = await als(leitungA).put(`/pdf-exporte/${briefId}`, { name: "x", zielgruppe: "extern", logoId, gestaltung: { ...gestaltung, groesseText: 5 } });
    expect(zuKlein.status).toBe(400);

    await alsApp(mandantA, async (c) => {
      await expect(c.query("UPDATE pdf_export_version SET name = 'manipuliert' WHERE pdf_export_id = $1", [briefId])).rejects.toThrow(/permission denied/);
    });
    await alsApp(mandantA, async (c) => {
      await expect(c.query("DELETE FROM pdf_export_version WHERE pdf_export_id = $1", [briefId])).rejects.toThrow(/permission denied/);
    });
    const { rows } = await admin.query("SELECT nummer, gestaltung->>'farbe' AS farbe FROM pdf_export_version WHERE pdf_export_id = $1 ORDER BY nummer", [briefId]);
    expect(rows).toEqual([
      { nummer: 1, farbe: null },
      { nummer: 2, farbe: "#e60005" },
    ]);
  });

  it("Logo in Benutzung ist nicht loeschbar", async () => {
    const res = await als(traegerA).del(`/traeger-dateien/${logoId}`);
    expect(res.status).toBe(400);
    const liste = await als(traegerA).get("/traeger-dateien");
    expect(liste.body.find((d: { id: string }) => d.id === logoId).benutzt).toBeGreaterThan(0);
  });

  it("Kopie eines Exports ist danach unabhaengig", async () => {
    const kopie = await als(leitungA).post(`/formulare/${formularId}/pdf-exporte`, { name: "Kopie", kopieVon: briefId });
    expect(kopie.status).toBe(201);
    expect(kopie.body).toMatchObject({ kopiertAus: "Hilfeplangespräch › Bericht ans Amt", versionNummer: 1, zielgruppe: "extern" });
    expect(kopie.body.gestaltung.farbe).toBe("#e60005");
    await als(leitungA).put(`/pdf-exporte/${kopie.body.id}`, { name: "Kopie", zielgruppe: "intern", logoId: null, gestaltung: { ...kopie.body.gestaltung, farbe: null } });
    expect((await als(leitungA).get(`/pdf-exporte/${briefId}`)).body.gestaltung.farbe).toBe("#e60005");
    // Stilllegen statt loeschen; der Standard laesst sich nicht stilllegen.
    expect((await als(leitungA).post(`/pdf-exporte/${kopie.body.id}/stilllegen`, { stillgelegt: true })).body.stillgelegt).toBe(true);
    const standardId = (await als(leitungA).get(`/formulare/${formularId}/pdf-exporte`)).body.find((e: { istStandard: boolean }) => e.istStandard).id;
    expect((await als(leitungA).post(`/pdf-exporte/${standardId}/stilllegen`, { stillgelegt: true })).status).toBe(400);
  });

  it("Vorschau mit Beispieldaten liefert ein PDF in der gewaehlten Schrift", async () => {
    const e = (await als(leitungA).get(`/pdf-exporte/${briefId}`)).body;
    const res = await als(leitungA).pdf(`/formulare/${formularId}/pdf-exporte/vorschau`, { name: e.name, zielgruppe: e.zielgruppe, logoId, gestaltung: e.gestaltung });
    expect(res.status).toBe(201);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const bytes = res.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await pdfSchriften(bytes)).toEqual(expect.arrayContaining(["LiberationSans", "LiberationSans-Bold"]));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("jede waehlbare Schrift wird mit allen Umrissen eingebettet", async () => {
    // GEGENPROBE (durchgefuehrt): dieselbe Messung an einem PDF mit Carlito
    // als Teilmenge zaehlte 16 von 30 Glyphen ohne Umriss -- deshalb fehlt
    // Carlito in der Auswahl.
    const e = (await als(leitungA).get(`/pdf-exporte/${briefId}`)).body;
    for (const schrift of ["nunito", "liberation-sans", "liberation-serif"]) {
      const res = await als(leitungA).pdf(`/formulare/${formularId}/pdf-exporte/vorschau`, {
        name: e.name,
        zielgruppe: e.zielgruppe,
        logoId: null,
        gestaltung: { ...e.gestaltung, schrift },
      });
      expect(res.status).toBe(201);
      const leer = await leereGlyphen(res.body as Buffer);
      expect(Object.keys(leer).length).toBeGreaterThanOrEqual(2);
      // Hoechstens das Leerzeichen hat keinen Umriss.
      for (const [name, n] of Object.entries(leer)) expect([name, n <= 1]).toEqual([name, true]);
    }
  });

  it("aus einem abgeschlossenen Protokoll entsteht das PDF; jede Erzeugung wird protokolliert", async () => {
    expect((await als(leitungA).put(`/formulare/${formularId}/entwurf`, { definition: DEFINITION })).status).toBe(200);
    expect((await als(leitungA).post(`/formulare/${formularId}/veroeffentlichen`)).status).toBe(201);
    const p = await als(betreuerA).post("/protokolle", { formularId, klientId: klientA });
    expect(p.status).toBe(201);
    protokollId = p.body.id;

    const akteId = (await als(betreuerA).get(`/protokolle/${protokollId}/pdf-exporte`)).body.find((x: { istStandard: boolean }) => x.istStandard).id;
    // Erst nach dem Abschluss.
    expect((await als(betreuerA).pdf(`/protokolle/${protokollId}/pdf`, { exportId: akteId })).status).toBe(400);

    const ab = await als(betreuerA).post(`/protokolle/${protokollId}/abschliessen`, {
      werte: { anlass: "Hilfeplangespräch im Mai", teilgenommen: true, einschaetzung: "nur für das Team" },
    });
    expect(ab.status).toBe(201);

    const angebot = (await als(betreuerA).get(`/protokolle/${protokollId}/pdf-exporte`)).body;
    // Die stillgelegte Kopie wird nicht angeboten; der Brief mit Amt als Vorschlag.
    expect(angebot.map((x: { name: string }) => x.name).sort()).toEqual(["Akte", "Bericht ans Amt"]);
    expect(angebot.find((x: { id: string }) => x.id === briefId)).toMatchObject({ mitAnschriftfeld: true });

    const res = await als(betreuerA).pdf(`/protokolle/${protokollId}/pdf`, { exportId: briefId, empfaenger: "Jugendamt Beispiel\nAm Markt 1\n12345 Beispielstadt" });
    expect(res.status).toBe(201);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename=/);
    const bytes = res.body as Buffer;
    const { rows } = await admin.query("SELECT sha256, empfaenger FROM pdf_export_erzeugt WHERE protokoll_id = $1", [protokollId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(rows[0].empfaenger).toContain("Jugendamt Beispiel");
    expect((await als(leitungA).get(`/pdf-exporte/${briefId}`)).body.anzahlErzeugt).toBe(1);

    await alsApp(mandantA, async (c) => {
      await expect(c.query("UPDATE pdf_export_erzeugt SET empfaenger = 'x' WHERE protokoll_id = $1", [protokollId])).rejects.toThrow(/permission denied/);
    });
    // Fremder Traeger: das Protokoll gibt es fuer ihn nicht.
    expect((await als(leitungB).pdf(`/protokolle/${protokollId}/pdf`, { exportId: briefId })).status).toBe(404);
  });

  it("externe PDFs nur mit dem Recht „PDF für Externe“", async () => {
    await admin.query("UPDATE account_typ_recht SET erlaubt = false WHERE mandant_id = $1 AND modul = 'protokolle' AND aktion = 'pdf-extern'", [mandantA]);
    try {
      const angebot = (await als(betreuerA).get(`/protokolle/${protokollId}/pdf-exporte`)).body;
      expect(angebot.map((x: { zielgruppe: string }) => x.zielgruppe)).toEqual(["intern"]);
      expect((await als(betreuerA).pdf(`/protokolle/${protokollId}/pdf`, { exportId: briefId })).status).toBe(403);
    } finally {
      await admin.query("UPDATE account_typ_recht SET erlaubt = true WHERE mandant_id = $1 AND modul = 'protokolle' AND aktion = 'pdf-extern'", [mandantA]);
    }
  });

  it("ein externer Export laesst Felder „nur intern“ weg", () => {
    // GEGENPROBE (durchgefuehrt): die Zeile `if (zielgruppe === "extern" && ... b.intern) continue;`
    // in pdf-export-render.ts auskommentiert -> dieser Test wird rot.
    const eingabe = {
      gestaltung: pdfGestaltungVorgabe("brief"),
      formular: { name: "Hilfeplangespräch", version: 1, definition: DEFINITION },
      werte: { anlass: "Mai", teilgenommen: true, einschaetzung: "nur für das Team" },
      anzeige: {},
      personen: {},
    };
    const extern = JSON.stringify(pdfBloecke({ ...eingabe, zielgruppe: "extern" }));
    const intern = JSON.stringify(pdfBloecke({ ...eingabe, zielgruppe: "intern" }));
    expect(intern).toContain("nur für das Team");
    expect(extern).not.toContain("nur für das Team");
    expect(extern).not.toContain("Interne Einschätzung");
    expect(extern).toContain("Mai");
  });

  it("Ueberschriftenfarbe ist bei jeder Traegerfarbe auf Papier lesbar (>= 4,5:1)", () => {
    const farben = ["#e60005", "#ffff00", "#00ff00", "#00ffff", "#ffffff", "#000000", "#2e7d32", "#7b1fa2", "#ff9800", "#1565c0"];
    const werte = farben.map((f) => kontrastAufWeiss(druckUeberschriftFarbe(f)));
    // Messwert statt Augenschein: die schwaechste Farbe in der Liste.
    expect(Math.min(...werte)).toBeGreaterThanOrEqual(4.5);
  });
});
