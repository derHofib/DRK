-- Das Herzstueck aus Bauplan Punkt 04. Zwei Garantien, beide von der
-- Datenbank erzwungen, keine im Anwendungscode -- eine Race Condition
-- zwischen zwei gleichzeitigen Buchungen kann eine Service-Layer-Pruefung
-- nicht zuverlaessig verhindern, ein Exclusion-Constraint schon.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE belegung (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  zimmer_id    uuid NOT NULL REFERENCES zimmer(id),
  klient_id    uuid NOT NULL REFERENCES klient(id),
  einzug       date NOT NULL,
  auszug       date,
  gebucht_von  uuid REFERENCES benutzer(id),
  erstellt_am  timestamptz NOT NULL DEFAULT now(),

  CHECK (auszug IS NULL OR auszug > einzug)
);

-- Garantie 1: Ein Zimmer hat zu keinem Zeitpunkt zwei ueberlappende
-- Belegungen. "[)" macht das Ende exklusiv -- ein Einzug am Tag eines
-- Auszugs ist kein Konflikt, sondern der normale Zimmerwechsel.
ALTER TABLE belegung ADD CONSTRAINT belegung_zimmer_ohne_ueberlappung
  EXCLUDE USING gist (
    zimmer_id WITH =,
    daterange(einzug, auszug, '[)') WITH &&
  );

-- Garantie 2: Eine Person kann nicht gleichzeitig in zwei Zimmern gefuehrt
-- werden -- unabhaengig davon, ob im selben oder einem anderen Haus.
ALTER TABLE belegung ADD CONSTRAINT belegung_klient_ohne_ueberlappung
  EXCLUDE USING gist (
    klient_id WITH =,
    daterange(einzug, auszug, '[)') WITH &&
  );

CREATE INDEX belegung_zimmer_idx ON belegung (zimmer_id);
CREATE INDEX belegung_klient_idx ON belegung (klient_id);

ALTER TABLE belegung ENABLE ROW LEVEL SECURITY;
ALTER TABLE belegung FORCE ROW LEVEL SECURITY;

CREATE POLICY belegung_isolation ON belegung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
