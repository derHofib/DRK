/**
 * Stunden aus Kalenderterminen (Migration 0080, Konzept
 * stunden-kalender/konzept-stunden-aus-kalender.md): Vormerkung, Buchung nach
 * Terminende, automatisches Storno + Neubuchung bei Aenderung, keine
 * Fremdbuchung durch Einladung, Sichtbarkeit, Mandantentrennung und
 * Unveraenderlichkeit in der Datenbank.
 *
 * Gegen echte PostgreSQL; die Datenbank-Tests laufen als zimmerakte_app, weil
 * nur diese Rolle zeigt, ob GRANTs und der zusammengesetzte FK greifen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { legeKlientZugangAn } from "./support/klient-zugang";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

const berlinTag = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

describe("Stunden aus dem Kalender", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let mandantA: string;
  let mandantB: string;
  let slugA: string;
  let slugB: string;
  let k1: string;
  let k2: string;
  let kB: string;
  let leitungId: string;
  let ma1Id: string;
  let ma2Id: string;
  let tokenLeitung: string;
  let tokenMa1: string;
  let tokenMa2: string;
  let tokenB: string;

  // 12:00 UTC ist in Berlin 13 oder 14 Uhr -- weit weg von Mitternacht, in
  // Sommer- wie Winterzeit. Zwei bzw. drei Tage zurueck, damit "gestern"
  // auch um kurz nach Mitternacht noch in der Vergangenheit liegt.
  const tagVor = (tage: number) => berlinTag(new Date(Date.now() - tage * 86_400_000));
  const um = (tag: string, stundeUtc: number, minute = 0) =>
    new Date(`${tag}T${String(stundeUtc).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`).toISOString();

  const http = () => app.getHttpServer();
  const get = (token: string, pfad: string) => request(http()).get(pfad).set("Authorization", `Bearer ${token}`);
  const post = (token: string, pfad: string, body: object = {}) => request(http()).post(pfad).set("Authorization", `Bearer ${token}`).send(body);
  const patch = (token: string, pfad: string, body: object) => request(http()).patch(pfad).set("Authorization", `Bearer ${token}`).send(body);
  const put = (token: string, pfad: string, body: object) => request(http()).put(pfad).set("Authorization", `Bearer ${token}`).send(body);

  async function termin(token: string, body: Record<string, unknown>): Promise<string> {
    const tag = tagVor(2);
    const r = await post(token, "/kalender/termine", {
      titel: "Begleitung zum Hausarzt",
      beginn: um(tag, 12),
      ende: um(tag, 13, 30),
      teilnehmer: [{ klientId: k1 }],
      stundenErfassen: true,
      ...body,
    });
    if (r.status !== 201) throw new Error(`Termin anlegen: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.id;
  }

  const buchungenZu = async (terminId: string) =>
    (
      await admin.query(
        `SELECT mitarbeiter_id, klient_id, datum::text, minuten, leistungsart, notiz, gebucht_von, storniert, storno_grund, storno_automatisch
         FROM stundenbuchung WHERE termin_id = $1 ORDER BY erstellt_am, klient_id`,
        [terminId]
      )
    ).rows;

  async function alsApp<T>(mandantId: string, benutzerId: string, f: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await c.query("SELECT set_config('app.benutzer_id', $1, true)", [benutzerId]);
      await c.query("SELECT set_config('app.klient_id', '', true)");
      return await f(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.end();
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    slugA = `test-stk-a-${suffix}`;
    slugB = `test-stk-b-${suffix}`;
    mandantA = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`STK A ${suffix}`, slugA])).rows[0].id;
    mandantB = (await admin.query("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`STK B ${suffix}`, slugB])).rows[0].id;
    const hash = await bcrypt.hash(passwort, 4);
    const email = (k: string) => `${k}-${suffix}@beispiel.test`;
    leitungId = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "einrichtungsleitung", email: email("leitung"), name: "Leitung", passwortHash: hash });
    ma1Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: email("ma1"), name: "Anna Keller", passwortHash: hash });
    ma2Id = await kontoMitAlterRolle(admin, { mandantId: mandantA, rolle: "betreuer", email: email("ma2"), name: "Tobias Wendt", passwortHash: hash });
    const leitungB = await kontoMitAlterRolle(admin, { mandantId: mandantB, rolle: "einrichtungsleitung", email: email("b"), name: "Leitung B", passwortHash: hash });

    const klient = async (m: string, vorname: string, az: string) =>
      (
        await admin.query(
          `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
           VALUES ($1, $2, 'Becker', '1990-01-01', $3, 'Amt') RETURNING id`,
          [m, vorname, `${az}-${suffix}`]
        )
      ).rows[0].id as string;
    k1 = await klient(mandantA, "Jonas", "STK1");
    k2 = await klient(mandantA, "Mira", "STK2");
    kB = await klient(mandantB, "Fremd", "STKB");
    for (const [m, k, kurz, von] of [
      [mandantA, k1, "k1", leitungId],
      [mandantA, k2, "k2", leitungId],
      [mandantB, kB, "kb", leitungB],
    ]) {
      await legeKlientZugangAn(admin, { mandantId: m, klientId: k, email: email(kurz), passwortHash: hash, eingeladenVon: von });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (slug: string, k: string) =>
      (await request(http()).post("/auth/login").send({ mandantSlug: slug, email: email(k), passwort })).body.accessToken as string;
    tokenLeitung = await login(slugA, "leitung");
    tokenMa1 = await login(slugA, "ma1");
    tokenMa2 = await login(slugA, "ma2");
    tokenB = await login(slugB, "b");
  });

  afterAll(async () => {
    try {
      const ids = [mandantA, mandantB];
      await admin.query("DELETE FROM stundenbuchung WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM abwesenheit WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM termin_teilnehmer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM termin WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mitarbeiter_profil WHERE mandant_id = ANY($1)", [ids]);
      await raeumeKontoMitRolleAuf(admin, mandantA);
      await raeumeKontoMitRolleAuf(admin, mandantB);
      await admin.query("DELETE FROM klient_zugang WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM klient WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = ANY($1)", [ids]);
      await admin.query("DELETE FROM mandant WHERE id = ANY($1)", [ids]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  describe("Buchen nach Terminende", () => {
    it("Vormerkung vor dem Ende bucht nichts und erscheint unter den Vormerkungen", async () => {
      const morgen = tagVor(-2);
      const id = await termin(tokenMa1, { titel: "Zukunft", beginn: um(morgen, 12), ende: um(morgen, 13) });
      expect((await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen")).status).toBe(200);
      expect(await buchungenZu(id)).toHaveLength(0);
      const v = await get(tokenMa1, "/stundenbuchungen/kalender/vormerkungen");
      expect(v.status).toBe(200);
      expect(v.body).toEqual(expect.arrayContaining([expect.objectContaining({ terminId: id, status: "geplant", minuten: 60, grund: null })]));
      const t = await get(tokenMa1, `/kalender/termine/${id}`);
      expect(t.body.stunden).toMatchObject({ vorgemerkt: true, hindernis: null, minuten: 60, buchungen: [] });
    });

    it("nach dem Ende: genau eine Buchung, Dauer = Termin, Tag = Berliner Tag des Beginns, Titel als Notiz", async () => {
      const id = await termin(tokenMa1, {});
      const liste = await get(tokenMa1, "/stundenbuchungen");
      expect(liste.status).toBe(200);
      const zeilen = await buchungenZu(id);
      expect(zeilen).toEqual([
        expect.objectContaining({
          mitarbeiter_id: ma1Id,
          gebucht_von: ma1Id,
          klient_id: k1,
          datum: tagVor(2),
          minuten: 90,
          leistungsart: "einzelbetreuung",
          notiz: "Begleitung zum Hausarzt",
          storniert: false,
        }),
      ]);
      const dto = liste.body.find((b: { terminId: string }) => b.terminId === id);
      expect(dto).toMatchObject({ terminTitel: "Begleitung zum Hausarzt", stornoAutomatisch: false, automatischNeuGebucht: false });
      // Erneutes Nachziehen aendert nichts.
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      expect(await buchungenZu(id)).toHaveLength(1);
    });

    it("zwei Klient:innen: je eine Buchung in voller Dauer, automatisch Gruppenangebot; gesetzte Leistung gilt", async () => {
      const gruppe = await termin(tokenMa1, { titel: "Kochgruppe", teilnehmer: [{ klientId: k1 }, { klientId: k2 }] });
      const begleitung = await termin(tokenMa1, { titel: "Bürgeramt", stundenLeistungsart: "begleitung" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      const g = await buchungenZu(gruppe);
      expect(g).toHaveLength(2);
      expect(g.every((z) => z.minuten === 90 && z.leistungsart === "gruppenangebot")).toBe(true);
      expect(new Set(g.map((z) => z.klient_id))).toEqual(new Set([k1, k2]));
      expect((await buchungenZu(begleitung))[0].leistungsart).toBe("begleitung");
    });

    it("zwei gleichzeitige Nachzieh-Aufrufe buchen nur einmal", async () => {
      const id = await termin(tokenMa1, { titel: "Parallel" });
      // Ueber die Datenbank angelegt waere sie schon gebucht -- deshalb erst
      // jetzt beide Aufrufe gleichzeitig loslassen.
      const antworten = await Promise.all([1, 2, 3].map(() => post(tokenMa1, "/stundenbuchungen/kalender/nachziehen")));
      expect(antworten.every((r) => r.status === 200)).toBe(true);
      expect(await buchungenZu(id)).toHaveLength(1);
    });
  });

  describe("Änderung nach der Buchung (Entscheidung: automatisch neu buchen)", () => {
    it("verlängert: alte Buchung automatisch storniert, neue mit neuer Dauer, beide sichtbar", async () => {
      const id = await termin(tokenMa1, { titel: "Verlängert" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      const tag = tagVor(2);
      const r = await patch(tokenMa1, `/kalender/termine/${id}`, { ende: um(tag, 14) });
      expect(r.status).toBe(200);
      const zeilen = await buchungenZu(id);
      expect(zeilen).toEqual([
        expect.objectContaining({ minuten: 90, storniert: true, storno_automatisch: true, storno_grund: "Termin nachträglich geändert" }),
        expect.objectContaining({ minuten: 120, storniert: false, storno_automatisch: false }),
      ]);
      expect(r.body.stunden.buchungen).toHaveLength(2);
      const liste = (await get(tokenMa1, "/stundenbuchungen")).body.filter((b: { terminId: string }) => b.terminId === id);
      expect(liste.find((b: { storniert: boolean }) => !b.storniert)).toMatchObject({ automatischNeuGebucht: true, minuten: 120 });
      expect(liste.find((b: { storniert: boolean }) => b.storniert)).toMatchObject({ stornoAutomatisch: true, stornierbar: false });
    });

    it("nur der Titel geändert: keine neue Buchung", async () => {
      const id = await termin(tokenMa1, { titel: "Titel alt" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      await patch(tokenMa1, `/kalender/termine/${id}`, { titel: "Titel neu" });
      expect(await buchungenZu(id)).toEqual([expect.objectContaining({ storniert: false, notiz: "Titel alt" })]);
    });

    it("abgesagt: automatisch storniert mit Grund „Termin abgesagt“, ohne Neubuchung", async () => {
      const id = await termin(tokenMa1, { titel: "Abgesagt" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      expect((await post(tokenMa1, `/kalender/termine/${id}/absagen`)).status).toBe(200);
      expect(await buchungenZu(id)).toEqual([expect.objectContaining({ storniert: true, storno_automatisch: true, storno_grund: "Termin abgesagt" })]);
    });

    it("von Hand storniert („fand nicht statt“): lebt nicht wieder auf, auch nicht nach einer Änderung", async () => {
      const id = await termin(tokenMa1, { titel: "Fand nicht statt" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      const buchungId = (await admin.query("SELECT id FROM stundenbuchung WHERE termin_id = $1", [id])).rows[0].id;
      expect((await post(tokenMa1, `/stundenbuchungen/${buchungId}/storno`, { grund: "Termin fand nicht statt" })).status).toBe(201);
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      await patch(tokenMa1, `/kalender/termine/${id}`, { ende: um(tagVor(2), 14) });
      expect(await buchungenZu(id)).toEqual([expect.objectContaining({ storniert: true, storno_automatisch: false })]);
    });

    it("Vormerkung zurückgenommen: gültige Buchung wird automatisch storniert", async () => {
      const id = await termin(tokenMa1, { titel: "Zurückgenommen" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      expect((await post(tokenMa1, `/kalender/termine/${id}/stunden`, { erfassen: false })).status).toBe(200);
      expect(await buchungenZu(id)).toEqual([expect.objectContaining({ storniert: true, storno_grund: "Vormerkung zurückgenommen" })]);
    });
  });

  describe("Jede Person bucht nur ihre eigene Zeit", () => {
    it("Einladung ohne eigenen Haken bucht der eingeladenen Person nichts; Zusagen mit Haken schon", async () => {
      const id = await termin(tokenMa1, { titel: "Mit Kollege", teilnehmer: [{ klientId: k1 }, { benutzerId: ma2Id }] });
      await post(tokenMa2, "/stundenbuchungen/kalender/nachziehen");
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      expect((await buchungenZu(id)).map((z) => z.mitarbeiter_id)).toEqual([ma1Id]);

      // Die Ersteller:in kann der Kollegin keine Vormerkung setzen: die Policy
      // laesst nur die eigene Teilnahmezeile zu.
      const fremd = await alsApp(mandantA, ma1Id, (c) =>
        c.query("UPDATE termin_teilnehmer SET stunden_erfassen = true WHERE termin_id = $1 AND benutzer_id = $2", [id, ma2Id])
      );
      expect(fremd.rowCount).toBe(0);

      const zusage = await post(tokenMa2, `/kalender/termine/${id}/antwort`, { antwort: "zugesagt", stundenErfassen: true });
      expect(zusage.status).toBe(200);
      expect(zusage.body.stunden.vorgemerkt).toBe(true);
      const zeilen = await buchungenZu(id);
      expect(zeilen.map((z) => z.mitarbeiter_id).sort()).toEqual([ma1Id, ma2Id].sort());
      expect(zeilen.find((z) => z.mitarbeiter_id === ma2Id)).toMatchObject({ gebucht_von: ma2Id });
    });

    it("Ablehnen nimmt die eigene Vormerkung zurück", async () => {
      const id = await termin(tokenMa1, { titel: "Ablehnen", teilnehmer: [{ klientId: k1 }, { benutzerId: ma2Id }] });
      await post(tokenMa2, `/kalender/termine/${id}/antwort`, { antwort: "zugesagt", stundenErfassen: true });
      await post(tokenMa2, `/kalender/termine/${id}/antwort`, { antwort: "abgelehnt" });
      const z = await buchungenZu(id);
      expect(z.filter((x) => x.mitarbeiter_id === ma2Id && !x.storniert)).toHaveLength(0);
    });
  });

  describe("Nicht buchbar", () => {
    it("ganztägig, ohne Klient:in und über Mitternacht: 400 beim Anlegen", async () => {
      const tag = tagVor(2);
      const basis = { titel: "x", stundenErfassen: true };
      const ganz = await post(tokenMa1, "/kalender/termine", { ...basis, ganztaegig: true, beginn: tag, ende: tag, teilnehmer: [{ klientId: k1 }] });
      expect(ganz.status).toBe(400);
      expect(ganz.body.message).toContain("Ganztägige");
      const ohne = await post(tokenMa1, "/kalender/termine", { ...basis, beginn: um(tag, 12), ende: um(tag, 13) });
      expect(ohne.status).toBe(400);
      const nacht = await post(tokenMa1, "/kalender/termine", { ...basis, beginn: um(tag, 21), ende: um(tagVor(1), 3), teilnehmer: [{ klientId: k1 }] });
      expect(nacht.status).toBe(400);
      expect(nacht.body.message).toContain("Mitternacht");
    });

    it("am Termintag selbst abwesend: nicht gebucht, Grund unter den Vormerkungen", async () => {
      const tag = tagVor(3);
      await admin.query(
        "INSERT INTO abwesenheit (mandant_id, benutzer_id, art, von, bis, eingetragen_von) VALUES ($1, $2, 'krank', $3, $3, $2)",
        [mandantA, ma1Id, tag]
      );
      const id = await termin(tokenMa1, { titel: "Krank", beginn: um(tag, 12), ende: um(tag, 13) });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      expect(await buchungenZu(id)).toHaveLength(0);
      const v = (await get(tokenMa1, "/stundenbuchungen/kalender/vormerkungen")).body.find((x: { terminId: string }) => x.terminId === id);
      expect(v).toMatchObject({ status: "nicht-gebucht", grund: "Nicht gebucht: an diesem Tag abwesend." });
    });

    it("Träger-Funktion aus: Haken 403, Nachziehen bucht nichts", async () => {
      expect((await put(tokenMa1, "/stundenbuchungen/kalender/traeger", { erlaubt: false, vorauswahl: true })).status).toBe(403);
      // Anlegen zieht nicht nach -- der Termin ist vorgemerkt, aber noch ungebucht.
      const id = await termin(tokenMa1, { titel: "Vor dem Abschalten" });
      expect((await put(tokenLeitung, "/stundenbuchungen/kalender/traeger", { erlaubt: false, vorauswahl: false })).status).toBe(200);
      try {
        const tag = tagVor(2);
        const r = await post(tokenMa1, "/kalender/termine", { titel: "aus", beginn: um(tag, 12), ende: um(tag, 13), teilnehmer: [{ klientId: k1 }], stundenErfassen: true });
        expect(r.status).toBe(403);
        await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
        expect(await buchungenZu(id)).toHaveLength(0);
        expect((await get(tokenMa1, "/mandant/me")).body).toMatchObject({ terminStundenErlaubt: false, terminStundenVorauswahl: false });
      } finally {
        await put(tokenLeitung, "/stundenbuchungen/kalender/traeger", { erlaubt: true, vorauswahl: true });
      }
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      expect(await buchungenZu(id)).toHaveLength(1);
    });
  });

  describe("Sichtbarkeit und Datenbank", () => {
    it("Leitung sieht Buchung und Herkunft, aber nicht den Termin (Titel null, Termin 404)", async () => {
      const id = await termin(tokenMa1, { titel: "Arzttermin vertraulich" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      const liste = await get(tokenLeitung, `/stundenbuchungen?herkunft=kalender&mitarbeiterId=${ma1Id}`);
      expect(liste.status).toBe(200);
      const zeile = liste.body.find((b: { terminId: string }) => b.terminId === id);
      expect(zeile).toMatchObject({ terminId: id, terminTitel: null });
      expect(liste.body.every((b: { terminId: string | null }) => b.terminId !== null)).toBe(true);
      expect((await get(tokenLeitung, `/kalender/termine/${id}`)).status).toBe(404);
      const manuell = await get(tokenLeitung, `/stundenbuchungen?herkunft=manuell&mitarbeiterId=${ma1Id}`);
      expect(manuell.body.every((b: { terminId: string | null }) => b.terminId === null)).toBe(true);
    });

    it("Saldo weist „davon aus Kalender“ aus; Doppelt-Hinweis bei Buchung von Hand am selben Tag", async () => {
      const tag = tagVor(4);
      const id = await termin(tokenMa1, { titel: "Doppelt", beginn: um(tag, 12), ende: um(tag, 13), teilnehmer: [{ klientId: k2 }] });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      const hand = await post(tokenMa1, "/stundenbuchungen", { klientId: k2, datum: tag, minuten: 30, leistungsart: "beratung" });
      expect(hand.status).toBe(201);
      const liste = (await get(tokenMa1, `/stundenbuchungen?von=${tag}&bis=${tag}&klientId=${k2}`)).body;
      expect(liste).toHaveLength(2);
      expect(liste.every((b: { moeglicherweiseDoppelt: boolean }) => b.moeglicherweiseDoppelt)).toBe(true);
      const summe = (await get(tokenMa1, `/stundenbuchungen/summen?von=${tag}&bis=${tag}&klientId=${k2}`)).body[0];
      expect(summe).toMatchObject({ minuten: 90, minutenKalender: 60 });
      expect(id).toBeTruthy();
    });

    it("termin_id ist nach dem Anlegen nicht änderbar (permission denied)", async () => {
      const id = await termin(tokenMa1, { titel: "Unveränderlich" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      await expect(
        alsApp(mandantA, ma1Id, (c) => c.query("UPDATE stundenbuchung SET termin_id = NULL WHERE termin_id = $1", [id]))
      ).rejects.toThrow(/permission denied/);
    });

    it("Mandantentrennung: Verweis auf den Termin eines anderen Trägers scheitert am zusammengesetzten FK", async () => {
      const tag = tagVor(2);
      const fremd = await post(tokenB, "/kalender/termine", { titel: "B", beginn: um(tag, 12), ende: um(tag, 13), teilnehmer: [{ klientId: kB }] });
      expect(fremd.status).toBe(201);
      await expect(
        alsApp(mandantA, ma1Id, (c) =>
          c.query(
            `INSERT INTO stundenbuchung (mandant_id, klient_id, mitarbeiter_id, datum, minuten, leistungsart, gebucht_von, termin_id)
             VALUES ($1, $2, $3, $4, 60, 'einzelbetreuung', $3, $5)`,
            [mandantA, k1, ma1Id, tag, fremd.body.id]
          )
        )
      ).rejects.toThrow(/stundenbuchung_termin_fk/);
    });

    it("automatisches Storno ist endgültig wie jedes andere (Trigger aus 0072)", async () => {
      const id = await termin(tokenMa1, { titel: "Endgültig" });
      await post(tokenMa1, "/stundenbuchungen/kalender/nachziehen");
      await post(tokenMa1, `/kalender/termine/${id}/absagen`);
      await expect(
        alsApp(mandantA, ma1Id, (c) => c.query("UPDATE stundenbuchung SET storno_automatisch = false WHERE termin_id = $1", [id]))
      ).rejects.toThrow(/stornierte Buchung/);
    });
  });

  describe("Voreinstellungen", () => {
    it("persönlich: Standard folgt dem Träger; eigene Wahl gilt, null folgt wieder dem Träger", async () => {
      const start = await get(tokenMa2, "/stundenbuchungen/kalender/einstellungen");
      expect(start.body).toMatchObject({ funktionAn: true, darfBuchen: true, darfTraegerAendern: false, eigeneVorauswahl: null, vorauswahl: true });
      const aus = await put(tokenMa2, "/stundenbuchungen/kalender/einstellungen", { vorauswahl: false, vorauswahlZusage: null });
      expect(aus.body).toMatchObject({ eigeneVorauswahl: false, vorauswahl: false, eigeneVorauswahlZusage: null, vorauswahlZusage: true });
      const zurueck = await put(tokenMa2, "/stundenbuchungen/kalender/einstellungen", { vorauswahl: null, vorauswahlZusage: null });
      expect(zurueck.body).toMatchObject({ eigeneVorauswahl: null, vorauswahl: true });
      expect((await put(tokenMa2, "/stundenbuchungen/kalender/einstellungen", { vorauswahl: "ja" })).status).toBe(400);
    });

    it("Leitung darf den Träger-Schalter ändern und sieht den Bereich", async () => {
      const r = await get(tokenLeitung, "/stundenbuchungen/kalender/einstellungen");
      expect(r.body.darfTraegerAendern).toBe(true);
      expect((await get(tokenLeitung, "/mandant/me/einstellungen-rechte")).body.stunden).toBe(true);
      expect((await get(tokenMa1, "/mandant/me/einstellungen-rechte")).body.stunden).toBe(false);
    });
  });
});
