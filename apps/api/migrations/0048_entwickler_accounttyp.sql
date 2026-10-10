-- Fester, dauerhafter Vollzugriff-Accounttyp "Entwickler" je Mandant --
-- siehe Organigramm-Plan-Nachtrag "Entwickler-Accounttyp": der allererste
-- Account eines neuen Traegers wird dieser Entwickler (ueber das erweiterte
-- scripts/account-anlegen.sh, nicht hier -- diese Migration legt nur den
-- Accounttyp selbst an, keine Position/Besetzung, siehe 0041: Positionen
-- brauchen eine org_unit, die zwar schon per org_unit_traeger_anlegen()
-- (0040) im selben AFTER INSERT-Moment entsteht, aber die Reihenfolge der
-- beiden Trigger zueinander ist nicht garantiert -- das Script legt die
-- Position daher erst NACH dem vollstaendigen INSERT an, wenn beide
-- Trigger sicher gelaufen sind).
--
-- Anders als bei kassenbuchung_typ_standard_anlegen() (0035) reicht hier
-- EIN INSERT: ein Vollzugriff-Typ bekommt laut 0041 nie account_typ_recht-
-- Zeilen (sein Zugriff wird in der Rechte-Engine komplett kurzgeschlossen),
-- es gibt also nichts Weiteres vorzubefuellen.
--
-- "Entwickler" ist dauerhaft (nicht nur ein Einmal-Bootstrap-Schritt): der
-- Typ bleibt fuer immer im Mandanten bestehen, genau wie jeder andere
-- Accounttyp. ist_system=true sperrt das Umbenennen schon ueber den
-- bestehenden Code-Check in organigramm.service.ts::aktualisiereAccountTyp()
-- ("Systemvorlagen koennen nicht umbenannt werden"); eine Loeschroute fuer
-- Accounttypen gibt es ohnehin nicht (siehe organigramm.controller.ts).
CREATE FUNCTION entwickler_accounttyp_anlegen() RETURNS trigger AS $$
BEGIN
  INSERT INTO account_typ (mandant_id, name, kategorie, ist_system, ist_vollzugriff)
  VALUES (NEW.id, 'Entwickler', 'intern', true, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mandant_entwickler_accounttyp
  AFTER INSERT ON mandant
  FOR EACH ROW EXECUTE FUNCTION entwickler_accounttyp_anlegen();

-- Backfill fuer bereits bestehende Mandanten (Entwicklungs-/Testdaten, die
-- vor dieser Migration entstanden sind): nur Mandanten ohne IRGENDEINEN
-- Vollzugriff-Typ bekommen rueckwirkend einen Entwickler -- ein Mandant,
-- der (z.B. in einem Test-Fixture) bereits einen eigenen Vollzugriff-Typ
-- hat, soll keinen zweiten, redundanten bekommen.
INSERT INTO account_typ (mandant_id, name, kategorie, ist_system, ist_vollzugriff)
SELECT m.id, 'Entwickler', 'intern', true, true
FROM mandant m
WHERE NOT EXISTS (
  SELECT 1 FROM account_typ a WHERE a.mandant_id = m.id AND a.ist_vollzugriff
);
