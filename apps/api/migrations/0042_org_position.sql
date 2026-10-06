-- Positionen: der eigentliche Organigramm-Baum (Berichtslinie), getrennt
-- vom Organisationseinheiten-Baum aus 0040 -- jede Position haengt an
-- GENAU einer org_unit, hat aber ihre eigene Eltern-Kind-Beziehung
-- (parent_position_id) fuer die Berichtslinie. Tabellenname bewusst
-- "org_position", nicht "position" -- Postgres kennt POSITION(...) als
-- Standardfunktion, ein gleichnamiger Tabellenname waere unnoetig
-- verwirrend.
CREATE TYPE org_position_typ AS ENUM ('linie', 'stabsstelle');

CREATE TABLE org_position (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id         uuid NOT NULL REFERENCES mandant(id),
  org_unit_id        uuid NOT NULL REFERENCES org_unit(id),
  parent_position_id uuid REFERENCES org_position(id),
  titel              text NOT NULL,
  typ                org_position_typ NOT NULL DEFAULT 'linie',
  account_typ_id     uuid NOT NULL REFERENCES account_typ(id),
  -- "ist_geplant" ist die einzige WIRKLICH nicht ableitbare Information
  -- (Platzhalter fuer eine noch nicht reale Position, siehe
  -- Organigramm-Plan). Besetzt/vakant sind dagegen aus org_position_besetzung
  -- ableitbar -- genau wie zimmer seinen Status nicht speichert, sondern
  -- per JOIN gegen belegung ableitet (CLAUDE.md Regel 4), speichert auch
  -- org_position keinen separaten "besetzt/vakant"-Status: der Lesezugriff
  -- (naechster Planungsschritt) ermittelt das per EXISTS gegen
  -- org_position_besetzung.
  ist_geplant        boolean NOT NULL DEFAULT false,
  aktiv              boolean NOT NULL DEFAULT true,
  soll_besetzung     int NOT NULL DEFAULT 1,
  gueltig_ab         date NOT NULL DEFAULT CURRENT_DATE,
  gueltig_bis        date,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  erstellt_von       uuid REFERENCES benutzer(id),

  CHECK (soll_besetzung > 0),
  CHECK (gueltig_bis IS NULL OR gueltig_bis >= gueltig_ab)
);

COMMENT ON TABLE org_position IS
  'Positionen (Organigramm-Knoten, Berichtslinie via parent_position_id). typ=stabsstelle erbt keinen Subtree-Scope und vererbt keinen -- siehe org_position_stabsstelle_scope.';

CREATE INDEX org_position_org_unit_idx ON org_position (org_unit_id);
CREATE INDEX org_position_parent_idx ON org_position (parent_position_id);
CREATE INDEX org_position_account_typ_idx ON org_position (account_typ_id);

ALTER TABLE org_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_isolation ON org_position
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Eigene Closure Table fuer den Positions-Baum -- gleiches Prinzip und
-- gleicher Pflege-Algorithmus wie org_unit_closure (0040), nur auf
-- parent_position_id statt parent_id angewendet. Zwei fast identische
-- Funktionen statt einer generischen: dynamisches SQL ueber Tabellennamen
-- waere hier schwerer nachvollziehbar als zweimal derselbe, klar lesbare
-- Code -- und beide Baeume aendern sich unabhaengig voneinander.
-- mandant_id bekommt ON DELETE CASCADE aus demselben Grund wie bei
-- org_unit_closure (0040): eine eigenstaendige, nicht kaskadierende
-- FK-Pruefung wuerde einen Mandanten-Delete blockieren, selbst wenn die
-- Zeile ueber ancestor_id/descendant_id ohnehin mitgeloescht wuerde --
-- Postgres prueft jede Constraint unabhaengig.
CREATE TABLE org_position_closure (
  mandant_id    uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
  ancestor_id   uuid NOT NULL REFERENCES org_position(id) ON DELETE CASCADE,
  descendant_id uuid NOT NULL REFERENCES org_position(id) ON DELETE CASCADE,
  depth         int NOT NULL,

  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX org_position_closure_descendant_idx ON org_position_closure (descendant_id);

ALTER TABLE org_position_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_closure FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_closure_isolation ON org_position_closure
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

CREATE FUNCTION org_position_closure_pflegen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO org_position_closure (mandant_id, ancestor_id, descendant_id, depth)
      VALUES (NEW.mandant_id, NEW.id, NEW.id, 0);
    IF NEW.parent_position_id IS NOT NULL THEN
      INSERT INTO org_position_closure (mandant_id, ancestor_id, descendant_id, depth)
        SELECT NEW.mandant_id, c.ancestor_id, NEW.id, c.depth + 1
        FROM org_position_closure c
        WHERE c.descendant_id = NEW.parent_position_id;
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE' OF parent_position_id
  IF NEW.parent_position_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_position_closure
    WHERE ancestor_id = NEW.id AND descendant_id = NEW.parent_position_id
  ) THEN
    RAISE EXCEPTION 'Verschieben wuerde einen Zyklus erzeugen: % ist bereits Nachfahre von %', NEW.parent_position_id, NEW.id;
  END IF;

  DELETE FROM org_position_closure
  WHERE descendant_id IN (SELECT descendant_id FROM org_position_closure WHERE ancestor_id = NEW.id)
    AND ancestor_id IN (
      SELECT ancestor_id FROM org_position_closure WHERE descendant_id = NEW.id AND ancestor_id <> NEW.id
    );

  IF NEW.parent_position_id IS NOT NULL THEN
    INSERT INTO org_position_closure (mandant_id, ancestor_id, descendant_id, depth)
      SELECT NEW.mandant_id, a.ancestor_id, d.descendant_id, a.depth + d.depth + 1
      FROM org_position_closure a
      JOIN org_position_closure d ON d.ancestor_id = NEW.id
      WHERE a.descendant_id = NEW.parent_position_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_closure_insert
  AFTER INSERT ON org_position
  FOR EACH ROW EXECUTE FUNCTION org_position_closure_pflegen();
