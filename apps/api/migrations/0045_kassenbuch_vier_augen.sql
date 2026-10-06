-- Vier-Augen-Verschaerfung fuer den Kassenbuch-Storno: bislang durfte sich
-- eine Bereichs- oder Einrichtungsleitung, die selbst gebucht hatte, den
-- eigenen Storno-Antrag im selben Zug bewilligen (kassenbuchung.service.ts,
-- stornoBeantragen(), siehe Migration 0031) -- wer das Geld bewegt hat,
-- konnte die eigene Buchung also folgenlos rueckgaengig machen. Die
-- fachliche Vorgabe verlangt ein echtes Vier-Augen-Prinzip: die
-- entscheidende Person darf nie dieselbe sein, die gebucht hat -- OHNE
-- Ausnahme, auch nicht fuer Geschaeftsfuehrung (account_typ.ist_vollzugriff).
-- Das ist eine von genau drei harten Ausnahmen vom Vollzugriff-Wildcard laut
-- Projektauftrag. Der Wildcard-Kurzschluss in RechteService.istVollzugriff()
-- kann diese Regel strukturell nicht abbilden -- er beantwortet nur "darf
-- diese Person ueberhaupt entscheiden", nie "ist diese Person identisch mit
-- der buchenden Person" --, deshalb sitzt die Regel hier als Trigger, nicht
-- als weitere Bedingung in der Rechte-Engine.
--
-- Anwendungsseitig faengt kassenbuchung.service.ts (stornoBeantragen()) den
-- Normalfall schon VOR diesem Trigger ab: stellt die buchende Person selbst
-- den Antrag, bleibt er auf status='beantragt' liegen statt automatisch
-- bewilligt zu werden (verstaendlichere Fehlermeldung als ein roher
-- Datenbankfehler). Dieser Trigger ist die harte, nicht umgehbare Grenze
-- darunter -- sie greift auch dann noch, wenn ein kuenftiger Code-Pfad
-- (oder ein roher UPDATE als App-Rolle) diese Pruefung vergisst oder
-- umgeht. Gleiches Prinzip wie CLAUDE.md Regel 5 ("Unveraenderlichkeit
-- gehoert in die Datenbank, nicht in den Code"), hier auf eine
-- Vier-Augen-Regel statt auf Unveraenderlichkeit angewendet.
--
-- Custom-SQLSTATE wie belegung_kapazitaet_pruefen() (Migration 0032) --
-- ZA001 ist dort bereits fuer die Zimmerkapazitaet vergeben, hier also
-- ZA002 (per Grep ueber migrations/ und src/ als noch unbenutzt geprueft).
CREATE FUNCTION kassenbuchung_stornoantrag_vier_augen_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gebucht_von_wert uuid;
BEGIN
  -- Nur relevant, sobald eine Entscheidung getroffen wird (der Uebergang
  -- beantragt -> genehmigt/abgelehnt setzt entschieden_von). Ein UPDATE,
  -- das entschieden_von nicht setzt, kann es laut Anwendungscode nicht
  -- geben, aber die Pruefung bleibt robust, falls doch.
  IF NEW.entschieden_von IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT gebucht_von INTO gebucht_von_wert FROM kassenbuchung WHERE id = NEW.kassenbuchung_id;

  IF gebucht_von_wert IS NOT NULL AND NEW.entschieden_von = gebucht_von_wert THEN
    RAISE EXCEPTION 'Wer eine Kassenbuchung selbst gebucht hat, darf nicht ueber deren Storno-Antrag entscheiden (Vier-Augen-Prinzip).'
      USING ERRCODE = 'ZA002';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER kassenbuchung_stornoantrag_vier_augen_pruefen
  BEFORE UPDATE ON kassenbuchung_stornoantrag
  FOR EACH ROW EXECUTE FUNCTION kassenbuchung_stornoantrag_vier_augen_pruefen();
