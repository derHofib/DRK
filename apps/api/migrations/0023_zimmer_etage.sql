-- Zimmer sollen sich nach Standort und innerhalb eines Standorts nach
-- Etage gruppieren lassen (siehe Zimmer.tsx). Freitext statt Zahl: nicht
-- jedes Gebaeude nummeriert seine Etagen durchgehend ("EG", "1. OG",
-- "Dachgeschoss", "Keller" muessen alle moeglich sein), und eine Zahl waere
-- fuer "EG" ohnehin nur eine Konvention, die an dieser Stelle nichts
-- gewinnt.
--
-- Default 'EG' fuer Bestandsdaten: bestehende Zimmer brauchen keine
-- Datenkorrektur, die Leitung kann das je Zimmer ueber "Zimmer bearbeiten"
-- anpassen.
ALTER TABLE zimmer ADD COLUMN etage text NOT NULL DEFAULT 'EG';

-- Dasselbe spaltenscharfe Muster wie 0022: zimmer.etage ist jetzt ebenfalls
-- ueber "Zimmer bearbeiten" aenderbar.
REVOKE UPDATE ON zimmer FROM zimmerakte_app;
GRANT  UPDATE (nummer, etage, aktiv) ON zimmer TO zimmerakte_app;
