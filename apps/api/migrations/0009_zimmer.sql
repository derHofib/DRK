-- Kein Statusfeld. Das ist keine Unvollstaendigkeit, sondern die zentrale
-- Entscheidung aus dem Bauplan (Punkt 03): der Belegungsstatus wird aus
-- belegung abgeleitet (siehe naechste Migration), nie hier gespeichert.
CREATE TABLE zimmer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  standort_id uuid NOT NULL REFERENCES standort(id),
  nummer      text NOT NULL,
  aktiv       boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now(),

  UNIQUE (standort_id, nummer)
);

ALTER TABLE zimmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE zimmer FORCE ROW LEVEL SECURITY;

CREATE POLICY zimmer_isolation ON zimmer
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
