/**
 * Externe Parteien (Organigramm-Plan, Schritt 9): das Schema dafuer existiert
 * bereits vollstaendig seit Schritt 1/2 (migrations/0041_account_typ.sql,
 * 0042_org_position.sql) -- dieser Schritt baut NICHTS Neues, er belegt nur,
 * dass die drei damals angelegten Invarianten tatsaechlich halten:
 *
 *   1. account_typ.kategorie='extern' kann nie ist_vollzugriff=true sein
 *      (CHECK account_typ_check).
 *   2. Ein extern-Account-Typ kann nur objektbezogenen Scope (assigned)
 *      mit erlaubt=true bekommen, nie 'tenant' oder einen anderen
 *      Org-Unit-Scope (Trigger account_typ_recht_pruefen).
 *   3. Aus Anwendersicht bleibt "assigned" rein objektbezogen: die
 *      Rechte-Engine (RechteService.ermittleErlaubteOrgUnitIds) liefert
 *      dafuer IMMER eine leere Liste, nie "alle" und keine konkrete
 *      Org-Unit-Id -- ein extern-Account-Typ ist also strukturell nie
 *      traegerweit sichtbar, selbst wenn hatRecht() fuer dieselbe
 *      (modul,aktion)-Kombination true liefert.
 *
 * Kein bestehender Endpunkt ruft heute ermittleErlaubteOrgUnitIds() auf
 * (verifiziert: weder organigramm.service.ts noch irgendein anderer Service
 * nutzt diese Methode -- alle @ErfordertRecht()/hatRecht()-Stellen sind
 * reine Ja/Nein-Pruefungen, siehe rechte.decorator.ts: "Noch nicht an einem
 * echten Endpunkt im Einsatz"). Punkt 3 oben ist deshalb NICHT ueber einen
 * HTTP-Endpunkt nachweisbar, der speziell danach filtert -- stattdessen:
 * echtes HTTP-Login ueber das volle AppModule (wie in
 * organigramm-lesen.e2e-spec.ts), um zu belegen, dass ein extern-Konto
 * ganz regulaer durch @Authenticated() kommt, und direkter Zugriff auf
 * RechteService (aus demselben AppModule-Container geholt, kein zweites
 * Testing-Modul noetig -- RechteModule wird von AppModule importiert und
 * exportiert RechteService) fuer die Scope-Aufloesung selbst, genau das in
 * rechte-engine.e2e-spec.ts etablierte Muster fuer "Subjekt-Typ extern".
 *
 * Laeuft gegen eine echte PostgreSQL-Instanz mit angewendeten Migrationen
 * (kein Mock) -- CHECK-Constraints, Trigger und RLS lassen sich nicht
 * sinnvoll mocken.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { RechteService } from "../src/rechte/rechte.service";
import { tenantContextStorage } from "../src/common/tenant-context";

function alsBenutzer<T>(mandantId: string, benutzerId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ mandantId, benutzerId, rolle: "betreuer" }, fn);
}

describe("Externe Parteien: Schema-Invarianten (Organigramm-Modul, Schritt 9)", () => {
  let app: INestApplication;
  let admin: Client;
  let rechte: RechteService;

  let mandantId: string;
  let mandantSlug: string;
  let traegerId: string;

  // Account-Typ mit genau einer erlaubten (modul,aktion)-Zeile, Scope 'assigned'.
  let externAssignedTypId: string;
  let posAssignedId: string;
  let benAssignedId: string;
  let benAssignedEmail: string;

  // Account-Typ ganz ohne jede account_typ_recht-Zeile (impliziter Deny).
  let externLeerTypId: string;
  let posLeerId: string;
  let benLeerEmail: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `extern-check-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Externe-Parteien-Check ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    const { rows: assignedTypRows } = await admin.query<{ id: string }>(
      `INSERT INTO account_typ (mandant_id, name, kategorie) VALUES ($1, 'Kostentraeger (assigned)', 'extern') RETURNING id`,
      [mandantId]
    );
    externAssignedTypId = assignedTypRows[0].id;
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'klienten', 'lesen-akte', 'assigned', true)`,
      [mandantId, externAssignedTypId]
    );

    const { rows: leerTypRows } = await admin.query<{ id: string }>(
      `INSERT INTO account_typ (mandant_id, name, kategorie) VALUES ($1, 'Externer Zugang ohne Rechte', 'extern') RETURNING id`,
      [mandantId]
    );
    externLeerTypId = leerTypRows[0].id;
    // Bewusst KEINE account_typ_recht-Zeile fuer externLeerTypId -- das IST
    // der Testfall (impliziter Default-Deny).

    const { rows: posAssignedRows } = await admin.query<{ id: string }>(
      `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, 'Kostentraeger-Zugang', $3) RETURNING id`,
      [mandantId, traegerId, externAssignedTypId]
    );
    posAssignedId = posAssignedRows[0].id;

    const { rows: posLeerRows } = await admin.query<{ id: string }>(
      `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, 'Externer Zugang ohne Rechte', $3) RETURNING id`,
      [mandantId, traegerId, externLeerTypId]
    );
    posLeerId = posLeerRows[0].id;

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string }> {
      const email = `${label}-${suffix}@extern-check.test`;
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

    const benAssigned = await neuerBenutzer("assigned");
    benAssignedId = benAssigned.id;
    benAssignedEmail = benAssigned.email;
    const benLeer = await neuerBenutzer("leer");
    benLeerEmail = benLeer.email;

    await zuweisen(posAssignedId, benAssignedId);
    await zuweisen(posLeerId, benLeer.id);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // RechteModule wird von AppModule importiert und exportiert RechteService
    // (rechte.module.ts) -- kein zweites, schlankeres Testing-Modul noetig,
    // wie es rechte-engine.e2e-spec.ts (ohne HTTP) verwendet.
    rechte = app.get(RechteService);
  });

  afterAll(async () => {
    // Dieser Testmandant hat NIE eine ist_vollzugriff=true-Position (beide
    // Account-Typen hier sind kategorie=extern, koennen das per CHECK gar
    // nicht sein) -- org_vollzugriff_anzahl() liefert fuer ihn also immer 0,
    // und der Schutztrigger (0042_org_position.sql) feuert deshalb schon
    // beim Loeschen IRGENDEINER org_position_besetzung-Zeile, nicht nur
    // einer tatsaechlichen Vollzugriff-Zeile. Gleiches Vorgehen wie in
    // rollen-migration-abgleich.e2e-spec.ts (das Fixture dort hat ebenfalls
    // keine Vollzugriff-Position): kurz deaktivieren, danach wieder aktivieren.
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

  describe("CHECK-Invariante: ist_vollzugriff erfordert kategorie=intern (migrations/0041_account_typ.sql)", () => {
    it("ein roher INSERT mit kategorie='extern' UND ist_vollzugriff=true wird von der DB abgelehnt (23514, check_violation)", async () => {
      let fehler: any;
      try {
        await admin.query(
          `INSERT INTO account_typ (mandant_id, name, kategorie, ist_vollzugriff) VALUES ($1, $2, 'extern', true)`,
          [mandantId, `Verbotener-Vollzugriff-${randomUUID().slice(0, 8)}`]
        );
      } catch (e) {
        fehler = e;
      }
      expect(fehler).toBeDefined();
      expect(fehler.code).toBe("23514");
      expect(fehler.constraint).toBe("account_typ_check");
    });
  });

  describe("Trigger-Invariante: extern erhaelt nur Scope 'assigned' (account_typ_recht_pruefen)", () => {
    it("Gegenprobe: scope='tenant' schlaegt fehl, scope='assigned' gelingt -- fuer DASSELBE (modul,aktion)-Paar an DEMSELBEN extern-Typ", async () => {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ (mandant_id, name, kategorie) VALUES ($1, 'Trigger-Check', 'extern') RETURNING id`,
        [mandantId]
      );
      const triggerTypId = rows[0].id;

      // Fall 1: traegerweiter Scope -- muss der Trigger ablehnen.
      let fehler: any;
      try {
        await admin.query(
          `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
           VALUES ($1, $2, 'zimmer', 'ansehen', 'tenant', true)`,
          [mandantId, triggerTypId]
        );
      } catch (e) {
        fehler = e;
      }
      expect(fehler).toBeDefined();
      expect(fehler.code).toBe("P0001");

      // Fall 2: identisches (modul,aktion)-Paar, nur Scope auf 'assigned'
      // geaendert -- muss gelingen. Das Nebeneinander beider Faelle belegt,
      // dass der Trigger gezielt scope<>'assigned' erwischt, nicht einfach
      // jede Zeile dieses Account-Typs blockiert.
      const { rows: erfolgRows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
         VALUES ($1, $2, 'zimmer', 'ansehen', 'assigned', true) RETURNING id`,
        [mandantId, triggerTypId]
      );
      expect(erfolgRows).toHaveLength(1);
    });
  });

  describe("Rechte-Engine ueber HTTP + direkt: 'assigned' ist Ja/Nein, aber NIE traegerweit", () => {
    it("Login gelingt ueber echtes HTTP (volles AppModule) fuer ein extern-Konto, der Token traegt durch @Authenticated()", async () => {
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug, email: benAssignedEmail, passwort });
      expect(loginRes.status).toBe(201);
      expect(typeof loginRes.body.accessToken).toBe("string");

      const statusRes = await request(app.getHttpServer())
        .get("/auth/totp/status")
        .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
      expect(statusRes.status).toBe(200);
    });

    it("hatRecht() ist true (assigned-Scope greift als Ja/Nein-Pruefung), ermittleErlaubteOrgUnitIds() ist trotzdem IMMER leer -- nie 'alle', keine Org-Unit-Id", async () => {
      const hat = await alsBenutzer(mandantId, benAssignedId, () => rechte.hatRecht("klienten", "lesen-akte"));
      expect(hat).toBe(true);

      const orgUnits = await alsBenutzer(mandantId, benAssignedId, () =>
        rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
      );
      expect(orgUnits).toEqual([]);
      expect(orgUnits).not.toBe("alle");
    });

    it("Gegenprobe: dasselbe Konto hat fuer ein ANDERES Modul/Aktion-Paar (ohne eigene Zeile) kein Recht -- die Erlaubnis ist exakt auf die eine Zeile begrenzt, nicht pauschal", async () => {
      const hatOrganigramm = await alsBenutzer(mandantId, benAssignedId, () =>
        rechte.hatRecht("organigramm", "ansehen")
      );
      expect(hatOrganigramm).toBe(false);
    });
  });

  describe("Default-Deny: extern-Account-Typ ganz ohne jede account_typ_recht-Zeile", () => {
    it("hatRecht() liefert false (impliziter Deny, direkter Service-Zugriff)", async () => {
      const [benLeerRow] = (
        await admin.query<{ id: string }>("SELECT id FROM benutzer WHERE email = $1", [benLeerEmail])
      ).rows;
      const hat = await alsBenutzer(mandantId, benLeerRow.id, () => rechte.hatRecht("klienten", "lesen-akte"));
      expect(hat).toBe(false);
    });

    it("derselbe Zugang scheitert auch ueber einen echten, rechte-gegateten HTTP-Endpunkt mit 403 (nicht nur im direkten Service-Aufruf)", async () => {
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug, email: benLeerEmail, passwort });
      expect(loginRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .get("/organigramm/org-units")
        .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
      expect(res.status).toBe(403);
    });
  });
});
