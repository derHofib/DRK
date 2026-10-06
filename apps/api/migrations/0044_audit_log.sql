-- Append-only Protokoll fuer Strukturaenderungen (org_unit/org_position/
-- account_typ/delegation), jeden Klientenakte-Zugriff (auch durch
-- Geschaeftsfuehrung) und jede sensible Aktion aus der Rechte-Registry
-- (spaeterer Schritt). Bislang existiert im ganzen Projekt kein
-- vergleichbarer Audit-Mechanismus (siehe Organigramm-Plan-Recherche) --
-- das hier ist Neuland, kein bestehendes Muster wird fortgesetzt.
--
-- Unveraenderlich wie kassenbuchung (0011): REVOKE UPDATE, DELETE --
-- ein Protokoll, das sich nachtraeglich umschreiben liesse, waere keins.
CREATE TABLE audit_log (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id                 uuid NOT NULL REFERENCES mandant(id),
  benutzer_id                uuid NOT NULL REFERENCES benutzer(id),
  handelnd_als_vertreter_von uuid REFERENCES benutzer(id),
  modul                      text NOT NULL,
  aktion                     text NOT NULL,
  objekt_typ                 text NOT NULL,
  objekt_id                  uuid,
  vorher                     jsonb,
  nachher                    jsonb,
  erstellt_am                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS
  'Unveraenderliches Protokoll (wer, wann, was, vorher/nachher). handelnd_als_vertreter_von ist gesetzt, wenn die Aktion unter einer aktiven Vertretung ausgefuehrt wurde.';

CREATE INDEX audit_log_mandant_zeit_idx ON audit_log (mandant_id, erstellt_am DESC);
CREATE INDEX audit_log_objekt_idx ON audit_log (objekt_typ, objekt_id);
CREATE INDEX audit_log_benutzer_idx ON audit_log (benutzer_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_isolation ON audit_log
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON audit_log FROM zimmerakte_app;
