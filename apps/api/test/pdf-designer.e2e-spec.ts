/**
 * Freier PDF-Designer (Grundform "frei", Konzept pdf-designer 21.11.2026).
 *
 * Gemessen statt angesehen: drawText wird mitgeschnitten, und fuer jeden
 * gezeichneten Text wird geprueft, ob er in seinem Baustein liegt. Geprueft wird:
 *  - ein zu langer Text verlaesst seinen Kasten nie; er wird verkleinert und
 *    der Rest steht VOLLSTAENDIG im Anhang "Fortsetzung" (nie still abgeschnitten)
 *  - der Fliessbereich nimmt nur die nicht platzierten Felder und bricht auf
 *    Folgeseiten um, innerhalb des Fliessbereichs der Folgeseite
 *  - ein internes Feld als Baustein in einem externen Export wird nie gezeichnet
 *  - Seitenzahlen stehen erst fest, wenn alle Seiten gesetzt sind
 *  - der Server lehnt Bausteine ausserhalb des Blatts und zwei Fliessbereiche ab
 *  - "Passt es?" mit den laengsten echten Werten meldet nur Baustein-Ids, nie Inhalt
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { PDFPage, type PDFFont } from "pdf-lib";
import {
  pdfFreiAusGestaltung,
  pdfFreiBaustein,
  pdfGestaltungVorgabe,
  type FormularDefinition,
  type PdfFreiBaustein,
  type PdfGestaltung,
} from "@zimmerakte/shared";
import { AppModule } from "../src/app.module";
import { pdfExportRendernMitBericht, type PdfRenderEingabe } from "../src/pdf-export/pdf-export-render";
import { laengeOhneInhalt } from "../src/pdf-export/pdf-export.service";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

const MM = 72 / 25.4;
const SEITE_H = 841.89;

const DEFINITION: FormularDefinition = {
  bausteine: [
    { typ: "kurztext", schluessel: "anlass", beschriftung: "Anlass" },
    { typ: "ja_nein", schluessel: "miete", beschriftung: "Mietzahlung aktuell" },
    { typ: "langtext", schluessel: "verlauf", beschriftung: "Verlauf" },
    { typ: "langtext", schluessel: "intern_notiz", beschriftung: "Interne Notiz", intern: true },
  ],
};

type Gezeichnet = { seite: number; text: string; x: number; y: number; b: number; size: number };

/** drawText mitschneiden: Text, Seite und Ausdehnung in pt. */
async function mitschneiden(e: PdfRenderEingabe) {
  const seiten: PDFPage[] = [];
  const texte: Gezeichnet[] = [];
  const orig = PDFPage.prototype.drawText;
  // Haengt noch der Spion eines abgebrochenen Tests (Zeitlimit), wuerde der
  // neue sich selbst aufrufen und mit einem Stackueberlauf statt der
  // eigentlichen Ursache enden.
  if (jest.isMockFunction(orig)) throw new Error("drawText ist noch vom vorigen Test umgeleitet.");
  const spion = jest.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, opt) {
    if (!seiten.includes(this)) seiten.push(this);
    const font = opt?.font as PDFFont;
    texte.push({ seite: seiten.indexOf(this) + 1, text, x: opt!.x!, y: opt!.y!, size: opt!.size!, b: font.widthOfTextAtSize(text, opt!.size!) });
    return orig.call(this, text, opt);
  });
  try {
    const bericht = await pdfExportRendernMitBericht(e);
    return { bericht, texte };
  } finally {
    spion.mockRestore();
  }
}

/** Liegt der gezeichnete Text (Grundlinie bis Oberlaenge) im Baustein? Toleranz 0,5 pt. */
function imBaustein(t: Gezeichnet, el: PdfFreiBaustein): boolean {
  const x0 = el.x * MM - 0.5;
  const x1 = (el.x + el.b) * MM + 0.5;
  const oben = SEITE_H - el.y * MM + 0.5;
  const unten = SEITE_H - (el.y + el.h) * MM - 0.5;
  return t.x >= x0 && t.x + t.b <= x1 && t.y + t.size * 0.75 <= oben && t.y - t.size * 0.25 >= unten;
}

function eingabe(g: PdfGestaltung, werte: Record<string, unknown>, zielgruppe: "intern" | "extern" = "intern"): PdfRenderEingabe {
  return {
    gestaltung: g,
    zielgruppe,
    traegerfarbe: "#e60005",
    logo: null,
    formular: { name: "Hausbesuch", version: 1, definition: DEFINITION },
    werte: werte as PdfRenderEingabe["werte"],
    anzeige: {},
    personen: {},
    platzhalter: { "benutzer.name": "Anna Berger", datum: "21.11.2026", "klient.name": "Mira Beispiel" },
    empfaenger: null,
  };
}

