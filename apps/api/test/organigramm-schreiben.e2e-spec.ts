/**
 * Schreibende Organigramm-Endpunkte (Organigramm-Plan, Lieferreihenfolge
 * Schritt 7): Organisationseinheiten/Positionen/Account-Typen anlegen,
 * bearbeiten, Positionen besetzen/deaktivieren, Stabsstelle-Scope und die
 * Account-Typ-Rechte-Matrix setzen.
 *
 * Wie organigramm-lesen.e2e-spec.ts/rechte-engine.e2e-spec.ts: account_typ/
 * org_position/org_position_besetzung werden DIREKT per SQL aufgebaut,
 * nicht ueber benutzer.rolle -- rollen-mapping.ts (Schritt 3) kennt
 * organigramm.* fuer einrichtungsleitung/mitarbeiter noch nicht (bewusste,
 * noch ausstehende Einschraenkung, kein Bug dieses Schritts). Heute sieht
 * praktisch nur ein ist_vollzugriff=true-Konto (Geschaeftsfuehrung-Wildcard)
 * diese Endpunkte vollstaendig -- die uebrigen Testkonten bekommen gezielt
 * NUR organigramm.bearbeiten bzw. NUR organigramm.manage-permissions, um
 * die beiden Gates wirklich getrennt zu pruefen.
 *
 * Login laeuft ueber HTTP (volles AppModule) -- @Authenticated()/
 * @ErfordertRecht() sind damit tatsaechlich end-to-end geprueft (401/403
 * inklusive), nicht nur die Services selbst.
 *
 * Jede DB-Invariante (Zyklenschutz, ist_geplant-Pruefung, Stabsstelle-Scope,
 * letzter-Vollzugriff-Schutz, Account-Typ-Matrix-Regeln) steckt als Trigger
 * in den Migrationen 0040-0042 -- die Gegenproben hier zeigen, dass diese
 * Trigger tatsaechlich greifen (CLAUDE.md: "Prüfen statt behaupten"), nicht
 * nur, dass der gluckliche Pfad funktioniert.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Organigramm: schreibende Endpunkte", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let traegerId: string;

  let normalTypId: string;
  let gfTypId: string;
  let bearbeitenTypId: string;
  let managePermissionsTypId: string;
  let ohneRechtTypId: string;
  let systemTypId: string;

  let posGfId: string;
  let bereichAId: string;

  let tokenGf: string;
  let tokenBearbeiten: string;
  let tokenManagePermissions: string;
  let tokenOhneRecht: string;

  const passwort = "correct horse battery staple";
  const gestern = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-organigramm-schreiben-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Organigramm Schreiben ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    async function neuerAccountTyp(
      name: string,
      opts: { istVollzugriff?: boolean; istSystem?: boolean } = {}
    ): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ (mandant_id, name, ist_vollzugriff, ist_system) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, name, opts.istVollzugriff ?? false, opts.istSystem ?? false]
      );
      return rows[0].id;
    }
    async function recht(accountTypId: string, aktion: string, scope = "tenant") {
      await admin.query(
        `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
         VALUES ($1, $2, 'organigramm', $3, $4, true)`,
        [mandantId, accountTypId, aktion, scope]
      );
    }

    normalTypId = await neuerAccountTyp("Normal (ohne Organigramm-Recht)");
    gfTypId = await neuerAccountTyp("Geschäftsführung", { istVollzugriff: true });
    bearbeitenTypId = await neuerAccountTyp("Organigramm-Pflege");
    await recht(bearbeitenTypId, "ansehen");
    await recht(bearbeitenTypId, "bearbeiten");
    await recht(bearbeitenTypId, "personendaten-sehen");
    managePermissionsTypId = await neuerAccountTyp("Rechteverwaltung");
    await recht(managePermissionsTypId, "ansehen");
    await recht(managePermissionsTypId, "manage-permissions");
    // ohneRechtTypId bekommt bewusst KEIN organigramm.*-Recht -- Beleg fuer
    // die 403-Faelle weiter unten.
    ohneRechtTypId = await neuerAccountTyp("Ohne Organigramm-Recht");
    // systemTypId simuliert eine Systemvorlage (ist_system=true) -- so
    // etwas entsteht laut Fachkonzept nur ueber scripts/rollen-migration.ts,
    // niemals ueber die API; hier direkt per SQL angelegt, um die
    // Umbenennungssperre zu pruefen.
    systemTypId = await neuerAccountTyp("Systemvorlage", { istSystem: true });

    async function neuePosition(titel: string, accountTypId: string, orgUnitId: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, orgUnitId, titel, accountTypId]
      );
      return rows[0].id;
    }
    posGfId = await neuePosition("Geschäftsführung", gfTypId, traegerId);
    const posBearbeitenId = await neuePosition("Organigramm-Pflege", bearbeitenTypId, traegerId);
    const posManagePermissionsId = await neuePosition("Rechteverwaltung", managePermissionsTypId, traegerId);
    const posOhneRechtId = await neuePosition("Ohne Organigramm-Recht", ohneRechtTypId, traegerId);

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string }> {
      const email = `${label}-${suffix}@organigramm-schreiben.test`;
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

    const benGf = await neuerBenutzer("gf");
    const benBearbeiten = await neuerBenutzer("bearbeiten");
    const benManagePermissions = await neuerBenutzer("managePermissions");
    const benOhneRecht = await neuerBenutzer("ohneRecht");

    await zuweisen(posGfId, benGf.id);
    await zuweisen(posBearbeitenId, benBearbeiten.id);
    await zuweisen(posManagePermissionsId, benManagePermissions.id);
    await zuweisen(posOhneRechtId, benOhneRecht.id);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenGf = await login(benGf.email);
    tokenBearbeiten = await login(benBearbeiten.email);
    tokenManagePermissions = await login(benManagePermissions.email);
    tokenOhneRecht = await login(benOhneRecht.email);
  });

  afterAll(async () => {
    // posGfId (ist_vollzugriff) ist die einzige Vollzugriff-Position dieses
    // Testmandanten -- siehe rechte-engine.e2e-spec.ts fuer die Begruendung,
        // warum der Schutztrigger hier kurz deaktiviert werden muss.
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("ALTER TABLE org_position DISABLE TRIGGER org_position_vollzugriff_schutz");
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_stabsstelle_scope WHERE mandant_id = $1", [mandantId]);
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
      await admin.query("ALTER TABLE org_position ENABLE TRIGGER org_position_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  function als(token: string) {
    const header = () => ({ Authorization: `Bearer ${token}` });
    return {
      get: (path: string) => request(app.getHttpServer()).get(path).set(header()),
      post: (path: string, body?: unknown) => request(app.getHttpServer()).post(path).set(header()).send(body ?? {}),
      patch: (path: string, body?: unknown) => request(app.getHttpServer()).patch(path).set(header()).send(body ?? {}),
      put: (path: string, body?: unknown) => request(app.getHttpServer()).put(path).set(header()).send(body ?? {}),
    };
  }

  async function letzterAuditEintrag(objektTyp: string, objektId: string) {
    const { rows } = await admin.query(
      `SELECT * FROM audit_log WHERE mandant_id = $1 AND objekt_typ = $2 AND objekt_id = $3 ORDER BY erstellt_am DESC LIMIT 1`,
      [mandantId, objektTyp, objektId]
    );
    return rows[0];
  }

  describe("Organisationseinheiten", () => {
    let teamAId: string;
    let bereichBId: string;
    let teamBId: string;

    it("legt einen Bereich unter dem Träger an", async () => {
      const res = await als(tokenGf).post("/organigramm/org-units", {
        typ: "bereich",
        name: "Bereich A",
        parentId: traegerId,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ typ: "bereich", name: "Bereich A", parentId: traegerId, aktiv: true });
      bereichAId = res.body.id;
    });

    it("schreibt einen passenden audit_log-Eintrag (vorher=null, nachher=die neue Zeile)", async () => {
      const eintrag = await letzterAuditEintrag("org_unit", bereichAId);
      expect(eintrag).toBeDefined();
      expect(eintrag.modul).toBe("organigramm");
      expect(eintrag.aktion).toBe("org-unit.anlegen");
      expect(eintrag.vorher).toBeNull();
      expect(eintrag.nachher).toMatchObject({ id: bereichAId, name: "Bereich A" });
    });

    it("legt ein Team unter dem Bereich an", async () => {
      const res = await als(tokenGf).post("/organigramm/org-units", { typ: "team", name: "Team A", parentId: bereichAId });
      expect(res.status).toBe(201);
      teamAId = res.body.id;
      expect(res.body).toMatchObject({ typ: "team", parentId: bereichAId });
    });

    it("legt eine zweite Bereich/Team-Kette fuer den Reparenting-Erfolgsfall an", async () => {
      const resB = await als(tokenGf).post("/organigramm/org-units", { typ: "bereich", name: "Bereich B", parentId: traegerId });
      bereichBId = resB.body.id;
      const resTeamB = await als(tokenGf).post("/organigramm/org-units", { typ: "team", name: "Team B", parentId: bereichBId });
      teamBId = resTeamB.body.id;
      expect(resTeamB.status).toBe(201);
    });

    it("benennt eine Organisationseinheit um", async () => {
      const res = await als(tokenGf).patch(`/organigramm/org-units/${bereichAId}`, { name: "Bereich A (umbenannt)" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Bereich A (umbenannt)");
    });

    it("haengt Team B unter Bereich A um (erfolgreiches Reparenting)", async () => {
      const res = await als(tokenGf).patch(`/organigramm/org-units/${teamBId}`, { parentId: bereichAId });
      expect(res.status).toBe(200);
      expect(res.body.parentId).toBe(bereichAId);
    });

    it("GEGENPROBE: ein Knoten kann nicht unter seinen eigenen Nachfahren verschoben werden -> 409", async () => {
      // bereichA ist Vorfahre von teamA -- Bereich A unter Team A zu haengen
      // waere ein Zyklus, der Trigger org_unit_closure_update muss das
      // ablehnen.
      const res = await als(tokenGf).patch(`/organigramm/org-units/${bereichAId}`, { parentId: teamAId });
      expect(res.status).toBe(409);
    });

    it("typ=\"einrichtung\" ist ueber diesen Endpunkt nicht anlegbar -> 400", async () => {
      const res = await als(tokenGf).post("/organigramm/org-units", { typ: "einrichtung", name: "x", parentId: traegerId });
      expect(res.status).toBe(400);
    });

    it("typ=\"traeger\" ist ueber diesen Endpunkt nicht anlegbar -> 400", async () => {
      const res = await als(tokenGf).post("/organigramm/org-units", { typ: "traeger", name: "x", parentId: traegerId });
      expect(res.status).toBe(400);
    });

    it("ohne organigramm.bearbeiten -> 403", async () => {
      const res = await als(tokenOhneRecht).post("/organigramm/org-units", { typ: "bereich", name: "x", parentId: traegerId });
      expect(res.status).toBe(403);
    });

    it("mit NUR organigramm.bearbeiten (kein Vollzugriff) klappt das Anlegen trotzdem", async () => {
      const res = await als(tokenBearbeiten).post("/organigramm/org-units", { typ: "bereich", name: "Bereich C", parentId: traegerId });
      expect(res.status).toBe(201);
    });
  });

  describe("Positionen", () => {
    let posId: string;
    let besetzungId: string;
    let benWorker1: string;
    let benWorker2: string;

    beforeAll(async () => {
      async function neuerBenutzer(label: string): Promise<string> {
        const { rows } = await admin.query<{ id: string }>(
          `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
           VALUES ($1, $2, $3, 'x', 'betreuer') RETURNING id`,
          [mandantId, `${label}-${randomUUID().slice(0, 8)}@organigramm-schreiben.test`, label]
        );
        return rows[0].id;
      }
      benWorker1 = await neuerBenutzer("worker1");
      benWorker2 = await neuerBenutzer("worker2");
    });

    it("legt eine Position an -- istGeplant ist NICHT gesetzt (bleibt beim DB-Default false)", async () => {
      const res = await als(tokenGf).post("/organigramm/positions", {
        orgUnitId: bereichAId,
        titel: "Teamleitung Test",
        accountTypId: normalTypId,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ titel: "Teamleitung Test", istGeplant: false, aktiv: true, besetztMit: [] });
      posId = res.body.id;
    });

    it("markiert die noch unbesetzte Position per PATCH als Platzhalter (istGeplant=true)", async () => {
      const res = await als(tokenGf).patch(`/organigramm/positions/${posId}`, { istGeplant: true });
      expect(res.status).toBe(200);
      expect(res.body.istGeplant).toBe(true);
    });

    it("besetzt die Position -- istGeplant faellt automatisch weg", async () => {
      // gueltigAb bewusst auf gestern zurueckdatiert: so kann die Besetzung
      // im naechsten Test mit gueltigBis=gestern beendet werden, ohne den
      // CHECK (gueltig_bis >= gueltig_ab) zu verletzen, UND ist damit ab
      // heute (nicht erst ab morgen) tatsaechlich vakant -- siehe
      // POSITIONEN_SELECT: "gueltig_bis >= CURRENT_DATE" zaehlt ein
      // Enddatum von HEUTE noch als besetzt.
      const res = await als(tokenGf).post(`/organigramm/positions/${posId}/besetzen`, {
        benutzerId: benWorker1,
        gueltigAb: gestern,
      });
      expect(res.status).toBe(201);
      expect(res.body.istGeplant).toBe(false);
      expect(res.body.besetztMit).toEqual([{ benutzerId: benWorker1, benutzerName: "worker1" }]);
      const { rows } = await admin.query("SELECT id FROM org_position_besetzung WHERE position_id = $1", [posId]);
      besetzungId = rows[0].id;
    });

    it("GEGENPROBE: istGeplant=true bei aktiver Besetzung wird abgelehnt -> 409", async () => {
      const res = await als(tokenGf).patch(`/organigramm/positions/${posId}`, { istGeplant: true });
      expect(res.status).toBe(409);
    });

    it("beendet die Besetzung (gueltigBis in der Vergangenheit -- ab sofort vakant)", async () => {
      const res = await als(tokenGf).patch(`/organigramm/positions/${posId}/besetzung/${besetzungId}/beenden`, {
        gueltigBis: gestern,
      });
      expect(res.status).toBe(200);
      expect(res.body.besetztMit).toEqual([]);
    });

    it("eine erneute Besetzung danach ist moeglich", async () => {
      const res = await als(tokenGf).post(`/organigramm/positions/${posId}/besetzen`, { benutzerId: benWorker2 });
      expect(res.status).toBe(201);
      expect(res.body.besetztMit).toEqual([{ benutzerId: benWorker2, benutzerName: "worker2" }]);
    });

    it("besetzen mit unbekanntem Benutzer -> 404", async () => {
      const res = await als(tokenGf).post(`/organigramm/positions/${posId}/besetzen`, { benutzerId: randomUUID() });
      expect(res.status).toBe(404);
    });

    it("deaktiviert die Position (auch bei weiterhin aktiver Besetzung -- kein DB-Constraint verbietet das)", async () => {
      const res = await als(tokenGf).patch(`/organigramm/positions/${posId}/deaktivieren`);
      expect(res.status).toBe(200);
      expect(res.body.aktiv).toBe(false);
    });

    it("schreibt einen audit_log-Eintrag fuer das Deaktivieren", async () => {
      const eintrag = await letzterAuditEintrag("org_position", posId);
      expect(eintrag.aktion).toBe("position.deaktivieren");
      expect(eintrag.vorher.aktiv).toBe(true);
      expect(eintrag.nachher.aktiv).toBe(false);
    });

    it("Reparenting-Zyklus-Gegenprobe im Positionsbaum -> 409", async () => {
      const elternRes = await als(tokenGf).post("/organigramm/positions", {
        orgUnitId: bereichAId,
        titel: "Eltern-Position",
        accountTypId: normalTypId,
      });
      const kindRes = await als(tokenGf).post("/organigramm/positions", {
        orgUnitId: bereichAId,
        titel: "Kind-Position",
        accountTypId: normalTypId,
        parentPositionId: elternRes.body.id,
      });
      const res = await als(tokenGf).patch(`/organigramm/positions/${elternRes.body.id}`, {
        parentPositionId: kindRes.body.id,
      });
      expect(res.status).toBe(409);
    });

    it("ohne organigramm.bearbeiten -> 403", async () => {
      const res = await als(tokenOhneRecht).post("/organigramm/positions", {
        orgUnitId: bereichAId,
        titel: "x",
        accountTypId: normalTypId,
      });
      expect(res.status).toBe(403);
    });

    describe("Stabsstelle-Scope", () => {
      it("setzt den Scope einer Stabsstelle", async () => {
        const stabRes = await als(tokenGf).post("/organigramm/positions", {
          orgUnitId: traegerId,
          titel: "QM-Stabsstelle",
          typ: "stabsstelle",
          accountTypId: normalTypId,
        });
        const stabId = stabRes.body.id;

        const res = await als(tokenGf).put(`/organigramm/positions/${stabId}/stabsstelle-scope`, {
          orgUnitIds: [bereichAId],
        });
        expect(res.status).toBe(200);

        const { rows } = await admin.query("SELECT org_unit_id FROM org_position_stabsstelle_scope WHERE position_id = $1", [
          stabId,
        ]);
        expect(rows.map((r) => r.org_unit_id)).toEqual([bereichAId]);
      });

      it("GEGENPROBE: eine Linienposition bekommt keinen Stabsstelle-Scope -> 409", async () => {
        const linieRes = await als(tokenGf).post("/organigramm/positions", {
          orgUnitId: bereichAId,
          titel: "Linie",
          accountTypId: normalTypId,
        });
        const res = await als(tokenGf).put(`/organigramm/positions/${linieRes.body.id}/stabsstelle-scope`, {
          orgUnitIds: [bereichAId],
        });
        expect(res.status).toBe(409);
      });
    });
  });

  describe("Letzter Vollzugriff-Inhaber bleibt bestehen (Gegenprobe)", () => {
    it("die einzige aktiv besetzte Vollzugriff-Position dieses Mandanten kann nicht deaktiviert werden -> 409", async () => {
      const res = await als(tokenGf).patch(`/organigramm/positions/${posGfId}/deaktivieren`);
      expect(res.status).toBe(409);
    });
  });

  describe("Account-Typen", () => {
    let neuerTypId: string;

    it("legt einen Account-Typ an", async () => {
      const res = await als(tokenManagePermissions).post("/organigramm/account-typen", { name: "Testtyp A" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: "Testtyp A", kategorie: "intern", istSystem: false, istVollzugriff: false });
      neuerTypId = res.body.id;
    });

    it("benennt den Account-Typ um", async () => {
      const res = await als(tokenManagePermissions).patch(`/organigramm/account-typen/${neuerTypId}`, { name: "Testtyp A (neu)" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Testtyp A (neu)");
    });

    it("setzt die Rechte-Matrix", async () => {
      const res = await als(tokenManagePermissions).put(`/organigramm/account-typen/${neuerTypId}/rechte`, {
        rechte: [{ modul: "organigramm", aktion: "ansehen", scope: "tenant", erlaubt: true }],
      });
      expect(res.status).toBe(200);
      expect(res.body.rechte).toEqual([{ modul: "organigramm", aktion: "ansehen", scope: "tenant", erlaubt: true }]);
    });

    it("schreibt einen audit_log-Eintrag fuer das Setzen der Rechte-Matrix", async () => {
      const eintrag = await letzterAuditEintrag("account_typ", neuerTypId);
      expect(eintrag.aktion).toBe("account-typ.rechte-setzen");
    });

    it("GEGENPROBE: ein unbekanntes (modul,aktion)-Paar wird abgelehnt -> 400, OHNE etwas zu schreiben", async () => {
      const res = await als(tokenManagePermissions).put(`/organigramm/account-typen/${neuerTypId}/rechte`, {
        rechte: [{ modul: "unbekanntes-modul", aktion: "irgendwas", scope: "tenant", erlaubt: true }],
      });
      expect(res.status).toBe(400);

      // Beleg, dass die vorherige Matrix (aus dem Test davor) unangetastet
      // blieb -- Validierung laeuft VOR jedem Schreibzugriff.
      const { rows } = await admin.query("SELECT modul, aktion FROM account_typ_recht WHERE account_typ_id = $1", [
        neuerTypId,
      ]);
      expect(rows).toEqual([{ modul: "organigramm", aktion: "ansehen" }]);
    });

    it("GEGENPROBE: eine Systemvorlage kann nicht umbenannt werden -> 400", async () => {
      const res = await als(tokenManagePermissions).patch(`/organigramm/account-typen/${systemTypId}`, { name: "x" });
      expect(res.status).toBe(400);
    });

    it("GEGENPROBE: ein ist_vollzugriff-Typ bekommt keine Rechte-Matrix-Zeilen -> 409", async () => {
      const res = await als(tokenManagePermissions).put(`/organigramm/account-typen/${gfTypId}/rechte`, {
        rechte: [{ modul: "organigramm", aktion: "ansehen", scope: "tenant", erlaubt: true }],
      });
      expect(res.status).toBe(409);
    });

    it("ohne organigramm.manage-permissions -> 403 (auch mit organigramm.bearbeiten allein reicht es nicht)", async () => {
      const res = await als(tokenBearbeiten).post("/organigramm/account-typen", { name: "x" });
      expect(res.status).toBe(403);
    });

    it("ohne jedes Organigramm-Recht -> 403", async () => {
      const res = await als(tokenOhneRecht).post("/organigramm/account-typen", { name: "x" });
      expect(res.status).toBe(403);
    });
  });
});
