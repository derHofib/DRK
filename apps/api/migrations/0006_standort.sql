-- Ein Haus mit Adresse. Ein Mandant hat beliebig viele -- die Anforderung
-- "mehrere Haeuser" aus dem Bauplan ist damit von der ersten Zeile an
-- abgebildet, nicht nachtraeglich draufgesetzt.
CREATE TABLE standort (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  name        text NOT NULL,
  adresse     text NOT NULL,
  aktiv       boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE standort ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort FORCE ROW LEVEL SECURITY;

CREATE POLICY standort_isolation ON standort
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
