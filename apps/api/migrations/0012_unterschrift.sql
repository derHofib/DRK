-- Getrennt von kassenbuchung gehalten, damit die Buchungstabelle schlank
-- bleibt (Bauplan Punkt 04) -- die meisten Buchungen (Einzahlungen,
-- Sonstiges) haben gar keine Unterschrift.
--
-- bild liegt hier direkt als bytea in Postgres, nicht im Objektspeicher.
-- Das ist ein bewusster Kompromiss fuer diese Phase (Signaturbilder sind
-- klein, wenige KB als PNG) und KEIN Widerspruch zur Doku in
-- README/Bauplan, die fuer Dokumente generell Objektspeicher vorsieht --
-- vor dem Produktivbetrieb nachzuziehen, sobald S3-Anbindung existiert.
-- bild_hash macht das schon jetzt nachweisbar manipulationssicher: eine
-- nachtraeglich vertauschte Datei liesse sich am Hash erkennen, selbst
-- wenn die bytea-Spalte irgendwann doch mal aendbar waere.
CREATE TABLE unterschrift (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       uuid NOT NULL REFERENCES mandant(id),
  kassenbuchung_id uuid NOT NULL REFERENCES kassenbuchung(id),
  bild             bytea NOT NULL,
  bild_hash        text NOT NULL, -- sha256, hex-kodiert
  erstellt_am      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (kassenbuchung_id)
);

ALTER TABLE unterschrift ENABLE ROW LEVEL SECURITY;
ALTER TABLE unterschrift FORCE ROW LEVEL SECURITY;

CREATE POLICY unterschrift_isolation ON unterschrift
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Genau wie die Buchung selbst: einmal geschrieben, nie mehr geaendert
-- oder geloescht. Eine falsche Unterschrift gehoert zu einer stornierten
-- Buchung, nicht zu einer ausgetauschten Datei.
REVOKE UPDATE, DELETE ON unterschrift FROM zimmerakte_app;
