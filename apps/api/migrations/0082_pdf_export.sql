-- PDF-Exporte je Formular mit eigenem Design
-- (Konzept /mnt/project-files/formular-pdf/konzept-formular-pdf.md, Fassung 2,
-- freigegeben von Dennis am 20.11.2026: "Bau das so").
--
-- Entscheidung, die alles traegt: Das Design gehoert zum einzelnen PDF-Export
-- EINES Formulars, nicht zum Traeger. Dennis: "Ich will das fuer jedes
-- Formular einzeln entscheiden ... und je Formular unterschiedliche Designs."
-- Ein traegerweites Briefpapier (Fassung 1) wurde deshalb verworfen.
-- Geteilt werden nur DATEN (Logo-Dateien, Angaben zum Traeger, Standort-
-- Steckbrief aus 0079), die ein Export ueber Platzhalter einsetzt -- so
-- stimmt eine geaenderte Bankverbindung in allen Exporten, ohne dass sich ein
-- Design aendert.
--
-- Ein Export-Design ist versioniert und append-only: ein PDF, das an ein Amt
-- ging, muss sich spaeter genau so wieder erzeugen lassen (pdf_export_erzeugt
-- merkt sich die Version). Vorbild: formular_version, kassenbuchung.

-- ---------------------------------------------------------------------------
-- Gemeinsame Angaben: Traeger (1 Zeile je Mandant)
-- ---------------------------------------------------------------------------

CREATE TABLE traeger_angaben (
  mandant_id         uuid PRIMARY KEY REFERENCES mandant(id),
  -- Rechtlicher Name, z. B. "DRK Schoeneberg-Wilmersdorf hilft gGmbH"; der
  -- Anzeigename mandant.name ist oft kuerzer.
  name               text,
  hauptsitz          text,
  telefon            text,
  email              text,
  website            text,
  geschaeftsfuehrung text,
  registergericht    text,
  registernummer     text,
  steuernummer       text,
  bank               text,
  iban               text,
  bic                text,
  geaendert_am       timestamptz NOT NULL DEFAULT now(),
  geaendert_von      uuid REFERENCES benutzer(id)
);

ALTER TABLE traeger_angaben ENABLE ROW LEVEL SECURITY;
ALTER TABLE traeger_angaben FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_angaben_isolation ON traeger_angaben
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE DELETE ON traeger_angaben FROM zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Gemeinsame Dateien (vorerst nur Logos)
-- ---------------------------------------------------------------------------

-- Nur Formate, die pdf-lib ohne Umweg einbettet. SVG wird beim Hochladen in
-- PNG umgerechnet (sharp) und NIE als SVG gespeichert: eine SVG-Datei kann
-- Skript enthalten und darf deshalb nicht unveraendert ausgeliefert werden
-- (siehe ERLAUBTE_DOKUMENT_MIME_TYPES in common/datei.ts). Weitere Arten
-- (eigene Schrift, Hintergrund-PDF) kommen mit eigener Migration -- ein CHECK,
-- der heute Werte zuliesse, die kein Codepfad behandelt, waere eine stille
-- Luecke.
CREATE TABLE traeger_datei (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  art            text NOT NULL CHECK (art IN ('logo')),
  name           text NOT NULL CHECK (btrim(name) <> ''),
  mime           text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'application/pdf')),
  inhalt         bytea NOT NULL,
  sha256         text NOT NULL,
  groesse        integer NOT NULL CHECK (groesse > 0 AND groesse <= 2097152),
  hochgeladen_am timestamptz NOT NULL DEFAULT now(),
  hochgeladen_von uuid REFERENCES benutzer(id),
  UNIQUE (id, mandant_id)
);

ALTER TABLE traeger_datei ENABLE ROW LEVEL SECURITY;
ALTER TABLE traeger_datei FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_datei_isolation ON traeger_datei
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Inhalt ist unveraenderlich (ein altes PDF soll sich mit demselben Logo
-- wieder erzeugen lassen); umbenennen ja. Loeschen nur, solange kein Export
-- es benutzt -- das erzwingt der Fremdschluessel aus pdf_export_version.
REVOKE UPDATE ON traeger_datei FROM zimmerakte_app;
GRANT UPDATE (name) ON traeger_datei TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- PDF-Exporte eines Formulars
-- ---------------------------------------------------------------------------