const LANG = Array.from({ length: 60 }, (_, i) => `Satz ${i + 1} mit einigen Worten über den Verlauf des Besuchs.`).join(" ");

// Der erste Lauf bettet die Schriften ein und verkleinert schrittweise:
// lokal 3,4 s, auf dem CI-Runner ueber Jests Standard von 5 s.
jest.setTimeout(30_000);

describe("PDF-Designer: Renderer fuer frei gestaltete Exporte", () => {
  const frei = (erste: PdfFreiBaustein[], folge: PdfFreiBaustein[] = []): PdfGestaltung => ({
    ...pdfGestaltungVorgabe("frei"),
    frei: { raster: 1, hilfslinien: "keine", erste, folge },
  });

  it("zu langer Text bleibt im Kasten, der volle Text steht im Anhang", async () => {
    // GEGENPROBE (durchgefuehrt): in freiRendern `melden(...)` beim Feld
    // auskommentiert -> kein Anhang, die Pruefung auf den vollen Text wird rot.
    const kasten = pdfFreiBaustein({ id: "verlauf", art: "feld", feld: "verlauf", x: 20, y: 30, b: 80, h: 20, pt: 10 });
    const { bericht, texte } = await mitschneiden(eingabe(frei([kasten]), { verlauf: LANG }));
    expect(bericht.ueberlauf).toEqual(["erste:verlauf"]);
    expect(bericht.seiten).toBe(2);
    const imKasten = texte.filter((t) => t.seite === 1);
    expect(imKasten.length).toBeGreaterThan(2);
    for (const t of imKasten) expect([t.text, imBaustein(t, kasten)]).toEqual([t.text, true]);
    // Verkleinert bis zur Untergrenze, nie darunter.
    expect(Math.min(...imKasten.map((t) => t.size))).toBe(7);
    expect(imKasten.at(-1)!.text).toMatch(/→ Fortsetzung$/);
    // Der Anhang enthaelt jedes Wort des Werts.
    const anhang = texte.filter((t) => t.seite === 2).map((t) => t.text).join(" ").replace(/\s+/g, " ");
    expect(anhang).toContain("Fortsetzung".toLocaleUpperCase("de-DE"));
    expect(anhang).toContain(LANG);
  });

  it("passt der Text nach Verkleinern, gibt es keinen Anhang", async () => {
    const kasten = pdfFreiBaustein({ id: "anlass", art: "feld", feld: "anlass", x: 20, y: 30, b: 60, h: 9, pt: 14 });
    const { bericht, texte } = await mitschneiden(eingabe(frei([kasten]), { anlass: "Hilfeplangespräch im Mai mit dem Amt" }));
    expect(bericht).toMatchObject({ seiten: 1, ueberlauf: [] });
    for (const t of texte) expect(imBaustein(t, kasten)).toBe(true);
    expect(Math.max(...texte.map((t) => t.size))).toBeLessThan(14);
  });

  it("Fliessbereich: nur nicht platzierte Felder, Umbruch in den Fliessbereich der Folgeseite", async () => {
    const anlass = pdfFreiBaustein({ id: "anlass", art: "feld", feld: "anlass", x: 20, y: 20, b: 80, h: 10 });
    const flussE = pdfFreiBaustein({ id: "fluss", art: "fluss", x: 20, y: 200, b: 120, h: 60 });
    const flussF = pdfFreiBaustein({ id: "fluss", art: "fluss", x: 30, y: 40, b: 150, h: 235 });
    const seite = pdfFreiBaustein({ id: "nr", art: "text", x: 150, y: 285, b: 40, h: 5, text: "Seite {seite} von {seiten}", pt: 7, ausrichtung: "rechts" });
    const g = frei([anlass, flussE, seite], [flussF, seite]);
    const { bericht, texte } = await mitschneiden(eingabe(g, { anlass: "Einmalig platziert", miete: true, verlauf: LANG }));
    // Mehrere Seiten; wie viele, haengt an der Schrift -- gezaehlt wird unten.
    expect(bericht.seiten).toBeGreaterThanOrEqual(2);
    // Platziertes Feld genau einmal, nicht noch einmal im Fliessbereich.
    expect(texte.filter((t) => t.text === "Einmalig platziert")).toHaveLength(1);
    const inhalt = texte.filter((t) => !t.text.startsWith("Seite ") && t.text !== "Einmalig platziert" && t.text !== "Anlass");
    for (const t of inhalt) {
      const ziel = t.seite === 1 ? flussE : flussF;
      expect([t.seite, t.text, imBaustein(t, ziel)]).toEqual([t.seite, t.text, true]);
    }
    const n = bericht.seiten;
    expect(texte.filter((t) => t.text.startsWith("Seite ")).map((t) => t.text)).toEqual(Array.from({ length: n }, (_, i) => `Seite ${i + 1} von ${n}`));
    // Jede Seite traegt Inhalt; keine leere Folgeseite.
    for (let i = 1; i <= n; i++) expect(inhalt.some((t) => t.seite === i)).toBe(true);
  });

  it("ein internes Feld als Baustein erscheint in einem externen Export nie", async () => {
    // GEGENPROBE (durchgefuehrt): in freiRendern die Feldkarte mit
    // `zielgruppe: "intern"` gebaut -> der Text taucht auf, Test rot.
    const notiz = pdfFreiBaustein({ id: "notiz", art: "feld", feld: "intern_notiz", x: 20, y: 20, b: 120, h: 30 });
    const werte = { intern_notiz: "nur für das Team" };
    const extern = await mitschneiden(eingabe(frei([notiz]), werte, "extern"));
    expect(extern.texte.map((t) => t.text).join(" ")).not.toContain("nur für das Team");
    expect(extern.texte.map((t) => t.text).join(" ")).not.toContain("Interne Notiz");
    const intern = await mitschneiden(eingabe(frei([notiz]), werte, "intern"));
    expect(intern.texte.map((t) => t.text).join(" ")).toContain("nur für das Team");
  });

  it("aus Brief und Akte uebernommene Bausteine liegen alle auf dem Blatt", () => {
    for (const v of ["brief", "akte"] as const) {
      const f = pdfFreiAusGestaltung(pdfGestaltungVorgabe(v));
      for (const el of [...f.erste, ...f.folge]) {
        expect([v, el.id, el.x >= 0 && el.y >= 0 && el.x + el.b <= 210 && el.y + el.h <= 297]).toEqual([v, el.id, true]);
      }
      expect(f.erste.filter((x) => x.art === "fluss")).toHaveLength(1);
      expect(f.folge.filter((x) => x.art === "fluss")).toHaveLength(1);
    }
  });

  it("Laenge ohne Inhalt: Woerter und Zeilen bleiben, Buchstaben nicht", () => {
    const echt = "Frau M. hat die Miete\nnicht gezahlt";
    const maske = laengeOhneInhalt(echt);
    expect(maske).toHaveLength(echt.length);
    expect(maske.split("\n").map((z) => z.split(" ").map((w) => w.length))).toEqual(echt.split("\n").map((z) => z.split(" ").map((w) => w.length)));
    for (const wort of ["Frau", "Miete", "gezahlt"]) expect(maske).not.toContain(wort);
  });
});

