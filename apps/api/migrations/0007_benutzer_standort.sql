-- Das in 0004_benutzer.sql angekuendigte Nachziehen: Standort-Einschraenkung
-- als eigene Zuordnungstabelle, jetzt wo standort existiert.
--
-- Semantik: KEINE Zeile fuer einen Benutzer = keine Einschraenkung, er sieht
-- alle Standorte seines Mandanten (Standardfall, z.B. Leitung). Mit
-- mindestens einer Zeile ist er auf genau diese Standorte begrenzt (z.B.
-- eine Bezugsbetreuung, die nur in einem Haus arbeitet). Die Durchsetzung
-- passiert in den jeweiligen Service-Methoden (siehe zimmer.service.ts),
-- nicht per RLS auf dieser Tabelle selbst -- eine leere Zuordnungsliste
-- laesst sich in RLS nicht von "gar keine Berechtigung" unterscheiden.
--
-- mandant_id ist hier bewusst redundant zu benutzer.mandant_id gespeichert
-- (statt ueber einen Join hergeleitet) -- das haelt die RLS-Policy einfach
-- und schnell. Ein CHECK-Constraint kann diese Redundanz nicht gegen eine
-- andere Tabelle validieren (Postgres erlaubt das nicht), deshalb macht das
-- der Trigger unten: verhindert, dass irgendein Bug einen Benutzer mit dem
-- Standort eines anderen Mandanten verknuepft.
CREATE TABLE benutzer_standort (
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  benutzer_id uuid NOT NULL REFERENCES benutzer(id),
  standort_id uuid NOT NULL REFERENCES standort(id),
  PRIMARY KEY (benutzer_id, standort_id)
);

ALTER TABLE benutzer_standort ENABLE ROW LEVEL SECURITY;
ALTER TABLE benutzer_standort FORCE ROW LEVEL SECURITY;

CREATE POLICY benutzer_standort_isolation ON benutzer_standort
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

CREATE FUNCTION benutzer_standort_mandant_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mandant_id <> (SELECT mandant_id FROM benutzer WHERE id = NEW.benutzer_id) THEN
    RAISE EXCEPTION 'benutzer_standort: benutzer_id gehoert zu einem anderen Mandanten';
  END IF;
  IF NEW.mandant_id <> (SELECT mandant_id FROM standort WHERE id = NEW.standort_id) THEN
    RAISE EXCEPTION 'benutzer_standort: standort_id gehoert zu einem anderen Mandanten';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER benutzer_standort_mandant_pruefen
  BEFORE INSERT OR UPDATE ON benutzer_standort
  FOR EACH ROW EXECUTE FUNCTION benutzer_standort_mandant_pruefen();
