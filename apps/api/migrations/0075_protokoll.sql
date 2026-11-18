-- Protokolle: Formulare aus Bausteinen, ausgefuellt als strukturierte
-- Datenpunkte (Konzept: /mnt/project-files/protokolle/konzept-protokolle.md,
-- freigegeben 18.11.2026). Schritt 1: Datenmodell, Ausfuellen, Abschliessen,
-- Korrigieren mit Historie.
--
-- Drei getrennte Dinge: Formular (welche Felder, welche Logik), Protokoll mit
-- Datenpunkten (was eingetragen wurde) und spaeter PDF-Layouts (wie es auf
-- Papier aussieht). Der Feldschluessel verbindet sie.
--
-- Wie tagesbericht sind Protokolle Sozialdaten (Art. 9 DSGVO, SGB X): RLS mit
-- FORCE, Datentraegerverschluesselung, zusammengesetzte Fremdschluessel auf
-- (id, mandant_id), damit keine Zeile auf ein Objekt eines fremden Traegers
-- zeigen kann (ein FK-Check laeuft an RLS vorbei, siehe 0070_hilfeplan_und_ziele).
--
-- Name, Geburtsdatum und Aktenzeichen der Klient:in werden NIE als Wert
-- gespeichert, sondern beim Lesen ueber klient_id aufgeloest (Baustein
-- "anzeige"). Eine Kopie in jedem Protokoll wuerde die Anonymisierung
-- (0070_klient_loeschfrist) unterlaufen, die den Namen an genau einer Stelle
-- leert. Das erzwingt pruefeDefinition() in packages/shared/src/index.ts.

-- ---------------------------------------------------------------------------
-- Formular und Versionen
-- ---------------------------------------------------------------------------

-- Kein Status-Feld: "aktuelle Version" ist die juengste veroeffentlichte
-- (abgeleitet, CLAUDE.md Regel 4). Bezug vorerst nur 'klient'; Standort- und
-- bezugslose Protokolle kommen mit eigener Migration, wenn es sie gibt --
-- ein CHECK, der heute schon Werte zuliesse, die kein Codepfad behandelt,
-- waere eine stille Luecke.
CREATE TABLE formular (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id         uuid NOT NULL REFERENCES mandant(id),
  name               text NOT NULL CHECK (btrim(name) <> ''),
  beschreibung       text,
  bezug              text NOT NULL DEFAULT 'klient' CHECK (bezug IN ('klient')),
  -- Aus welcher Vorlage der Bibliothek (apps/api/src/protokolle/formular-vorlagen.ts)
  -- das Formular entstanden ist; NULL fuer selbst gebaute (Editor, Schritt 2).
  vorlage_schluessel text,
  erstellt_von       uuid REFERENCES benutzer(id),
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  archiviert_am      timestamptz,
  UNIQUE (id, mandant_id),
  UNIQUE (mandant_id, vorlage_schluessel)
);

ALTER TABLE formular ENABLE ROW LEVEL SECURITY;
ALTER TABLE formular FORCE ROW LEVEL SECURITY;
CREATE POLICY formular_isolation ON formular
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Geloescht wird ein Formular nie (alte Protokolle zeigen auf seine Versionen),
-- nur stillgelegt. Aenderbar sind Name, Beschreibung und Stilllegung.
REVOKE UPDATE, DELETE ON formular FROM zimmerakte_app;
GRANT UPDATE (name, beschreibung, archiviert_am) ON formular TO zimmerakte_app;

CREATE TABLE formular_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id          uuid NOT NULL REFERENCES mandant(id),
  formular_id         uuid NOT NULL,
  nummer              integer NOT NULL CHECK (nummer >= 1),
  definition          jsonb NOT NULL CHECK (jsonb_typeof(definition -> 'bausteine') = 'array'),
  erstellt_von        uuid REFERENCES benutzer(id),
  erstellt_am         timestamptz NOT NULL DEFAULT now(),
  -- NULL = Entwurf (nur im Editor sichtbar, Schritt 2).
  veroeffentlicht_am  timestamptz,
  veroeffentlicht_von uuid REFERENCES benutzer(id),
  UNIQUE (formular_id, nummer),
  UNIQUE (id, mandant_id),
  FOREIGN KEY (formular_id, mandant_id) REFERENCES formular (id, mandant_id)
);

