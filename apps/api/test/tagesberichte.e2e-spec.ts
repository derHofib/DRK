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

    const { rows: bereichsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung') RETURNING id`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );
    const { rows: einrichtungsleitungRows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Einrichtungsleitung S1 Test', $3, 'einrichtungsleitung') RETURNING id`,
      [mandantId, `einrichtungsleitung-s1-${suffix}@beispiel.test`, passwortHash]
    );
    const einrichtungsleitungS1Id = einrichtungsleitungRows[0].id;
    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung B Test', $3, 'bereichsleitung')`,
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
    await admin.query(
      "DELETE FROM tagesbericht_tag WHERE mandant_id = ANY($1)",
      [[mandantId, mandantBId]]
    );
    await admin.query("DELETE FROM tagesbericht_dokument WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM tagesbericht WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM tag WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
    await admin.query("DELETE FROM belegung WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM zimmer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer_standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [[mandantId, mandantBId]]);
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
