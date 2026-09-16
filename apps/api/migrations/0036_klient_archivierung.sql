-- Wenn ein Klient auszieht und nicht mehr Teil der Einrichtung ist, kann die
-- Leitung ihn archivieren: der Klient wird eingefroren (keine neuen
-- Tagesberichte/Buchungen/Rechnungen/Kostenuebernahmen/Stammdaten-Aenderungen/
-- Zimmerzuweisungen mehr moeglich, siehe klientIstArchiviert() in
-- common/standort-restriction.ts) und verschwindet aus der normalen
-- Klientenliste. Reversibel -- anders als die Anonymisierung (0027) ist das
-- kein Recht auf Loeschung, sondern eine operative Statusaenderung.
--
-- Gleiches Muster wie anonymisiert_am/anonymisiert_von.
ALTER TABLE klient ADD COLUMN archiviert_am  timestamptz;
ALTER TABLE klient ADD COLUMN archiviert_von uuid REFERENCES benutzer(id);

ALTER TABLE klient ADD CONSTRAINT klient_archivierung_konsistent
  CHECK ((archiviert_am IS NULL) = (archiviert_von IS NULL));

COMMENT ON COLUMN klient.archiviert_am IS
  'Gesetzt durch KlientArchivService.archivieren(). Der Klient ist damit eingefuehrt read-only und aus der Standardliste ausgeblendet, bleibt aber ueber ?archiviert=true sichtbar. Reversibel per entarchivieren().';

-- Erweitert die spaltenscharfe Sperre aus 0027 um die beiden neuen Spalten --
-- REVOKE muss erneut ausgesprochen werden, weil GRANT UPDATE (...) die vorige
-- Spaltenliste sonst nur ERGAENZT, nicht ersetzt, und die Absicht ("nur genau
-- diese Spalten") sonst beim Lesen der Migration verloren ginge.
REVOKE UPDATE ON klient FROM zimmerakte_app;
GRANT UPDATE (vorname, nachname, geburtsdatum, anonymisiert_am, anonymisiert_von, archiviert_am, archiviert_von)
  ON klient TO zimmerakte_app;

-- Ein PDF-Snapshot pro Archivierungsvorgang -- bewusst OHNE UNIQUE(klient_id):
-- archivieren -> entarchivieren -> erneutes archivieren erzeugt einen neuen,
-- unabhaengigen Snapshot, keiner wird ueberschrieben oder geloescht. Gleicher
-- bytea+Hash-Kompromiss wie tagesbericht_dokument (0028) und rechnung_dokument
-- (0015), aus denselben Gruenden (Amtsnachfragen, Nachvollziehbarkeit).
CREATE TABLE klient_archiv_pdf (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  klient_id    uuid NOT NULL REFERENCES klient(id),
  erstellt_von uuid REFERENCES benutzer(id),
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  pdf          bytea NOT NULL,
  pdf_hash     text NOT NULL -- sha256, hex-kodiert
);

CREATE INDEX klient_archiv_pdf_klient_idx ON klient_archiv_pdf (klient_id);

ALTER TABLE klient_archiv_pdf ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_archiv_pdf FORCE ROW LEVEL SECURITY;

CREATE POLICY klient_archiv_pdf_isolation ON klient_archiv_pdf
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Wie tagesbericht_dokument/rechnung_dokument: einmal erzeugt, nie mehr
-- geaendert oder geloescht -- ein Archiv-Snapshot, der sich nachtraeglich
-- aendern liesse, waere kein Beleg mehr.
REVOKE UPDATE, DELETE ON klient_archiv_pdf FROM zimmerakte_app;
