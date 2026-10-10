-- Mitarbeitende "entfernen" = deaktivieren, nie loeschen: benutzer wird von
-- audit_log, Tagesberichten, Kassenbuch, Aufgaben usw. referenziert, und ein
-- Loeschen wuerde genau die Nachvollziehbarkeit zerstoeren, fuer die diese
-- Tabellen existieren. Eine deaktivierte Person kann sich nicht mehr
-- anmelden (login_lookup/AuthGuard pruefen benutzer.aktiv) und ist jederzeit
-- reaktivierbar; ihre Besetzungen bleiben bewusst unangetastet, damit eine
-- Reaktivierung die Rechte unveraendert wiederherstellt.

-- Spaltenscharf (CLAUDE.md Regel 3): 0025 hat UPDATE auf benutzer auf vier
-- Spalten beschnitten; "aktiv" kommt als fuenfte dazu, mehr nicht -- name/
-- email/mandant_id bleiben fuer die App-Rolle unveraenderlich.
GRANT UPDATE (aktiv) ON benutzer TO zimmerakte_app;

-- Der Schutz "mindestens ein aktiv besetzter Vollzugriff je Mandant" (0042)
-- zaehlte bisher nur Besetzungen. Eine deaktivierte Person kann sich aber
-- nicht anmelden -- besetzt sie die letzte Vollzugriff-Position, waere der
-- Mandant ausgesperrt, obwohl die Zaehlung "1" sagt. Deshalb zaehlen nur
-- noch Besetzungen aktiver Benutzer.
CREATE OR REPLACE FUNCTION org_vollzugriff_anzahl(p_mandant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int
  FROM org_position_besetzung b
  JOIN org_position p ON p.id = b.position_id
  JOIN account_typ a ON a.id = p.account_typ_id
  JOIN benutzer u ON u.id = b.benutzer_id
  WHERE b.mandant_id = p_mandant_id
    AND a.ist_vollzugriff
    AND p.aktiv
    AND u.aktiv
    AND b.gueltig_ab <= CURRENT_DATE
    AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE);
$$;

-- Gleiche Absicherung wie org_position_besetzung_vollzugriff_schutz (0042),
-- nur fuer den anderen Weg, den letzten Vollzugriff zu verlieren: die Person
-- selbst wird deaktiviert. AFTER-Trigger, weil die Zaehlung den neuen Stand
-- sehen muss; die Exception rollt das UPDATE zurueck.
CREATE OR REPLACE FUNCTION benutzer_vollzugriff_schutz() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.aktiv AND NOT NEW.aktiv AND org_vollzugriff_anzahl(NEW.mandant_id) = 0 THEN
    RAISE EXCEPTION 'Mindestens eine aktiv besetzte Position mit Vollzugriff muss je Mandant bestehen bleiben.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER benutzer_vollzugriff_schutz
  AFTER UPDATE OF aktiv ON benutzer
  FOR EACH ROW EXECUTE FUNCTION benutzer_vollzugriff_schutz();
