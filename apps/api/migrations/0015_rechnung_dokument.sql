-- Das eingescannte/hochgeladene Rechnungsdokument, getrennt von rechnung
-- gehalten (nicht jede Rechnung hat sofort ein Dokument -- "beantragt"
-- kann formlos telefonisch passieren, das Dokument kommt oft erst mit der
-- Genehmigung nach). Gleicher bewusste bytea-Kompromiss wie unterschrift
-- in 0012, mit demselben Hash-Nachweis.
CREATE TABLE rechnung_dokument (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  rechnung_id  uuid NOT NULL REFERENCES rechnung(id),
  dateiname    text NOT NULL,
  mime_type    text NOT NULL,
  inhalt       bytea NOT NULL,
  inhalt_hash  text NOT NULL, -- sha256, hex-kodiert
  hochgeladen_von uuid REFERENCES benutzer(id),
  erstellt_am  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (rechnung_id)
);

ALTER TABLE rechnung_dokument ENABLE ROW LEVEL SECURITY;
ALTER TABLE rechnung_dokument FORCE ROW LEVEL SECURITY;

CREATE POLICY rechnung_dokument_isolation ON rechnung_dokument
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON rechnung_dokument FROM zimmerakte_app;
