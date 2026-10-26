-- Loeschfrist fuer Chatinhalte und Chat-Bereinigung bei Anonymisierung
-- (Entscheidungsvorlage "Datenschutz im Hecaso-Chat", Optionen A und B).
--
-- Bis hierher lag jede Chatnachricht unbegrenzt in der Datenbank -- auch die
-- "geloeschten", die nur ihren Inhalt verloren haben (0055). Das verstoesst
-- gegen die Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO): im Chat landen
-- zwangslaeufig Gesundheits- und Sozialdaten, und ein Chat ist Absprache,
-- nicht Akte. Was dokumentationspflichtig ist, gehoert in Verlauf oder
-- Schichtuebergabe, die eigene Aufbewahrungsregeln haben.
--
-- Teil A: Frist je Traeger (mandant.chat_loeschfrist_tage, Standard 90 Tage).
-- Nach Ablauf werden Nachricht UND Anhang endgueltig entfernt (DELETE, kein
-- Leeren) -- anders als das Loeschen durch Absender:innen bleibt hier keine
-- Zeile "Nachricht geloescht" stehen, sonst lebten Absender und Zeitpunkt
-- unbegrenzt weiter. Beantwortete Chat-Anfragen folgen derselben Frist
-- (gerechnet ab der Antwort); offene bleiben, bis jemand antwortet oder die
-- Klient:in sie zurueckzieht -- sonst verschwaende eine Bitte um ein
-- Gespraech kommentarlos.
--
-- Chats und Teilnahmen selbst bleiben stehen: sie sind der Container, in dem
-- weiter geschrieben wird, und tragen keine Inhalte.
--
-- Die App-Rolle hat auf chat_nachricht/chat_anfrage bewusst kein DELETE
-- (append-only, 0055/0056) und bekommt es auch jetzt nicht. Stattdessen
-- genau EINE SECURITY-DEFINER-Funktion ohne Parameter: sie kann nichts
-- anderes loeschen als das, was nach der eigenen Frist des jeweiligen
-- Mandanten abgelaufen ist. Ein Fehler im Service kann damit keine
-- beliebigen Nachrichten entfernen.
ALTER TABLE mandant
  ADD COLUMN chat_loeschfrist_tage integer NOT NULL DEFAULT 90
  -- Untergrenze 7 statt 1: ein Tippfehler ("1" statt "100") wuerde sonst
  -- beim naechsten Lauf fast den gesamten Verlauf unwiderruflich loeschen.
  CHECK (chat_loeschfrist_tage BETWEEN 7 AND 3650);

COMMENT ON COLUMN mandant.chat_loeschfrist_tage IS
  'Nach so vielen Tagen werden Chatnachrichten, ihre Bilder und beantwortete Chat-Anfragen endgueltig geloescht (chat_loeschfrist_anwenden()).';

-- Spaltenscharf wie 0019/0029: die bestehenden GRANTs (akzentfarbe,
-- dunkel_grundfarbe) bleiben, dazu genau diese eine Spalte.
GRANT UPDATE (chat_loeschfrist_tage) ON mandant TO zimmerakte_app;

