-- Vier Rollen aus dem Bauplan (Punkt 05). Bewusst ein ENUM und keine
-- Lookup-Tabelle -- solange Rollen nicht mandantenspezifisch anpassbar sein
-- muessen, ist das die einfachere, nicht die faulere Loesung. Wird das
-- irgendwann noetig, ist die Migration auf eine Tabelle strassenklar, aber
-- nicht vorab noetig.
CREATE TYPE benutzer_rolle AS ENUM (
  'leitung',
  'verwaltung',
  'bezugsbetreuung',
  'springer'
);

CREATE TABLE benutzer (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       uuid NOT NULL REFERENCES mandant(id),
  email            citext NOT NULL,
  name             text NOT NULL,
  passwort_hash    text NOT NULL,
  rolle            benutzer_rolle NOT NULL,
  -- 2FA: Schema ist vorbereitet, die Erzwingung im Login-Flow ist NICHT Teil
  -- von Phase 0 -- siehe README, Abschnitt "Was hier bewusst fehlt".
  totp_secret      text,
  totp_aktiviert   boolean NOT NULL DEFAULT false,
  aktiv            boolean NOT NULL DEFAULT true,
  erstellt_am      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (mandant_id, email)
);

COMMENT ON TABLE benutzer IS
  'Mitarbeitende. Gehoeren zu genau einem Mandanten; die Standort-Einschraenkung kommt in Phase 1 als eigene Zuordnungstabelle, sobald standort existiert.';
COMMENT ON COLUMN benutzer.totp_secret IS
  'Verschluesselt an der Anwendungsschicht abzulegen, sobald der 2FA-Flow gebaut wird -- hier bewusst nur das Feld, kein Klartext-Vertrauen ins Schema.';

ALTER TABLE benutzer ENABLE ROW LEVEL SECURITY;
ALTER TABLE benutzer FORCE ROW LEVEL SECURITY;

CREATE POLICY benutzer_isolation ON benutzer
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
