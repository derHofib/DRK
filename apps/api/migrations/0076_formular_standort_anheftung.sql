-- Formulare selbst bauen, an Standorte binden und an Ablaeufe anheften
-- (Rueckmeldung "Formulare", Konzept /mnt/project-files/formulare/konzept-formulare.md,
-- freigegeben 18.11.2026). Baut auf 0075_protokoll auf.
--
-- "In Entwicklung" / "Veroeffentlicht" braucht KEINE neue Spalte: Ein
-- Formular ohne veroeffentlichte Version ist in Entwicklung, eine Version
-- ohne veroeffentlicht_am ist der Entwurf der naechsten (CLAUDE.md Regel 4).
--
-- Standorte und Anheftungen gehoeren zum FORMULAR, nicht zur Version: Sie
-- aendern nicht, WAS gefragt wird, sondern WO das Formular angeboten wird --
-- eine neue Version nur dafuer wuerde alte Protokolle nicht betreffen und
-- die Versionsliste mit Rauschen fuellen.

-- ---------------------------------------------------------------------------
-- Zusammengesetzte Schluessel, auf die die neuen Fremdschluessel zeigen
-- (CLAUDE.md Regel 1: ein FK nur auf id liesse einen fremden Traeger zu).
-- ---------------------------------------------------------------------------
ALTER TABLE standort ADD CONSTRAINT standort_id_mandant_uq UNIQUE (id, mandant_id);

-- ---------------------------------------------------------------------------
-- Ein Entwurf je Formular
-- ---------------------------------------------------------------------------
-- Zwei parallele Entwuerfe haetten dieselbe naechste Nummer im Sinn und
-- wuerden sich gegenseitig ueberschreiben; der Editor kennt nur "den" Entwurf.
CREATE UNIQUE INDEX formular_version_ein_entwurf ON formular_version (formular_id) WHERE veroeffentlicht_am IS NULL;

-- Ein Formular, das NIE veroeffentlicht wurde, darf geloescht werden (es gibt
-- keine Protokolle dazu). Sobald eine Version veroeffentlicht ist, verhindert
-- das der Fremdschluessel formular_version -> formular zusammen mit dem
-- Trigger formular_version_eingefroren, der das Loeschen einer
-- veroeffentlichten Version ablehnt -- die Datenbank, nicht der Service.
GRANT DELETE ON formular TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Standorte
-- ---------------------------------------------------------------------------
-- Keine Zeile = alle Standorte, auch kuenftige. So ist ein neuer Standort
-- automatisch dabei, ohne dass jemand alle Formulare nachpflegen muss.
-- Massgeblich ist der Standort der KLIENT:IN (aktuelle Belegung), nicht der
-- der ausfuellenden Person: viele Mitarbeitende arbeiten an mehreren
-- Standorten, die Klient:in wohnt an genau einem.
CREATE TABLE formular_standort (
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  formular_id uuid NOT NULL,
  standort_id uuid NOT NULL,
  PRIMARY KEY (formular_id, standort_id),
  FOREIGN KEY (formular_id, mandant_id) REFERENCES formular (id, mandant_id) ON DELETE CASCADE,
  -- Bewusst OHNE ON DELETE CASCADE: Verschwaende die letzte Zeile mit dem
  -- Standort, galte das Formular ploetzlich fuer ALLE Standorte -- eine
  -- stille Ausweitung. Lieber scheitert das Loeschen des Standorts.
  FOREIGN KEY (standort_id, mandant_id) REFERENCES standort (id, mandant_id)
);

ALTER TABLE formular_standort ENABLE ROW LEVEL SECURITY;
ALTER TABLE formular_standort FORCE ROW LEVEL SECURITY;
CREATE POLICY formular_standort_isolation ON formular_standort
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Nur Zeilen anlegen und entfernen, nie umschreiben.
REVOKE UPDATE ON formular_standort FROM zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Anheftungen
-- ---------------------------------------------------------------------------
-- Ein Anheftpunkt ist eine Stelle in der Zimmerakte, an der Formulare
-- dazugezogen werden. Die Liste steht im Code (ANHEFTPUNKTE in
-- packages/shared); der CHECK haelt sie hier gleich -- ein Wert, den kein
-- Codepfad behandelt, waere eine stille Luecke (wie bezug in 0075).
-- "Klientenakte > Protokolle" ist kein Anheftpunkt, sondern immer dabei.
CREATE TABLE formular_anheftung (
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  formular_id uuid NOT NULL,
  anheftpunkt text NOT NULL CHECK (anheftpunkt IN ('tagesbericht')),
  modus       text NOT NULL CHECK (modus IN ('automatisch', 'dazunehmen')),
  -- Pflicht gibt es nur fuer automatisch dazugezogene Formulare: ein
  -- Formular, das man erst per Knopf dazunimmt, kann nicht Pflicht sein.
  pflicht     boolean NOT NULL DEFAULT false CHECK (modus = 'automatisch' OR NOT pflicht),
  PRIMARY KEY (formular_id, anheftpunkt),
  FOREIGN KEY (formular_id, mandant_id) REFERENCES formular (id, mandant_id) ON DELETE CASCADE
);

ALTER TABLE formular_anheftung ENABLE ROW LEVEL SECURITY;
ALTER TABLE formular_anheftung FORCE ROW LEVEL SECURITY;
CREATE POLICY formular_anheftung_isolation ON formular_anheftung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE ON formular_anheftung FROM zimmerakte_app;
GRANT UPDATE (modus, pflicht) ON formular_anheftung TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Protokoll gehoert zu einem Tagesbericht
-- ---------------------------------------------------------------------------
-- Fremdschluessel auf (id, klient_id) statt nur auf id: so kann ein Protokoll
-- nur an einem Tagesbericht DERSELBEN Klient:in haengen. Ueber klient_id
-- (selbst mandantengebunden, 0075) ist damit auch der Traeger festgelegt.
-- Nur beim Anlegen gesetzt; protokoll hat spaltenscharfe UPDATE-Rechte
-- (0075), tagesbericht_id gehoert nicht dazu.
ALTER TABLE protokoll ADD COLUMN tagesbericht_id uuid;
ALTER TABLE protokoll
  ADD CONSTRAINT protokoll_tagesbericht_fk FOREIGN KEY (tagesbericht_id, klient_id)
  REFERENCES tagesbericht (id, klient_id);
CREATE INDEX protokoll_tagesbericht_idx ON protokoll (tagesbericht_id) WHERE tagesbericht_id IS NOT NULL;
