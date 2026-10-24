-- Standort-Sichtbarkeit fuer Chat-Anfragen in der Datenbank (Nachtrag zu 0056).
--
-- Bisher prueften nur chat-anfrage.service.ts und KlientNamen, ob ein:e
-- standortbeschraenkte:r Mitarbeitende:r die Klient:in sehen darf. Die Policies
-- und chat_anfrage_annehmen() liessen eine Anfrage fuer jede Person durch, die
-- Ziel oder Teammitglied ist -- bei direktem Aufruf mit der App-Rolle also auch
-- fuer jemanden, der die Klient:in nicht sehen darf (z. B. nach deren Umzug in
-- ein anderes Haus). Regel 5 des Leitfadens: das gehoert in die Datenbank.
--
-- chat_anfrage_klient_sichtbar() bildet common/standort-restriction.ts nach
-- (klientIstErlaubt) und bleibt bewusst gleich streng/gleich locker:
--   * keine Zeile in benutzer_standort  -> keine Einschraenkung, sichtbar
--   * sonst sichtbar, wenn EINES zutrifft:
--       1. aktuell belegt (auszug IS NULL AND einzug <= CURRENT_DATE) an einem erlaubten Standort
--       2. Bezugsbetreuer:in laut klient_stammdaten (auch ohne Belegung)
--       3. die LETZTE Belegung (hoechster einzug, auch beendet) lag an einem erlaubten Standort
--   * Klient:innen ohne jede Belegung und ohne Bezugsbetreuung sind fuer
--     Beschraenkte unsichtbar (fail closed), wie im Service.
-- Abweichungen zum Service, jeweils zusaetzlich und nur strenger/fail closed:
--   * Mandant, Prinzipal und aktives Konto werden hier selbst geprueft
--     (der Service verlaesst sich auf RLS bzw. den Guard).
--   * Eine Klient-Sitzung (kein app.benutzer_id) bekommt hier immer false; ihr
--     Zugriff auf die eigenen Anfragen laeuft ueber den eigenen Policy-Zweig.
-- Nicht uebernommen wird die Zwischenspeicherung des Services (nur Performance).
CREATE FUNCTION chat_anfrage_klient_sichtbar(p_klient_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM benutzer b
    JOIN klient k ON k.id = p_klient_id AND k.mandant_id = b.mandant_id
    WHERE b.id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      AND b.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND b.aktiv
      AND (
        NOT EXISTS (SELECT 1 FROM benutzer_standort bs WHERE bs.benutzer_id = b.id)
        OR EXISTS (
          SELECT 1
          FROM belegung bg
          JOIN zimmer z ON z.id = bg.zimmer_id
          JOIN benutzer_standort bs ON bs.standort_id = z.standort_id AND bs.benutzer_id = b.id
          WHERE bg.klient_id = p_klient_id AND bg.auszug IS NULL AND bg.einzug <= CURRENT_DATE
        )
        OR EXISTS (
          SELECT 1 FROM klient_stammdaten ks WHERE ks.klient_id = p_klient_id AND ks.bezugsbetreuer_id = b.id
        )
        OR EXISTS (
          SELECT 1
          FROM (
            SELECT z2.standort_id
            FROM belegung b2
            JOIN zimmer z2 ON z2.id = b2.zimmer_id
            WHERE b2.klient_id = p_klient_id
            ORDER BY b2.einzug DESC
            LIMIT 1
          ) letzte
          JOIN benutzer_standort bs ON bs.standort_id = letzte.standort_id AND bs.benutzer_id = b.id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION chat_anfrage_klient_sichtbar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_anfrage_klient_sichtbar(uuid) TO zimmerakte_app;

-- Lesen: der Zweig der Klient:in bleibt unveraendert, alle Mitarbeitenden-Zweige
-- gelten nur noch fuer Klient:innen, die sie sehen duerfen. Das schliesst
-- Beantworten und SSE mit ein, beide lesen unter derselben Policy.
ALTER POLICY chat_anfrage_lesen ON chat_anfrage
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      OR (
        (
          ziel_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
          OR beantwortet_von = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
          OR (standort_id IS NOT NULL AND chat_anfrage_team_mitglied(standort_id))
        )
        AND chat_anfrage_klient_sichtbar(klient_id)
      )
    )
  );

-- Ablehnen: ohne Sichtrecht auch kein Beantworten. (Eine UPDATE-Policy
-- ohne sichtbare Zeile aendert ohnehin nichts; hier wird es zusaetzlich
-- ausdruecklich verlangt, damit es nicht an der Reihenfolge der Policies haengt.)
ALTER POLICY chat_anfrage_beantworten ON chat_anfrage
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND beantwortet_am IS NULL
    AND (
      klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      OR (
        (
          ziel_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
          OR (standort_id IS NOT NULL AND chat_anfrage_team_mitglied(standort_id))
        )
        AND chat_anfrage_klient_sichtbar(klient_id)
      )
    )
  );

