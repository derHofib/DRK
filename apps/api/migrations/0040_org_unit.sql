-- Organigramm-Modul, erster Schritt (reines Datenmodell, siehe Plan
-- "Organigramm-Modul mit Positions- und Rechteverwaltung"): die
-- Organisationseinheiten-Hierarchie Traeger -> Einrichtung -> Bereich ->
-- Team. "standort" bleibt unveraendert bestehen (von zimmer, kassenbuchung,
-- benutzer_standort referenziert) -- ein Umbau auf eine generische
-- org_unit-Tabelle haette riesigen Blast-Radius fuer keinen fachlichen
-- Gewinn, da heute nur die Einrichtungsebene real genutzt wird. org_unit
-- legt sich stattdessen als Baum DARUEBER: jede Einrichtung bekommt genau
-- einen org_unit-Knoten (typ='einrichtung'), 1:1 mit ihrem standort
-- verknuepft; Bereich/Team sind rein neu und optional, reine
-- Positions-Behaelter in dieser Phase (Zimmer/Klient/Kassenbuchung bleiben
-- an standort_id haengen, bekommen keine eigene org_unit_id).
CREATE TYPE org_unit_typ AS ENUM ('traeger', 'einrichtung', 'bereich', 'team');

-- ON DELETE CASCADE auf mandant/standort ist eine bewusste Ausnahme von der
-- sonstigen Projektkonvention (kein bestehendes Table-FK auf mandant
-- kaskadiert, siehe andere Migrationen) -- org_unit ist aber eine
-- automatisch gepflegte SCHATTEN-Struktur, die mandant/standort 1:1
-- spiegelt (siehe Trigger unten), kein eigenstaendiger Fachdatensatz mit
-- eigenem Wert. In der Praxis wird mandant/standort nie hart geloescht
-- (Produktionscode deaktiviert nur, siehe standort.aktiv) -- das passiert
-- ausschliesslich in Test-Teardowns, die mandant/standort direkt per
-- DELETE entfernen, ohne die neue, ihnen unbekannte org_unit-Tabelle
-- mitzupflegen. Ohne CASCADE wuerde jeder bestehende e2e-Test fehlschlagen,
-- sobald sein Teardown einen Mandanten/standort loescht, der inzwischen
-- einen org_unit-Knoten hat.
CREATE TABLE org_unit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES org_unit(id),
  typ         org_unit_typ NOT NULL,
  standort_id uuid REFERENCES standort(id) ON DELETE CASCADE,
  name        text NOT NULL,
  aktiv       boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now(),

  -- Genau der Traeger-Wurzelknoten hat keinen Elternknoten -- alles
  -- andere haengt irgendwo darunter.
  CHECK ((typ = 'traeger') = (parent_id IS NULL)),
  -- standort_id ist exklusiv fuer die Einrichtungsebene reserviert.
  CHECK (typ = 'einrichtung' OR standort_id IS NULL),
  CHECK (typ <> 'einrichtung' OR standort_id IS NOT NULL)
);

COMMENT ON TABLE org_unit IS
  'Organisationseinheiten-Baum (Traeger/Einrichtung/Bereich/Team) ueber dem bestehenden standort. Siehe Organigramm-Plan fuer die Begruendung, warum standort nicht ersetzt wird.';

-- Pro Mandant genau ein Traeger-Wurzelknoten; pro standort hoechstens ein
-- org_unit-Knoten (die 1:1-Verknuepfung).
CREATE UNIQUE INDEX org_unit_ein_traeger_je_mandant
  ON org_unit (mandant_id) WHERE typ = 'traeger';
CREATE UNIQUE INDEX org_unit_standort_eindeutig
  ON org_unit (standort_id) WHERE standort_id IS NOT NULL;
CREATE INDEX org_unit_parent_idx ON org_unit (parent_id);

ALTER TABLE org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit FORCE ROW LEVEL SECURITY;

