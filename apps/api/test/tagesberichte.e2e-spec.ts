/**
 * Tagesberichte: Anlegen, die zwei Listen-Sichten (alle Klienten vs. ein
 * einzelner Klient -- dieselbe Methode, klientId? entscheidet), Tags
 * (frei vergeben, mandantweit wiederverwendbar, nachtraeglich
 * hinzufuegbar/entfernbar), Standort-Einschraenkung und Mandantentrennung.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

const TEST_PDF_BASE64 = "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsO4CQ==";
const TEST_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Tagesberichte", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let mandantBId: string;
  let mandantBSlug: string;

  let tokenBereichsleitung: string;
  let tokenEinrichtungsleitungS1: string;
  let tokenBereichsleitungB: string;

  let klient1: string; // Standort 1
  let klient2: string; // Standort 2

  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantSlug = `test-tagesbericht-${suffix}`;
    mandantBSlug = `test-tagesbericht-b-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Tagesbericht ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;
    const { rows: mandantBRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Tagesbericht B ${suffix}`, mandantBSlug]
    );
    mandantBId = mandantBRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
       VALUES ($1, $2, 'Bereichsleitung Test', $3) RETURNING id`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );
    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3) RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    const einrichtungsleitungS1Id = einrichtungsleitungRows[0].id;
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
       VALUES ($1, $2, 'Bereichsleitung B Test', $3)`,
      [mandantBId, `bereichsleitung-b-${suffix}@beispiel.test`, passwortHash]
    );

    const { rows: standort1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 1', 'Str. 1') RETURNING id",
      [mandantId]
    );
    const standort1 = standort1Rows[0].id;
    const { rows: standort2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Standort 2', 'Str. 2') RETURNING id",
      [mandantId]
    );
    const standort2 = standort2Rows[0].id;

    await admin.query(
      "INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)",
      [mandantId, einrichtungsleitungS1Id, standort1]
    );

    const { rows: zimmer1Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '101') RETURNING id",
      [mandantId, standort1]
    );
    const { rows: zimmer2Rows } = await admin.query<{ id: string }>(
      "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, '201') RETURNING id",
      [mandantId, standort2]
    );

    const { rows: klient1Rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Eins', 'S1', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-S1-${suffix}`]
    );
    klient1 = klient1Rows[0].id;
    const { rows: klient2Rows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Zwei', 'S2', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-S2-${suffix}`]
    );
    klient2 = klient2Rows[0].id;

    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer1Rows[0].id, klient1]
    );
    await admin.query(
      "INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')",
      [mandantId, zimmer2Rows[0].id, klient2]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(slug: string, email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenBereichsleitung = await login(mandantSlug, `bereichsleitung-${suffix}@beispiel.test`);
    tokenEinrichtungsleitungS1 = await login(mandantSlug, `einrichtungsleitung-s1-${suffix}@beispiel.test`);
    tokenBereichsleitungB = await login(mandantBSlug, `bereichsleitung-b-${suffix}@beispiel.test`);
  });

  afterAll(async () => {
    // Seit Migration 0048 bekommt JEDER neu angelegte Mandant automatisch
    // einen Entwickler-Accounttyp (Seed-Trigger) -- muss vor dem Loeschen
    // des Mandanten weg, sonst schlaegt es an der FK auf account_typ fehl.
    await raeumeKontoMitRolleAuf(admin, mandantId);
    await raeumeKontoMitRolleAuf(admin, mandantBId);
    await admin.query(
      "DELETE FROM tagesbericht_tag WHERE mandant_id = ANY($1)",
      [[mandantId, mandantBId]]
    );
    await admin.query("DELETE FROM tagesbericht_aenderung WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM tagesbericht_dokument WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM tagesbericht WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM tag WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.end();
    await app.close();
  });

  function als(token: string) {
    const http = app.getHttpServer();
    return {
      get: (path: string) => request(http).get(path).set("Authorization", `Bearer ${token}`),
      post: (path: string, body: Record<string, unknown>) =>
        request(http).post(path).set("Authorization", `Bearer ${token}`).send(body),
      patch: (path: string, body: Record<string, unknown>) =>
        request(http).patch(path).set("Authorization", `Bearer ${token}`).send(body),
      delete: (path: string) => request(http).delete(path).set("Authorization", `Bearer ${token}`),
    };
  }

  it("legt einen Tagesbericht mit initialen Tags an", async () => {
    const res = await als(tokenBereichsleitung).post("/tagesberichte", {
      klientId: klient1,
      datum: "2026-08-26",
      text: "Ruhiger Tag, an der Gruppenaktivitaet teilgenommen.",
      tagNamen: ["Beobachtung", "Freizeit"],
    });
    expect(res.status).toBe(201);
    expect(res.body.klientId).toBe(klient1);
    expect(res.body.text).toContain("Ruhiger Tag");
    expect(res.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(["Beobachtung", "Freizeit"]);
  });

  it("ohne klientId: zeigt Berichte ALLER Klienten (allgemeiner Menuepunkt)", async () => {
    await als(tokenBereichsleitung).post("/tagesberichte", { klientId: klient2, datum: "2026-08-25", text: "Bericht zu Klient 2." });

    const alle = await als(tokenBereichsleitung).get("/tagesberichte");
    expect(alle.status).toBe(200);
    const klientIds = alle.body.map((t: { klientId: string }) => t.klientId);
    expect(klientIds).toEqual(expect.arrayContaining([klient1, klient2]));
  });

  it("mit klientId: nur Berichte dieses einen Klienten (Tab in der Klientenakte)", async () => {
    const res = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((t: { klientId: string }) => t.klientId === klient1)).toBe(true);
  });

  it("Zeitraum: von/bis grenzen inklusiv ein, ungueltige Angaben ergeben 400", async () => {
    for (const datum of ["2026-03-01", "2026-03-15", "2026-03-31", "2026-04-01"]) {
      await als(tokenBereichsleitung).post("/tagesberichte", { klientId: klient1, datum, text: `Zeitraum ${datum}` });
    }
    const res = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}&von=2026-03-01&bis=2026-03-31`);
    expect(res.status).toBe(200);
    const daten = res.body.map((t: { datum: string }) => t.datum).sort();
    expect(daten).toEqual(["2026-03-01", "2026-03-15", "2026-03-31"]);

    const nurVon = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}&von=2026-04-01`);
    expect(nurVon.body.every((t: { datum: string }) => t.datum >= "2026-04-01")).toBe(true);

    expect((await als(tokenBereichsleitung).get("/tagesberichte?von=kein-datum")).status).toBe(400);
    expect((await als(tokenBereichsleitung).get("/tagesberichte?von=2026-05-02&bis=2026-05-01")).status).toBe(400);
  });

  it("wiederverwendet einen bestehenden Tag mit demselben Namen statt einen Duplikat-Tag anzulegen", async () => {
    const erster = await als(tokenBereichsleitung).post("/tagesberichte", {
      klientId: klient1,
      datum: "2026-08-24",
      text: "Zweiter Bericht.",
      tagNamen: ["Beobachtung"],
    });
    const tagsListe = await als(tokenBereichsleitung).get("/tags");
    const beobachtungTags = tagsListe.body.filter((t: { name: string }) => t.name === "Beobachtung");
    expect(beobachtungTags.length).toBe(1);
    expect(erster.body.tags[0].id).toBe(beobachtungTags[0].id);
  });

  it("Tag laesst sich nachtraeglich hinzufuegen und wieder entfernen", async () => {
    const angelegt = await als(tokenBereichsleitung).post("/tagesberichte", {
      klientId: klient1,
      datum: "2026-08-23",
      text: "Bericht ohne Tags.",
    });
    expect(angelegt.body.tags).toEqual([]);

    const hinzugefuegt = await als(tokenBereichsleitung).post(`/tagesberichte/${angelegt.body.id}/tags`, { name: "Vorfall" });
    expect(hinzugefuegt.status).toBe(201);
    expect(hinzugefuegt.body.tags.map((t: { name: string }) => t.name)).toContain("Vorfall");
    const tagId = hinzugefuegt.body.tags.find((t: { name: string }) => t.name === "Vorfall").id;

    const entfernt = await als(tokenBereichsleitung).delete(`/tagesberichte/${angelegt.body.id}/tags/${tagId}`);
    expect(entfernt.status).toBe(200);

    const nachher = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}`);
    const bericht = nachher.body.find((t: { id: string }) => t.id === angelegt.body.id);
    expect(bericht.tags.map((t: { name: string }) => t.name)).not.toContain("Vorfall");
  });

  it("Standort-Einschraenkung: einrichtungsleitung-s1 sieht auch im allgemeinen Menuepunkt nur Berichte ihres Standorts", async () => {
    const alle = await als(tokenEinrichtungsleitungS1).get("/tagesberichte");
    expect(alle.status).toBe(200);
    expect(alle.body.every((t: { klientId: string }) => t.klientId === klient1)).toBe(true);
    expect(alle.body.some((t: { klientId: string }) => t.klientId === klient2)).toBe(false);
  });

  it("Standort-Einschraenkung: einrichtungsleitung-s1 kann keinen Bericht fuer einen Klienten in Standort 2 anlegen", async () => {
    const res = await als(tokenEinrichtungsleitungS1).post("/tagesberichte", {
      klientId: klient2,
      datum: "2026-08-26",
      text: "Sollte scheitern.",
    });
    expect(res.status).toBe(404);
  });

  it("Mandantentrennung: Bereichsleitung eines anderen Mandanten sieht keine fremden Tagesberichte", async () => {
    const res = await als(tokenBereichsleitungB).get("/tagesberichte");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("lehnt ungueltige Eingaben mit 400 ab", async () => {
    const res = await als(tokenBereichsleitung).post("/tagesberichte", { klientId: klient1, datum: "26.08.2026", text: "" });
    expect(res.status).toBe(400);
  });

  it("lehnt einen Tagesbericht mit Datum in der Zukunft mit 400 ab, erlaubt heute", async () => {
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    const morgen = new Date(`${heute}T12:00:00Z`);
    morgen.setUTCDate(morgen.getUTCDate() + 1);
    const zukunft = await als(tokenBereichsleitung).post("/tagesberichte", {
      klientId: klient1,
      datum: morgen.toISOString().slice(0, 10),
      text: "Noch nicht passiert.",
    });
    expect(zukunft.status).toBe(400);
    const ok = await als(tokenBereichsleitung).post("/tagesberichte", { klientId: klient1, datum: heute, text: "Heute." });
    expect(ok.status).toBe(201);
  });

  /**
   * Bearbeiten mit Historie: die Protokollierung sitzt in Triggern
   * (Migration 0069), deshalb pruefen die Tests auch, dass sie sich weder
   * umgehen noch nachtraeglich veraendern laesst.
   */
  describe("Bearbeiten und Historie", () => {
    let berichtId: string;

    beforeAll(async () => {
      const res = await als(tokenBereichsleitung).post("/tagesberichte", {
        klientId: klient1,
        datum: "2026-09-01",
        text: "Ursprungstext.",
        tagNamen: ["Anfangstag"],
        dokumente: [{ base64: TEST_PDF_BASE64, dateiname: "anfang.pdf", mimeType: "application/pdf" }],
      });
      berichtId = res.body.id;
    });

    it("Anlegen mit Tags/Dokumenten erzeugt keine Historie (Ursprungsfassung)", async () => {
      const h = await als(tokenBereichsleitung).get(`/tagesberichte/${berichtId}/historie`);
      expect(h.status).toBe(200);
      expect(h.body).toEqual([]);
    });

    it("Autor bearbeitet; Historie nennt alten und neuen Text, Datum und wer", async () => {
      const res = await als(tokenBereichsleitung).patch(`/tagesberichte/${berichtId}`, {
        text: "Korrigierter Text.",
        datum: "2026-09-02",
      });
      expect(res.status).toBe(200);
      expect(res.body.text).toBe("Korrigierter Text.");
      expect(res.body.anzahlAenderungen).toBe(1);
      const h = await als(tokenBereichsleitung).get(`/tagesberichte/${berichtId}/historie`);
      expect(h.body).toHaveLength(1);
      expect(h.body[0]).toMatchObject({
        art: "bearbeitet",
        textAlt: "Ursprungstext.",
        textNeu: "Korrigierter Text.",
        datumAlt: "2026-09-01",
        datumNeu: "2026-09-02",
        geaendertVonName: "Bereichsleitung Test",
      });
    });

    it("protokolliert nachtraeglich hinzugefuegte Tags, entfernte Tags und Dokumente samt Person", async () => {
      const tag = await als(tokenEinrichtungsleitungS1).post(`/tagesberichte/${berichtId}/tags`, { name: "Spaeter" });
      const spaeterId = tag.body.tags.find((t: { name: string }) => t.name === "Spaeter").id;
      await als(tokenEinrichtungsleitungS1).delete(`/tagesberichte/${berichtId}/tags/${spaeterId}`);
      await als(tokenEinrichtungsleitungS1).post(`/tagesberichte/${berichtId}/dokumente`, {
        base64: TEST_PNG_BASE64,
        dateiname: "nachtrag.png",
        mimeType: "image/png",
      });
      const h = await als(tokenBereichsleitung).get(`/tagesberichte/${berichtId}/historie`);
      const arten = h.body.map((e: { art: string }) => e.art);
      expect(arten).toEqual(expect.arrayContaining(["tag_hinzugefuegt", "tag_entfernt", "dokument_hinzugefuegt"]));
      const doc = h.body.find((e: { art: string }) => e.art === "dokument_hinzugefuegt");
      expect(doc).toMatchObject({ dokumentName: "nachtrag.png", geaendertVonName: "Einrichtungsleitung S1 Test" });
      expect(h.body.find((e: { art: string }) => e.art === "tag_entfernt").tagName).toBe("Spaeter");
    });

    it("Nicht-Autor darf Text nicht bearbeiten (403), bearbeitbar ist false", async () => {
      const res = await als(tokenEinrichtungsleitungS1).patch(`/tagesberichte/${berichtId}`, { text: "Fremd." });
      expect(res.status).toBe(403);
      const liste = await als(tokenEinrichtungsleitungS1).get(`/tagesberichte?klientId=${klient1}`);
      expect(liste.body.find((b: { id: string }) => b.id === berichtId).bearbeitbar).toBe(false);
    });

    it("lehnt Datum in der Zukunft, leeren Text und leere Anfrage mit 400 ab", async () => {
      const morgen = new Date();
      morgen.setUTCDate(morgen.getUTCDate() + 2);
      const zukunft = await als(tokenBereichsleitung).patch(`/tagesberichte/${berichtId}`, {
        datum: morgen.toISOString().slice(0, 10),
      });
      expect(zukunft.status).toBe(400);
      expect((await als(tokenBereichsleitung).patch(`/tagesberichte/${berichtId}`, { text: "  " })).status).toBe(400);
      expect((await als(tokenBereichsleitung).patch(`/tagesberichte/${berichtId}`, {})).status).toBe(400);
    });

    it("Mandantentrennung: anderer Mandant bekommt 404 auf Bearbeiten und Historie", async () => {
      expect((await als(tokenBereichsleitungB).patch(`/tagesberichte/${berichtId}`, { text: "x" })).status).toBe(404);
      expect((await als(tokenBereichsleitungB).get(`/tagesberichte/${berichtId}/historie`)).status).toBe(404);
    });

    it("Datenbank: Historie ist unveraenderlich, Autor/Klient sind nicht aenderbar", async () => {
      const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await app_.connect();
      try {
        await app_.query("BEGIN");
        await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(app_.query("DELETE FROM tagesbericht_aenderung")).rejects.toThrow(/permission denied/);
        await app_.query("ROLLBACK");
        await app_.query("BEGIN");
        await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await expect(app_.query("UPDATE tagesbericht SET klient_id = klient_id")).rejects.toThrow(/permission denied/);
        await app_.query("ROLLBACK");
      } finally {
        await app_.end();
      }
    });

    it("Datenbank: direkte Textaenderung ohne App-Code wird trotzdem protokolliert (Trigger)", async () => {
      const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await app_.connect();
      try {
        await app_.query("BEGIN");
        await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
        await app_.query("UPDATE tagesbericht SET text = 'Direkt.' WHERE id = $1", [berichtId]);
        await app_.query("COMMIT");
      } finally {
        await app_.end();
      }
      const { rows } = await admin.query(
        "SELECT text_alt, text_neu FROM tagesbericht_aenderung WHERE tagesbericht_id = $1 AND text_neu = 'Direkt.'",
        [berichtId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].text_alt).toBe("Korrigierter Text.");
    });
  });

  /**
   * Dokumente an Tagesberichten: bewusst mehrere pro Bericht moeglich
   * (anders als bei rechnung_dokument), gleiche Sicherheitsvorkehrungen wie
   * bei Rechnungsdokumenten (MIME-Allowlist, "attachment"-Disposition,
   * nosniff -- siehe common/datei.ts), und dieselbe Standort-/
   * Mandanten-Isolation wie der Berichtstext selbst.
   */
  describe("Dokumente", () => {
    let berichtId: string;

    beforeAll(async () => {
      const angelegt = await als(tokenBereichsleitung).post("/tagesberichte", {
        klientId: klient1,
        datum: "2026-08-27",
        text: "Bericht mit Dokument.",
        dokumente: [{ base64: TEST_PDF_BASE64, dateiname: "beleg.pdf", mimeType: "application/pdf" }],
      });
      berichtId = angelegt.body.id;
    });

    it("legt einen Bericht mit initialem Dokument an", async () => {
      const res = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}`);
      const bericht = res.body.find((b: { id: string }) => b.id === berichtId);
      expect(bericht.dokumente.length).toBe(1);
      expect(bericht.dokumente[0].dateiname).toBe("beleg.pdf");
      expect(bericht.dokumente[0].mimeType).toBe("application/pdf");
    });

    it("laesst sich um ein zweites Dokument nachtraeglich ergaenzen (mehrere pro Bericht moeglich)", async () => {
      const res = await als(tokenBereichsleitung).post(`/tagesberichte/${berichtId}/dokumente`, {
        base64: TEST_PNG_BASE64,
        dateiname: "foto.png",
        mimeType: "image/png",
      });
      expect(res.status).toBe(201);
      expect(res.body.dokumente.length).toBe(2);
      expect(res.body.dokumente.map((d: { dateiname: string }) => d.dateiname).sort()).toEqual([
        "beleg.pdf",
        "foto.png",
      ]);
    });

    it("liefert den Dateiinhalt mit sicheren Headern (attachment, nosniff, Hash)", async () => {
      const liste = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}`);
      const bericht = liste.body.find((b: { id: string }) => b.id === berichtId);
      const dokumentId = bericht.dokumente.find((d: { dateiname: string }) => d.dateiname === "beleg.pdf").id;

      const res = await als(tokenBereichsleitung).get(`/tagesberichte/${berichtId}/dokumente/${dokumentId}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-datei-hash"]).toBeTruthy();
      expect(Buffer.from(res.body).length).toBeGreaterThan(0);
    });

    it("lehnt einen nicht erlaubten MIME-Type mit 400 ab", async () => {
      const res = await als(tokenBereichsleitung).post(`/tagesberichte/${berichtId}/dokumente`, {
        base64: "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
        dateiname: "boese.html",
        mimeType: "text/html",
      });
      expect(res.status).toBe(400);
    });

    it("weist eine unbekannte Dokument-ID mit 404 ab", async () => {
      const res = await als(tokenBereichsleitung).get(`/tagesberichte/${berichtId}/dokumente/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("Standort-Einschraenkung: einrichtungsleitung-s1 kann kein Dokument fuer Klient 2 herunterladen oder hinzufuegen", async () => {
      const berichtKlient2 = await als(tokenBereichsleitung).post("/tagesberichte", {
        klientId: klient2,
        datum: "2026-08-27",
        text: "Bericht Klient 2 mit Dokument.",
        dokumente: [{ base64: TEST_PDF_BASE64, dateiname: "beleg2.pdf", mimeType: "application/pdf" }],
      });
      const dokumentId = berichtKlient2.body.dokumente[0].id;

      const hinzufuegen = await als(tokenEinrichtungsleitungS1).post(`/tagesberichte/${berichtKlient2.body.id}/dokumente`, {
        base64: TEST_PNG_BASE64,
        dateiname: "sollte-scheitern.png",
        mimeType: "image/png",
      });
      expect(hinzufuegen.status).toBe(404);

      const herunterladen = await als(tokenEinrichtungsleitungS1).get(
        `/tagesberichte/${berichtKlient2.body.id}/dokumente/${dokumentId}`
      );
      expect(herunterladen.status).toBe(404);
    });

    it("Mandantentrennung: Bereichsleitung eines anderen Mandanten kann das Dokument nicht herunterladen", async () => {
      const liste = await als(tokenBereichsleitung).get(`/tagesberichte?klientId=${klient1}`);
      const bericht = liste.body.find((b: { id: string }) => b.id === berichtId);
      const dokumentId = bericht.dokumente[0].id;

      const res = await als(tokenBereichsleitungB).get(`/tagesberichte/${berichtId}/dokumente/${dokumentId}`);
      expect(res.status).toBe(404);
    });
  });
});