CREATE TRIGGER org_position_closure_update
  AFTER UPDATE OF parent_position_id ON org_position
  FOR EACH ROW EXECUTE FUNCTION org_position_closure_pflegen();

-- Mehrfachbesetzung (mehrere aktive Zeilen je position_id) und
-- Mehrfachposition (mehrere aktive Zeilen je benutzer_id, auch
-- einrichtungsuebergreifend -- der Springer-Fall) sind beide einfach
-- "mehr als eine passende Zeile", keine Sonderfaelle im Schema.
-- Historisiert wie belegung: eine Zuweisung wird beendet (gueltig_bis
-- gesetzt), nicht rueckwirkend veraendert.
CREATE TABLE org_position_besetzung (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  position_id  uuid NOT NULL REFERENCES org_position(id),
  benutzer_id  uuid NOT NULL REFERENCES benutzer(id),
  gueltig_ab   date NOT NULL DEFAULT CURRENT_DATE,
  gueltig_bis  date,
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  erstellt_von uuid REFERENCES benutzer(id),

  CHECK (gueltig_bis IS NULL OR gueltig_bis >= gueltig_ab)
);
CREATE INDEX org_position_besetzung_position_idx ON org_position_besetzung (position_id);
CREATE INDEX org_position_besetzung_benutzer_idx ON org_position_besetzung (benutzer_id);

ALTER TABLE org_position_besetzung ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_besetzung FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_besetzung_isolation ON org_position_besetzung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE ON org_position_besetzung FROM zimmerakte_app;
GRANT UPDATE (gueltig_bis) ON org_position_besetzung TO zimmerakte_app;

-- Sobald jemand wirklich zugewiesen wird, ist eine Position kein reiner
-- Platzhalter mehr -- "Rechte greifen sofort" (Organigramm-Plan) heisst
-- auch: ist_geplant faellt automatisch weg, kein manueller Zwischenschritt
-- noetig. Umgekehrt (BEFORE-Trigger unten) verhindert die DB, dass jemand
-- eine aktiv besetzte Position manuell wieder auf "geplant" zurueckstellt,
-- ohne vorher die Zuweisung zu beenden -- das waere ein unmoeglicher
-- Zustand (ein Platzhalter mit echtem Mitarbeiter dahinter).
CREATE FUNCTION org_position_besetzung_geplant_aufheben() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE org_position SET ist_geplant = false WHERE id = NEW.position_id AND ist_geplant;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_besetzung_geplant_aufheben
  AFTER INSERT ON org_position_besetzung
  FOR EACH ROW EXECUTE FUNCTION org_position_besetzung_geplant_aufheben();

