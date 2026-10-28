-- Standorte einer Person an der BESETZUNG statt an der Position.
--
-- Hintergrund: Eine Position ist eine Stelle im Organigramm mit genau einer
-- org_unit_id, und diese Einheit ist der Anker fuer die Scope-Aufloesung der
-- Rechte-Engine. Wer an mehreren Standorten arbeitet, braucht deshalb heute
-- je Standort eine eigene Position desselben Rangs (z. B. sechsmal
-- "Mitarbeiter"). org_position_weitere_einheit (0047) loest das fuer
-- Sammelraenge nicht: sie haengt an der Position, also bekaeme jede Person,
-- die diese Position teilt, alle weiteren Einheiten -- richtig ist das nur
-- fuer Einzelstellen wie eine Einrichtungsleitung mit zwei Haeusern.
--
-- Die Einheiten einer einzelnen Person gehoeren deshalb an ihre Besetzung.
-- Die Rechte-Engine nimmt sie zusaetzlich zu org_unit_id und
-- weitere_einheit als Anker (Vereinigung). Diese Migration aendert fuer
-- Bestandsdaten nichts: ohne Zeilen hier verhaelt sich alles wie vorher,
-- ein Umstieg ist also schrittweise und ohne Rechteverlust moeglich.
--
-- Wie bei weitere_einheit nur fuer typ='linie': Stabsstellen haben
-- org_position_stabsstelle_scope, ein zweiter Mechanismus waere eine zweite
-- Quelle fuer dieselbe Information.
CREATE TABLE org_position_besetzung_einheit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  besetzung_id uuid NOT NULL REFERENCES org_position_besetzung(id) ON DELETE CASCADE,
  org_unit_id  uuid NOT NULL REFERENCES org_unit(id),

  UNIQUE (besetzung_id, org_unit_id)
);
CREATE INDEX org_position_besetzung_einheit_org_unit_idx ON org_position_besetzung_einheit (org_unit_id);

ALTER TABLE org_position_besetzung_einheit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_position_besetzung_einheit FORCE ROW LEVEL SECURITY;

CREATE POLICY org_position_besetzung_einheit_isolation ON org_position_besetzung_einheit
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Eine Zuordnung wird angelegt oder entfernt, nie veraendert (ein Wechsel
-- ist Entfernen + Anlegen). Spaltenscharf also gar kein UPDATE.
REVOKE UPDATE ON org_position_besetzung_einheit FROM zimmerakte_app;

-- Die Fremdschluessel pruefen den Mandanten nicht (ein FK sieht RLS nicht),
-- und mandant_id ist hier redundant gespeichert: dieselbe Absicherung wie
-- bei benutzer_standort (0007), plus die Beschraenkung auf Linienpositionen.
CREATE FUNCTION org_position_besetzung_einheit_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_typ org_position_typ;
  v_mandant uuid;
BEGIN
  SELECT p.typ, b.mandant_id INTO v_typ, v_mandant
  FROM org_position_besetzung b JOIN org_position p ON p.id = b.position_id
  WHERE b.id = NEW.besetzung_id;
  IF v_typ <> 'linie' THEN
    RAISE EXCEPTION 'Einheiten an der Besetzung gibt es nur fuer Linienpositionen -- Stabsstellen nutzen org_position_stabsstelle_scope.';
  END IF;
  IF NEW.mandant_id <> v_mandant
     OR NEW.mandant_id <> (SELECT mandant_id FROM org_unit WHERE id = NEW.org_unit_id) THEN
    RAISE EXCEPTION 'org_position_besetzung_einheit: Besetzung und Einheit muessen zum selben Mandanten gehoeren.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_position_besetzung_einheit_pruefen
  BEFORE INSERT ON org_position_besetzung_einheit
  FOR EACH ROW EXECUTE FUNCTION org_position_besetzung_einheit_pruefen();