ALTER TABLE formular_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE formular_version FORCE ROW LEVEL SECURITY;
CREATE POLICY formular_version_isolation ON formular_version
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON formular_version FROM zimmerakte_app;
GRANT UPDATE (definition, veroeffentlicht_am, veroeffentlicht_von) ON formular_version TO zimmerakte_app;
GRANT DELETE ON formular_version TO zimmerakte_app;

-- Eine veroeffentlichte Version ist eingefroren: Protokolle haengen an ihr und
-- muessen fuer immer mit denselben Feldern, Beschriftungen und Optionen
-- angezeigt werden koennen, mit denen sie ausgefuellt wurden (Nachweis
-- gegenueber Aemtern). Durchgesetzt hier statt im Service (CLAUDE.md Regel 5).
-- Ein Entwurf darf geaendert, veroeffentlicht oder verworfen werden.
CREATE FUNCTION formular_version_eingefroren() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.veroeffentlicht_am IS NOT NULL THEN
    RAISE EXCEPTION 'Eine veröffentlichte Formularversion kann nicht mehr geändert werden.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER formular_version_eingefroren
  BEFORE UPDATE OR DELETE ON formular_version
  FOR EACH ROW EXECUTE FUNCTION formular_version_eingefroren();

-- ---------------------------------------------------------------------------
-- Protokoll und Datenpunkte
-- ---------------------------------------------------------------------------

-- Status abgeleitet: abgeschlossen_am IS NULL = Entwurf.
CREATE TABLE protokoll (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id          uuid NOT NULL REFERENCES mandant(id),
  formular_version_id uuid NOT NULL,
  klient_id           uuid NOT NULL,
  autor_id            uuid NOT NULL REFERENCES benutzer(id),
  bezugsdatum         date NOT NULL,
  erstellt_am         timestamptz NOT NULL DEFAULT now(),
  abgeschlossen_am    timestamptz,
  abgeschlossen_von   uuid REFERENCES benutzer(id),
  UNIQUE (id, mandant_id),
  FOREIGN KEY (formular_version_id, mandant_id) REFERENCES formular_version (id, mandant_id),
  FOREIGN KEY (klient_id, mandant_id) REFERENCES klient (id, mandant_id),
  CHECK ((abgeschlossen_am IS NULL) = (abgeschlossen_von IS NULL))
);

CREATE INDEX protokoll_klient_idx ON protokoll (klient_id, bezugsdatum DESC);
CREATE INDEX protokoll_version_idx ON protokoll (formular_version_id);

ALTER TABLE protokoll ENABLE ROW LEVEL SECURITY;
ALTER TABLE protokoll FORCE ROW LEVEL SECURITY;
CREATE POLICY protokoll_isolation ON protokoll
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON protokoll FROM zimmerakte_app;
GRANT UPDATE (bezugsdatum, abgeschlossen_am, abgeschlossen_von) ON protokoll TO zimmerakte_app;
GRANT DELETE ON protokoll TO zimmerakte_app;

-- Abgeschlossen heisst: Teil der Akte. Nicht mehr loeschbar, nicht wieder
-- "oeffnen", Datum fest. Inhaltliche Korrekturen laufen ueber protokoll_wert
-- und landen dort in der Historie. Nur ein Entwurf darf geloescht werden.
CREATE FUNCTION protokoll_abschluss_endgueltig() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.abgeschlossen_am IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Ein abgeschlossenes Protokoll kann nicht gelöscht werden.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.abgeschlossen_am IS DISTINCT FROM OLD.abgeschlossen_am
       OR NEW.abgeschlossen_von IS DISTINCT FROM OLD.abgeschlossen_von
       OR NEW.bezugsdatum IS DISTINCT FROM OLD.bezugsdatum THEN
      RAISE EXCEPTION 'Ein abgeschlossenes Protokoll kann nicht wieder geöffnet werden.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER protokoll_abschluss_endgueltig
  BEFORE UPDATE OR DELETE ON protokoll
  FOR EACH ROW EXECUTE FUNCTION protokoll_abschluss_endgueltig();

