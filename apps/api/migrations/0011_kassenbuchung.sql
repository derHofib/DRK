-- Append-only, echt erzwungen -- nicht per Konvention, sondern per
-- Datenbankrecht. Eine falsche Buchung wird storniert, nicht korrigiert
-- (Bauplan Punkt 03): "storniert" ist die einzige Spalte, die sich nach
-- dem Anlegen noch aendern darf, und auch das nur mit Grund, Urheber und
-- Zeitpunkt. Betrag, Datum, Klient, Verwendungszweck sind ab dem Moment
-- des INSERT fuer die App-Rolle nicht mehr anfassbar -- das ist unten
-- keine Zusicherung im Code, sondern ein REVOKE/GRANT.
CREATE TYPE kassenbuchung_typ AS ENUM ('hzl', 'einzahlung', 'sonstiges');

CREATE TABLE kassenbuchung (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  klient_id         uuid NOT NULL REFERENCES klient(id),
  datum             date NOT NULL,
  betrag_cent       integer NOT NULL, -- negativ = Auszahlung, positiv = Einzahlung. Nie Fliesskomma (Bauplan Punkt 04).
  verwendungszweck  text NOT NULL,
  typ               kassenbuchung_typ NOT NULL,
  iso_jahr          integer,
  iso_woche         integer CHECK (iso_woche IS NULL OR iso_woche BETWEEN 1 AND 53),
  gebucht_von       uuid REFERENCES benutzer(id),
  erstellt_am       timestamptz NOT NULL DEFAULT now(),

  storniert         boolean NOT NULL DEFAULT false,
  storno_grund      text,
  storniert_von     uuid REFERENCES benutzer(id),
  storniert_am      timestamptz,

  CHECK (NOT storniert OR (storno_grund IS NOT NULL AND storniert_von IS NOT NULL AND storniert_am IS NOT NULL))
);

-- Hoechstens eine aktive (nicht stornierte) HZL-Zahlung je Klient und
-- Kalenderwoche. Ein Storno der bestehenden Zahlung setzt storniert=true
-- und macht die Woche damit fuer diesen partiellen Index wieder frei --
-- die Historie bleibt trotzdem vollstaendig erhalten, nur eben als
-- stornierte statt geloeschte Zeile.
CREATE UNIQUE INDEX hzl_einmal_je_woche
  ON kassenbuchung (klient_id, iso_jahr, iso_woche)
  WHERE typ = 'hzl' AND NOT storniert;

CREATE INDEX kassenbuchung_klient_idx ON kassenbuchung (klient_id);

ALTER TABLE kassenbuchung ENABLE ROW LEVEL SECURITY;
ALTER TABLE kassenbuchung FORCE ROW LEVEL SECURITY;

CREATE POLICY kassenbuchung_isolation ON kassenbuchung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Die App-Rolle bekommt durch ALTER DEFAULT PRIVILEGES (0002_app_role.sql)
-- automatisch UPDATE/DELETE auf jede neue Tabelle -- hier wird das
-- ausdruecklich wieder entzogen und durch eine eng umrissene
-- Spalten-Berechtigung ersetzt.
REVOKE UPDATE, DELETE ON kassenbuchung FROM zimmerakte_app;
GRANT UPDATE (storniert, storno_grund, storniert_von, storniert_am) ON kassenbuchung TO zimmerakte_app;
