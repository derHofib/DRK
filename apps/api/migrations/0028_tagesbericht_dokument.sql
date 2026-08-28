-- Dokumente (Fotos, Scans) zu einem Tagesbericht -- bewusst OHNE
-- UNIQUE(tagesbericht_id) wie bei rechnung_dokument (0015): ein
-- Tagesbericht begleiten oft mehrere Belegfotos, eine Rechnung genau ein
-- Dokument. Gleicher bewusster bytea-Kompromiss wie unterschrift (0012)
-- und rechnung_dokument, mit demselben Hash-Nachweis.
CREATE TABLE tagesbericht_dokument (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  tagesbericht_id uuid NOT NULL REFERENCES tagesbericht(id),
  dateiname       text NOT NULL,
  mime_type       text NOT NULL,
  inhalt          bytea NOT NULL,
  inhalt_hash     text NOT NULL, -- sha256, hex-kodiert
  hochgeladen_von uuid REFERENCES benutzer(id),
  erstellt_am     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tagesbericht_dokument_tagesbericht_idx ON tagesbericht_dokument (tagesbericht_id);

ALTER TABLE tagesbericht_dokument ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagesbericht_dokument FORCE ROW LEVEL SECURITY;

CREATE POLICY tagesbericht_dokument_isolation ON tagesbericht_dokument
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Wie rechnung_dokument (0015) und der Tagesbericht selbst (0024): einmal
-- hochgeladen, nie mehr geaendert oder geloescht -- Teil der fachlichen
-- Dokumentation, muss fuer Amtsnachfragen unveraendert nachvollziehbar
-- bleiben.
REVOKE UPDATE, DELETE ON tagesbericht_dokument FROM zimmerakte_app;