-- Annehmen: Rumpf unveraendert zu 0056, ergaenzt um die Sichtbarkeit in der
-- Auswahl der Anfrage. Wer die Klient:in nicht sehen darf, bekommt P0002
-- ("nicht gefunden") -- dasselbe wie bei einer fremden Anfrage, damit die
-- Existenz nicht verraten wird.
CREATE OR REPLACE FUNCTION chat_anfrage_annehmen(p_anfrage_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mandant uuid := NULLIF(current_setting('app.mandant_id', true), '')::uuid;
  v_ich uuid := NULLIF(current_setting('app.benutzer_id', true), '')::uuid;
  v_anfrage chat_anfrage%ROWTYPE;
  v_schluessel text;
  v_chat uuid;
  v_neu boolean := false;
BEGIN
  IF v_ich IS NULL OR v_mandant IS NULL THEN
    RAISE EXCEPTION 'Nur Mitarbeitende koennen Anfragen annehmen.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM benutzer WHERE id = v_ich AND mandant_id = v_mandant AND aktiv) THEN
    RAISE EXCEPTION 'Nur aktive Mitarbeitende koennen Anfragen annehmen.' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_anfrage
  FROM chat_anfrage a
  WHERE a.id = p_anfrage_id
    AND a.mandant_id = v_mandant
    AND (a.ziel_benutzer_id = v_ich OR (a.standort_id IS NOT NULL AND chat_anfrage_team_mitglied(a.standort_id)))
    AND chat_anfrage_klient_sichtbar(a.klient_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anfrage nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_anfrage.beantwortet_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Anfrage ist bereits beantwortet.' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM klient_zugang z
    JOIN klient k ON k.id = z.klient_id
    WHERE z.klient_id = v_anfrage.klient_id AND z.aktiv AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL
  ) THEN
    RAISE EXCEPTION 'Die Person hat keinen aktiven Zugang mehr.' USING ERRCODE = '55000';
  END IF;

  v_schluessel := 'benutzer:' || v_ich::text || '|klient:' || v_anfrage.klient_id::text;
  INSERT INTO chat (mandant_id, art, direkt_schluessel, erstellt_von_benutzer_id)
  VALUES (v_mandant, 'direkt', v_schluessel, v_ich)
  ON CONFLICT (mandant_id, direkt_schluessel) WHERE direkt_schluessel IS NOT NULL DO NOTHING
  RETURNING id INTO v_chat;
  IF v_chat IS NULL THEN
    SELECT c.id INTO v_chat FROM chat c WHERE c.mandant_id = v_mandant AND c.direkt_schluessel = v_schluessel;
  ELSE
    v_neu := true;
  END IF;

  INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id)
  SELECT v_mandant, v_chat, v_ich
  WHERE NOT EXISTS (SELECT 1 FROM chat_teilnehmer t WHERE t.chat_id = v_chat AND t.benutzer_id = v_ich AND t.verlassen_am IS NULL);
  INSERT INTO chat_teilnehmer (mandant_id, chat_id, klient_id)
  SELECT v_mandant, v_chat, v_anfrage.klient_id
  WHERE NOT EXISTS (SELECT 1 FROM chat_teilnehmer t WHERE t.chat_id = v_chat AND t.klient_id = v_anfrage.klient_id AND t.verlassen_am IS NULL);

  IF v_anfrage.nachricht IS NOT NULL THEN
    INSERT INTO chat_nachricht (mandant_id, chat_id, absender_klient_id, art, text)
    VALUES (v_mandant, v_chat, v_anfrage.klient_id, 'text', v_anfrage.nachricht);
  END IF;

  UPDATE chat_anfrage
  SET beantwortet_am = clock_timestamp(), beantwortet_von = v_ich, angenommen = true, chat_id = v_chat
  WHERE id = v_anfrage.id;
  RETURN v_chat;
END;
$$;