CREATE FUNCTION org_position_geplant_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ist_geplant AND EXISTS (
    SELECT 1 FROM org_position_besetzung
    WHERE position_id = NEW.id
      AND gueltig_ab <= CURRENT_DATE
      AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'Eine Position mit aktiver Zuweisung kann nicht als geplant markiert werden -- zuerst die Zuweisung beenden.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_geplant_pruefen
  BEFORE INSERT OR UPDATE OF ist_geplant ON org_position
  FOR EACH ROW EXECUTE FUNCTION org_position_geplant_pruefen();

-- Positions-Override: eine Position darf einzelne Rechte des
-- Account-Typ-Defaults ueberschreiben (erlaubt+scope komplett, nicht
-- additiv -- siehe Rechte-Engine-Algorithmus im Organigramm-Plan).
CREATE TABLE org_position_recht_override (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  position_id uuid NOT NULL REFERENCES org_position(id),
  modul       text NOT NULL,
  aktion      text NOT NULL,
  scope       text NOT NULL,
  erlaubt     boolean NOT NULL,

  UNIQUE (position_id, modul, aktion)
);

ALTER TABLE org_position_recht_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_recht_override FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_recht_override_isolation ON org_position_recht_override
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Stabsstellen erben keinen Subtree-Scope von ihrer org_unit/Berichtslinie
-- (siehe org_position.typ Kommentar) -- ihr Scope ist eine explizite Liste
-- von Organisationseinheiten (Traeger-Wurzel = traegerweit, sonst eine
-- oder mehrere Einrichtungen).
CREATE TABLE org_position_stabsstelle_scope (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  position_id uuid NOT NULL REFERENCES org_position(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),

  UNIQUE (position_id, org_unit_id)
);

ALTER TABLE org_position_stabsstelle_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_stabsstelle_scope FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_stabsstelle_scope_isolation ON org_position_stabsstelle_scope
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

CREATE FUNCTION org_position_stabsstelle_scope_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_position WHERE id = NEW.position_id AND typ = 'stabsstelle') THEN
    RAISE EXCEPTION 'Nur Stabsstellen (org_position.typ=stabsstelle) bekommen einen expliziten Scope -- Linienpositionen leiten ihren Scope aus org_unit_closure ab.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_stabsstelle_scope_pruefen
  BEFORE INSERT OR UPDATE ON org_position_stabsstelle_scope
  FOR EACH ROW EXECUTE FUNCTION org_position_stabsstelle_scope_pruefen();

-- Objektbezogener Scope (scope='assigned'): eine Liste konkreter Objekte
-- (z.B. einzelne klient_id), fuer die eine Position Rechte hat --
-- unabhaengig vom Organisationseinheiten-Baum. Nicht nur fuer die
-- vorbereitete Externen-Anbindung gedacht (siehe Organigramm-Plan), auch
-- fuer interne Sonderfaelle wie einen Springer mit genau einem
-- zugewiesenen Klienten. Bleibt ungenutzt, bis eine UI sie befuellt.
CREATE TABLE org_position_objekt_scope (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  position_id uuid NOT NULL REFERENCES org_position(id),
  objekt_typ  text NOT NULL,
  objekt_id   uuid NOT NULL,

  UNIQUE (position_id, objekt_typ, objekt_id)
);

ALTER TABLE org_position_objekt_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_objekt_scope FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_objekt_scope_isolation ON org_position_objekt_scope
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- "Letzter Vollzugriff-Inhaber nicht entfernbar" (Organigramm-Plan) --
-- in der DB erzwungen, nicht nur im UI verhindert, gleiches Haertungsprinzip
-- wie FORCE ROW LEVEL SECURITY. Eine Hilfsfunktion zaehlt die aktiv
-- besetzten Vollzugriff-Positionen je Mandant; drei Trigger (auf den drei
-- Stellen, an denen sich das aendern kann) rufen sie auf.
CREATE FUNCTION org_vollzugriff_anzahl(p_mandant_id uuid) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
  FROM org_position_besetzung b
  JOIN org_position p ON p.id = b.position_id
  JOIN account_typ a ON a.id = p.account_typ_id
  WHERE b.mandant_id = p_mandant_id
    AND a.ist_vollzugriff
    AND p.aktiv
    AND b.gueltig_ab <= CURRENT_DATE
    AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE);
$$;

CREATE FUNCTION org_position_besetzung_vollzugriff_schutz() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF org_vollzugriff_anzahl(COALESCE(NEW.mandant_id, OLD.mandant_id)) = 0 THEN
    RAISE EXCEPTION 'Mindestens eine aktiv besetzte Position mit Vollzugriff muss je Mandant bestehen bleiben.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER org_position_besetzung_vollzugriff_schutz
  AFTER UPDATE OF gueltig_bis OR DELETE ON org_position_besetzung
  FOR EACH ROW EXECUTE FUNCTION org_position_besetzung_vollzugriff_schutz();

CREATE FUNCTION org_position_vollzugriff_schutz() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF org_vollzugriff_anzahl(NEW.mandant_id) = 0 THEN
    RAISE EXCEPTION 'Mindestens eine aktiv besetzte Position mit Vollzugriff muss je Mandant bestehen bleiben.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_vollzugriff_schutz
  AFTER UPDATE OF account_typ_id, aktiv ON org_position
  FOR EACH ROW EXECUTE FUNCTION org_position_vollzugriff_schutz();

CREATE FUNCTION account_typ_vollzugriff_schutz() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ist_vollzugriff AND NOT NEW.ist_vollzugriff AND org_vollzugriff_anzahl(NEW.mandant_id) = 0 THEN
    RAISE EXCEPTION 'Mindestens eine aktiv besetzte Position mit Vollzugriff muss je Mandant bestehen bleiben.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_typ_vollzugriff_schutz
  AFTER UPDATE OF ist_vollzugriff ON account_typ
  FOR EACH ROW EXECUTE FUNCTION account_typ_vollzugriff_schutz();