-- Kein Status-Feld (Regel 4): "in Benutzung", "wie oft erzeugt" ergeben sich
-- aus pdf_export_erzeugt. kopiert_aus ist nur ein Vermerk ("kopiert aus
-- Hilfeplangespraech > Bericht an das Amt"), keine Verknuepfung -- eine Kopie
-- ist danach unabhaengig (Konzept Abschnitt 1).
CREATE TABLE pdf_export (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  formular_id   uuid NOT NULL,
  ist_standard  boolean NOT NULL DEFAULT false,
  kopiert_aus   text,
  angelegt_am   timestamptz NOT NULL DEFAULT now(),
  angelegt_von  uuid REFERENCES benutzer(id),
  stillgelegt_am timestamptz,
  UNIQUE (id, mandant_id),
  -- CASCADE: geloescht werden kann nur ein nie veroeffentlichtes Formular
  -- (protokoll.service.ts). Dann kann es keine Erzeugung geben -- und gaebe
  -- es eine, haelt pdf_export_erzeugt (ohne CASCADE) das Loeschen trotzdem auf.
  -- Referenzaktionen laufen mit den Rechten des Tabelleneigentuemers; das
  -- REVOKE DELETE unten gilt nur fuer direkte Loeschversuche der App.
  FOREIGN KEY (formular_id, mandant_id) REFERENCES formular (id, mandant_id) ON DELETE CASCADE,
  -- Der Standard-Export ist der, den "Als PDF" ohne Auswahl nimmt; er darf
  -- nicht stillgelegt sein, sonst gaebe es Formulare ohne PDF.
  CHECK (NOT (ist_standard AND stillgelegt_am IS NOT NULL))
);

CREATE UNIQUE INDEX pdf_export_ein_standard ON pdf_export (formular_id) WHERE ist_standard;
CREATE INDEX pdf_export_formular_idx ON pdf_export (formular_id);

ALTER TABLE pdf_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_export FORCE ROW LEVEL SECURITY;
CREATE POLICY pdf_export_isolation ON pdf_export
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON pdf_export FROM zimmerakte_app;
GRANT UPDATE (ist_standard, stillgelegt_am) ON pdf_export TO zimmerakte_app;

-- Name und Zielgruppe gehoeren zur Version, nicht zum Export: beides
-- bestimmt, was im PDF steht (Titel, ob interne Felder ueberhaupt in Frage
-- kommen), und muss deshalb mit der Version eingefroren sein.
CREATE TABLE pdf_export_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  pdf_export_id uuid NOT NULL,
  nummer        integer NOT NULL CHECK (nummer >= 1),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  zielgruppe    text NOT NULL CHECK (zielgruppe IN ('intern', 'extern')),
  logo_id       uuid,
  -- Gestaltung (packages/shared: PdfGestaltung). Fehlende Angaben fuellt
  -- pdfGestaltungMitVorgaben() beim Lesen auf, daher reicht '{}' fuer
  -- "Zimmerakte-Vorgabe".
  gestaltung    jsonb NOT NULL CHECK (jsonb_typeof(gestaltung) = 'object'),
  gespeichert_am timestamptz NOT NULL DEFAULT now(),
  gespeichert_von uuid REFERENCES benutzer(id),
  UNIQUE (pdf_export_id, nummer),
  UNIQUE (id, mandant_id),
  FOREIGN KEY (pdf_export_id, mandant_id) REFERENCES pdf_export (id, mandant_id) ON DELETE CASCADE,
  FOREIGN KEY (logo_id, mandant_id) REFERENCES traeger_datei (id, mandant_id)
);

ALTER TABLE pdf_export_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_export_version FORCE ROW LEVEL SECURITY;
CREATE POLICY pdf_export_version_isolation ON pdf_export_version
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Append-only (Regel 5): Aendern heisst neue Version.
REVOKE UPDATE, DELETE ON pdf_export_version FROM zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Erzeugte PDFs (Nachweis)
-- ---------------------------------------------------------------------------

