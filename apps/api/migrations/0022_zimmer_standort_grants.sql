-- Zimmer und Standort waren bislang reine Anlegen-und-Lesen-Tabellen --
-- kein Service hat je ein UPDATE darauf ausgefuehrt, deshalb war die volle
-- Spaltenberechtigung aus ALTER DEFAULT PRIVILEGES (0002) bis hierher
-- folgenlos. Mit "Zimmer bearbeiten/deaktivieren" und "Standort
-- bearbeiten/deaktivieren" gibt es jetzt echte UPDATE-Pfade -- deshalb
-- dasselbe spaltenscharfe Muster wie bei kassenbuchung (0011) und
-- mandant.akzentfarbe (0019), von Anfang an statt nachtraeglich.
--
-- zimmer.standort_id bleibt bewusst aussen vor: ein Zimmer nachtraeglich
-- einem anderen Standort zuzuordnen ist nicht Teil dieser Aenderung, und
-- ohne das GRANT kann ein kuenftiger Bug im Service das auch nicht
-- versehentlich tun.
REVOKE UPDATE ON zimmer FROM zimmerakte_app;
GRANT  UPDATE (nummer, aktiv) ON zimmer TO zimmerakte_app;

REVOKE UPDATE ON standort FROM zimmerakte_app;
GRANT  UPDATE (name, adresse, aktiv) ON standort TO zimmerakte_app;
