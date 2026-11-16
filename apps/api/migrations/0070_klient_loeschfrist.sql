-- Loeschfrist fuer Klientendaten nach der Archivierung (Art. 5 Abs. 1 lit. e,
-- Art. 17 DSGVO; Sozialdaten nach SGB X).
--
-- Bis hierher gab es fuer Klientendaten nur die manuelle Anonymisierung (0027).
-- Wer sie vergass, liess Namen, Diagnosen und Kontaktdaten ausgezogener
-- Menschen unbegrenzt liegen. Jetzt gibt es je Traeger eine Frist, gerechnet
-- AB DER ARCHIVIERUNG (0036): wer archiviert ist, ist ausgezogen und
-- eingefroren. Nach Ablauf wird die Person automatisch anonymisiert.
--
-- Standard ist NULL = AUS. Es gibt keine gesetzlich einheitliche Frist; sie
-- haengt vom Traeger, vom Kostentraeger und von der Aufbewahrungspflicht ab.
-- Eine geratene Voreinstellung wuerde bei der Auslieferung still und
-- unwiderruflich Daten vernichten -- darum muss der Traeger die Frist
-- bewusst setzen.
--
-- Entarchivieren setzt archiviert_am zurueck: die Frist beginnt danach neu.
-- Eine Person, die wieder aufgenommen wurde, wird nie nach der alten
-- Archivierung geloescht.
--
-- Was die Anonymisierung betrifft (ab jetzt auch die manuelle, per Trigger):
--   * klient: Name, Geburtsdatum (wie bisher)
--   * klient_stammdaten: ganze Zeile -- Diagnosen, Medikamente, IBAN, ...
--   * klient_kontakt: alle Zeilen -- personenbezogene Daten Dritter
--   * klient_archiv_pdf: die Aktenauszuege; sie enthalten die kompletten
--     Daten im Klartext und wuerden die Anonymisierung sonst unterlaufen
--   * Chat: 0061
-- Es bleiben, wie vor dieser Migration: Aktenzeichen und Amt (Referenz fuer
-- Belege), Kassenbuch, Rechnungen und Tagesberichte. Deren Aufbewahrung
-- ist eine offene fachliche Entscheidung des Traegers.

ALTER TABLE mandant
  ADD COLUMN klient_loeschfrist_tage integer
  -- Untergrenze 30: ein Tippfehler ("1" statt "100") wuerde sonst beim
  -- naechsten Lauf jede archivierte Person unwiderruflich anonymisieren.
  CHECK (klient_loeschfrist_tage IS NULL OR klient_loeschfrist_tage BETWEEN 30 AND 7300);

COMMENT ON COLUMN mandant.klient_loeschfrist_tage IS
  'NULL = keine automatische Loeschung. Sonst werden Klient:innen so viele Tage nach der Archivierung automatisch anonymisiert (klient_loeschfrist_anwenden()).';

GRANT UPDATE (klient_loeschfrist_tage) ON mandant TO zimmerakte_app;

-- Der automatische Lauf hat keine handelnde Person. Statt anonymisiert_von
-- auf einen Systembenutzer zu zeigen (den es nicht gibt), wird der
-- Automatik-Fall ausdruecklich markiert. Die App-Rolle bekommt auf die
-- Spalte kein UPDATE: nur die Funktion unten kann sie setzen.
ALTER TABLE klient ADD COLUMN anonymisiert_automatisch boolean NOT NULL DEFAULT false;

ALTER TABLE klient DROP CONSTRAINT klient_anonymisierung_konsistent;
ALTER TABLE klient ADD CONSTRAINT klient_anonymisierung_konsistent CHECK (
  (anonymisiert_am IS NULL AND anonymisiert_von IS NULL AND NOT anonymisiert_automatisch)
  OR
  (anonymisiert_am IS NOT NULL AND (anonymisiert_von IS NOT NULL) <> anonymisiert_automatisch)
);

-- Als Trigger wie 0052 und 0061: ob manuell oder automatisch, die Bereinigung
-- der abhaengigen Tabellen darf an keinem Pfad vergessen werden. Dieselbe
-- Transaktion -- scheitert sie, scheitert die Anonymisierung mit.
CREATE FUNCTION klient_daten_bei_anonymisierung() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.anonymisiert_am IS NOT NULL AND OLD.anonymisiert_am IS NULL THEN
    DELETE FROM klient_stammdaten WHERE klient_id = NEW.id;
    DELETE FROM klient_kontakt WHERE klient_id = NEW.id;
    DELETE FROM klient_archiv_pdf WHERE klient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER klient_daten_bei_anonymisierung
  AFTER UPDATE OF anonymisiert_am ON klient
  FOR EACH ROW EXECUTE FUNCTION klient_daten_bei_anonymisierung();

-- Parameterlos und ueber alle Mandanten, aus demselben Grund wie
-- chat_loeschfrist_anwenden() (0061): der Hintergrundlauf hat keinen
-- Tenant-Kontext, und die App-Rolle bekommt kein allgemeines Recht dafuer.
-- Die Funktion kann nichts anderes tun, als genau die Personen zu
-- anonymisieren, deren archiviert_am nach der Frist des eigenen Mandanten
-- liegt.
--
-- Zusaetzliche Bremse: wer aktuell oder kuenftig belegt ist, wird nie
-- angefasst, auch wenn archiviert_am gesetzt ist -- ein Widerspruch in den
-- Daten (archiviert, aber eingezogen) soll nicht zur Loeschung fuehren,
-- sondern auffallen.
CREATE FUNCTION klient_loeschfrist_anwenden()
RETURNS TABLE (mandant_id uuid, klienten bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('klient_loeschfrist_anwenden', 0)) THEN
    RETURN;
  END IF;

  FOR m IN
    SELECT id, klient_loeschfrist_tage FROM mandant
    WHERE klient_loeschfrist_tage IS NOT NULL ORDER BY id
  LOOP
    mandant_id := m.id;

    UPDATE klient k
    SET vorname = 'Anonymisiert', nachname = 'Anonymisiert', geburtsdatum = NULL,
        anonymisiert_am = now(), anonymisiert_automatisch = true
    WHERE k.mandant_id = m.id
      AND k.anonymisiert_am IS NULL
      AND k.archiviert_am IS NOT NULL
      AND k.archiviert_am < now() - make_interval(days => m.klient_loeschfrist_tage)
      AND NOT EXISTS (
        SELECT 1 FROM belegung b
        WHERE b.klient_id = k.id AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
      );
    GET DIAGNOSTICS klienten = ROW_COUNT;

    IF klienten > 0 THEN
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION klient_loeschfrist_anwenden() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION klient_loeschfrist_anwenden() TO zimmerakte_app;