-- Laeuft ueber ALLE Mandanten, weil der taegliche Lauf in der API keinen
-- Tenant-Kontext hat (es gibt keine anfragende Person). Jeder Mandant wird
-- nur nach seiner eigenen Frist bereinigt. Das Advisory-Lock verhindert, dass
-- mehrere API-Instanzen gleichzeitig dieselben Zeilen loeschen; wer es nicht
-- bekommt, liefert einfach nichts zurueck.
CREATE FUNCTION chat_loeschfrist_anwenden()
RETURNS TABLE (mandant_id uuid, nachrichten bigint, anhaenge bigint, anfragen bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  v_grenze timestamptz;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('chat_loeschfrist_anwenden', 0)) THEN
    RETURN;
  END IF;

  FOR m IN SELECT id, chat_loeschfrist_tage FROM mandant ORDER BY id LOOP
    v_grenze := now() - make_interval(days => m.chat_loeschfrist_tage);
    mandant_id := m.id;

    DELETE FROM chat_anhang a
    USING chat_nachricht n
    WHERE a.nachricht_id = n.id
      AND n.mandant_id = m.id
      AND n.erstellt_am < v_grenze;
    GET DIAGNOSTICS anhaenge = ROW_COUNT;

    DELETE FROM chat_nachricht n
    WHERE n.mandant_id = m.id
      AND n.erstellt_am < v_grenze;
    GET DIAGNOSTICS nachrichten = ROW_COUNT;

    DELETE FROM chat_anfrage f
    WHERE f.mandant_id = m.id
      AND f.beantwortet_am IS NOT NULL
      AND f.beantwortet_am < v_grenze;
    GET DIAGNOSTICS anfragen = ROW_COUNT;

    IF nachrichten > 0 OR anhaenge > 0 OR anfragen > 0 THEN
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION chat_loeschfrist_anwenden() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_loeschfrist_anwenden() TO zimmerakte_app;

-- Teil B: Anonymisierung (0027) ueberschrieb bisher nur Name und
-- Geburtsdatum in klient. Chatinhalte blieben vollstaendig stehen -- Fotos,
-- Anfragetexte, alles, was die Person selbst geschrieben hat, und jeder
-- Direktchat, der sich per Definition nur um sie drehte. Art. 17 DSGVO
-- endet aber nicht an der Tabellengrenze.
--
-- Was entfernt wird:
--   * Direktchats mit der Person: der gesamte Verlauf, beide Seiten. Ein
--     Direktchat mit einer Klient:in IST eine Unterhaltung ueber sie; die
--     Nachrichten der Mitarbeitenden darin sind keine Akte (siehe oben).
--   * Gruppen: nur ihre eigenen Nachrichten, und ihre Teilnahme endet.
--     Nachrichten anderer in Gruppen bleiben -- ob darin ueber die Person
--     geschrieben wurde, laesst sich nicht maschinell erkennen; dafuer gilt
--     die Loeschfrist aus Teil A.
--   * Alle Chat-Anfragen der Person.
-- Direktchat-Teilnahmen bleiben bestehen: man kann einen Direktchat nicht
-- verlassen (chat.service.ts), und der Zugang ist durch
-- klient_zugang_bei_sperre() ohnehin schon gesperrt.
--
-- Als Trigger wie klient_zugang_bei_sperre() (0052): Anonymisierung kann an
-- mehreren Stellen im Code passieren, die Bereinigung darf an keiner davon
-- vergessen werden. Laeuft in derselben Transaktion -- scheitert sie,
-- scheitert die Anonymisierung mit.
CREATE FUNCTION chat_bei_anonymisierung() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NEW.anonymisiert_am IS NOT NULL AND OLD.anonymisiert_am IS NULL THEN
    SELECT coalesce(array_agg(n.id), '{}') INTO v_ids
    FROM chat_nachricht n
    WHERE n.mandant_id = NEW.mandant_id
      AND (
        n.absender_klient_id = NEW.id
        OR n.chat_id IN (
          SELECT ct.chat_id
          FROM chat_teilnehmer ct
          JOIN chat c ON c.id = ct.chat_id
          WHERE ct.klient_id = NEW.id AND c.art = 'direkt'
        )
      );

    DELETE FROM chat_anhang WHERE nachricht_id = ANY(v_ids);
    DELETE FROM chat_nachricht WHERE id = ANY(v_ids);

    UPDATE chat_teilnehmer ct
    SET verlassen_am = clock_timestamp()
    FROM chat c
    WHERE c.id = ct.chat_id
      AND c.art = 'gruppe'
      AND ct.klient_id = NEW.id
      AND ct.verlassen_am IS NULL;

    DELETE FROM chat_anfrage WHERE klient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_bei_anonymisierung
  AFTER UPDATE OF anonymisiert_am ON klient
  FOR EACH ROW EXECUTE FUNCTION chat_bei_anonymisierung();
