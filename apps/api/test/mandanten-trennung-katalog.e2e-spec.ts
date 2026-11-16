/**
 * Katalogtest: jede fachliche Tabelle ist nach Mandant getrennt.
 *
 * Warum zusätzlich zu mandanten-trennung.e2e-spec.ts: Der dortige Test prüft
 * ausgewählte Tabellen über den HTTP-Pfad. Eine NEUE Tabelle ohne Row Level
 * Security würde dort nicht auffallen, solange niemand einen Test für sie
 * schreibt -- und genau das ist der teure Fehler (Art. 9 DSGVO, SGB X).
 * Dieser Test liest deshalb den Systemkatalog und wird rot, sobald eine
 * Tabelle in `public` die Regeln aus CLAUDE.md, Punkt 1, verletzt.
 *
 * Wer eine Tabelle bewusst OHNE Mandantenbezug anlegt, trägt sie in
 * TABELLEN_OHNE_MANDANTENBEZUG ein -- mit Begründung. Das ist Absicht: die
 * Ausnahme soll im Codereview sichtbar sein.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** Tabellen ohne `mandant_id`-Spalte. Jede Ausnahme braucht eine Begründung. */
const TABELLEN_OHNE_MANDANTENBEZUG = new Map<string, string>([
  ["_migrations", "Migrationsverwaltung des Skripts, keine Fachdaten; die App-Rolle hat keinen Zugriff darauf."],
  ["mandant", "Ist der Mandant selbst; getrennt über `id` statt `mandant_id` (Policy mandant_isolation)."],
]);

const MANDANT_KONTEXT = "app.mandant_id";

interface Tabelle {
  name: string;
  rls: boolean;
  erzwungen: boolean;
  hatMandantId: boolean;
  mandantIdNotNull: boolean;
  mandantIdFkAufMandant: boolean;
}

interface Policy {
  tabelle: string;
  name: string;
  befehl: "r" | "a" | "w" | "d" | "*";
  erlaubend: boolean;
  using: string | null;
  check: string | null;
}

