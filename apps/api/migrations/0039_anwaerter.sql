-- Anwärter: eine abgespeckte Vorstufe des Klienten für Anfragen, bevor ein
-- Aktenzeichen existiert (Jugendamt ruft an, Familie meldet sich -- die
-- Aufnahme ist noch nicht entschieden). Bewusst eine eigene Tabelle statt
-- optionaler Felder auf klient: ein Klient bleibt damit immer vollständig,
-- nichts im bestehenden Code (Kassenbuch, Rechnungen, Zimmerzuweisung)
-- muss einen unvollständigen Klienten vertragen. Bei Annahme entsteht ein
-- echter klient-Datensatz, der Anwärter verweist danach nur noch darauf.
CREATE TYPE anwaerter_status AS ENUM ('offen', 'angenommen', 'abgelehnt');

CREATE TABLE anwaerter (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id         uuid NOT NULL REFERENCES mandant(id),
  vorname            text NOT NULL,
  nachname           text NOT NULL,
  geburtsdatum       date,
  telefon            text,
  email              text,
  anfragende_stelle  text,
  notiz              text,
  status             anwaerter_status NOT NULL DEFAULT 'offen',
  ablehnung_grund    text,
  klient_id          uuid REFERENCES klient(id),
  erstellt_von       uuid REFERENCES benutzer(id),
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  entschieden_von    uuid REFERENCES benutzer(id),
  entschieden_am     timestamptz,

  -- Gleiches Vier-Augen-Konsistenzmuster wie zimmer_kapazitaetsantrag
  -- (0032) und kassenbuchung_stornoantrag (0031): der Status bestimmt
  -- eindeutig, welche Begleitfelder gesetzt sein müssen.
  CHECK (status <> 'offen' OR (entschieden_von IS NULL AND entschieden_am IS NULL
         AND ablehnung_grund IS NULL AND klient_id IS NULL)),
  CHECK (status <> 'angenommen' OR (entschieden_von IS NOT NULL AND entschieden_am IS NOT NULL
         AND klient_id IS NOT NULL AND ablehnung_grund IS NULL)),
  CHECK (status <> 'abgelehnt' OR (entschieden_von IS NOT NULL AND entschieden_am IS NOT NULL
         AND ablehnung_grund IS NOT NULL AND klient_id IS NULL))
);

CREATE INDEX anwaerter_mandant_status_idx ON anwaerter (mandant_id, status);

ALTER TABLE anwaerter ENABLE ROW LEVEL SECURITY;
ALTER TABLE anwaerter FORCE ROW LEVEL SECURITY;

CREATE POLICY anwaerter_isolation ON anwaerter
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Kein spaltenscharfes REVOKE hier: anders als Kassenbuch/Tagesbericht ist
-- das kein unveränderliches Beleg-Protokoll, sondern ein Arbeitsvorgang --
-- Kontaktdaten dürfen korrigiert werden, solange die Anfrage offen ist.
-- Das erzwingt der Service ("WHERE status = 'offen'"), nicht das
-- Rechtesystem. DELETE bleibt im Service ebenso auf 'offen' beschränkt --
-- eine getroffene Entscheidung bleibt nachvollziehbar erhalten.
