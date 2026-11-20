-- Dokumentation: alle Formulare ausfuellen, auch ohne Klient:in
-- (Rueckmeldung „Dokumentation“, Konzept
-- /mnt/project-files/dokumentation-formulare/konzept-dokumentation-formulare.md,
-- freigegeben 20.11.2026).
--
-- Bisher gehoerte jedes Protokoll zu einer Klient:in (0075: klient_id NOT NULL,
-- formular.bezug nur 'klient'). Eine Teambesprechung oder Brandschutzbegehung
-- liess sich damit gar nicht abbilden. Neu waehlt jedes Formular eine
-- Zuordnung: klient (wie bisher), klient_wahlweise, standort, ohne.
--
-- Die Zuordnung steht in der DEFINITION der Version (definition->>'zuordnung'),
-- nicht am Formular: sie aendert, was beim Ausfuellen gefragt wird, und ein
-- bereits ausgefuelltes Dokument muss seine Zuordnung behalten. Die Spalte
-- unten ist daraus GENERIERT -- ein Ort fuer die Wahrheit (CLAUDE.md Regel 4),
-- aber fuer CHECK und Trigger in SQL greifbar. Veroeffentlichte Versionen sind
-- ohnehin eingefroren (Trigger formular_version_eingefroren).
--
-- formular.bezug (0075) bleibt stehen, wird aber nicht mehr gelesen.

ALTER TABLE formular_version
  ADD COLUMN zuordnung text GENERATED ALWAYS AS (COALESCE(definition ->> 'zuordnung', 'klient')) STORED;
ALTER TABLE formular_version
  ADD CONSTRAINT formular_version_zuordnung_check
  CHECK (zuordnung IN ('klient', 'klient_wahlweise', 'standort', 'ohne'));

-- Ob das Formular auf der Seite Dokumentation zum Ausfuellen angeboten wird.
-- Gehoert zum Formular (WO es angeboten wird), wie Standorte und Anheftungen
-- in 0076 -- eine neue Version nur dafuer waere Rauschen.
ALTER TABLE formular ADD COLUMN auf_dokumentation boolean NOT NULL DEFAULT true;
GRANT UPDATE (auf_dokumentation) ON formular TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Protokoll: Klient:in, Standort oder nichts
-- ---------------------------------------------------------------------------

ALTER TABLE protokoll ALTER COLUMN klient_id DROP NOT NULL;
ALTER TABLE protokoll ADD COLUMN standort_id uuid;
-- Zusammengesetzt (CLAUDE.md Regel 1): ein Protokoll kann nie auf den Standort
-- eines fremden Traegers zeigen. standort_id_mandant_uq stammt aus 0076.
ALTER TABLE protokoll
  ADD CONSTRAINT protokoll_standort_fk FOREIGN KEY (standort_id, mandant_id) REFERENCES standort (id, mandant_id);
CREATE INDEX protokoll_standort_idx ON protokoll (standort_id, bezugsdatum DESC) WHERE standort_id IS NOT NULL;

ALTER TABLE protokoll ADD CONSTRAINT protokoll_ein_bezug CHECK (num_nonnulls(klient_id, standort_id) <= 1);
-- Der FK auf den Tagesbericht laeuft ueber (tagesbericht_id, klient_id) und
-- wuerde bei klient_id NULL gar nicht geprueft (MATCH SIMPLE). Ein Tagesbericht
-- gehoert immer zu einer Klient:in, also auch jedes angeheftete Protokoll.
ALTER TABLE protokoll ADD CONSTRAINT protokoll_tagesbericht_braucht_klient
  CHECK (tagesbericht_id IS NULL OR klient_id IS NOT NULL);

-- Neu hinzugefuegte Spalte ohne UPDATE-Recht (0075 vergibt Spaltenrechte
-- einzeln): der Bezug wird beim Anlegen festgelegt und nie umgehaengt.

-- Passt der Bezug zur Zuordnung der Version? In der Datenbank, nicht nur im
-- Service (Regel 5): sonst koennte ein Protokoll einer Klienten-Pflicht-Version
-- ohne Klient:in entstehen und in keiner Akte auftauchen.
CREATE FUNCTION protokoll_bezug_passt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  z text;
BEGIN
  SELECT zuordnung INTO z FROM formular_version WHERE id = NEW.formular_version_id;
  IF z = 'klient' AND (NEW.klient_id IS NULL OR NEW.standort_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Dieses Formular gehört zu einer Klient:in.' USING ERRCODE = 'check_violation';
  ELSIF z = 'klient_wahlweise' AND NEW.standort_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dieses Formular gehört zu keinem Standort.' USING ERRCODE = 'check_violation';
  ELSIF z = 'standort' AND (NEW.standort_id IS NULL OR NEW.klient_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Dieses Formular gehört zu einem Standort.' USING ERRCODE = 'check_violation';
  ELSIF z = 'ohne' AND (NEW.klient_id IS NOT NULL OR NEW.standort_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Dieses Formular hat keine Zuordnung.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protokoll_bezug_passt
  BEFORE INSERT ON protokoll
  FOR EACH ROW EXECUTE FUNCTION protokoll_bezug_passt();