CREATE POLICY org_unit_isolation ON org_unit
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Closure Table statt ltree/rekursiver CTE pro Request: die Rechtepruefung
-- (naechster Planungsschritt) laeuft auf JEDEM Request im heissen Pfad --
-- eine Closure Table macht Vorfahren-/Nachfahren-Lookups zu einem simplen
-- indizierten Join statt einer Baumwanderung pro Check, ohne eine neue
-- Postgres-Extension einzufuehren (im Projekt bislang ungenutzt).
-- mandant_id bekommt hier ebenfalls ON DELETE CASCADE (gleiche Begruendung
-- wie bei org_unit oben): ohne eigenes CASCADE wuerde diese direkte
-- Fremdschluessel-Pruefung einen Mandanten-Delete blockieren, auch wenn
-- die betroffene Zeile ueber ancestor_id/descendant_id ohnehin gleich mit
-- geloescht wuerde -- Postgres prueft jede FK-Constraint unabhaengig, ein
-- CASCADE-Pfad "rettet" keinen anderen, nicht-kaskadierenden.
CREATE TABLE org_unit_closure (
  mandant_id    uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
  ancestor_id   uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  descendant_id uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  depth         int NOT NULL,

  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX org_unit_closure_descendant_idx ON org_unit_closure (descendant_id);

ALTER TABLE org_unit_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit_closure FORCE ROW LEVEL SECURITY;

CREATE POLICY org_unit_closure_isolation ON org_unit_closure
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Haelt org_unit_closure bei INSERT und beim Umhaengen (UPDATE OF parent_id)
-- konsistent. Reparenting nutzt den Standard-Closure-Table-Algorithmus:
-- alte "von aussen in den Teilbaum"-Pfade entfernen, dann aus der neuen
-- Position neu aufbauen (Kreuzprodukt Vorfahren-des-neuen-Elternknotens x
-- Nachfahren-des-verschobenen-Knotens). Die Zyklus-Pruefung VOR dem Umbau
-- verhindert, dass ein Knoten unter einen eigenen Nachfahren verschoben
-- wird (sonst wuerde eine Schleife entstehen, die sich serverseitig nicht
-- mehr sauber aufloesen liesse -- siehe Organigramm-Plan, "Zyklen und
-- verwaiste Knoten verhindern").
CREATE FUNCTION org_unit_closure_pflegen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO org_unit_closure (mandant_id, ancestor_id, descendant_id, depth)
      VALUES (NEW.mandant_id, NEW.id, NEW.id, 0);
    IF NEW.parent_id IS NOT NULL THEN
      INSERT INTO org_unit_closure (mandant_id, ancestor_id, descendant_id, depth)
        SELECT NEW.mandant_id, c.ancestor_id, NEW.id, c.depth + 1
        FROM org_unit_closure c
        WHERE c.descendant_id = NEW.parent_id;
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE' OF parent_id
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_unit_closure
    WHERE ancestor_id = NEW.id AND descendant_id = NEW.parent_id
  ) THEN
    RAISE EXCEPTION 'Verschieben wuerde einen Zyklus erzeugen: % ist bereits Nachfahre von %', NEW.parent_id, NEW.id;
  END IF;

  DELETE FROM org_unit_closure
  WHERE descendant_id IN (SELECT descendant_id FROM org_unit_closure WHERE ancestor_id = NEW.id)
    AND ancestor_id IN (
      SELECT ancestor_id FROM org_unit_closure WHERE descendant_id = NEW.id AND ancestor_id <> NEW.id
    );

  IF NEW.parent_id IS NOT NULL THEN
    INSERT INTO org_unit_closure (mandant_id, ancestor_id, descendant_id, depth)
      SELECT NEW.mandant_id, a.ancestor_id, d.descendant_id, a.depth + d.depth + 1
      FROM org_unit_closure a
      JOIN org_unit_closure d ON d.ancestor_id = NEW.id
      WHERE a.descendant_id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_unit_closure_insert
  AFTER INSERT ON org_unit
  FOR EACH ROW EXECUTE FUNCTION org_unit_closure_pflegen();
CREATE TRIGGER org_unit_closure_update
  AFTER UPDATE OF parent_id ON org_unit
  FOR EACH ROW EXECUTE FUNCTION org_unit_closure_pflegen();

-- Bestandsdaten: jeder existierende Mandant bekommt seinen Traeger-Wurzelknoten,
-- jeder existierende standort seinen 1:1-verknuepften Einrichtungsknoten
-- darunter. Reine Strukturnachbildung (kein Rollen-/Rechte-Mapping -- das
-- folgt in einem spaeteren, eigenen Migrationsschritt), deshalb hier schon
-- fuer den Bestand nachgezogen statt erst beim naechsten Anlegen.
INSERT INTO org_unit (mandant_id, typ, name)
  SELECT id, 'traeger', name FROM mandant;

INSERT INTO org_unit (mandant_id, parent_id, typ, standort_id, name, aktiv)
  SELECT s.mandant_id, t.id, 'einrichtung', s.id, s.name, s.aktiv
  FROM standort s
  JOIN org_unit t ON t.mandant_id = s.mandant_id AND t.typ = 'traeger';

-- Ab jetzt entsteht beides automatisch mit: ein neuer Mandant bekommt sofort
-- seinen Traeger-Knoten, ein neuer standort sofort seinen Einrichtungsknoten
-- darunter -- exakt das Trigger-Muster von
-- mandant_kassenbuchung_typ_standard (migrations/0035), hier nur auf
-- org_unit angewendet. Ohne das waere ein frisch angelegter Mandant/standort
-- erst nach einem manuellen Nachpflegeschritt organigramm-faehig.
CREATE FUNCTION org_unit_traeger_anlegen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO org_unit (mandant_id, typ, name) VALUES (NEW.id, 'traeger', NEW.name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER mandant_org_unit_traeger_standard
  AFTER INSERT ON mandant
  FOR EACH ROW EXECUTE FUNCTION org_unit_traeger_anlegen();

CREATE FUNCTION org_unit_einrichtung_anlegen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  traeger_id uuid;
BEGIN
  SELECT id INTO traeger_id FROM org_unit WHERE mandant_id = NEW.mandant_id AND typ = 'traeger';
  INSERT INTO org_unit (mandant_id, parent_id, typ, standort_id, name)
    VALUES (NEW.mandant_id, traeger_id, 'einrichtung', NEW.id, NEW.name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER standort_org_unit_einrichtung_standard
  AFTER INSERT ON standort
  FOR EACH ROW EXECUTE FUNCTION org_unit_einrichtung_anlegen();
