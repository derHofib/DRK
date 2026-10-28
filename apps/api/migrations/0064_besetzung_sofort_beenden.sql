-- Rang einer Person aendern (Mitarbeitendenverwaltung, benutzer.service.ts
-- ::positionWechseln()): der Wechsel soll SOFORT gelten, nicht erst morgen.
--
-- Eine Besetzung ist laut 0042 bis einschliesslich gueltig_bis gueltig
-- (gueltig_bis >= CURRENT_DATE). Ein "Beenden zum heutigen Tag" laesst die
-- alte Position also den ganzen restlichen Tag wirken -- wer eine
-- Geschaeftsfuehrung herabstuft, wuerde ihr bis Mitternacht weiter
-- Vollzugriff lassen, und der Schutz "letzter Vollzugriff" (Trigger
-- org_position_besetzung_vollzugriff_schutz) saehe die Aenderung erst gar
-- nicht. Sofort wirksam heisst deshalb gueltig_bis = gestern.
--
-- Das scheitert bisher an der CHECK-Bedingung, wenn die Besetzung erst heute
-- begonnen hat (gueltig_bis >= gueltig_ab). Statt die Zeile zu LOESCHEN
-- (die Besetzungshistorie soll erhalten bleiben, genau wie das Kassenbuch
-- storniert statt loescht) erlauben wir einen Tag davor: gueltig_bis =
-- gueltig_ab - 1 ist ein leeres Intervall, also "am selben Tag
-- zurueckgenommen, hat nie gegolten". Alles weiter in der Vergangenheit
-- bleibt verboten.
ALTER TABLE org_position_besetzung DROP CONSTRAINT org_position_besetzung_check;
ALTER TABLE org_position_besetzung ADD CONSTRAINT org_position_besetzung_check
  CHECK (gueltig_bis IS NULL OR gueltig_bis >= gueltig_ab - 1);
