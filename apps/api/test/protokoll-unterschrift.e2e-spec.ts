/**
 * Unterschriften in Formularen (Rückmeldung d8e84954, Migration 0086).
 *
 * Geprüft wird, was nicht nur die Oberfläche zusichern darf:
 *  - unterschrieben wird erst nach dem Abschließen, jeder Platz genau einmal
 *  - Leitungsplätze unterschreibt nur die Leitung selbst (Organigramm), nicht
 *    die Mitarbeiter:in und nicht die Leitung eines anderen Standorts
 *  - Klient:in und eigene Rolle werden auf dem Gerät der Mitarbeiter:in erfasst
 *  - nur PNG, "nur Papier"-Plätze gar nicht
 *  - die Datenbank lässt kein Ändern/Löschen zu, prüft Platz und Rolle gegen die
 *    Definition und trennt Mandanten (RLS, zusammengesetzter Fremdschlüssel)
 *  - eine Korrektur nach der Unterschrift wird als "vor der Änderung" angezeigt
 *  - "Zu unterschreiben" nennt nur offene Plätze der eigenen Leitungsrolle
 *  - im PDF steht das Bild auf der Linie, leere Plätze bleiben Linie für Papier,
 *    und im freien Designer gesetzte Plätze fehlen im Fließbereich
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import sharp from "sharp";
import { PDFPage, type PDFFont } from "pdf-lib";
import { pdfFreiBaustein, pdfGestaltungVorgabe, pruefeDefinition, type FormularDefinition, type PdfGestaltung } from "@zimmerakte/shared";
import { AppModule } from "../src/app.module";
import { pdfExportRendernMitBericht, type PdfRenderEingabe } from "../src/pdf-export/pdf-export-render";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf, type AlteRolle } from "./support/konto-mit-rolle";

jest.setTimeout(30_000);

const DEFINITION: FormularDefinition = {
  bausteine: [
    { typ: "kurztext", schluessel: "anlass", beschriftung: "Anlass", pflicht: true },
    {
      typ: "unterschriften",
      schluessel: "unterschriften",
      beschriftung: "Unterschriften",
      spalten: 2,
      plaetze: [
        { id: "p1", rolle: "klient", beschriftung: "" },
        { id: "p2", rolle: "mitarbeiter", beschriftung: "" },
        { id: "p3", rolle: "einrichtungsleitung", beschriftung: "" },
        { id: "p4", rolle: "bereichsleitung", beschriftung: "" },
        { id: "p5", rolle: "eigene", beschriftung: "Gesetzliche Betreuung", neueZeile: true },
        { id: "p6", rolle: "klient", beschriftung: "Kenntnisnahme", nurPapier: true },
      ],
    },
  ],
};

describe("Unterschriften in Formularen", () => {
  let app: INestApplication;
  let admin: Client;
  let appRolle: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const mandanten: string[] = [];
  let mandantA: string;
  let mandantB: string;
  let standortLinde: string;
  let standortPark: string;
  let klient: string;
  let png: string;

  const tokens = { betreuer: "", el: "", elPark: "", bl: "", fremd: "" };
  const ids = { betreuer: "", el: "", bl: "" };

  async function mandant(name: string) {
    const slug = `test-unterschrift-${name}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Unterschrift ${name} ${suffix}`, slug]);
    mandanten.push(rows[0].id);
    return { id: rows[0].id, slug };
  }

  async function konto(m: { id: string; slug: string }, rolle: AlteRolle, kurz: string, name: string) {
    const email = `${kurz}-${suffix}@beispiel.test`;
    const id = await kontoMitAlterRolle(admin, { mandantId: m.id, rolle, email, name, passwortHash: await bcrypt.hash(passwort, 4) });
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: m.slug, email, passwort });
    return { id, token: res.body.accessToken as string };
  }

  /** Eine Leitungsstelle am Einrichtungsknoten des Standorts -- so, wie das Organigramm sie anlegt. */
  async function leitungAmStandort(mandantId: string, standortId: string, benutzerId: string, titel: string) {
    const unit = await admin.query<{ id: string }>("SELECT id FROM org_unit WHERE standort_id = $1", [standortId]);
    const typ = await admin.query<{ account_typ_id: string }>(
      "SELECT p.account_typ_id FROM org_position p JOIN org_position_besetzung b ON b.position_id = p.id WHERE b.benutzer_id = $1",
      [benutzerId]
    );
    const pos = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, unit.rows[0].id, typ.rows[0].account_typ_id, titel]
    );
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [mandantId, pos.rows[0].id, benutzerId]);
  }

  async function standort(mandantId: string, name: string) {
    const { rows } = await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Weg 1') RETURNING id", [mandantId, name]);
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
    standortLinde = await standort(a.id, "Haus Linde");
    standortPark = await standort(a.id, "Haus am Park");

    const betreuer = await konto(a, "betreuer", "u-betreuer", "Sarah Klein");
    const el = await konto(a, "betreuer", "u-el", "Petra Lorenz");
    const elPark = await konto(a, "betreuer", "u-el-park", "Paul Park");
    const bl = await konto(a, "bereichsleitung", "u-bl", "Jens Hartmann");
    const fremd = await konto(b, "bereichsleitung", "u-fremd", "Fremde Leitung");
    Object.assign(tokens, { betreuer: betreuer.token, el: el.token, elPark: elPark.token, bl: bl.token, fremd: fremd.token });
    Object.assign(ids, { betreuer: betreuer.id, el: el.id, bl: bl.id });
    await leitungAmStandort(a.id, standortLinde, el.id, "Einrichtungsleitung");
    await leitungAmStandort(a.id, standortPark, elPark.id, "Einrichtungsleitung");

    const k = await admin.query<{ id: string }>(
      "INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, 'Marco', 'Becker', '2001-02-03', $2, 'Jugendamt') RETURNING id",
      [a.id, `AZ-${suffix}`]
    );
    klient = k.rows[0].id;
    const z = await admin.query<{ id: string }>("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, 'U1') RETURNING id", [a.id, standortLinde]);
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [a.id, z.rows[0].id, klient]);

    const bild = await sharp({ create: { width: 60, height: 24, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
    png = `data:image/png;base64,${bild.toString("base64")}`;
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE formular_version DISABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll DISABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert DISABLE TRIGGER protokoll_wert_protokoll");
      for (const m of mandanten) {
        for (const t of ["protokoll_unterschrift", "protokoll_aenderung", "protokoll_wert", "pdf_export_erzeugt", "pdf_export_version", "pdf_export", "protokoll", "formular_standort", "formular_version", "formular", "belegung", "zimmer", "klient"]) {
          await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [m]);
        }
        await raeumeKontoMitRolleAuf(admin, m);
        await admin.query("DELETE FROM standort WHERE mandant_id = $1", [m]);
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

  let formularId: string;
  let protokollId: string;
  const platz = (p: string, extra: object = {}) => ({ baustein: "unterschriften", platz: p, bild: png, ort: "Berlin", ...extra });

  it("Definition: eigene Rolle braucht eine Beschriftung, Plätze sind eindeutig", () => {
    expect(pruefeDefinition(DEFINITION)).toEqual([]);
    const kaputt: FormularDefinition = {
      bausteine: [
        {
          typ: "unterschriften",
          schluessel: "u",
          beschriftung: "U",
          spalten: 2,
          plaetze: [
            { id: "p1", rolle: "eigene", beschriftung: " " },
            { id: "p1", rolle: "klient", beschriftung: "" },
          ],
        },
      ],
    };
    const f = pruefeDefinition(kaputt).join(" ");
    expect(f).toMatch(/eigene Rolle braucht eine Beschriftung/);
    expect(f).toMatch(/kommt doppelt vor/);
  });

  it("Formular veröffentlichen, Protokoll ausfüllen; vor dem Abschließen kein Unterschreiben", async () => {
    const f = await als(tokens.bl).post("/formulare", { name: "Hausordnung" });
    expect(f.status).toBe(201);
    formularId = f.body.id;
    expect((await als(tokens.bl).put(`/formulare/${formularId}/entwurf`, { definition: DEFINITION })).status).toBe(200);
    const v = await als(tokens.bl).post(`/formulare/${formularId}/veroeffentlichen`);
    expect([v.status, v.body.pruefung ?? []]).toEqual([201, []]);

    const p = await als(tokens.betreuer).post("/protokolle", { formularId, klientId: klient });
    expect(p.status).toBe(201);
    protokollId = p.body.id;
    expect(p.body.unterschriften.map((u: { platz: string }) => u.platz)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(p.body.unterschriften.every((u: { darfIch: boolean }) => !u.darfIch)).toBe(true);

    const zuFrueh = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p1"));
    expect(zuFrueh.status).toBe(400);
    expect(zuFrueh.body.message).toMatch(/nach dem Abschließen/);

    expect((await als(tokens.betreuer).post(`/protokolle/${protokollId}/abschliessen`, { werte: { anlass: "Einzug" } })).status).toBe(201);
  });

  it("Namen werden gelesen: Klient:in, Autor:in, Leitung aus dem Organigramm; darfIch je Person", async () => {
    const mitarbeiter = await als(tokens.betreuer).get(`/protokolle/${protokollId}`);
    const u = Object.fromEntries(mitarbeiter.body.unterschriften.map((x: { platz: string }) => [x.platz, x]));
    expect([u.p1.name, u.p2.name, u.p3.name, u.p4.name, u.p5.name]).toEqual(["Marco Becker", "Sarah Klein", "Petra Lorenz", "Jens Hartmann", null]);
    expect([u.p1.darfIch, u.p2.darfIch, u.p3.darfIch, u.p4.darfIch, u.p5.darfIch, u.p6.darfIch]).toEqual([true, true, false, false, true, false]);
    expect([u.p1.fuerAndere, u.p2.fuerAndere, u.p5.fuerAndere]).toEqual([true, false, true]);

    const leitung = await als(tokens.el).get(`/protokolle/${protokollId}`);
    expect(leitung.body.unterschriften.find((x: { platz: string }) => x.platz === "p3").darfIch).toBe(true);
    const fremdeLeitung = await als(tokens.elPark).get(`/protokolle/${protokollId}`);
    expect(fremdeLeitung.body.unterschriften.find((x: { platz: string }) => x.platz === "p3").darfIch).toBe(false);
  });

  it("Leitungsplätze nur von der Leitung selbst", async () => {
    // GEGENPROBE (durchgeführt): in unterschriftSpeichern die Organigramm-Prüfung
    // (istLeitungsRolle-Zweig) auskommentiert -> die ersten beiden Erwartungen
    // wurden 201 statt 403, der Test rot. Wiederhergestellt.
    const r1 = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p3"));
    expect(r1.status).toBe(403);
    expect(r1.body.message).toMatch(/nur die Einrichtungsleitung selbst/);
    expect((await als(tokens.elPark).post(`/protokolle/${protokollId}/unterschriften`, platz("p3"))).status).toBe(403);
    expect((await als(tokens.el).post(`/protokolle/${protokollId}/unterschriften`, platz("p4"))).status).toBe(403);
    // Fremder Mandant sieht das Protokoll gar nicht.
    expect((await als(tokens.fremd).post(`/protokolle/${protokollId}/unterschriften`, platz("p4"))).status).toBe(404);
  });

  it("Zu unterschreiben: nur offene Plätze der eigenen Leitungsrolle", async () => {
    const el = await als(tokens.el).get("/protokolle/zu-unterschreiben");
    expect(el.status).toBe(200);
    const eintrag = el.body.find((x: { protokollId: string }) => x.protokollId === protokollId);
    expect(eintrag.plaetze.map((p: { platz: string }) => p.platz)).toEqual(["p3"]);
    expect(eintrag.standortName).toBe("Haus Linde");
    const bl = await als(tokens.bl).get("/protokolle/zu-unterschreiben");
    expect(bl.body.find((x: { protokollId: string }) => x.protokollId === protokollId).plaetze.map((p: { platz: string }) => p.platz)).toEqual(["p4"]);
    const betreuer = await als(tokens.betreuer).get("/protokolle/zu-unterschreiben");
    expect(betreuer.body).toEqual([]);
    const park = await als(tokens.elPark).get("/protokolle/zu-unterschreiben");
    expect(park.body.some((x: { protokollId: string }) => x.protokollId === protokollId)).toBe(false);
  });

  it("Unterschreiben: Klient:in und eigene Rolle auf dem Gerät, Mitarbeiter:in und Leitung selbst", async () => {
    const k = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p1"));
    expect(k.status).toBe(201);
    const m = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p2"));
    expect(m.status).toBe(201);
    const e = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p5", { name: "Gerd Vormund" }));
    expect(e.status).toBe(201);
    const l = await als(tokens.el).post(`/protokolle/${protokollId}/unterschriften`, platz("p3", { ort: "Potsdam" }));
    expect(l.status).toBe(201);

    const u = Object.fromEntries(l.body.unterschriften.map((x: { platz: string }) => [x.platz, x]));
    expect(u.p1.geleistet.name).toBe("Marco Becker");
    expect(u.p2.geleistet.name).toBe("Sarah Klein");
    expect(u.p3.geleistet).toMatchObject({ name: "Petra Lorenz", ort: "Potsdam", vorAenderung: false });
    expect(u.p3.geleistet.pruefnummer).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(u.p3.geleistet.bild.startsWith("data:image/png;base64,")).toBe(true);
    expect(u.p5.geleistet.name).toBe("Gerd Vormund");
    expect(u.p4.geleistet).toBeNull();

    const db = await admin.query("SELECT platz, benutzer_id, erfasst_von FROM protokoll_unterschrift WHERE protokoll_id = $1 ORDER BY platz", [protokollId]);
    expect(db.rows).toEqual([
      { platz: "p1", benutzer_id: null, erfasst_von: ids.betreuer },
      { platz: "p2", benutzer_id: ids.betreuer, erfasst_von: ids.betreuer },
      { platz: "p3", benutzer_id: ids.el, erfasst_von: ids.el },
      { platz: "p5", benutzer_id: null, erfasst_von: ids.betreuer },
    ]);

    const el = await als(tokens.el).get("/protokolle/zu-unterschreiben");
    expect(el.body.some((x: { protokollId: string }) => x.protokollId === protokollId)).toBe(false);
  });

  it("jeder Platz nur einmal, nur-Papier gar nicht, nur PNG", async () => {
    const doppelt = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p1"));
    expect([doppelt.status, doppelt.body.message]).toEqual([400, "Dieser Platz ist schon unterschrieben."]);
    const papier = await als(tokens.betreuer).post(`/protokolle/${protokollId}/unterschriften`, platz("p6"));
    expect([papier.status, papier.body.message]).toEqual([400, "Dieser Platz wird nur auf Papier unterschrieben."]);
    const kein = await als(tokens.bl).post(`/protokolle/${protokollId}/unterschriften`, platz("p4", { bild: "data:image/png;base64,PGh0bWw+" }));
    expect([kein.status, kein.body.message]).toEqual([400, "Die Unterschrift muss ein PNG-Bild sein."]);
    const fehlt = await als(tokens.bl).post(`/protokolle/${protokollId}/unterschriften`, platz("x9"));
    expect(fehlt.status).toBe(400);
  });

  it("Datenbank: kein Ändern/Löschen, Rolle muss zur Definition passen, Mandanten getrennt", async () => {
    // GEGENPROBE (durchgeführt): REVOKE in 0086 entfernt -> UPDATE ging durch, Test rot.
    await alsApp(mandantA, async (c) => {
      await expect(c.query("UPDATE protokoll_unterschrift SET ort = 'X' WHERE protokoll_id = $1", [protokollId])).rejects.toThrow(/permission denied/);
    });
    await alsApp(mandantA, async (c) => {
      await expect(c.query("DELETE FROM protokoll_unterschrift WHERE protokoll_id = $1", [protokollId])).rejects.toThrow(/permission denied/);
    });
    const bild = Buffer.from(png.split(",")[1], "base64");
    // Leitungsplatz als "klient" eingereicht, um die Selbst-Unterschrift zu umgehen:
    // GEGENPROBE (durchgeführt): Rollenvergleich im jsonpath des Triggers entfernt -> Einfügen gelang.
    await alsApp(mandantA, async (c) => {
      await expect(
        c.query(
          `INSERT INTO protokoll_unterschrift (mandant_id, protokoll_id, baustein, platz, rolle, benutzer_id, erfasst_von, bild, bild_hash, inhalt_hash)
           VALUES ($1, $2, 'unterschriften', 'p4', 'klient', NULL, $3, $4, 'x', 'y')`,
          [mandantA, protokollId, ids.betreuer, bild]
        )
      ).rejects.toThrow(/gibt es in diesem Formular nicht/);
    });
    // Selbst-Rolle für jemand anderen:
    await alsApp(mandantA, async (c) => {
      await expect(
        c.query(
          `INSERT INTO protokoll_unterschrift (mandant_id, protokoll_id, baustein, platz, rolle, benutzer_id, erfasst_von, bild, bild_hash, inhalt_hash)
           VALUES ($1, $2, 'unterschriften', 'p4', 'bereichsleitung', $3, $4, $5, 'x', 'y')`,
          [mandantA, protokollId, ids.bl, ids.betreuer, bild]
        )
      ).rejects.toThrow(/check constraint/);
    });
    // Mandant B sieht nichts und kann nicht auf A's Protokoll schreiben.
    await alsApp(mandantB, async (c) => {
      expect((await c.query("SELECT count(*)::int AS n FROM protokoll_unterschrift")).rows[0].n).toBe(0);
      await expect(
        c.query(
          `INSERT INTO protokoll_unterschrift (mandant_id, protokoll_id, baustein, platz, rolle, erfasst_von, bild, bild_hash, inhalt_hash)
           VALUES ($1, $2, 'unterschriften', 'p1', 'klient', $3, $4, 'x', 'y')`,
          [mandantB, protokollId, ids.betreuer, bild]
        )
      ).rejects.toThrow();
    });
  });

  it("Korrektur nach der Unterschrift: als 'vor der Änderung geleistet' sichtbar", async () => {
    const r = await als(tokens.betreuer).post(`/protokolle/${protokollId}/korrektur`, { werte: { anlass: "Einzug und Belehrung" }, grund: "Ergänzt" });
    expect(r.status).toBe(201);
    const u = Object.fromEntries(r.body.unterschriften.map((x: { platz: string }) => [x.platz, x]));
    expect(u.p1.geleistet.vorAenderung).toBe(true);
    expect(u.p3.geleistet.vorAenderung).toBe(true);
    // Danach unterschreibt die Bereichsleitung den neuen Stand.
    const bl = await als(tokens.bl).post(`/protokolle/${protokollId}/unterschriften`, platz("p4"));
    expect(bl.status).toBe(201);
    expect(bl.body.unterschriften.find((x: { platz: string }) => x.platz === "p4").geleistet.vorAenderung).toBe(false);
  });

  it("PDF aus der Akte: neuer Export ohne Absender-Linie, Erzeugen gelingt", async () => {
    const ex = await als(tokens.bl).post(`/formulare/${formularId}/pdf-exporte`, { name: "Akte" });
    expect(ex.status).toBe(201);
    expect(ex.body.gestaltung.unterschrift).toBe("keine");
    const pdf = await als(tokens.betreuer).post(`/protokolle/${protokollId}/pdf`, { exportId: ex.body.id });
    expect([200, 201]).toContain(pdf.status);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
  });
});

// --- Renderer (ohne Datenbank) ---------------------------------------------

type Gezeichnet = { text: string; x: number; y: number };

async function mitschneiden(e: PdfRenderEingabe) {
  const texte: Gezeichnet[] = [];
  const bilder: { x: number; y: number; width: number; height: number }[] = [];
  const origText = PDFPage.prototype.drawText;
  const origBild = PDFPage.prototype.drawImage;
  if (jest.isMockFunction(origText)) throw new Error("drawText ist noch umgeleitet.");
  const s1 = jest.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, opt) {
    void (opt?.font as PDFFont);
    texte.push({ text, x: opt!.x!, y: opt!.y! });
    return origText.call(this, text, opt);
  });
  const s2 = jest.spyOn(PDFPage.prototype, "drawImage").mockImplementation(function (this: PDFPage, bild, opt) {
    bilder.push({ x: opt!.x!, y: opt!.y!, width: opt!.width!, height: opt!.height! });
    return origBild.call(this, bild, opt);
  });
  try {
    await pdfExportRendernMitBericht(e);
    return { texte, bilder };
  } finally {
    s1.mockRestore();
    s2.mockRestore();
  }
}

