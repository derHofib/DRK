-- Formular ersetzt die Standardsicht des Tagesberichts (Rueckmeldung
-- "Tagesbericht Formular", Konzept /mnt/project-files/tagesbericht-formular/
-- konzept-tagesbericht-formular.md, freigegeben 18.11.2026). Baut auf 0076.
--
-- Bisher hing ein Formular nur als Beilage unter dem Pflicht-Freitext. Neu
-- kann es der Tagesbericht SELBST sein; der Freitext wird dann zur
-- optionalen Bemerkung.

-- ---------------------------------------------------------------------------
-- Darstellung je Anheftung
-- ---------------------------------------------------------------------------
-- Am Formular, nicht zentral je Standort: die Standorte regelt das Formular
-- bereits (formular_standort) -- eine zweite Standortliste fuer dieselbe
-- Frage waere ein zweiter Ort fuer dieselbe Wahrheit (CLAUDE.md Regel 4).
-- Default 'ergaenzt': bestehende Anheftungen verhalten sich wie bisher,
-- nichts aendert sich ungefragt.
ALTER TABLE formular_anheftung
  ADD COLUMN darstellung text NOT NULL DEFAULT 'ergaenzt' CHECK (darstellung IN ('ergaenzt', 'ersetzt'));

-- Ein Formular, das man erst per Knopf dazunimmt oder weglassen darf, kann
-- nicht der Tagesbericht sein: sonst gaebe es Berichte ganz ohne Inhalt.
ALTER TABLE formular_anheftung
  ADD CONSTRAINT formular_anheftung_ersetzt_pflicht
  CHECK (darstellung = 'ergaenzt' OR (modus = 'automatisch' AND pflicht));

GRANT UPDATE (darstellung) ON formular_anheftung TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Leerer Berichtstext nur mit Protokoll
-- ---------------------------------------------------------------------------
-- Ersetzt ein Formular den Freitext, darf der Text leer sein. Ohne
-- angeheftetes Protokoll waere ein leerer Tagesbericht aber eine leere
-- Dokumentation -- das prueft der Service, und zusaetzlich hier die
-- Datenbank (Regel 5: nicht per Codereview). Verzoegert bis zum COMMIT,
-- weil das Protokoll erst NACH dem Tagesbericht in derselben Transaktion
-- entsteht (es verweist per FK auf ihn).
CREATE FUNCTION tagesbericht_leer_nur_mit_protokoll() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF btrim(NEW.text) = '' AND NOT EXISTS (SELECT 1 FROM protokoll p WHERE p.tagesbericht_id = NEW.id) THEN
    RAISE EXCEPTION 'Ein Tagesbericht ohne Text braucht ein angeheftetes Formular.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tagesbericht_leer_nur_mit_protokoll
  AFTER INSERT OR UPDATE OF text ON tagesbericht
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tagesbericht_leer_nur_mit_protokoll();