-- Jedes erzeugte PDF, nicht nur externe: die Zahl "38-mal erzeugt" ist dann
-- eine Zaehlung, und bei einem externen PDF steht fest, wer es wann an wen
-- mit welcher Exportversion erzeugt hat (Hash zum Wiedererkennen).
-- Gespeichert wird NICHT das PDF selbst -- es laesst sich aus Protokoll und
-- Exportversion identisch wieder erzeugen, und eine zweite Kopie von
-- Sozialdaten waere ein weiterer Ort, den die Loeschfrist kennen muesste.
CREATE TABLE pdf_export_erzeugt (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id            uuid NOT NULL REFERENCES mandant(id),
  pdf_export_version_id uuid NOT NULL,
  protokoll_id          uuid NOT NULL,
  standort_id           uuid,
  empfaenger            text,
  sha256                text NOT NULL,
  erzeugt_von           uuid REFERENCES benutzer(id),
  erzeugt_am            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pdf_export_version_id, mandant_id) REFERENCES pdf_export_version (id, mandant_id),
  FOREIGN KEY (protokoll_id, mandant_id) REFERENCES protokoll (id, mandant_id),
  FOREIGN KEY (standort_id, mandant_id) REFERENCES standort (id, mandant_id)
);

CREATE INDEX pdf_export_erzeugt_version_idx ON pdf_export_erzeugt (pdf_export_version_id);
CREATE INDEX pdf_export_erzeugt_protokoll_idx ON pdf_export_erzeugt (protokoll_id);

ALTER TABLE pdf_export_erzeugt ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_export_erzeugt FORCE ROW LEVEL SECURITY;
CREATE POLICY pdf_export_erzeugt_isolation ON pdf_export_erzeugt
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON pdf_export_erzeugt FROM zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Jedes Formular hat von Anfang an einen Export "Akte"
-- ---------------------------------------------------------------------------

-- In der Datenbank statt im Service: Formulare entstehen an mehreren Stellen
-- (Editor, Vorlagen, Testdaten), und ein Formular ohne Export haette in der
-- Akte keinen PDF-Knopf. Version 1 mit '{}' = Zimmerakte-Vorgabe "akte".
CREATE FUNCTION formular_standard_export() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  neu uuid;
BEGIN
  INSERT INTO pdf_export (mandant_id, formular_id, ist_standard, angelegt_von)
  VALUES (NEW.mandant_id, NEW.id, true, NEW.erstellt_von)
  RETURNING id INTO neu;
  INSERT INTO pdf_export_version (mandant_id, pdf_export_id, nummer, name, zielgruppe, gestaltung, gespeichert_von)
  VALUES (NEW.mandant_id, neu, 1, 'Akte', 'intern', '{}'::jsonb, NEW.erstellt_von);
  RETURN NEW;
END;
$$;

CREATE TRIGGER formular_standard_export
  AFTER INSERT ON formular
  FOR EACH ROW EXECUTE FUNCTION formular_standard_export();

-- Bestehende Formulare nachziehen (laeuft als Migrationsrolle, RLS greift hier nicht).
WITH neu AS (
  INSERT INTO pdf_export (mandant_id, formular_id, ist_standard, angelegt_von)
  SELECT f.mandant_id, f.id, true, f.erstellt_von FROM formular f
  RETURNING id, mandant_id, angelegt_von
)
INSERT INTO pdf_export_version (mandant_id, pdf_export_id, nummer, name, zielgruppe, gestaltung, gespeichert_von)
SELECT mandant_id, id, 1, 'Akte', 'intern', '{}'::jsonb, angelegt_von FROM neu;

-- ---------------------------------------------------------------------------
-- Recht: externe PDFs erzeugen
-- ---------------------------------------------------------------------------

-- Ein externes PDF verlaesst die Einrichtung (Amt, Klient:in). Eigenes Recht,
-- damit ein Traeger das auf Bezugsbetreuung und Leitung beschraenken kann
-- (Konzept Frage 6). Startwert wie "ausfuellen": wer dokumentiert, darf auch
-- den Bericht ans Amt erzeugen -- so wie heute mit dem Tagesbericht.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'protokolle', 'pdf-extern', r.scope, r.erlaubt
FROM account_typ_recht r
WHERE r.modul = 'protokolle' AND r.aktion = 'ausfuellen'
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