describe("Unterschriften im PDF-Renderer", () => {
  let bild: Buffer;
  beforeAll(async () => {
    bild = await sharp({ create: { width: 60, height: 24, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
  });

  const eingabe = (g: PdfGestaltung): PdfRenderEingabe => ({
    gestaltung: g,
    zielgruppe: "extern",
    traegerfarbe: "#e60005",
    logo: null,
    formular: { name: "Hausordnung", version: 1, definition: DEFINITION },
    werte: { anlass: "Einzug" },
    anzeige: {},
    personen: {},
    platzhalter: { "benutzer.name": "Anna Berger", datum: "22.11.2026" },
    empfaenger: null,
    unterschriften: {
      "unterschriften:p1": { name: "Marco Becker", bild, ort: "Berlin", datum: "22.11.2026", pruefnummer: "4F2A-91C0" },
      "unterschriften:p3": { name: "Petra Lorenz", bild: null, ort: null, datum: null, pruefnummer: null },
    },
  });

  it("Akte: Bild auf der Linie bei geleisteter, Leerzeile bei offener Unterschrift; auch extern", async () => {
    const { texte, bilder } = await mitschneiden(eingabe({ ...pdfGestaltungVorgabe("akte"), unterschrift: "keine" }));
    const alle = texte.map((t) => t.text);
    expect(bilder).toHaveLength(1);
    expect(alle).toContain("Marco Becker");
    expect(alle).toContain("Berlin, 22.11.2026");
    expect(alle).toContain("elektronisch unterschrieben · Prüfnr. 4F2A-91C0");
    expect(alle).toContain("Petra Lorenz");
    expect(alle).toContain(", Einrichtungsleitung");
    expect(alle).toContain("Gesetzliche Betreuung");
    expect(alle.filter((t) => t === "Ort, Datum ____________________").length).toBe(5);
    // Zwei nebeneinander: Klient:in und Mitarbeiter:in auf derselben Höhe.
    const marco = texte.find((t) => t.text === "Marco Becker")!;
    const mitarbeiter = texte.find((t) => t.text === "Mitarbeiter:in")!;
    expect(Math.abs(marco.y - mitarbeiter.y)).toBeLessThan(0.01);
    expect(mitarbeiter.x).toBeGreaterThan(marco.x + 50);
    // "neue Zeile": die eigene Rolle steht unter, nicht neben der Bereichsleitung.
    const bl = texte.find((t) => t.text === "Bereichsleitung")!;
    const eigene = texte.find((t) => t.text === "Gesetzliche Betreuung")!;
    expect(eigene.y).toBeLessThan(bl.y - 20);
    // Bild liegt über der Linie (Grundlinie des Namens darunter).
    expect(bilder[0].y).toBeGreaterThan(marco.y);
  });

  it("Frei gestaltet: gesetzter Platz steht im Kasten, nicht noch einmal im Fließbereich", async () => {
    const g: PdfGestaltung = {
      ...pdfGestaltungVorgabe("frei"),
      unterschrift: "keine",
      frei: {
        raster: 1,
        hilfslinien: "keine",
        erste: [
          pdfFreiBaustein({ id: "fluss", art: "fluss", x: 20, y: 20, b: 170, h: 200 }),
          pdfFreiBaustein({ id: "uk", art: "unterschrift", x: 20, y: 250, b: 80, h: 25, feld: "unterschriften", platz: "p1" }),
        ],
        folge: [],
      },
    };
    const { texte, bilder } = await mitschneiden(eingabe(g));
    expect(texte.filter((t) => t.text === "Marco Becker")).toHaveLength(1);
    const marco = texte.find((t) => t.text === "Marco Becker")!;
    const MM = 72 / 25.4;
    expect(marco.x).toBeCloseTo(20 * MM, 0);
    expect(marco.y).toBeLessThan(841.89 - 250 * MM);
    expect(marco.y).toBeGreaterThan(841.89 - 275 * MM);
    expect(bilder).toHaveLength(1);
    // Die übrigen Plätze laufen im Fließbereich mit.
    expect(texte.some((t) => t.text === "Mitarbeiter:in")).toBe(true);
  });
});
