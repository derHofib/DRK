-- Tagesberichte bearbeitbar machen, ohne die Nachvollziehbarkeit zu verlieren.
--
-- 0024 hat tagesbericht bewusst unveraenderlich gemacht (wie das Kassenbuch).
-- Fachlich soll ein Bericht aber korrigierbar sein (Tippfehler, falsches
-- Datum, Nachtrag). Der Kompromiss: UPDATE wird nur spaltenscharf fuer
-- (text, datum) freigegeben, und JEDE Aenderung dieser Spalten schreibt ein
-- Trigger zwingend in tagesbericht_aenderung. Die Historie haengt damit an der
-- Datenbank, nicht am Anwendungscode: auch ein kuenftiger Codepfad, der
-- tagesbericht direkt aktualisiert, kann keine stille Aenderung mehr machen.
-- Autor, Klient, Mandant und Erstellzeitpunkt bleiben weiterhin gesperrt.
--
-- Die Historie ist wie der Bericht selbst ein Sozialdatum (Art. 9 DSGVO): sie
-- enthaelt alte Berichtstexte im Klartext und liegt unter denselben Schutz-
-- massnahmen wie tagesbericht.text -- RLS mit FORCE, Datentraegerverschluesselung
-- (docs/DEPLOYMENT.md). Eine eigene Spaltenverschluesselung nur fuer die
-- Historie waere ein schwaecheres Schutzniveau fuer den Bericht selbst als fuer
-- seine Vorversionen und wuerde die Verschluesselungsgrenze verschieben.
--
-- Ebenfalls protokolliert werden nachtraeglich hinzugefuegte Dokumente und
-- hinzugefuegte/entfernte Tags: beides aendert nicht den Berichtstext, ist aber
-- eine nachtraegliche Veraenderung der Dokumentation. Auch das geschieht per
-- Trigger auf den Zuordnungstabellen, aus demselben Grund wie oben.
--
-- Append-only: die Historie darf nie geaendert oder geloescht werden, sonst
-- waere sie als Nachweis gegenueber Aemtern wertlos.
CREATE TABLE tagesbericht_aenderung (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  tagesbericht_id uuid NOT NULL REFERENCES tagesbericht(id),
  art             text NOT NULL CHECK (art IN ('bearbeitet', 'tag_hinzugefuegt', 'tag_entfernt', 'dokument_hinzugefuegt')),
  geaendert_von   uuid REFERENCES benutzer(id),
  geaendert_am    timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- art = 'bearbeitet'
  text_alt        text,
  text_neu        text,
  datum_alt       date,
  datum_neu       date,
  -- art = 'tag_*'
  tag_name        text,
  -- art = 'dokument_hinzugefuegt'
  dokument_name   text
);

CREATE INDEX tagesbericht_aenderung_bericht_idx ON tagesbericht_aenderung (tagesbericht_id, geaendert_am);

ALTER TABLE tagesbericht_aenderung ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagesbericht_aenderung FORCE ROW LEVEL SECURITY;

CREATE POLICY tagesbericht_aenderung_isolation ON tagesbericht_aenderung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON tagesbericht_aenderung FROM zimmerakte_app;

CREATE FUNCTION tagesbericht_aenderung_protokollieren() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tagesbericht_aenderung
    (mandant_id, tagesbericht_id, art, geaendert_von, text_alt, text_neu, datum_alt, datum_neu)
  VALUES
    (OLD.mandant_id, OLD.id, 'bearbeitet',
     NULLIF(current_setting('app.benutzer_id', true), '')::uuid,
     OLD.text, NEW.text, OLD.datum, NEW.datum);
  RETURN NEW;
END;
$$;

CREATE TRIGGER tagesbericht_aenderung_protokoll
  BEFORE UPDATE OF text, datum ON tagesbericht
  FOR EACH ROW
  WHEN (OLD.text IS DISTINCT FROM NEW.text OR OLD.datum IS DISTINCT FROM NEW.datum)
  EXECUTE FUNCTION tagesbericht_aenderung_protokollieren();

REVOKE UPDATE ON tagesbericht FROM zimmerakte_app;
GRANT UPDATE (text, datum) ON tagesbericht TO zimmerakte_app;

-- Tags und Dokumente, die schon beim Anlegen des Berichts mitkommen, gehoeren
-- zur Ursprungsfassung und sind keine nachtraegliche Aenderung. Der Bericht
-- wird im selben Statement-Strom wie seine Tags angelegt, deshalb vergleicht
-- der Trigger den Zeitstempel nicht, sondern prueft, ob der Bericht in dieser
-- Transaktion entstanden ist (xmin = aktuelle Transaktion).
CREATE FUNCTION tagesbericht_nachtrag_protokollieren() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bericht_id uuid;
  mandant    uuid;
  neu_in_dieser_transaktion boolean;
  name_      text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    bericht_id := OLD.tagesbericht_id;
    mandant := OLD.mandant_id;
  ELSE
    bericht_id := NEW.tagesbericht_id;
    mandant := NEW.mandant_id;
  END IF;

  SELECT t.xmin::text = txid_current()::text INTO neu_in_dieser_transaktion
  FROM tagesbericht t WHERE t.id = bericht_id;
  IF COALESCE(neu_in_dieser_transaktion, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'tagesbericht_tag' THEN
    SELECT name::text INTO name_ FROM tag WHERE id = COALESCE(NEW.tag_id, OLD.tag_id);
    INSERT INTO tagesbericht_aenderung (mandant_id, tagesbericht_id, art, geaendert_von, tag_name)
    VALUES (mandant, bericht_id,
            CASE TG_OP WHEN 'DELETE' THEN 'tag_entfernt' ELSE 'tag_hinzugefuegt' END,
            NULLIF(current_setting('app.benutzer_id', true), '')::uuid, name_);
  ELSE
    INSERT INTO tagesbericht_aenderung (mandant_id, tagesbericht_id, art, geaendert_von, dokument_name)
    VALUES (mandant, bericht_id, 'dokument_hinzugefuegt',
            NULLIF(current_setting('app.benutzer_id', true), '')::uuid, NEW.dateiname);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER tagesbericht_tag_protokoll
  AFTER INSERT OR DELETE ON tagesbericht_tag
  FOR EACH ROW EXECUTE FUNCTION tagesbericht_nachtrag_protokollieren();

CREATE TRIGGER tagesbericht_dokument_protokoll
  AFTER INSERT ON tagesbericht_dokument
  FOR EACH ROW EXECUTE FUNCTION tagesbericht_nachtrag_protokollieren();
