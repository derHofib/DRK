-- Stammdaten der betreuten Person. Bewusst schlank: Stundensaldo und
-- Kostenuebernahme-Zeitraeume kommen NICHT als Felder hierher, sondern als
-- eigene Bewegungstabellen in einer spaeteren Phase (stundenbuchung,
-- kostenuebernahme) -- dieselbe "ableiten statt speichern"-Logik wie beim
-- Zimmerstatus, siehe Bauplan Punkt 03.
CREATE TYPE hzl_rhythmus AS ENUM ('monatlich', 'woechentlich');

CREATE TABLE klient (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  vorname        text NOT NULL,
  nachname       text NOT NULL,
  geburtsdatum   date NOT NULL,
  aktenzeichen   text NOT NULL,
  amt            text NOT NULL,
  hzl_rhythmus   hzl_rhythmus NOT NULL DEFAULT 'monatlich',
  erstellt_am    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (mandant_id, aktenzeichen)
);

COMMENT ON TABLE klient IS
  'Besondere Kategorie personenbezogener Daten (Art. 9 DSGVO) -- Sozialdaten nach SGB X. Siehe Bauplan Punkt 06 zu Loeschfristen.';

ALTER TABLE klient ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient FORCE ROW LEVEL SECURITY;

CREATE POLICY klient_isolation ON klient
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
