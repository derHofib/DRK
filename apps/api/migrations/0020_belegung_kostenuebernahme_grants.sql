-- Wie schon bei kassenbuchung (0011) und mandant.akzentfarbe (0019): die
-- App-Rolle bekommt durch ALTER DEFAULT PRIVILEGES (0002) automatisch
-- UPDATE/DELETE auf jede neue Tabelle. Fuer belegung und kostenuebernahme
-- war das bislang nie eingeschraenkt worden, obwohl beide Services dieselbe
-- Append-mit-genau-einer-Ausnahme-Struktur haben wie kassenbuchung:
--
--   belegung          -- nach dem Einzug (INSERT) aendert sich nur noch
--                         "auszug" (belegung.service.ts: ausziehen()).
--                         zimmer_id, klient_id, einzug sind historische
--                         Tatsachen und duerfen nach dem Anlegen nicht mehr
--                         verschoben werden -- sonst liesse sich eine
--                         Belegung nachtraeglich einem anderen Zimmer oder
--                         Klienten zuschreiben, ohne dass die
--                         Ueberlappungs-Constraints (0010) das noch pruefen
--                         wuerden.
--   kostenuebernahme  -- nach dem Anlegen aendert sich nur noch "bis"
--                         (kostenuebernahme.service.ts: beenden()). amt,
--                         klient_id, von sind ebenso historische Tatsachen.
--
-- Kein Code im Service pruefte das je -- er brauchte es nicht, weil er die
-- anderen Spalten nie anfasst. Das Fehlen dieser REVOKE/GRANT-Zeilen war
-- damit reine Zufallssicherheit: ein zukuenftiger Bug im Service haette bis
-- heute jede Spalte beider Tabellen aendern koennen.
--
-- DELETE entzogen aus demselben Grund wie bei kassenbuchung: beide Tabellen
-- sind die Grundlage fuer Amtsnachfragen und duerfen keine Zeile verlieren.
REVOKE UPDATE, DELETE ON belegung FROM zimmerakte_app;
GRANT  UPDATE (auszug) ON belegung TO zimmerakte_app;

REVOKE UPDATE, DELETE ON kostenuebernahme FROM zimmerakte_app;
GRANT  UPDATE (bis) ON kostenuebernahme TO zimmerakte_app;
