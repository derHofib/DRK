-- Organigramm-Nachtrag (Darstellung/Flexibilitaet, Live-Rueckmeldung nach
-- Abschluss des urspruenglichen Organigramm-Moduls): zwei unabhaengige
-- Ergaenzungen.
--
-- 1) Manuelle Geschwister-Reihenfolge fuer org_unit und org_position.
-- NULL = noch nie manuell sortiert -- die Lesequery (organigramm.service.ts)
-- sortiert dann per COALESCE(reihenfolge, 2147483647), Name/Titel ans Ende,
-- stabil, ohne dass Bestandsdaten migriert werden muessten.
ALTER TABLE org_unit     ADD COLUMN reihenfolge int;
ALTER TABLE org_position ADD COLUMN reihenfolge int;

-- 2) Mehrfachzuordnung einer LINIEN-Position zu weiteren Organisations-
-- einheiten (z.B. eine Einrichtungsleitung mit zwei Einrichtungen) -- eine
-- echte Datenmodell-Erweiterung, keine rein visuelle Verknuepfung: die
-- Rechte-Engine (rechte.service.ts::orgUnitIdsFuerScope()) loest Scopes wie
-- "einrichtung"/"bereich"/"subtree"/"team" kuenftig ueber ALLE zugeordneten
-- Einheiten auf (Vereinigung), nicht nur ueber org_position.org_unit_id.
--
-- Bewusst NUR fuer typ='linie': Stabsstellen haben mit
-- org_position_stabsstelle_scope (Migration 0042) bereits einen
-- allgemeineren, mehrfachen Org-Unit-Scope (inklusive traegerweit) -- ein
-- zweiter, ueberlappender Mechanismus fuer denselben Zweck waere zwei
-- Quellen fuer dieselbe Information.
CREATE TABLE org_position_weitere_einheit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  position_id uuid NOT NULL REFERENCES org_position(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),

  UNIQUE (position_id, org_unit_id)
);

ALTER TABLE org_position_weitere_einheit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_weitere_einheit FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_weitere_einheit_isolation ON org_position_weitere_einheit
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Guard-Trigger exakt nach dem Muster von
-- org_position_stabsstelle_scope_pruefen() (Migration 0042): nur
-- Linienpositionen, und die "weitere" Einheit darf nicht die eigene
-- org_unit_id der Position sein (das waere kein Zugewinn, sondern ein
-- Duplikat derselben Zuordnung).
CREATE FUNCTION org_position_weitere_einheit_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_typ org_position_typ;
  v_eigene_einheit uuid;
BEGIN
  SELECT typ, org_unit_id INTO v_typ, v_eigene_einheit FROM org_position WHERE id = NEW.position_id;
  IF v_typ <> 'linie' THEN
    RAISE EXCEPTION 'Weitere Organisationseinheiten gibt es nur fuer Linienpositionen -- Stabsstellen nutzen org_position_stabsstelle_scope.';
  END IF;
  IF NEW.org_unit_id = v_eigene_einheit THEN
    RAISE EXCEPTION 'Die weitere Einheit darf nicht die bereits zugeordnete Heimat-Einheit der Position sein.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_weitere_einheit_pruefen
  BEFORE INSERT OR UPDATE ON org_position_weitere_einheit
  FOR EACH ROW EXECUTE FUNCTION org_position_weitere_einheit_pruefen();
