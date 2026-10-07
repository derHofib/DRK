/**
 * GET /organigramm/export/pdf (Organigramm-Plan, Lieferreihenfolge Schritt
 * 7/UI, letzter Teilschritt "Tabellenansicht/Export"): liefert dieselben
 * (bereits redigierten) Organigramm-Daten wie die lesenden GET-Endpunkte,
 * nur als PDF statt JSON. Gated mit dem SCHWAECHEREN organigramm.ansehen,
 * nicht manage-permissions -- der Export zeigt keine zusaetzliche
 * Sensibilitaet gegenueber der Baumansicht.
 *
 * Fixture-Muster wie organigramm-lesen.e2e-spec.ts (account_typ/
 * org_position direkt per SQL, kein rollen-mapping.ts-Pfad -- dieselbe
 * bewusste, noch ausstehende Einschraenkung, kein Bug dieses Schritts).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Organigramm: GET /organigramm/export/pdf", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let traegerId: string;

  let tokenMitRecht: string;
  let tokenOhneRecht: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-organigramm-pdf-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Organigramm-PDF ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

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

    const mitRechtTypId = await neuerAccountTyp("Mit organigramm.ansehen");
    await recht(mitRechtTypId, "ansehen");
    // ohneRechtTypId bekommt bewusst KEIN organigramm.ansehen -- impliziter
    // Deny, soll 403 liefern.
    const ohneRechtTypId = await neuerAccountTyp("Ohne Organigramm-Recht");

    async function neuePosition(titel: string, accountTypId: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, traegerId, titel, accountTypId]
      );
      return rows[0].id;
    }
    const posMitRechtId = await neuePosition("Mit organigramm.ansehen", mitRechtTypId);
    const posOhneRechtId = await neuePosition("Ohne Organigramm-Recht", ohneRechtTypId);

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string }> {
      const email = `${label}-${suffix}@organigramm-pdf.test`;
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
         VALUES ($1, $2, $3, $4, 'betreuer') RETURNING id`,
        [mandantId, email, `Testperson ${label}`, passwortHash]
      );
      return { id: rows[0].id, email };
    }
    async function zuweisen(positionId: string, benutzerId: string) {
      await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
        mandantId,
        positionId,
        benutzerId,
      ]);
    }

    const benMitRecht = await neuerBenutzer("mitRecht");
    const benOhneRecht = await neuerBenutzer("ohneRecht");
    await zuweisen(posMitRechtId, benMitRecht.id);
    await zuweisen(posOhneRechtId, benOhneRecht.id);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenMitRecht = await login(benMitRecht.email);
    tokenOhneRecht = await login(benOhneRecht.email);
  });

  afterAll(async () => {
    // org_position_besetzung_vollzugriff_schutz feuert AFTER DELETE auf JEDE
    // Zeile dieser Tabelle (nicht nur Vollzugriff-Besetzungen) -- dieser
    // Testmandant hat gar keine Vollzugriff-Position, trotzdem muss der
    // Trigger fuers Aufraeumen kurz aus (Muster: organigramm-lesen.e2e-spec.ts).
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("mit organigramm.ansehen: 200, application/pdf, nicht-leerer Inhalt mit gueltigen PDF-Magic-Bytes", async () => {
    const res = await request(app.getHttpServer())
      .get("/organigramm/export/pdf")
      .set("Authorization", `Bearer ${tokenMitRecht}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const body = Buffer.from(res.body as Buffer);
    expect(body.length).toBeGreaterThan(0);
    // Magic-Bytes eines PDF-Dokuments ("%PDF-"), Muster: klient-archivierung.e2e-spec.ts.
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("ohne organigramm.ansehen -> 403", async () => {
    const res = await request(app.getHttpServer())
      .get("/organigramm/export/pdf")
      .set("Authorization", `Bearer ${tokenOhneRecht}`);
    expect(res.status).toBe(403);
  });

  it("ohne Token -> 401", async () => {
    const res = await request(app.getHttpServer()).get("/organigramm/export/pdf");
    expect(res.status).toBe(401);
  });
});