-- Ein Datenpunkt je Feld (Konzept 7.2): auswertbar mit normalem SQL, der Typ
-- ist durch die Datenbank gesichert, und die Historie arbeitet feldgenau.
-- Ein leeres Feld hat KEINE Zeile (statt einer Zeile mit NULL) -- "nicht
-- ausgefuellt" ist so nur auf eine Weise darstellbar.
CREATE TABLE protokoll_wert (
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  protokoll_id    uuid NOT NULL,
  feld_schluessel text NOT NULL CHECK (feld_schluessel ~ '^[a-z][a-z0-9_]{0,62}$'),
  datentyp        text NOT NULL CHECK (datentyp IN ('text', 'zahl', 'datum', 'zeit', 'bool', 'liste')),
  wert_text       text,
  wert_zahl       numeric,
  wert_datum      date,
  wert_zeit       time,
  wert_bool       boolean,
  wert_liste      text[],
  quelle          text NOT NULL CHECK (quelle IN ('eingabe', 'vorschlag', 'vorschlag_geaendert', 'festgehalten', 'berechnet')),
  PRIMARY KEY (protokoll_id, feld_schluessel),
  FOREIGN KEY (protokoll_id, mandant_id) REFERENCES protokoll (id, mandant_id) ON DELETE CASCADE,
  CHECK (num_nonnulls(wert_text, wert_zahl, wert_datum, wert_zeit, wert_bool, wert_liste) = 1),
  CHECK (CASE datentyp
           WHEN 'text'  THEN wert_text  IS NOT NULL
           WHEN 'zahl'  THEN wert_zahl  IS NOT NULL
           WHEN 'datum' THEN wert_datum IS NOT NULL
           WHEN 'zeit'  THEN wert_zeit  IS NOT NULL
           WHEN 'bool'  THEN wert_bool  IS NOT NULL
           WHEN 'liste' THEN wert_liste IS NOT NULL
         END)
);

CREATE INDEX protokoll_wert_feld_idx ON protokoll_wert (mandant_id, feld_schluessel);

ALTER TABLE protokoll_wert ENABLE ROW LEVEL SECURITY;
ALTER TABLE protokoll_wert FORCE ROW LEVEL SECURITY;
CREATE POLICY protokoll_wert_isolation ON protokoll_wert
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE ON protokoll_wert FROM zimmerakte_app;
GRANT UPDATE (wert_text, wert_zahl, wert_datum, wert_zeit, wert_bool, wert_liste, quelle) ON protokoll_wert TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Historie
-- ---------------------------------------------------------------------------

-- Append-only wie tagesbericht_aenderung (0069). Werte als jsonb, damit eine
-- Spalte jeden Datentyp aufnehmen kann; ausgewertet wird die Historie nie,
-- nur angezeigt.
CREATE TABLE protokoll_aenderung (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  protokoll_id    uuid NOT NULL,
  feld_schluessel text NOT NULL,
  wert_alt        jsonb,
  wert_neu        jsonb,
  grund           text NOT NULL CHECK (btrim(grund) <> ''),
  geaendert_von   uuid REFERENCES benutzer(id),
  geaendert_am    timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (protokoll_id, mandant_id) REFERENCES protokoll (id, mandant_id)
);

CREATE INDEX protokoll_aenderung_protokoll_idx ON protokoll_aenderung (protokoll_id, geaendert_am);

ALTER TABLE protokoll_aenderung ENABLE ROW LEVEL SECURITY;
ALTER TABLE protokoll_aenderung FORCE ROW LEVEL SECURITY;
CREATE POLICY protokoll_aenderung_isolation ON protokoll_aenderung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON protokoll_aenderung FROM zimmerakte_app;

