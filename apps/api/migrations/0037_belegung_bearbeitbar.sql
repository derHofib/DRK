-- Besprechung: Mitarbeitende sollen Ein-/Auszuege vorausschauend eintragen
-- koennen (siehe 0038_zimmer_warteliste.sql fuer die Warteliste), aber auch
-- die Flexibilitaet brauchen, ein bereits eingetragenes Datum zu korrigieren,
-- wenn sich ein Termin verschiebt. Bisher durfte die App-Rolle nach 0020
-- nur "auszug" aendern (ausziehen() durfte nur einmalig auf eine noch
-- offene Belegung schreiben) -- "einzug" war nach dem Anlegen fuer immer
-- fest. zimmer_id/klient_id bleiben weiterhin unantastbar (siehe
-- Begruendung in 0020): nur die beiden Datumsspalten werden freigegeben,
-- eine Belegung laesst sich damit nicht nachtraeglich einem anderen Zimmer
-- oder Klienten zuschreiben.
--
-- Die Ueberlappungs-/Kapazitaetspruefungen (0010, 0032) laufen automatisch
-- auch bei UPDATE (der Trigger steht auf "BEFORE INSERT OR UPDATE", der
-- EXCLUDE-Constraint gilt ohnehin fuer jede Zeilenaenderung) -- ein
-- Korrekturversuch, der mit einer anderen Belegung kollidiert, wird also
-- weiterhin abgelehnt, nicht erst durch neuen Code hier.
REVOKE UPDATE ON belegung FROM zimmerakte_app;
GRANT  UPDATE (einzug, auszug) ON belegung TO zimmerakte_app;