describe("PDF-Designer: Speichern und Pruefen ueber die API", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  let mandantId: string;
  let leitung: string;
  let betreuer: string;
  let klientId: string;
  let formularId: string;

  const http = () => request(app.getHttpServer());
  const als = (token: string) => ({
    get: (url: string) => http().get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => http().post(url).set("Authorization", `Bearer ${token}`).send(body),
    put: (url: string, body: object) => http().put(url).set("Authorization", `Bearer ${token}`).send(body),
  });

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const slug = `test-pdfdesigner-${suffix}`;
    mandantId = (await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Testmandant Designer ${suffix}`, slug])).rows[0].id;
    const konto = async (rolle: "einrichtungsleitung" | "betreuer", kurz: string) => {
      const email = `${kurz}-${suffix}@beispiel.test`;
      await kontoMitAlterRolle(admin, { mandantId, rolle, email, name: `Person ${kurz}`, passwortHash: await bcrypt.hash(passwort, 4) });
      return (await http().post("/auth/login").send({ mandantSlug: slug, email, passwort })).body.accessToken as string;
    };
    leitung = await konto("einrichtungsleitung", "d-leitung");
    betreuer = await konto("betreuer", "d-betreuer");
    const s = await admin.query<{ id: string }>("INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus Linde', 'Lindenweg 3') RETURNING id", [mandantId]);
    klientId = (
      await admin.query<{ id: string }>(
        "INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt) VALUES ($1, 'Mira', 'Beispiel', '2004-05-06', 'AZ-1', 'Jugendamt') RETURNING id",
        [mandantId]
      )
    ).rows[0].id;
    const z = await admin.query<{ id: string }>("INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, 'Z-1') RETURNING id", [mandantId, s.rows[0].id]);
    await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [mandantId, z.rows[0].id, klientId]);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE formular_version DISABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll DISABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert DISABLE TRIGGER protokoll_wert_protokoll");
      for (const t of [
        "pdf_export_erzeugt",
        "pdf_export_version",
        "pdf_export",
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
        await admin.query(`DELETE FROM ${t} WHERE mandant_id = $1`, [mandantId]);
      }
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]).catch(() => undefined);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.query("ALTER TABLE formular_version ENABLE TRIGGER formular_version_eingefroren");
      await admin.query("ALTER TABLE protokoll ENABLE TRIGGER protokoll_abschluss_endgueltig");
      await admin.query("ALTER TABLE protokoll_wert ENABLE TRIGGER protokoll_wert_protokoll");
      await admin.end();
      await app.close();
    }
  });

  let exportId: string;
  let gestaltung: PdfGestaltung;

  it("neuer frei gestalteter Export wird gespeichert und unveraendert wieder gelesen", async () => {
    formularId = (await als(leitung).post("/formulare", { name: "Hausbesuch" })).body.id;
    expect((await als(leitung).put(`/formulare/${formularId}/entwurf`, { definition: DEFINITION })).status).toBe(200);
    expect((await als(leitung).post(`/formulare/${formularId}/veroeffentlichen`)).status).toBe(201);
    const neu = await als(leitung).post(`/formulare/${formularId}/pdf-exporte`, { name: "Frei", vorlage: "frei" });
    expect(neu.status).toBe(201);
    exportId = neu.body.id;
    expect(neu.body.gestaltung.vorlage).toBe("frei");
    gestaltung = {
      ...neu.body.gestaltung,
      frei: {
        ...neu.body.gestaltung.frei,
        raster: 0.5,
        erste: [
          ...neu.body.gestaltung.frei.erste,
          pdfFreiBaustein({ id: "anlass", art: "feld", feld: "anlass", x: 20.5, y: 50, b: 30, h: 8, pt: 9 }),
        ],
      },
    };
    const res = await als(leitung).put(`/pdf-exporte/${exportId}`, { name: "Frei", zielgruppe: "intern", logoId: null, gestaltung });
    expect(res.status).toBe(200);
    expect(res.body.gestaltung.frei).toEqual(gestaltung.frei);
  });

  it("Bausteine ausserhalb des Blatts, krumme Masse und zwei Fliessbereiche lehnt der Server ab", async () => {
    // GEGENPROBE (durchgefuehrt): `.refine(... ragt über das Blatt ...)` im
    // Controller entfernt -> der erste Fall speichert mit 200, Test rot.
    const mit = (erste: PdfFreiBaustein[]) => ({ name: "Frei", zielgruppe: "intern", logoId: null, gestaltung: { ...gestaltung, frei: { ...gestaltung.frei, erste } } });
    const raus = pdfFreiBaustein({ id: "raus", art: "text", x: 190, y: 10, b: 30, h: 5, text: "x" });
    expect((await als(leitung).put(`/pdf-exporte/${exportId}`, mit([raus]))).status).toBe(400);
    const krumm = pdfFreiBaustein({ id: "krumm", art: "text", x: 10.3, y: 10, b: 30, h: 5, text: "x" });
    expect((await als(leitung).put(`/pdf-exporte/${exportId}`, mit([krumm]))).status).toBe(400);
    const f1 = pdfFreiBaustein({ id: "f1", art: "fluss", x: 10, y: 10, b: 30, h: 50 });
    const f2 = pdfFreiBaustein({ id: "f2", art: "fluss", x: 10, y: 100, b: 30, h: 50 });
    expect((await als(leitung).put(`/pdf-exporte/${exportId}`, mit([f1, f2]))).status).toBe(400);
    const klein = pdfFreiBaustein({ id: "klein", art: "text", x: 10, y: 10, b: 30, h: 5, text: "x", pt: 6 });
    expect((await als(leitung).put(`/pdf-exporte/${exportId}`, mit([klein]))).status).toBe(400);
  });

  it("„Passt es?“ mit den laengsten echten Werten meldet nur Ids, nie Inhalt", async () => {
    const p = await als(betreuer).post("/protokolle", { formularId, klientId });
    expect(p.status).toBe(201);
    const echt = "Ausführliches Gespräch mit Vermieterin über Rückstände und Ratenzahlung bis Jahresende";
    expect((await als(betreuer).post(`/protokolle/${p.body.id}/abschliessen`, { werte: { anlass: echt, miete: false } })).status).toBe(201);

    const body = { name: "Frei", zielgruppe: "intern", logoId: null, gestaltung, empfaenger: null };
    const beispiel = await als(leitung).post(`/formulare/${formularId}/pdf-exporte/pruefen`, { ...body, laengste: false });
    expect(beispiel.status).toBe(201);
    expect(beispiel.body.ueberlauf).toEqual([]);
    const laengste = await als(leitung).post(`/formulare/${formularId}/pdf-exporte/pruefen`, { ...body, laengste: true });
    expect(laengste.status).toBe(201);
    expect(laengste.body.ueberlauf).toEqual(["erste:anlass"]);
    expect(Object.keys(laengste.body).sort()).toEqual(["seiten", "ueberlauf"]);
    expect(JSON.stringify(laengste.body)).not.toContain("Vermieterin");
    // Pruefen darf nur, wer gestalten darf.
    expect((await als(betreuer).post(`/formulare/${formularId}/pdf-exporte/pruefen`, { ...body, laengste: true })).status).toBe(403);
  });
});
