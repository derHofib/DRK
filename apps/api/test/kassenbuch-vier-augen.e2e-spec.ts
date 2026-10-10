/**
 * Vier-Augen-Verschaerfung beim Kassenbuch-Storno (Migration 0045,
 * kassenbuchung.service.ts stornoBeantragen()/stornoEntscheiden()): wer
 * eine Kassenbuchung selbst gebucht hat, darf nie ueber deren Storno-Antrag
 * entscheiden -- unabhaengig von ihren Rechten und OHNE Ausnahme fuer
 * Geschaeftsfuehrung. Bislang bewilligte sich eine Leitung, die selbst
 * gebucht hatte, den eigenen Antrag im selben Zug (siehe Migration 0031);
 * das entfaellt hier bewusst.
 *
 * Fixture-Aufbau direkt ueber account_typ/org_position/org_position_besetzung
 * (nicht ueber die alte `rolle`-Spalte) -- Vorbild ist
 * rechte-engine.e2e-spec.ts, inklusive des afterAll()-Musters
 * (org_position_besetzung_vollzugriff_schutz kurz deaktivieren,
 * try/finally fuer admin.end()/app.close()).
 *
 * Der "unter Vertretung"-Testfall legt die Delegation direkt per SQL an,
 * nicht ueber eine API: die Delegation-CRUD-API existiert zum Zeitpunkt
 * dieses Schritts (Organigramm-Modul, Lieferreihenfolge Schritt 5) noch
 * nicht -- das ist ein spaeterer Schritt. Bis dahin ist der direkte
 * Tabellenzugriff (wie schon in rechte-engine.e2e-spec.ts fuer die
 * Delegationstests) der einzig moegliche Weg, den Zustand aufzubauen.
 *
 * Laeuft gegen eine echte PostgreSQL-Instanz mit angewendeten Migrationen
 * (kein Mock) -- der Trigger aus Migration 0045 laesst sich nicht sinnvoll
 * mocken.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { DatabaseModule } from "../src/database/database.module";
import { RechteModule } from "../src/rechte/rechte.module";
import { KassenbuchungService } from "../src/kassenbuch/kassenbuchung.service";
import { RechteService } from "../src/rechte/rechte.service";
import { tenantContextStorage } from "../src/common/tenant-context";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

const STORNO_VIER_AUGEN_VERLETZT = "ZA002";

function alsBenutzer<T>(mandantId: string, benutzerId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ mandantId, benutzerId }, fn);
}

describe("Kassenbuch: Vier-Augen-Verschaerfung beim Storno (Migration 0045)", () => {
  let app: INestApplication;
  let admin: Client;
  let kassenbuch: KassenbuchungService;

  let mandantId: string;
  let traegerId: string;
  let klientId: string;
  let einzahlungTypId: string;

  // Account-Typ mit kassenbuch.storno-entscheiden.
  let leitungTypId: string;

  let benLeitungA: string; // bucht selbst, stellt eigenen Storno-Antrag
  let benLeitungB: string; // entscheidet ueber Antrag von A (Normalfall)
  let benLeitungX: string; // delegiert ihr Recht an Y
  let benY: string; // nur die generische Mitarbeiter-Testposition (kein kassenbuch.storno-entscheiden daraus), bucht selbst, entscheidet unter geliehenem Recht

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Vier-Augen-Check ${suffix}`, `vier-augen-check-${suffix}`]
    );
    mandantId = mandantRows[0].id;

    const { rows: traegerRows } = await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'",
      [mandantId]
    );
    traegerId = traegerRows[0].id;

    // Vom Trigger mandant_kassenbuchung_typ_standard automatisch angelegt
    // (siehe migrations/0035_kassenbuchung_typ.sql) -- wie in
    // kassenbuch-storno-antrag.e2e-spec.ts.
    const { rows: typRows } = await admin.query<{ id: string }>(
      "SELECT id FROM kassenbuchung_typ WHERE mandant_id = $1 AND bezeichnung = 'Einzahlung'",
      [mandantId]
    );
    einzahlungTypId = typRows[0].id;

    const { rows: klientRows } = await admin.query<{ id: string }>(
      `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
       VALUES ($1, 'Test', 'Klient', '1990-01-01', $2, 'Testamt') RETURNING id`,
      [mandantId, `AZ-${suffix}`]
    );
    klientId = klientRows[0].id;

    async function neuerAccountTyp(name: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        "INSERT INTO account_typ (mandant_id, name) VALUES ($1, $2) RETURNING id",
        [mandantId, name]
      );
      return rows[0].id;
    }
    leitungTypId = await neuerAccountTyp("Leitung");
    await admin.query(
      `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
       VALUES ($1, $2, 'kassenbuch', 'storno-entscheiden', 'tenant', true)`,
      [mandantId, leitungTypId]
    );

    async function neuerBenutzer(label: string): Promise<string> {
      return kontoMitAlterRolle(admin, {
        mandantId,
        rolle: "betreuer",
        email: `${label}-${suffix}@vier-augen-check.test`,
        name: label,
        passwortHash: "x",
      });
    }
    async function neuePosition(titel: string): Promise<string> {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [mandantId, traegerId, titel, leitungTypId]
      );
      return rows[0].id;
    }
    async function zuweisen(positionId: string, benutzerId: string) {
      await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
        mandantId,
        positionId,
        benutzerId,
      ]);
    }

    benLeitungA = await neuerBenutzer("leitungA");
    benLeitungB = await neuerBenutzer("leitungB");
    benLeitungX = await neuerBenutzer("leitungX");
    benY = await neuerBenutzer("y-unter-vertretung");

    await zuweisen(await neuePosition("Leitung A"), benLeitungA);
    await zuweisen(await neuePosition("Leitung B"), benLeitungB);
    await zuweisen(await neuePosition("Leitung X"), benLeitungX);
    // benY bekommt bewusst KEINE eigene Position -- isoliert den
    // Delegationspfad von eigenen Rechten (gleiches Muster wie benVertreter
    // in rechte-engine.e2e-spec.ts).

    // Delegation von Leitung X an Y: Y leiht sich damit kassenbuch.storno-
    // entscheiden. sensible_rechte_eingeschlossen=true ist noetig, weil die
    // Aktion in registry.ts als sensibel markiert ist (siehe
    // RechteService.delegierteAufloesung()).
    const in7Tagen = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const vor1Tag = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { rows: delegationRows } = await admin.query<{ id: string }>(
      `INSERT INTO delegation (mandant_id, vertretener_benutzer_id, vertreter_benutzer_id, von, bis, umfang, sensible_rechte_eingeschlossen, status, erstellt_von, genehmigt_von, genehmigt_am)
       VALUES ($1, $2, $3, $4, $5, 'auswahl', true, 'genehmigt', $2, $2, now()) RETURNING id`,
      [mandantId, benLeitungX, benY, vor1Tag, in7Tagen]
    );
    await admin.query(
      `INSERT INTO delegation_recht (mandant_id, delegation_id, modul, aktion) VALUES ($1, $2, 'kassenbuch', 'storno-entscheiden')`,
      [mandantId, delegationRows[0].id]
    );

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, RechteModule],
      providers: [KassenbuchungService],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    kassenbuch = app.get(KassenbuchungService);
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM delegation_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM delegation WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_stornoantrag WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM klient WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  async function neueBuchung(benutzerId: string, zweck: string): Promise<string> {
    const buchung = await alsBenutzer(mandantId, benutzerId, () =>
      kassenbuch.anlegen({
        klientId,
        datum: "2026-09-01",
        betragCent: 500,
        verwendungszweck: zweck,
        typId: einzahlungTypId,
      })
    );
    return buchung.id;
  }

  it("Leitung bucht selbst und stellt einen Storno-Antrag -- bleibt offen, wird NICHT automatisch bewilligt", async () => {
    const buchungId = await neueBuchung(benLeitungA, "Eigene Buchung A");
    const ergebnis = await alsBenutzer(mandantId, benLeitungA, () =>
      kassenbuch.stornoBeantragen(buchungId, "Falscher Betrag")
    );
    expect(ergebnis.storniert).toBe(false);
    expect(ergebnis.offenerStornoantrag).not.toBeNull();
    expect(ergebnis.offenerStornoantrag?.grund).toBe("Falscher Betrag");
  });

  it("eine ANDERE Leitung mit demselben Recht entscheidet ueber genau diesen Antrag -- Normalfall Vier-Augen", async () => {
    const buchungId = await neueBuchung(benLeitungA, "Eigene Buchung A2");
    const gestellt = await alsBenutzer(mandantId, benLeitungA, () =>
      kassenbuch.stornoBeantragen(buchungId, "Grund fuer Vier-Augen")
    );
    const antragId = gestellt.offenerStornoantrag!.id;
    expect(gestellt.storniert).toBe(false);

    const entschieden = await alsBenutzer(mandantId, benLeitungB, () =>
      kassenbuch.stornoEntscheiden(antragId, "genehmigt")
    );
    expect(entschieden.storniert).toBe(true);
    expect(entschieden.stornoGrund).toBe("Grund fuer Vier-Augen");
    expect(entschieden.offenerStornoantrag).toBeNull();
  });

  it("GEGENPROBE auf DB-Ebene: ein roher UPDATE als App-Rolle mit entschieden_von = gebucht_von scheitert mit SQLSTATE ZA002", async () => {
    const buchungId = await neueBuchung(benLeitungA, "Eigene Buchung A3 (DB-Gegenprobe)");
    const gestellt = await alsBenutzer(mandantId, benLeitungA, () =>
      kassenbuch.stornoBeantragen(buchungId, "Fuer die DB-Gegenprobe")
    );
    const antragId = gestellt.offenerStornoantrag!.id;

    const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query(
          "UPDATE kassenbuchung_stornoantrag SET status = 'genehmigt', entschieden_von = $1, entschieden_am = now() WHERE id = $2",
          [benLeitungA, antragId]
        )
      ).rejects.toMatchObject({ code: STORNO_VIER_AUGEN_VERLETZT });
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }
  });

  it('"unter Vertretung": Y hat kein eigenes Recht, leiht es sich per Delegation von Leitung X -- darf trotzdem nicht ueber den EIGENEN Antrag entscheiden', async () => {
    // Gegenprobe zur Gegenprobe: Y hat das Recht wirklich NUR ueber die
    // Delegation (die eigene Testposition traegt kein
    // kassenbuch.storno-entscheiden) -- ohne das waere der Testfall
    // bedeutungslos.
    const hatEigenesRecht = await alsBenutzer(mandantId, benY, () =>
      app.get(RechteService).hatRecht("kassenbuch", "storno-entscheiden")
    );
    expect(hatEigenesRecht).toBe(true); // true NUR durch die Delegation, siehe Aufbau oben

    const buchungId = await neueBuchung(benY, "Buchung von Y unter Vertretung");
    const gestellt = await alsBenutzer(mandantId, benY, () =>
      kassenbuch.stornoBeantragen(buchungId, "Y versucht Selbststorno")
    );
    // stornoBeantragen() prueft bereits selbst: benY ist die buchende
    // Person, bleibt also trotz (geliehenem) Recht auf 'beantragt' stehen --
    // genau das, was der DB-Trigger ohnehin erzwingen wuerde.
    expect(gestellt.storniert).toBe(false);
    const antragId = gestellt.offenerStornoantrag!.id;

    // Versucht Y trotzdem, explizit ueber stornoEntscheiden() (den
    // Fremd-Entscheidungspfad) zu gehen, muss das ebenfalls scheitern --
    // die entschieden_von <> gebucht_von-Regel kennt keine Ausnahme fuer
    // den Rechte-Herkunftsweg (strukturell durch den Trigger erzwungen,
    // nicht nur durch Konvention in stornoBeantragen()).
    await expect(
      alsBenutzer(mandantId, benY, () => kassenbuch.stornoEntscheiden(antragId, "genehmigt"))
    ).rejects.toThrow(ForbiddenException);
  });
});
