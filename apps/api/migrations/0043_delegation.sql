-- Vertretung ist an benutzer_id modelliert, nicht an position_id -- bei
-- Mehrfachbesetzung waere "eine Position vertreten" mehrdeutig (wessen
-- Rechte genau?). Die Vertretung ueberträgt "die Rechte, die dieser
-- Mitarbeiter aus seinen eigenen Positionen hat" -- eindeutig,
-- deterministisch, deckt den Positions-Fall mit ab (ein Mitarbeiter mit
-- nur einer Position delegiert faktisch deren Rechte). Siehe
-- Organigramm-Plan fuer die ausfuehrliche Begruendung.
CREATE TYPE delegation_umfang AS ENUM ('alle', 'auswahl');
-- Der Status-Enum-Typ traegt alle fuenf fachlichen Werte aus dem
-- Fachkonzept (fuer Shared-DTO/Anzeigezwecke), die Tabelle SPEICHERT aber
-- nur drei davon (CHECK unten) -- "aktiv" und "abgelaufen" sind aus
-- genehmigt + von/bis vs. heute ableitbar und werden erst beim Lesen
-- (Rechte-/Delegation-Service, spaeterer Schritt) dazugerechnet. Gleiches
-- Prinzip wie bei org_position.ist_geplant: nicht speichern, was sich aus
-- einem Datumsvergleich ergibt (CLAUDE.md Regel 4).
CREATE TYPE delegation_status AS ENUM ('beantragt', 'genehmigt', 'aktiv', 'abgelaufen', 'widerrufen');

CREATE TABLE delegation (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id                     uuid NOT NULL REFERENCES mandant(id),
  vertretener_benutzer_id        uuid NOT NULL REFERENCES benutzer(id),
  vertreter_benutzer_id          uuid NOT NULL REFERENCES benutzer(id),
  von                            date NOT NULL,
  bis                            date NOT NULL,
  umfang                         delegation_umfang NOT NULL DEFAULT 'alle',
  sensible_rechte_eingeschlossen boolean NOT NULL DEFAULT false,
  status                         delegation_status NOT NULL DEFAULT 'beantragt',
  erstellt_von                   uuid NOT NULL REFERENCES benutzer(id),
  erstellt_am                    timestamptz NOT NULL DEFAULT now(),
  genehmigt_von                  uuid REFERENCES benutzer(id),
  genehmigt_am                   timestamptz,
  widerrufen_von                 uuid REFERENCES benutzer(id),
  widerrufen_am                  timestamptz,

  CHECK (bis >= von),
  CHECK (vertretener_benutzer_id <> vertreter_benutzer_id),
  CHECK (status IN ('beantragt', 'genehmigt', 'widerrufen')),
  CHECK (status NOT IN ('genehmigt') OR (genehmigt_von IS NOT NULL AND genehmigt_am IS NOT NULL)),
  CHECK (status = 'widerrufen' OR (widerrufen_von IS NULL AND widerrufen_am IS NULL)),
  CHECK (status <> 'widerrufen' OR (widerrufen_von IS NOT NULL AND widerrufen_am IS NOT NULL))
);

COMMENT ON TABLE delegation IS
  'Vertretung, ausschliesslich manuell angelegt und befristet. status speichert nur beantragt/genehmigt/widerrufen -- aktiv/abgelaufen ergeben sich beim Lesen aus genehmigt + von/bis vs. heute.';

CREATE INDEX delegation_vertreter_idx ON delegation (vertreter_benutzer_id);
CREATE INDEX delegation_vertretener_idx ON delegation (vertretener_benutzer_id);

ALTER TABLE delegation ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation FORCE ROW LEVEL SECURITY;

CREATE POLICY delegation_isolation ON delegation
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Wie bei kassenbuchung_stornoantrag (0031): der Antrag selbst ist nach
-- dem Anlegen unveraendrbar, nur die Entscheidung (genehmigen/widerrufen)
-- darf nachgetragen werden. Der Service erzwingt zusaetzlich die
-- passenden WHERE-Bedingungen (z.B. "nur wenn noch nicht widerrufen"),
-- damit eine Entscheidung nicht ein zweites Mal umgebogen werden kann.
REVOKE UPDATE ON delegation FROM zimmerakte_app;
GRANT UPDATE (status, genehmigt_von, genehmigt_am, widerrufen_von, widerrufen_am) ON delegation TO zimmerakte_app;

-- Nur bei umfang='auswahl' sinnvoll (sonst gilt die gesamte Rechte-Menge
-- des Vertretenen, siehe Rechte-Engine-Algorithmus). manage-permissions
-- ist strukturell nie delegierbar -- hier zusaetzlich zur Auflösungslogik
-- auch an der Quelle verhindert, nicht nur dort gefiltert.
CREATE TABLE delegation_recht (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  delegation_id uuid NOT NULL REFERENCES delegation(id),
  modul         text NOT NULL,
  aktion        text NOT NULL,

  UNIQUE (delegation_id, modul, aktion)
);

ALTER TABLE delegation_recht ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_recht FORCE ROW LEVEL SECURITY;

CREATE POLICY delegation_recht_isolation ON delegation_recht
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

CREATE FUNCTION delegation_recht_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM delegation WHERE id = NEW.delegation_id AND umfang = 'auswahl') THEN
    RAISE EXCEPTION 'delegation_recht-Zeilen sind nur bei umfang=auswahl sinnvoll.';
  END IF;
  IF NEW.modul = 'organigramm' AND NEW.aktion = 'manage-permissions' THEN
    RAISE EXCEPTION 'manage-permissions ist nicht delegierbar.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delegation_recht_pruefen
  BEFORE INSERT OR UPDATE ON delegation_recht
  FOR EACH ROW EXECUTE FUNCTION delegation_recht_pruefen();
