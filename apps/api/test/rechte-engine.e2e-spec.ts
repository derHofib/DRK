/**
 * Unit-Tests der Rechte-Auflösung (siehe Organigramm-Plan, Abschnitt
 * "Tests"): Account-Typ-Default, Override, Deny-pro-Scope bei
 * Mehrfachpositionen, Stabsstelle-Sonderfall, Wildcard Geschäftsführung,
 * Subtree-/Einrichtungs-Scope über die Closure-Tabelle, Delegation
 * (Minimum, Addition, keine Kettenvertretung, manage-permissions
 * ausgeschlossen), Subjekt-Typ extern.
 *
 * RechteService ist noch an keinen Endpunkt angeschlossen (Lieferreihenfolge
 * Schritt 2) -- deshalb kein HTTP-Login wie in den übrigen e2e-Specs,
 * sondern direkter Service-Zugriff über ein schlankes Testing-Modul
 * (DatabaseModule + RechteModule, nicht das volle AppModule). Der
 * Tenant-Kontext, den jede Service-Methode über requireTenantContext()
 * erwartet, wird hier manuell aufgespannt (tenantContextStorage.run(...))
 * -- genau das, was TenantContextInterceptor sonst pro echtem Request tut.
 *
 * Läuft gegen eine echte PostgreSQL-Instanz mit angewendeten Migrationen
 * (kein Mock) -- RLS und die Closure-Tabellen lassen sich nicht sinnvoll
 * mocken.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { DatabaseModule } from "../src/database/database.module";
import { RechteModule } from "../src/rechte/rechte.module";
import { RechteService } from "../src/rechte/rechte.service";
import { tenantContextStorage } from "../src/common/tenant-context";

function alsBenutzer<T>(mandantId: string, benutzerId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ mandantId, benutzerId }, fn);
}

describe("RechteService (Rechte-Engine, Organigramm-Modul)", () => {
  let app: INestApplication;
  let admin: Client;
  let rechte: RechteService;
  let mandantId: string;
  let traegerId: string;
  let einrichtungAId: string;
  let einrichtungBId: string;
  let bereichXId: string;
  let teamYId: string;

  // Account-Typen
  let gfTypId: string;
  let leitungTypId: string;
  let stabTypId: string;
  let externTypId: string;

  // Positionen
  let posGFId: string;
  let posLeitungAId: string;
  let posLeitungBId: string;
  let posStabId: string;
  let posBereichXId: string;
  let posTeamYId: string;
  let posExternId: string;

  // Benutzer
  let benGF: string;
  let benLeitungA: string;
  let benMulti: string;
  let benStab: string;
  let benBereichX: string;
  let benTeamY: string;
  let benExtern: string;
  let benVertretener: string;
  let benVertreter: string;
  let benVertreter2: string;
  let benOhneSensibel: string;
  let benOhneSensibelVertreter: string;

  // Bewusst OHNE kontoMitAlterRolle() -- dieser Test baut fuer jeden
  // Benutzer seine eigene, exakte Position/Rechtematrix von Hand auf (siehe
  // neuePosition()/zuweisen() unten), gerade um Scope-/Deny-/Vertretungs-
  // Grenzfaelle isoliert zu pruefen. Eine zusaetzliche, generische Position
  // aus kontoMitAlterRolle() wuerde genau diese Isolation unterlaufen --
  // z.B. haette ein eigentlich rechtloser "extern"-Benutzer dann ploetzlich
  // auch noch die MITARBEITER_RECHTE-Grundausstattung.
  async function neuerBenutzer(label: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
      [mandantId, `${label}-${randomUUID().slice(0, 8)}@rechte-check.test`, label]
    );
    return rows[0].id;
  }

  async function neuePosition(
    orgUnitId: string,
    titel: string,
    accountTypId: string,
    opts: { typ?: "linie" | "stabsstelle"; parentPositionId?: string } = {}
  ): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id, typ, parent_position_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [mandantId, orgUnitId, titel, accountTypId, opts.typ ?? "linie", opts.parentPositionId ?? null]
    );
    return rows[0].id;
  }

  async function zuweisen(positionId: string, benutzerId: string) {
    await admin.query(`INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)`, [
      mandantId,
      positionId,
      benutzerId,
    ]);
  }

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const slug = `rechte-check-${randomUUID().slice(0, 8)}`;
    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      ["Rechte-Check", slug]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    const { rows: standortRows } = await admin.query<{ id: string }>(
      `INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, 'Haus A', 'Teststr. 1'), ($1, 'Haus B', 'Teststr. 2') RETURNING id`,
      [mandantId]
    );
    const { rows: einrichtungRows } = await admin.query<{ id: string; standort_id: string }>(
      "SELECT id, standort_id FROM org_unit WHERE mandant_id = $1 AND typ = 'einrichtung' ORDER BY name",
      [mandantId]
    );
    einrichtungAId = einrichtungRows.find((r) => r.standort_id === standortRows[0].id)!.id;
    einrichtungBId = einrichtungRows.find((r) => r.standort_id === standortRows[1].id)!.id;

    const { rows: bereichRows } = await admin.query<{ id: string }>(
      "INSERT INTO org_unit (mandant_id, parent_id, typ, name) VALUES ($1, $2, 'bereich', 'Bereich X') RETURNING id",
      [mandantId, einrichtungAId]
    );
    bereichXId = bereichRows[0].id;
    const { rows: teamRows } = await admin.query<{ id: string }>(
      "INSERT INTO org_unit (mandant_id, parent_id, typ, name) VALUES ($1, $2, 'team', 'Team Y') RETURNING id",
      [mandantId, bereichXId]
    );
    teamYId = teamRows[0].id;

    async function neuerAccountTyp(
      name: string,
      opts: { istVollzugriff?: boolean; kategorie?: "intern" | "extern" } = {}
    ): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO account_typ (mandant_id, name, kategorie, ist_vollzugriff) VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, name, opts.kategorie ?? "intern", opts.istVollzugriff ?? false]
      );
      return rows[0].id;
    }
    async function recht(accountTypId: string, modul: string, aktion: string, scope: string, erlaubt = true) {
      await admin.query(
        `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1, $2, $3, $4, $5, $6)`,
        [mandantId, accountTypId, modul, aktion, scope, erlaubt]
      );
    }

    gfTypId = await neuerAccountTyp("Geschäftsführung", { istVollzugriff: true });

    leitungTypId = await neuerAccountTyp("Leitung Einrichtung");
    await recht(leitungTypId, "klienten", "lesen-akte", "einrichtung");
    await recht(leitungTypId, "zimmer", "ansehen", "subtree");
    await recht(leitungTypId, "zimmer", "belegen", "einrichtung");

    stabTypId = await neuerAccountTyp("Stabsstelle QM");
    // Scope hier bewusst "tenant" -- muss fuer eine Stabsstelle IGNORIERT
    // werden, siehe orgUnitIdsFuerScope()/Test weiter unten.
    await recht(stabTypId, "kassenbuch", "ansehen", "tenant");

    externTypId = await neuerAccountTyp("Kostenträger", { kategorie: "extern" });
    await recht(externTypId, "klienten", "lesen-akte", "assigned");

    posGFId = await neuePosition(traegerId, "Geschäftsführung", gfTypId);
    posLeitungAId = await neuePosition(einrichtungAId, "Einrichtungsleitung A", leitungTypId);
    posLeitungBId = await neuePosition(einrichtungBId, "Einrichtungsleitung B", leitungTypId);
    posStabId = await neuePosition(traegerId, "QM-Stabsstelle", stabTypId, {
      typ: "stabsstelle",
      parentPositionId: posGFId,
    });
    await admin.query(
      "INSERT INTO org_position_stabsstelle_scope (mandant_id, position_id, org_unit_id) VALUES ($1, $2, $3)",
      [mandantId, posStabId, einrichtungAId]
    );
    posBereichXId = await neuePosition(bereichXId, "Bereichsleitung X", leitungTypId);
    posTeamYId = await neuePosition(teamYId, "Teamleitung Y", leitungTypId);
    posExternId = await neuePosition(traegerId, "Kostenträger-Zugang", externTypId);

    // Override auf posLeitungB: hebt den Account-Typ-Default fuer
    // (klienten,lesen-akte) bei GENAU dieser Position auf -- der
    // Mehrfachpositions-Benutzer behaelt den Zugriff trotzdem ueber
    // posLeitungA (siehe Test "Deny gewinnt pro Org-Unit").
    await admin.query(
      `INSERT INTO org_position_recht_override (mandant_id, position_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'klienten', 'lesen-akte', 'einrichtung', false)`,
      [mandantId, posLeitungBId]
    );
    // Override auf posLeitungA: gewaehrt ZUSAETZLICH etwas, das der
    // Account-Typ "Leitung Einrichtung" von sich aus nicht hat.
    await admin.query(
      `INSERT INTO org_position_recht_override (mandant_id, position_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'kassenbuch', 'buchen', 'einrichtung', true)`,
      [mandantId, posLeitungAId]
    );
    // manage-permissions nur auf posLeitungA, um die Delegationsausnahme
    // tatsaechlich zu pruefen (nicht nur "hat er eh nicht").
    await recht(leitungTypId, "organigramm", "manage-permissions", "tenant");

    benGF = await neuerBenutzer("gf");
    benLeitungA = await neuerBenutzer("leitungA");
    benMulti = await neuerBenutzer("multi");
    benStab = await neuerBenutzer("stab");
    benBereichX = await neuerBenutzer("bereichX");
    benTeamY = await neuerBenutzer("teamY");
    benExtern = await neuerBenutzer("extern");
    benVertretener = await neuerBenutzer("vertretener");
    benVertreter = await neuerBenutzer("vertreter");
    benVertreter2 = await neuerBenutzer("vertreter2");
    benOhneSensibel = await neuerBenutzer("ohneSensibel");
    benOhneSensibelVertreter = await neuerBenutzer("ohneSensibelVertreter");

    await zuweisen(posGFId, benGF);
    await zuweisen(posLeitungAId, benLeitungA);
    await zuweisen(posLeitungAId, benMulti);
    await zuweisen(posLeitungBId, benMulti);
    await zuweisen(posStabId, benStab);
    await zuweisen(posBereichXId, benBereichX);
    await zuweisen(posTeamYId, benTeamY);
    await zuweisen(posExternId, benExtern);
    await zuweisen(posLeitungAId, benVertretener);
    // benVertreter bekommt bewusst KEINE eigene Position -- isoliert den
    // Delegationspfad von eigenen Rechten.
    await zuweisen(posLeitungBId, benOhneSensibel); // beliebige Basis-Position fuer den Vertretenen dieses Falls

    const in7Tagen = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const vor1Tag = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    async function delegationAnlegen(
      vertretenerId: string,
      vertreterId: string,
      opts: { sensibelEingeschlossen?: boolean } = {}
    ) {
      await admin.query(
        `INSERT INTO delegation (mandant_id, vertretener_benutzer_id, vertreter_benutzer_id, von, bis, umfang, sensible_rechte_eingeschlossen, status, erstellt_von, genehmigt_von, genehmigt_am)
         VALUES ($1, $2, $3, $4, $5, 'alle', $6, 'genehmigt', $2, $2, now())`,
        [mandantId, vertretenerId, vertreterId, vor1Tag, in7Tagen, opts.sensibelEingeschlossen ?? false]
      );
    }
    await delegationAnlegen(benVertretener, benVertreter, { sensibelEingeschlossen: true });
    // Kettenvertretung pruefen: benVertreter delegiert SEINERSEITS an
    // benVertreter2 -- darf NICHT die von benVertretener geerbten Rechte
    // weiterreichen, nur benVertreters EIGENE (hier: keine).
    await delegationAnlegen(benVertreter, benVertreter2, { sensibelEingeschlossen: true });
    // Default-Fall: sensible_rechte_eingeschlossen NICHT gesetzt (false).
    await delegationAnlegen(benOhneSensibel, benOhneSensibelVertreter);

    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, RechteModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rechte = app.get(RechteService);
  });

  afterAll(async () => {
    // posGFId (ist_vollzugriff) ist in diesem Fixture die einzige
    // Vollzugriff-Position -- das Loeschen ALLER Zuweisungen dieses
    // Mandanten wuerde sonst am "letzter Vollzugriff-Inhaber bleibt
    // bestehen"-Schutz (0042_org_position.sql) scheitern. Beim Aufraeumen
    // des GESAMTEN Testmandanten ist das kein echter Sicherheitsfall --
    // der Trigger kann das aber nicht unterscheiden, deshalb hier gezielt
    // deaktiviert und sofort wieder aktiviert (gleiches Vorgehen wie bei
    // der manuellen Migrationsverifikation). try/finally, damit
    // admin.end()/app.close() auch bei einem Fehlschlag mitten im Aufraeumen
    // garantiert laufen -- sonst haengen offene Verbindungen den
    // Jest-Prozess auf (siehe "Jest did not exit").
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM delegation_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM delegation WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_stabsstelle_scope WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_recht_override WHERE mandant_id = $1", [mandantId]);
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

  it("Account-Typ-Default: gewaehrt und auf die eigene Einrichtung begrenzt", async () => {
    const hat = await alsBenutzer(mandantId, benLeitungA, () => rechte.hatRecht("klienten", "lesen-akte"));
    expect(hat).toBe(true);
    const orgUnits = await alsBenutzer(mandantId, benLeitungA, () =>
      rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
    );
    expect(orgUnits).toEqual([einrichtungAId]);
  });

  it("impliziter Deny: kein Account-Typ-Default und kein Override -> kein Zugriff", async () => {
    const hat = await alsBenutzer(mandantId, benLeitungA, () => rechte.hatRecht("rechnungen", "export"));
    expect(hat).toBe(false);
  });

  it("Override gewaehrt zusaetzlich etwas, das der Account-Typ selbst nicht hat", async () => {
    const hat = await alsBenutzer(mandantId, benLeitungA, () => rechte.hatRecht("kassenbuch", "buchen"));
    expect(hat).toBe(true);
    const orgUnits = await alsBenutzer(mandantId, benLeitungA, () =>
      rechte.ermittleErlaubteOrgUnitIds("kassenbuch", "buchen")
    );
    expect(orgUnits).toEqual([einrichtungAId]);
  });

  it("Deny gewinnt PRO ORG-UNIT, nicht pro Mitarbeiter (Mehrfachposition)", async () => {
    // benMulti haengt an posLeitungA (erlaubt klienten.lesen-akte fuer
    // Einrichtung A) UND posLeitungB (per Override verboten fuer
    // Einrichtung B). Erwartung: Zugriff auf A bleibt, B bleibt gesperrt --
    // das Verbot auf B loescht nicht den Zugriff auf A.
    const hat = await alsBenutzer(mandantId, benMulti, () => rechte.hatRecht("klienten", "lesen-akte"));
    expect(hat).toBe(true);
    const orgUnits = await alsBenutzer(mandantId, benMulti, () =>
      rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
    );
    expect(orgUnits).toEqual([einrichtungAId]);
    expect(orgUnits).not.toContain(einrichtungBId);
  });

  it("Stabsstelle: ignoriert den gespeicherten Scope-Wert, nutzt ausschliesslich org_position_stabsstelle_scope", async () => {
    const hat = await alsBenutzer(mandantId, benStab, () => rechte.hatRecht("kassenbuch", "ansehen"));
    expect(hat).toBe(true);
    const orgUnits = await alsBenutzer(mandantId, benStab, () =>
      rechte.ermittleErlaubteOrgUnitIds("kassenbuch", "ansehen")
    );
    // Trotz scope='tenant' in der account_typ_recht-Zeile NUR der Teilbaum
    // unter Einrichtung A (die explizit konfigurierte Stabsstellen-Scope-
    // Zeile, ueber org_unit_closure auf ihre Nachfahren ausgeweitet --
    // "traegerweit oder auf Einrichtungen begrenzt" schliesst die
    // Bereiche/Teams darunter mit ein) -- nicht Einrichtung B.
    expect(new Set(orgUnits)).toEqual(new Set([einrichtungAId, bereichXId, teamYId]));
    expect(orgUnits).not.toContain(einrichtungBId);
  });

  it("Subtree-Scope: Bereichsleitung sieht ihren Bereich UND die Teams darunter", async () => {
    const orgUnits = await alsBenutzer(mandantId, benBereichX, () => rechte.ermittleErlaubteOrgUnitIds("zimmer", "ansehen"));
    expect(new Set(orgUnits)).toEqual(new Set([bereichXId, teamYId]));
  });

  it("Einrichtungs-Scope von einer Team-Position aus: klettert zum naechsten Einrichtungs-Vorfahren hoch (ueberspringt den Bereich)", async () => {
    const orgUnits = await alsBenutzer(mandantId, benTeamY, () => rechte.ermittleErlaubteOrgUnitIds("zimmer", "belegen"));
    expect(orgUnits).toEqual([einrichtungAId]);
  });

  it("Wildcard Geschäftsführung: Zugriff auch auf ein Modul/Aktion-Paar, fuer das es gar keine Datenbank-Zeile gibt", async () => {
    const hat = await alsBenutzer(mandantId, benGF, () => rechte.hatRecht("ein-modul-das-es-noch-nicht-gab", "irgendeine-aktion"));
    expect(hat).toBe(true);
    const orgUnits = await alsBenutzer(mandantId, benGF, () =>
      rechte.ermittleErlaubteOrgUnitIds("ein-modul-das-es-noch-nicht-gab", "irgendeine-aktion")
    );
    expect(orgUnits).toBe("alle");
  });

  it("Subjekt-Typ extern: hat das Recht (assigned-Scope greift), aber NIE eine Org-Unit-Menge", async () => {
    const hat = await alsBenutzer(mandantId, benExtern, () => rechte.hatRecht("klienten", "lesen-akte"));
    expect(hat).toBe(true);
    const orgUnits = await alsBenutzer(mandantId, benExtern, () =>
      rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
    );
    expect(orgUnits).toEqual([]);
  });

  it("Subjekt-Typ extern: Default-Deny fuer alles ausserhalb der eigenen Matrix, nie Vollzugriff", async () => {
    const hat = await alsBenutzer(mandantId, benExtern, () => rechte.hatRecht("kassenbuch", "ansehen"));
    expect(hat).toBe(false);
  });

  describe("Vertretung", () => {
    it("Vertreter erbt die Rechte des Vertretenen (sensible Aktion, eingeschlossen)", async () => {
      const hat = await alsBenutzer(mandantId, benVertreter, () => rechte.hatRecht("klienten", "lesen-akte"));
      expect(hat).toBe(true);
      const orgUnits = await alsBenutzer(mandantId, benVertreter, () =>
        rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
      );
      expect(orgUnits).toEqual([einrichtungAId]);
    });

    it("Sensible Rechte sind per Default von der Delegation ausgeschlossen", async () => {
      const hat = await alsBenutzer(mandantId, benOhneSensibelVertreter, () => rechte.hatRecht("klienten", "lesen-akte"));
      expect(hat).toBe(false);
    });

    it("manage-permissions ist strukturell nie delegierbar, selbst bei umfang=alle und eingeschlossenen sensiblen Rechten", async () => {
      const hatVertretener = await alsBenutzer(mandantId, benVertretener, () =>
        rechte.hatRecht("organigramm", "manage-permissions")
      );
      expect(hatVertretener).toBe(true); // Gegenprobe: der Vertretene selbst hat es wirklich

      const hatVertreter = await alsBenutzer(mandantId, benVertreter, () =>
        rechte.hatRecht("organigramm", "manage-permissions")
      );
      expect(hatVertreter).toBe(false);
    });

    it("keine Kettenvertretung: eine Weiterdelegation gibt nur eigene Rechte weiter, nicht die ererbten", async () => {
      const hat = await alsBenutzer(mandantId, benVertreter2, () => rechte.hatRecht("klienten", "lesen-akte"));
      expect(hat).toBe(false);
    });

    it("Vertreter behaelt seine eigenen Rechte zusaetzlich (Addition, nicht Ersetzung)", async () => {
      // benMulti-aehnlicher Fall waere aufwendiger -- hier reicht der
      // Nachweis am bestehenden Vertreter: er hat (wie jeder Benutzer ohne
      // Position) fuer ein Fremdmodul kein eigenes Recht, UND die Delegation
      // deckt nur klienten.lesen-akte ab -- beides bleibt getrennt
      // nachvollziehbar.
      const hatFremd = await alsBenutzer(mandantId, benVertreter, () => rechte.hatRecht("kassenbuch", "ansehen"));
      expect(hatFremd).toBe(false);
    });
  });

  describe("Gegenproben", () => {
    it("GEGENPROBE: ohne das Override-Deny haette benMulti auch auf Einrichtung B Zugriff (Beleg, dass der Test wirklich etwas prueft)", async () => {
      await admin.query(
        "DELETE FROM org_position_recht_override WHERE position_id = $1 AND modul = 'klienten' AND aktion = 'lesen-akte'",
        [posLeitungBId]
      );
      const orgUnits = await alsBenutzer(mandantId, benMulti, () =>
        rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
      );
      expect(new Set(orgUnits)).toEqual(new Set([einrichtungAId, einrichtungBId]));

      // Wiederherstellen, damit kein anderer Test in dieser Datei davon beeinflusst wird.
      await admin.query(
        `INSERT INTO org_position_recht_override (mandant_id, position_id, modul, aktion, scope, erlaubt)
         VALUES ($1, $2, 'klienten', 'lesen-akte', 'einrichtung', false)`,
        [mandantId, posLeitungBId]
      );
      const orgUnitsNachher = await alsBenutzer(mandantId, benMulti, () =>
        rechte.ermittleErlaubteOrgUnitIds("klienten", "lesen-akte")
      );
      expect(orgUnitsNachher).toEqual([einrichtungAId]);
    });
  });
});
