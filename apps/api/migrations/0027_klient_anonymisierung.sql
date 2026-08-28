-- Recht auf Loeschung (Art. 17 DSGVO) trifft hier auf konkurrierende
-- Aufbewahrungspflichten: Kassenbuchungen (0011, append-only) und
-- Rechnungen bleiben Zahlungsbelege gegenueber dem Amt und haengen per
-- klient_id an dieser Zeile -- ein Hard-Delete des Klienten wuerde diese
-- Fremdschluessel-Ketten verwaisen lassen (oder braeuchte ON DELETE
-- CASCADE, was die Belege gleich mitloeschen wuerde -- genau das Gegenteil
-- der Aufbewahrungspflicht). Deshalb Anonymisierung statt DELETE: die
-- identifizierenden Felder werden ueberschrieben, die Zeile selbst bleibt.
-- Siehe Kommentar in 0008_klient.sql ("Bauplan Punkt 06 zu Loeschfristen").
ALTER TABLE klient ALTER COLUMN geburtsdatum DROP NOT NULL;
ALTER TABLE klient ADD COLUMN anonymisiert_am  timestamptz;
ALTER TABLE klient ADD COLUMN anonymisiert_von uuid REFERENCES benutzer(id);

ALTER TABLE klient ADD CONSTRAINT klient_anonymisierung_konsistent
  CHECK ((anonymisiert_am IS NULL) = (anonymisiert_von IS NULL));

COMMENT ON COLUMN klient.anonymisiert_am IS
  'Gesetzt durch KlientService.anonymisieren() (Art. 17 DSGVO). Vorname/Nachname werden dabei durch einen Platzhalter ersetzt, Geburtsdatum geloescht. Aktenzeichen und Amt bleiben stehen -- sie sind die administrative Referenz, an der Kassenbuch/Rechnungen weiterhin haengen, und identifizieren fuer sich genommen keine Person.';

-- Wie bei kassenbuchung (0011): Default-Privileges (0002) geben der
-- App-Rolle heute UPDATE/DELETE auf ALLE Spalten. DELETE faellt hier ganz
-- weg -- ein Hard-Delete waere der falsche Weg, siehe oben -- und UPDATE
-- bleibt auf genau die Felder beschraenkt, die eine Anonymisierung anfasst.
REVOKE UPDATE, DELETE ON klient FROM zimmerakte_app;
GRANT UPDATE (vorname, nachname, geburtsdatum, anonymisiert_am, anonymisiert_von) ON klient TO zimmerakte_app;