-- JEDE Aenderung eines Datenpunkts eines ABGESCHLOSSENEN Protokolls landet hier
-- -- per Trigger, nicht per Anwendungscode: auch ein kuenftiger Codepfad kann
-- keine stille Aenderung mehr machen (wie 0069). Der Grund ist Pflicht und
-- kommt aus der Transaktionsvariable app.aenderungsgrund; fehlt er, scheitert
-- die Aenderung.
--
-- Entwuerfe werden nicht protokolliert (sie sind noch nicht Teil der Akte).
-- Das Abschliessen selbst schreibt seine Werte, BEVOR abgeschlossen_am gesetzt
-- wird -- deshalb erzeugt es keine Historie.
CREATE FUNCTION protokoll_wert_als_json(w protokoll_wert) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE w.datentyp
    WHEN 'text'  THEN to_jsonb(w.wert_text)
    WHEN 'zahl'  THEN to_jsonb(w.wert_zahl)
    WHEN 'datum' THEN to_jsonb(w.wert_datum::text)
    WHEN 'zeit'  THEN to_jsonb(to_char(w.wert_zeit, 'HH24:MI'))
    WHEN 'bool'  THEN to_jsonb(w.wert_bool)
    WHEN 'liste' THEN to_jsonb(w.wert_liste)
  END
$$;

CREATE FUNCTION protokoll_wert_protokollieren() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  abgeschlossen boolean;
  grund_        text;
  alt           jsonb;
  neu           jsonb;
  zeile         protokoll_wert;
BEGIN
  zeile := COALESCE(NEW, OLD);
  SELECT p.abgeschlossen_am IS NOT NULL INTO abgeschlossen FROM protokoll p WHERE p.id = zeile.protokoll_id;
  IF NOT COALESCE(abgeschlossen, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP <> 'INSERT' THEN alt := protokoll_wert_als_json(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN neu := protokoll_wert_als_json(NEW); END IF;
  IF alt IS NOT DISTINCT FROM neu THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  grund_ := NULLIF(btrim(current_setting('app.aenderungsgrund', true)), '');
  IF grund_ IS NULL THEN
    RAISE EXCEPTION 'Änderungen an einem abgeschlossenen Protokoll brauchen einen Grund.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO protokoll_aenderung (mandant_id, protokoll_id, feld_schluessel, wert_alt, wert_neu, grund, geaendert_von)
  VALUES (zeile.mandant_id, zeile.protokoll_id, zeile.feld_schluessel, alt, neu, grund_,
          NULLIF(current_setting('app.benutzer_id', true), '')::uuid);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER protokoll_wert_protokoll
  AFTER INSERT OR UPDATE OR DELETE ON protokoll_wert
  FOR EACH ROW EXECUTE FUNCTION protokoll_wert_protokollieren();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

-- Neue Rechte der Registry sind ohne Zeile ein impliziter Deny (siehe 0072).
-- Wer heute Tagesberichte sehen bzw. anlegen darf, darf dasselbe mit
-- Protokollen (gleiche Faehigkeit "ueber die eigene Klientel dokumentieren").
-- Fremde Protokolle korrigieren und Formulare verwalten bekommt die
-- Leitungsebene -- erkennbar wie in 0072/0074 am Recht, Storno-Antraege zu
-- entscheiden. Mandanten aendern das danach frei in der Matrix.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'protokolle', neu.aktion, r.scope, r.erlaubt
FROM account_typ_recht r
JOIN LATERAL (
  SELECT 'ansehen' AS aktion WHERE r.modul = 'tagesberichte' AND r.aktion = 'ansehen'
  UNION ALL SELECT 'ausfuellen' WHERE r.modul = 'tagesberichte' AND r.aktion = 'anlegen'
  UNION ALL SELECT 'korrigieren-fremde' WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
  UNION ALL SELECT 'formulare-verwalten' WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
) neu ON true
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
