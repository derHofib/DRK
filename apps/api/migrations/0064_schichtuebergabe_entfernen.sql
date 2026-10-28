-- Die Schichtuebergabe (Migration 0060) wird vollstaendig entfernt: Seite,
-- Dashboard-Karte, API und Rechte sind aus dem Code verschwunden
-- (Entscheidung vom 2026-10-28).
--
-- Warum DROP statt die Tabellen stehen zu lassen: Punkte sind Freitext und
-- koennen Gesundheitsdaten zu Klient:innen enthalten (Art. 9 DSGVO). Ohne
-- Code, der sie anzeigt, waeren sie ein Datenbestand, den niemand mehr sieht,
-- auf den aber auch keine Loeschfrist und keine Auskunft mehr zugreift
-- (Speicherbegrenzung, Art. 5 Abs. 1 lit. e). 0060 entzog der App-Rolle
-- UPDATE/DELETE; diese Migration laeuft als Eigentuemer.
--
-- Aufgaben, die aus einem Punkt angelegt wurden, BLEIBEN: Titel und
-- Beschreibung tragen den Text des Punktes, nur die Verknuepfung entfaellt.
-- aufgabe.klient_id kam mit 0060 nur fuer diese Verknuepfung hinzu und wurde
-- ausschliesslich aus der Schichtuebergabe gesetzt -- ohne sie haette die
-- Spalte keinen Schreib- und keinen Lesepfad mehr.

ALTER TABLE aufgabe DROP COLUMN schichtuebergabe_punkt_id;
ALTER TABLE aufgabe DROP COLUMN klient_id;

DROP TABLE schichtuebergabe_gelesen;
DROP TABLE schichtuebergabe_punkt;
DROP TABLE schichtuebergabe;
DROP TYPE dienst;

-- Die Rechte-Registry kennt das Modul nicht mehr. Gespeicherte Zeilen dazu
-- wuerden in keiner Matrix mehr erscheinen und koennten nie wieder entzogen
-- werden -- falls das Modul je unter diesem Namen zurueckkommt, waere es
-- sonst stillschweigend schon vergeben.
DELETE FROM account_typ_recht WHERE modul = 'schichtuebergabe';
DELETE FROM org_position_recht_override WHERE modul = 'schichtuebergabe';
DELETE FROM delegation_recht WHERE modul = 'schichtuebergabe';
