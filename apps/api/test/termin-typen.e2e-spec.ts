/**
 * Eigene Termintypen (migrations/0085). Kernaussagen:
 *
 * 1. Jeder Traeger startet mit den drei bisherigen Arten; "Termin" ist der
 *    Standardtyp und faengt alles auf, was keinen Typ waehlt (auch
 *    Klient:innen).
 * 2. Verwalten verlangt kalender.typen-verwalten; lesen darf jede:r.
 * 3. Ausblenden aendert keinen bestehenden Termin, verhindert aber die
 *    neue Wahl. Der Standardtyp laesst sich weder ausblenden noch loeschen,
 *    ein benutzter Typ nicht loeschen.
 * 4. Die Leistungsart des Typs wird in den Termin kopiert -- eine spaetere
 *    Aenderung am Typ veraendert bestehende Termine nicht.
 * 5. Traegertrennung: RLS und der zusammengesetzte Fremdschluessel lassen
 *    keinen Termin auf den Typ eines anderen Traegers zeigen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";
import { klientToken, legeKlientZugangAn } from "./support/klient-zugang";

describe("Termintypen", () => {
  let app: INestApplication;
  let admin: Client;

  const suffix = randomUUID().slice(0, 8);
  const passwort = "correct horse battery staple";

  let mandantAId: string;
  let mandantBId: string;
  let leitungId: string;
  let tokenLeitung: string;
  let tokenBetreuer: string;
  let tokenLeitungB: string;
  let tokenKlient: string;

  const http = () => app.getHttpServer();
  const als = (token: string) => ({
    get: (p: string) => request(http()).get(p).set("Authorization", `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(http()).post(p).set("Authorization", `Bearer ${token}`).send(body),
    patch: (p: string, body: object = {}) => request(http()).patch(p).set("Authorization", `Bearer ${token}`).send(body),
    put: (p: string, body: object = {}) => request(http()).put(p).set("Authorization", `Bearer ${token}`).send(body),
    delete: (p: string) => request(http()).delete(p).set("Authorization", `Bearer ${token}`),
  });

  const termin = (extra: object = {}) => ({
    titel: "Besuch",
    beginn: "2026-12-03T09:00:00+01:00",
    ende: "2026-12-03T10:00:00+01:00",
    ...extra,
  });

  const typenVon = async (token: string) => (await als(token).get("/kalender/typen")).body as Array<Record<string, any>>;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const hash = await bcrypt.hash(passwort, 4);

    const slugA = `test-tt-a-${suffix}`;
    const slugB = `test-tt-b-${suffix}`;
    mandantAId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`TT A ${suffix}`, slugA])).rows[0].id;
    mandantBId = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`TT B ${suffix}`, slugB])).rows[0].id;

    const konto = (mandantId: string, rolle: "einrichtungsleitung" | "betreuer", kurz: string, name: string) =>
      kontoMitAlterRolle(admin, { mandantId, rolle, email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash: hash });
    leitungId = await konto(mandantAId, "einrichtungsleitung", "leitung", "Anna Leitung");
    await konto(mandantAId, "betreuer", "betreuer", "Bernd Betreuer");
    await konto(mandantBId, "einrichtungsleitung", "leitung-b", "Lena Leitung B");

    const klientId = (
      await admin.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Max', 'Muster', '2005-01-01', $2, 'Jugendamt') RETURNING id`,
        [mandantAId, `TT1-${suffix}`]
      )
    ).rows[0].id;
    await legeKlientZugangAn(admin, { mandantId: mandantAId, klientId, email: `klient-${suffix}@beispiel.test`, passwortHash: hash, eingeladenVon: leitungId });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = async (slug: string, kurz: string) =>
      (await request(http()).post("/auth/login").send({ mandantSlug: slug, email: `${kurz}-${suffix}@beispiel.test`, passwort })).body.accessToken as string;
    tokenLeitung = await login(slugA, "leitung");
    tokenBetreuer = await login(slugA, "betreuer");
    tokenLeitungB = await login(slugB, "leitung-b");
    tokenKlient = await klientToken(app, slugA, `klient-${suffix}@beispiel.test`, passwort);
  });

  afterAll(async () => {
    try {
      const ids = [mandantAId, mandantBId];
      await admin.query("DELETE FROM termin_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM termin WHERE mandant_id = ANY($1)", [ids]);
      await raeumeKontoMitRolleAuf(admin, mandantAId);
      await raeumeKontoMitRolleAuf(admin, mandantBId);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      // termin_typ verschwindet per ON DELETE CASCADE mit dem Traeger -- auch
      // der Standardtyp (der Trigger laesst das nur in diesem Fall zu).
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
      const rest = await admin.query("SELECT count(*)::int AS n FROM termin_typ WHERE mandant_id = ANY($1)", [ids]);
      expect(rest.rows[0].n).toBe(0);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("neuer Traeger startet mit Termin (Standard), Klient:innentermin, Besprechung", async () => {
    const typen = await typenVon(tokenBetreuer);
    expect(typen.map((t) => [t.bezeichnung, t.farbe, t.istStandard, t.aktiv])).toEqual([
      ["Termin", "grau", true, true],
      ["Klient:innentermin", "gruen", false, true],
      ["Besprechung", "petrol", false, true],
    ]);
  });

  it("Verwalten nur mit kalender.typen-verwalten; Lesen darf jede:r Mitarbeitende", async () => {
    expect((await als(tokenBetreuer).post("/kalender/typen", { bezeichnung: "X", farbe: "blau", betreuungszeit: "voreinstellung", leistungsart: null })).status).toBe(403);
    const standard = (await typenVon(tokenBetreuer))[0];
    expect((await als(tokenBetreuer).patch(`/kalender/typen/${standard.id}`, { farbe: "blau" })).status).toBe(403);
    // Klient-Token gilt hier gar nicht als Anmeldung (@Authenticated, nur Mitarbeitende).
    expect((await als(tokenKlient).get("/kalender/typen")).status).toBe(401);
    expect((await als(tokenLeitung).get("/mandant/me/einstellungen-rechte")).body.termintypen).toBe(true);
    expect((await als(tokenBetreuer).get("/mandant/me/einstellungen-rechte")).body.termintypen).toBe(false);
  });

  let hausbesuchId: string;

  it("anlegen: ans Ende, eindeutig ohne Gross/klein, nur feste Farben", async () => {
    const r = await als(tokenLeitung).post("/kalender/typen", {
      bezeichnung: "  Hausbesuch ",
      farbe: "orange",
      betreuungszeit: "vorbelegen",
      leistungsart: "einzelbetreuung",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ bezeichnung: "Hausbesuch", farbe: "orange", betreuungszeit: "vorbelegen", leistungsart: "einzelbetreuung", reihenfolge: 3, aktiv: true, istStandard: false });
    hausbesuchId = r.body.id;

    expect((await als(tokenLeitung).post("/kalender/typen", { bezeichnung: "hausbesuch", farbe: "blau", betreuungszeit: "voreinstellung", leistungsart: null })).status).toBe(409);
    // Rot gehoert "krank" -- eine Abwesenheit darf nie wie ein Termin aussehen.
    expect((await als(tokenLeitung).post("/kalender/typen", { bezeichnung: "Rot", farbe: "rot", betreuungszeit: "voreinstellung", leistungsart: null })).status).toBe(400);
    expect((await als(tokenLeitung).post("/kalender/typen", { bezeichnung: "", farbe: "blau", betreuungszeit: "voreinstellung", leistungsart: null })).status).toBe(400);
  });

  it("Termin ohne Typ bekommt den Standardtyp, mit Typ dessen Leistungsart als Kopie", async () => {
    const ohne = await als(tokenLeitung).post("/kalender/termine", termin());
    expect(ohne.status).toBe(201);
    expect(ohne.body.typ).toMatchObject({ bezeichnung: "Termin", farbe: "grau", istStandard: true });
    expect(ohne.body.stundenLeistungsart).toBeNull();

    const mit = await als(tokenLeitung).post("/kalender/termine", termin({ typId: hausbesuchId }));
    expect(mit.status).toBe(201);
    expect(mit.body.typ).toEqual({ id: hausbesuchId, bezeichnung: "Hausbesuch", farbe: "orange", istStandard: false });
    expect(mit.body.stundenLeistungsart).toBe("einzelbetreuung");

    // Typ aendern: der bestehende Termin behaelt seine Leistungsart (sonst
    // wuerden gebuchte Kalenderstunden nachtraeglich umgebucht).
    expect((await als(tokenLeitung).patch(`/kalender/typen/${hausbesuchId}`, { leistungsart: "begleitung", farbe: "rose" })).status).toBe(200);
    const spaeter = await als(tokenLeitung).get(`/kalender/termine/${mit.body.id}`);
    expect(spaeter.body.stundenLeistungsart).toBe("einzelbetreuung");
    expect(spaeter.body.typ.farbe).toBe("rose");

    // Wechsel des Typs uebernimmt dessen Leistungsart, wenn keine eigene mitkommt.
    const besprechung = (await typenVon(tokenLeitung)).find((t) => t.bezeichnung === "Besprechung")!;
    const wechsel = await als(tokenLeitung).patch(`/kalender/termine/${ohne.body.id}`, { typId: hausbesuchId });
    expect(wechsel.body.typ.id).toBe(hausbesuchId);
    expect(wechsel.body.stundenLeistungsart).toBe("begleitung");
    const zurueck = await als(tokenLeitung).patch(`/kalender/termine/${ohne.body.id}`, { typId: besprechung.id, stundenLeistungsart: "beratung" });
    expect(zurueck.body.stundenLeistungsart).toBe("beratung");
  });

  it("Klient:innen waehlen keinen Typ: ihr Termin bekommt immer den Standardtyp", async () => {
    const r = await als(tokenKlient).post("/kalender/termine", termin({ typId: hausbesuchId }));
    expect(r.status).toBe(201);
    expect(r.body.typ.istStandard).toBe(true);
  });

  it("ausblenden: bestehende Termine behalten den Typ, neu waehlen geht nicht", async () => {
    const t = await als(tokenLeitung).post("/kalender/termine", termin({ typId: hausbesuchId }));
    expect((await als(tokenLeitung).patch(`/kalender/typen/${hausbesuchId}`, { aktiv: false })).body.aktiv).toBe(false);

    const neu = await als(tokenLeitung).post("/kalender/termine", termin({ typId: hausbesuchId }));
    expect(neu.status).toBe(400);
    expect(neu.body.message).toContain("ausgeblendet");

    // Der alte Termin bleibt bearbeitbar und behaelt seinen Typ.
    const bearbeitet = await als(tokenLeitung).patch(`/kalender/termine/${t.body.id}`, { titel: "Besuch (verschoben)", typId: hausbesuchId });
    expect(bearbeitet.status).toBe(200);
    expect(bearbeitet.body.typ.id).toBe(hausbesuchId);

    expect((await als(tokenLeitung).patch(`/kalender/typen/${hausbesuchId}`, { aktiv: true })).body.aktiv).toBe(true);
  });

  it("Standardtyp: umbenennbar, aber nicht ausblendbar und nicht loeschbar", async () => {
    const standard = (await typenVon(tokenLeitung)).find((t) => t.istStandard)!;
    expect((await als(tokenLeitung).patch(`/kalender/typen/${standard.id}`, { aktiv: false })).status).toBe(400);
    expect((await als(tokenLeitung).delete(`/kalender/typen/${standard.id}`)).status).toBe(400);
    expect((await als(tokenLeitung).patch(`/kalender/typen/${standard.id}`, { bezeichnung: "Allgemein" })).body.bezeichnung).toBe("Allgemein");
    // Auch an der Anwendung vorbei haelt die Datenbank den Standardtyp fest.
    await expect(admin.query("UPDATE termin_typ SET aktiv = false WHERE id = $1", [standard.id])).rejects.toThrow(/check/i);
    await expect(admin.query("DELETE FROM termin_typ WHERE id = $1", [standard.id])).rejects.toThrow(/Standardtyp/);
  });

  it("loeschen: benutzt -> 409 (ausblenden empfohlen), unbenutzt -> weg", async () => {
    const benutzt = await als(tokenLeitung).delete(`/kalender/typen/${hausbesuchId}`);
    expect(benutzt.status).toBe(409);
    expect(benutzt.body.message).toContain("Blende ihn stattdessen aus");

    const tippfehler = await als(tokenLeitung).post("/kalender/typen", { bezeichnung: "Hausbsuch", farbe: "sand", betreuungszeit: "voreinstellung", leistungsart: null });
    expect((await als(tokenLeitung).delete(`/kalender/typen/${tippfehler.body.id}`)).status).toBe(204);
    expect((await typenVon(tokenLeitung)).some((t) => t.id === tippfehler.body.id)).toBe(false);
  });

  it("Reihenfolge: nur vollstaendig, dann so auch in der Liste", async () => {
    const ids = (await typenVon(tokenLeitung)).map((t) => t.id as string);
    const umgedreht = [...ids].reverse();
    const r = await als(tokenLeitung).put("/kalender/typen/reihenfolge", { ids: umgedreht });
    expect(r.status).toBe(200);
    expect(r.body.map((t: { id: string }) => t.id)).toEqual(umgedreht);
    expect((await als(tokenLeitung).put("/kalender/typen/reihenfolge", { ids: umgedreht.slice(1) })).status).toBe(400);
    expect((await als(tokenLeitung).put("/kalender/typen/reihenfolge", { ids: [...umgedreht.slice(1), umgedreht[1]] })).status).toBe(400);
  });

  it("Traegertrennung: fremde Typen unsichtbar, nicht waehlbar, nicht aenderbar", async () => {
    const typenB = await typenVon(tokenLeitungB);
    expect(typenB.map((t) => t.bezeichnung)).toEqual(["Termin", "Klient:innentermin", "Besprechung"]);
    expect(typenB.some((t) => t.id === hausbesuchId)).toBe(false);

    expect((await als(tokenLeitungB).post("/kalender/termine", termin({ typId: hausbesuchId }))).status).toBe(400);
    expect((await als(tokenLeitungB).patch(`/kalender/typen/${hausbesuchId}`, { bezeichnung: "Gekapert" })).status).toBe(404);
    expect((await als(tokenLeitungB).delete(`/kalender/typen/${hausbesuchId}`)).status).toBe(404);

    // Zusammengesetzter Fremdschluessel (Regel 1): selbst an RLS vorbei
    // (Admin-Verbindung) kann ein Termin von B nicht auf einen Typ von A zeigen.
    const leitungB = (await admin.query("SELECT id FROM benutzer WHERE mandant_id = $1 LIMIT 1", [mandantBId])).rows[0].id;
    await expect(
      admin.query(
        `INSERT INTO termin (mandant_id, titel, beginn, ende, erstellt_von_benutzer_id, typ_id)
         VALUES ($1, 'x', now(), now() + interval '1 hour', $2, $3)`,
        [mandantBId, leitungB, hausbesuchId]
      )
    ).rejects.toThrow(/termin_typ_fk/);
  });

  it("RLS: die App-Rolle sieht in termin_typ nur den eigenen Traeger", async () => {
    const app_ = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app_.connect();
    try {
      await app_.query("BEGIN");
      await app_.query("SELECT set_config('app.mandant_id', $1, true)", [mandantBId]);
      const { rows } = await app_.query<{ mandant_id: string }>("SELECT DISTINCT mandant_id FROM termin_typ");
      expect(rows).toEqual([{ mandant_id: mandantBId }]);
      // Spaltenscharfes UPDATE (Regel 3): ist_standard ist nach dem Anlegen fest.
      await expect(app_.query("UPDATE termin_typ SET ist_standard = true")).rejects.toThrow(/permission denied/);
    } finally {
      await app_.query("ROLLBACK").catch(() => {});
      await app_.end();
    }
  });
});
