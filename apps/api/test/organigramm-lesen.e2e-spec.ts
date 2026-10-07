/**
 * Lesende Organigramm-Endpunkte (Organigramm-Plan, Lieferreihenfolge
 * Schritt 6): GET /organigramm/org-units, /organigramm/positions,
 * /organigramm/account-typen. Alle drei nur ueber @ErfordertRecht(
 * "organigramm", "ansehen") erreichbar; die Personendaten-Redaktion in
 * /organigramm/positions (CLAUDE.md Regel 6) haengt zusaetzlich an
 * organigramm.personendaten-sehen.
 *
 * Wie rechte-engine.e2e-spec.ts: account_typ/account_typ_recht/
 * org_position/org_position_besetzung werden DIREKT per SQL aufgebaut,
 * nicht ueber benutzer.rolle -- rollen-mapping.ts (Schritt 3) kennt
 * organigramm.* fuer einrichtungsleitung/mitarbeiter noch nicht (bewusste,
 * noch ausstehende Einschraenkung, kein Bug dieses Schritts). Heute sieht
 * praktisch nur ein ist_vollzugriff=true-Konto (Geschaeftsfuehrung-Wildcard)
 * diese Endpunkte -- genau das bildet der erste Testfall unten ab.
 *
 * Login laeuft ueber HTTP (volles AppModule), nicht ueber einen direkten
 * Service-Aufruf -- damit @Authenticated()/@ErfordertRecht() tatsaechlich
 * end-to-end geprueft sind (401/403 inklusive), nicht nur die Rechte-Engine
 * selbst (die deckt rechte-engine.e2e-spec.ts bereits ab).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Organigramm: lesende Endpunkte", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let traegerId: string;
  let einrichtungId: string;

  let posMitNamenId: string;
  let posOhneNamenId: string;
  let posVakantId: string;

  let benMitNamenName: string;

  let tokenGf: string;
  let tokenMitNamen: string;
  let tokenOhneNamen: string;
  let tokenOhneZugriff: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-organigramm-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Organigramm ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    const { rows: standortRows } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus A', 'Teststr. 1') RETURNING id",
      [mandantId]
    );
    const { rows: einrichtungRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'einrichtung' AND standort_id = $2",
      [mandantId, standortRows[0].id]
    );
    einrichtungId = einrichtungRows[0].id;

    async function neuerAccountTyp(name: string, opts: { istVollzugriff?: boolean } = {}): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ (mandant_id, name, ist_vollzugriff) VALUES ($1, $2, $3) RETURNING id`,
        [mandantId, name, opts.istVollzugriff ?? false]
      );
      return rows[0].id;
    }
    async function recht(accountTypId: string, aktion: string) {
      await admin.query(
        `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
         VALUES ($1, $2, 'organigramm', $3, 'tenant', true)`,
        [mandantId, accountTypId, aktion]
      );
    }

    const gfTypId = await neuerAccountTyp("Geschäftsführung", { istVollzugriff: true });
    const mitNamenTypId = await neuerAccountTyp("Leitung mit Personendaten");
    await recht(mitNamenTypId, "ansehen");
    await recht(mitNamenTypId, "personendaten-sehen");
    const ohneNamenTypId = await neuerAccountTyp("Leitung ohne Personendaten");
    await recht(ohneNamenTypId, "ansehen");
    // ohneZugriffTypId bekommt bewusst KEIN organigramm.ansehen -- impliziter
    // Deny, soll 403 auf alle drei Endpunkte liefern.
    const ohneZugriffTypId = await neuerAccountTyp("Ohne Organigramm-Recht");

    async function neuePosition(titel: string, accountTypId: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, traegerId, titel, accountTypId]
      );
      return rows[0].id;
    }

    const posGfId = await neuePosition("Geschäftsführung", gfTypId);
    posMitNamenId = await neuePosition("Leitung mit Personendaten", mitNamenTypId);
    posOhneNamenId = await neuePosition("Leitung ohne Personendaten", ohneNamenTypId);
    // posVakant bleibt absichtlich unbesetzt -- Beleg fuer "leeres Array = vakant".
    posVakantId = await neuePosition("Vakante Stabsstelle", ohneNamenTypId);
    const posOhneZugriffId = await neuePosition("Ohne Organigramm-Recht", ohneZugriffTypId);

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string; name: string }> {
      const email = `${label}-${suffix}@organigramm-check.test`;
      const name = `Testperson ${label}`;
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, 'betreuer') RETURNING id`,
        [mandantId, email, name, passwortHash]
      );
      return { id: rows[0].id, email, name };
    }
    async function zuweisen(positionId: string, benutzerId: string) {
      await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
        mandantId,
        positionId,
        benutzerId,
      ]);
    }

    const benGf = await neuerBenutzer("gf");
    const benMitNamen = await neuerBenutzer("mitNamen");
    benMitNamenName = benMitNamen.name;
    const benOhneNamen = await neuerBenutzer("ohneNamen");
    const benOhneZugriff = await neuerBenutzer("ohneZugriff");

    await zuweisen(posGfId, benGf.id);
    await zuweisen(posMitNamenId, benMitNamen.id);
    await zuweisen(posOhneNamenId, benOhneNamen.id);
    await zuweisen(posOhneZugriffId, benOhneZugriff.id);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenGf = await login(benGf.email);
    tokenMitNamen = await login(benMitNamen.email);
    tokenOhneNamen = await login(benOhneNamen.email);
    tokenOhneZugriff = await login(benOhneZugriff.email);
  });

  afterAll(async () => {
    // posGf (ist_vollzugriff) ist die einzige Vollzugriff-Position dieses
    // Testmandanten -- siehe rechte-engine.e2e-spec.ts fuer die Begruendung,
    // warum der Schutztrigger hier kurz deaktiviert werden muss.
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  function als(token: string) {
    return (path: string) => request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`);
  }

  describe("GET /organigramm/org-units", () => {
    it("Geschäftsführung (Vollzugriff-Wildcard) sieht Traeger und Einrichtung flach, inkl. parentId-Verknuepfung", async () => {
      const res = await als(tokenGf)("/organigramm/org-units");
      expect(res.status).toBe(200);
      const traeger = res.body.find((u: any) => u.id === traegerId);
      const einrichtung = res.body.find((u: any) => u.id === einrichtungId);
      expect(traeger).toMatchObject({ id: traegerId, parentId: null, typ: "traeger", standortId: null, aktiv: true });
      expect(einrichtung).toMatchObject({ id: einrichtungId, parentId: traegerId, typ: "einrichtung" });
      expect(typeof einrichtung.standortId).toBe("string");
    });

    it("ohne organigramm.ansehen -> 403", async () => {
      const res = await als(tokenOhneZugriff)("/organigramm/org-units");
      expect(res.status).toBe(403);
    });

    it("ohne Token -> 401", async () => {
      const res = await request(app.getHttpServer()).get("/organigramm/org-units");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /organigramm/positions", () => {
    it("mit organigramm.personendaten-sehen: besetztMit zeigt den echten Namen", async () => {
      const res = await als(tokenMitNamen)("/organigramm/positions");
      expect(res.status).toBe(200);
      const position = res.body.find((p: any) => p.id === posMitNamenId);
      expect(position.besetztMit).toEqual([{ benutzerId: expect.any(String), benutzerName: benMitNamenName }]);
    });

    it("ohne organigramm.personendaten-sehen: dieselbe Position zeigt benutzerId/benutzerName als null, aber die Besetzung bleibt als Eintrag sichtbar", async () => {
      const res = await als(tokenOhneNamen)("/organigramm/positions");
      expect(res.status).toBe(200);
      const position = res.body.find((p: any) => p.id === posMitNamenId);
      // Gegenprobe gegen die zuvor sichtbaren echten Daten: ohne das Recht
      // wird redigiert, nicht einfach dieselbe Antwort erneut geliefert.
      expect(position.besetztMit).toEqual([{ benutzerId: null, benutzerName: null }]);
    });

    it("eine unbesetzte Position liefert ein leeres besetztMit-Array (vakant), fuer beide Sichten gleich", async () => {
      const mitNamen = await als(tokenMitNamen)("/organigramm/positions");
      const ohneNamen = await als(tokenOhneNamen)("/organigramm/positions");
      expect(mitNamen.body.find((p: any) => p.id === posVakantId).besetztMit).toEqual([]);
      expect(ohneNamen.body.find((p: any) => p.id === posVakantId).besetztMit).toEqual([]);
    });

    it("liefert die uebrigen Positions-Felder unveraendert, unabhaengig vom Personendaten-Recht", async () => {
      const res = await als(tokenOhneNamen)("/organigramm/positions");
      const position = res.body.find((p: any) => p.id === posOhneNamenId);
      expect(position).toMatchObject({
        id: posOhneNamenId,
        orgUnitId: traegerId,
        parentPositionId: null,
        titel: "Leitung ohne Personendaten",
        typ: "linie",
        istGeplant: false,
        aktiv: true,
        sollBesetzung: 1,
      });
      expect(typeof position.accountTypId).toBe("string");
      expect(typeof position.gueltigAb).toBe("string");
    });

    it("ohne organigramm.ansehen -> 403", async () => {
      const res = await als(tokenOhneZugriff)("/organigramm/positions");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /organigramm/account-typen", () => {
    it("liefert jeden Account-Typ mit seiner Rechte-Matrix; Vollzugriff-Typen haben eine leere Matrix", async () => {
      const res = await als(tokenGf)("/organigramm/account-typen");
      expect(res.status).toBe(200);

      const gf = res.body.find((a: any) => a.name === "Geschäftsführung");
      expect(gf.istVollzugriff).toBe(true);
      expect(gf.rechte).toEqual([]);

      const mitNamen = res.body.find((a: any) => a.name === "Leitung mit Personendaten");
      expect(mitNamen.istVollzugriff).toBe(false);
      expect(mitNamen.rechte).toEqual(
        expect.arrayContaining([
          { modul: "organigramm", aktion: "ansehen", scope: "tenant", erlaubt: true },
          { modul: "organigramm", aktion: "personendaten-sehen", scope: "tenant", erlaubt: true },
        ])
      );
      expect(mitNamen.rechte).toHaveLength(2);
    });

    it("ohne organigramm.ansehen -> 403", async () => {
      const res = await als(tokenOhneZugriff)("/organigramm/account-typen");
      expect(res.status).toBe(403);
    });
  });
});