describe("Mandantentrennung: Katalogprüfung aller Tabellen", () => {
  let admin: Client;
  let tabellen: Tabelle[];
  let policies: Policy[];

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    tabellen = (
      await admin.query(`
        SELECT c.relname AS name,
               c.relrowsecurity AS rls,
               c.relforcerowsecurity AS erzwungen,
               a.attnum IS NOT NULL AS "hatMandantId",
               COALESCE(a.attnotnull, false) AS "mandantIdNotNull",
               EXISTS (
                 SELECT 1 FROM pg_constraint k
                 WHERE k.conrelid = c.oid AND k.contype = 'f'
                   AND k.confrelid = 'public.mandant'::regclass
                   AND k.conkey = ARRAY[a.attnum]
               ) AS "mandantIdFkAufMandant"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute a
               ON a.attrelid = c.oid AND a.attname = 'mandant_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`)
    ).rows;

    policies = (
      await admin.query(`
        SELECT c.relname AS tabelle, p.polname AS name, p.polcmd AS befehl,
               p.polpermissive AS erlaubend,
               pg_get_expr(p.polqual, p.polrelid) AS "using",
               pg_get_expr(p.polwithcheck, p.polrelid) AS "check"
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'`)
    ).rows;
  });

  afterAll(async () => {
    await admin.end();
  });

  const fachlich = () => tabellen.filter((t) => !TABELLEN_OHNE_MANDANTENBEZUG.has(t.name));
  const bindetMandant = (ausdruck: string | null) => !!ausdruck && ausdruck.includes(MANDANT_KONTEXT);

  it("findet überhaupt Tabellen (ein leerer Katalog darf nicht als grün durchgehen)", () => {
    expect(fachlich().length).toBeGreaterThan(30);
  });

  it("Ausnahmeliste enthält nur Tabellen, die es gibt", () => {
    const vorhanden = new Set(tabellen.map((t) => t.name));
    const veraltet = [...TABELLEN_OHNE_MANDANTENBEZUG.keys()].filter((n) => !vorhanden.has(n));
    expect(veraltet).toEqual([]);
  });

  it("jede fachliche Tabelle hat mandant_id uuid NOT NULL mit Fremdschlüssel auf mandant(id)", () => {
    const fehlerhaft = fachlich()
      .filter((t) => !t.hatMandantId || !t.mandantIdNotNull || !t.mandantIdFkAufMandant)
      .map((t) => t.name);
    expect(fehlerhaft).toEqual([]);
  });

  it("jede fachliche Tabelle hat RLS aktiviert UND erzwungen (FORCE)", () => {
    const ohneRls = fachlich().filter((t) => !t.rls).map((t) => t.name);
    const ohneForce = fachlich().filter((t) => t.rls && !t.erzwungen).map((t) => t.name);
    expect({ ohneRls, ohneForce }).toEqual({ ohneRls: [], ohneForce: [] });
  });

  it("die Mandant-Tabelle selbst ist ebenfalls per RLS geschützt", () => {
    const mandant = tabellen.find((t) => t.name === "mandant");
    expect(mandant).toMatchObject({ rls: true, erzwungen: true });
  });

  it("jede fachliche Tabelle hat mindestens eine Policy", () => {
    const mitPolicy = new Set(policies.map((p) => p.tabelle));
    expect(fachlich().filter((t) => !mitPolicy.has(t.name)).map((t) => t.name)).toEqual([]);
  });

  it("jede erlaubende Policy bindet an app.mandant_id (USING bzw. WITH CHECK)", () => {
    // INSERT-Policies haben kein USING, Lese-Policies kein WITH CHECK -- geprüft
    // wird der Ausdruck, der für den jeweiligen Befehl tatsächlich gilt.
    const lose = policies
      .filter((p) => p.erlaubend)
      .filter((p) => {
        const ausdruecke = [p.using, p.check].filter((a): a is string => a !== null);
        return ausdruecke.length === 0 || !ausdruecke.every(bindetMandant);
      })
      .map((p) => `${p.tabelle}.${p.name}`);
    expect(lose).toEqual([]);
  });

  it("die App-Rolle kann RLS nicht umgehen (kein SUPERUSER, kein BYPASSRLS)", async () => {
    const { rows } = await admin.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'zimmerakte_app'"
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it("die App-Rolle ist nirgends Eigentümerin einer Tabelle", async () => {
    // Auch FORCE ROW LEVEL SECURITY ließe sich als Eigentümerin per
    // ALTER TABLE ... DISABLE ROW LEVEL SECURITY selbst abschalten.
    const { rows } = await admin.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND pg_get_userbyid(c.relowner) = 'zimmerakte_app'`);
    expect(rows).toEqual([]);
  });

  it("ohne Mandantenkontext oder mit fremdem Mandanten liefert jede Tabelle als App-Rolle 0 Zeilen", async () => {
    // Verhaltensprobe zusätzlich zur Katalogprüfung: der frische Mandant
    // bringt Zeilen mit (mandant, Standard-Buchungstypen), die mit leerem
    // oder fremdem Kontext unsichtbar sein müssen.
    const fremd = randomUUID();
    const slug = `katalog-${fremd.slice(0, 8)}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Katalogtest ${slug}`, slug]
    );
    const eigenerMandant = rows[0].id;
    const app = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await app.connect();
    try {
      // Tabellen, die die App-Rolle gar nicht lesen darf, sind per Grant
      // geschützt (z. B. kassenbuch_nummernkreis) und hier nicht messbar.
      const { rows: lesbareRows } = await admin.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
           AND has_table_privilege('zimmerakte_app', c.oid, 'SELECT')`
      );
      const lesbar = lesbareRows.map((r) => ({ name: r.name }));
      expect(lesbar.length).toBeGreaterThan(30);
      const nichtGeprueft: string[] = [];
      for (const kontext of [null, fremd]) {
        await app.query("BEGIN");
        // Ohne gesetzten Kontext liefert current_setting(.., true) NULL; ein
        // leerer String würde stattdessen beim uuid-Cast abbrechen.
        if (kontext) await app.query("SELECT set_config($1, $2, true)", [MANDANT_KONTEXT, kontext]);
        for (const t of lesbar) {
          const { rows: zaehler } = await app.query(`SELECT count(*)::int AS n FROM "${t.name}"`);
          if (zaehler[0].n !== 0) nichtGeprueft.push(`${t.name} (${zaehler[0].n} Zeilen, Kontext ${kontext ?? "leer"})`);
        }
        await app.query("ROLLBACK");
      }
      expect(nichtGeprueft).toEqual([]);
    } finally {
      await app.end();
      // Das Anlegen eines Mandanten erzeugt Standardzeilen in mehreren Tabellen
      // (Trigger). Statt deren Reihenfolge nachzubauen -- die beim nächsten
      // Trigger veraltet wäre -- räumt der Admin über den Katalog auf; die
      // Fremdschlüsselprüfung ist dafür nur in dieser Transaktion ausgesetzt.
      await admin.query("BEGIN");
      await admin.query("SET LOCAL session_replication_role = replica");
      for (const t of tabellen.filter((x) => x.hatMandantId)) {
        await admin.query(`DELETE FROM "${t.name}" WHERE mandant_id = $1`, [eigenerMandant]);
      }
      await admin.query("DELETE FROM mandant WHERE id = $1", [eigenerMandant]);
      await admin.query("COMMIT");
    }
  });
});
