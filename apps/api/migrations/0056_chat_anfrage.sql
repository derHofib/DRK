-- Chat-Anfragen durch Klient:innen (Chat-Plan, Schritt 3, Nachtrag) und
-- Historien-Grenze fuer Gruppen (Datenschutz-Entscheidung).
--
-- Teil A: Klient:innen legen keine Chats an (0055). Sie fragen ein Gespraech
-- an -- bei einer bestimmten Person oder beim "Team" ihres Standorts --, und
-- Mitarbeitende nehmen an oder lehnen ab. Erst die Annahme erzeugt (oder
-- oeffnet) den Direktchat.
--
-- Zustand wird abgeleitet, nicht gespeichert (CLAUDE.md Regel 4): offen =
-- beantwortet_am IS NULL; angenommen = angenommen IS TRUE; abgelehnt =
-- angenommen IS FALSE; zurueckgezogen = beantwortet_am gesetzt, aber
-- angenommen NULL (die Klient-Seite hat beantwortet, nicht das Team). Der
-- CHECK unten schliesst jede andere Kombination aus.
CREATE TABLE chat_anfrage (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       uuid NOT NULL REFERENCES mandant(id),
  klient_id        uuid NOT NULL REFERENCES klient(id),
  -- Genau eines von beiden: eine Person ODER das Team eines Standorts.
  ziel_benutzer_id uuid REFERENCES benutzer(id),
  standort_id      uuid REFERENCES standort(id),
  nachricht        text,
  erstellt_am      timestamptz NOT NULL DEFAULT clock_timestamp(),
  beantwortet_am   timestamptz,
  beantwortet_von  uuid REFERENCES benutzer(id),
  angenommen       boolean,
  ablehnungsgrund  text,
  chat_id          uuid REFERENCES chat(id),

  CHECK (num_nonnulls(ziel_benutzer_id, standort_id) = 1),
  CHECK (nachricht IS NULL OR (length(btrim(nachricht)) > 0 AND length(nachricht) <= 1000)),
  CHECK (ablehnungsgrund IS NULL OR (length(btrim(ablehnungsgrund)) > 0 AND length(ablehnungsgrund) <= 500)),
  CHECK (
    -- offen
    (beantwortet_am IS NULL AND angenommen IS NULL AND beantwortet_von IS NULL AND ablehnungsgrund IS NULL AND chat_id IS NULL)
    -- zurueckgezogen
    OR (beantwortet_am IS NOT NULL AND angenommen IS NULL AND beantwortet_von IS NULL AND ablehnungsgrund IS NULL AND chat_id IS NULL)
    -- angenommen
    OR (beantwortet_am IS NOT NULL AND angenommen IS TRUE AND beantwortet_von IS NOT NULL AND ablehnungsgrund IS NULL AND chat_id IS NOT NULL)
    -- abgelehnt
    OR (beantwortet_am IS NOT NULL AND angenommen IS FALSE AND beantwortet_von IS NOT NULL AND chat_id IS NULL)
  )
);

-- Hoechstens EINE offene Anfrage je Klient:in und Ziel: als Index statt als
-- Pruefung im Service, damit zwei gleichzeitige Absendungen nicht beide durchgehen.
CREATE UNIQUE INDEX chat_anfrage_offen_person_uq ON chat_anfrage (klient_id, ziel_benutzer_id)
  WHERE beantwortet_am IS NULL AND ziel_benutzer_id IS NOT NULL;
CREATE UNIQUE INDEX chat_anfrage_offen_team_uq ON chat_anfrage (klient_id, standort_id)
  WHERE beantwortet_am IS NULL AND standort_id IS NOT NULL;
CREATE INDEX chat_anfrage_klient_idx ON chat_anfrage (klient_id, erstellt_am DESC);
CREATE INDEX chat_anfrage_ziel_offen_idx ON chat_anfrage (ziel_benutzer_id) WHERE beantwortet_am IS NULL AND ziel_benutzer_id IS NOT NULL;
CREATE INDEX chat_anfrage_team_offen_idx ON chat_anfrage (standort_id) WHERE beantwortet_am IS NULL AND standort_id IS NOT NULL;

-- Hilfsfunktionen (SECURITY DEFINER aus demselben Grund wie in 0055: Policies
-- duerfen sich nicht gegenseitig in Rekursion treiben, und manche Tabellen
-- sind fuer Klient:innen sonst nicht lesbar; jede Funktion prueft Mandant und
-- Prinzipal selbst).

-- Gehoert der aktive Benutzer zum Team des Standorts? Wie in
-- common/standort-restriction.ts: eine Zuordnung zum Standort ODER gar keine
-- Standort-Einschraenkung (z. B. Leitung).
CREATE FUNCTION chat_anfrage_team_mitglied(p_standort_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM benutzer b
    WHERE b.id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      AND b.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND b.aktiv
      AND (
        EXISTS (SELECT 1 FROM benutzer_standort bs WHERE bs.benutzer_id = b.id AND bs.standort_id = p_standort_id)
        OR NOT EXISTS (SELECT 1 FROM benutzer_standort bs WHERE bs.benutzer_id = b.id)
      )
  );
$$;

-- Wen die angemeldete Klient:in anfragen darf -- einzige Quelle der Wahrheit
-- fuer GET /chat/anfragen/ziele UND die Insert-Policy. Zeilen mit
-- standort_id NULL sind Personen, mit benutzer_id NULL das Team.
--   * Bezugsbetreuer:in (klient_stammdaten.bezugsbetreuer_id), auch ohne Belegung
--   * aktive Mitarbeitende, die dem Standort der AKTUELLEN Belegung zugeordnet sind
--   * das Team dieses Standorts
-- Ohne aktuelle Belegung bleibt nur die Bezugsbetreuung. Nur fuer die eigene
-- Klient-Sitzung: Benutzer-Sitzungen erhalten nichts.
CREATE FUNCTION chat_anfrage_ziele(p_klient_id uuid)
RETURNS TABLE (benutzer_id uuid, standort_id uuid, ist_bezugsbetreuer boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH k AS (
    SELECT kl.id
    FROM klient kl
    WHERE kl.id = p_klient_id
      AND kl.id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      AND kl.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND kl.archiviert_am IS NULL AND kl.anonymisiert_am IS NULL
  ),
  st AS (
    SELECT z.standort_id
    FROM belegung bg
    JOIN zimmer z ON z.id = bg.zimmer_id
    JOIN k ON k.id = bg.klient_id
    WHERE bg.einzug <= CURRENT_DATE AND (bg.auszug IS NULL OR bg.auszug > CURRENT_DATE)
    LIMIT 1
  ),
  personen AS (
    SELECT bb.id AS benutzer_id, true AS ist_bb
    FROM klient_stammdaten ks
    JOIN k ON k.id = ks.klient_id
    JOIN benutzer bb ON bb.id = ks.bezugsbetreuer_id AND bb.aktiv AND bb.mandant_id = ks.mandant_id
    UNION ALL
    SELECT bs.benutzer_id, false
    FROM benutzer_standort bs
    JOIN st ON st.standort_id = bs.standort_id
    JOIN benutzer bt ON bt.id = bs.benutzer_id AND bt.aktiv
  )
  SELECT p.benutzer_id, NULL::uuid, bool_or(p.ist_bb) FROM personen p GROUP BY p.benutzer_id
  UNION ALL
  SELECT NULL::uuid, st.standort_id, false FROM st;
$$;

CREATE FUNCTION chat_anfrage_ziel_erlaubt(p_klient_id uuid, p_benutzer_id uuid, p_standort_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_anfrage_ziele(p_klient_id) z
    WHERE z.benutzer_id IS NOT DISTINCT FROM p_benutzer_id AND z.standort_id IS NOT DISTINCT FROM p_standort_id
  );
$$;

REVOKE ALL ON FUNCTION chat_anfrage_team_mitglied(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_anfrage_ziele(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_anfrage_ziel_erlaubt(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_anfrage_team_mitglied(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION chat_anfrage_ziele(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION chat_anfrage_ziel_erlaubt(uuid, uuid, uuid) TO zimmerakte_app;

ALTER TABLE chat_anfrage ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_anfrage FORCE ROW LEVEL SECURITY;

-- Lesen: die eigene Anfrage (Klient:in), die an mich gerichtete, die
-- beantwortete von mir und die Team-Anfragen meines Standorts. Beantwortete
-- bleiben fuers Team lesbar, damit die anderen Teammitglieder per Ereignis
-- erfahren, dass die Anfrage vergeben ist. Ob ich die Klient:in sehen darf
-- (Standort-Einschraenkung), kann keine Policy ausdruecken und prueft der Service.
CREATE POLICY chat_anfrage_lesen ON chat_anfrage FOR SELECT
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      OR ziel_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR beantwortet_von = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR (standort_id IS NOT NULL AND chat_anfrage_team_mitglied(standort_id))
    )
  );

-- Stellen: nur als man selbst, nur offen und nur an ein erlaubtes Ziel. INSERT ...
-- RETURNING wird nicht verwendet (ID vorab erzeugen), wie bei chat in 0055.
CREATE POLICY chat_anfrage_stellen ON chat_anfrage FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    AND beantwortet_am IS NULL
    AND chat_anfrage_ziel_erlaubt(klient_id, ziel_benutzer_id, standort_id)
  );

-- Beantworten (Ziel bzw. Team) oder Zurueckziehen (Klient:in), jeweils nur
-- solange offen. Was genau gesetzt werden darf, erzwingt der Trigger unten.
CREATE POLICY chat_anfrage_beantworten ON chat_anfrage FOR UPDATE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND beantwortet_am IS NULL
    AND (
      klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      OR ziel_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR (standort_id IS NOT NULL AND chat_anfrage_team_mitglied(standort_id))
    )
  )
  WITH CHECK (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Spaltenscharf (Regel 3): chat_id fehlt bewusst. Eine Annahme setzt es nur
-- chat_anfrage_annehmen() unten -- per UPDATE ginge "angenommen" gar nicht
-- (CHECK verlangt chat_id), die App-Rolle kann also nur ablehnen/zurueckziehen.
REVOKE UPDATE, DELETE ON chat_anfrage FROM zimmerakte_app;
GRANT UPDATE (beantwortet_am, beantwortet_von, angenommen, ablehnungsgrund) ON chat_anfrage TO zimmerakte_app;

-- Klient:innen duerfen nur zuruecknehmen, Mitarbeitende nur im eigenen Namen
-- beantworten. Eine Policy sieht nur die Zeile, nicht welche Spalten wie
-- geaendert werden.
CREATE FUNCTION chat_anfrage_aenderung_pruefen() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ich_klient uuid := NULLIF(current_setting('app.klient_id', true), '')::uuid;
  ich_benutzer uuid := NULLIF(current_setting('app.benutzer_id', true), '')::uuid;
BEGIN
  IF OLD.beantwortet_am IS NOT NULL THEN
    RAISE EXCEPTION 'Eine beantwortete Anfrage kann nicht mehr geaendert werden.' USING ERRCODE = '42501';
  END IF;
  IF ich_klient IS NOT NULL THEN
    IF NEW.angenommen IS NOT NULL OR NEW.beantwortet_von IS NOT NULL THEN
      RAISE EXCEPTION 'Klient:innen koennen eine Anfrage nur zurueckziehen.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.beantwortet_von IS DISTINCT FROM ich_benutzer OR NEW.angenommen IS NULL THEN
    RAISE EXCEPTION 'Eine Anfrage beantwortet man nur im eigenen Namen.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_anfrage_aenderung_pruefen
  BEFORE UPDATE ON chat_anfrage
  FOR EACH ROW EXECUTE FUNCTION chat_anfrage_aenderung_pruefen();

-- Hoechstens 5 offene Anfragen je Klient:in. Der Advisory-Lock serialisiert
-- gleichzeitige Absendungen derselben Person, sonst zaehlten beide 4 und
-- liessen 6 durch. SQLSTATE 53400 (configuration_limit_exceeded) kennt der
-- Service und uebersetzt ihn in 409.
CREATE FUNCTION chat_anfrage_limit_pruefen() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('chat_anfrage:' || NEW.klient_id::text, 0));
  IF (SELECT count(*) FROM chat_anfrage WHERE klient_id = NEW.klient_id AND beantwortet_am IS NULL) >= 5 THEN
    RAISE EXCEPTION 'Es sind bereits 5 Anfragen offen.' USING ERRCODE = '53400';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_anfrage_limit_pruefen
  BEFORE INSERT ON chat_anfrage
  FOR EACH ROW EXECUTE FUNCTION chat_anfrage_limit_pruefen();

-- Annehmen -----------------------------------------------------------------
-- Eine SECURITY DEFINER-Funktion, weil die Annahme Dinge tut, die die
-- App-Rolle bewusst nicht darf: eine Nachricht im Namen der KLIENT:IN
-- einfuegen (chat_nachricht_senden erlaubt nur den eigenen Absender) und
-- Teilnehmerzeilen fuer eine Person setzen, die nicht Admin ist
-- (chat_teilnehmer_eintragen). Statt diese Policies aufzuweichen, bekommt
-- genau dieser Weg die Rechte -- und prueft vorher selbst, dass der Aufrufer
-- Ziel bzw. Teammitglied ist und die Anfrage noch offen ist. Der Text stammt
-- aus der gespeicherten Anfrage (von der Klient:in selbst geschrieben und
-- durch CHECK begrenzt), der Aufrufer kann keinen eigenen Inhalt unterschieben.
--
-- Alles in einer Transaktion: "wer zuerst" entscheidet das FOR UPDATE auf der
-- Anfragezeile. Ein zweiter gleichzeitiger Annehmer wartet, sieht danach die
-- beantwortete Zeile und scheitert mit 55000 -- und sein Chat wird mit
-- zurueckgerollt, es entsteht nie ein zweiter.
--
-- Ein bestehender Direktchat wird weiterverwendet (seine Historie bleibt
-- sichtbar, die Historien-Grenze unten gilt nur fuer Gruppen).
CREATE FUNCTION chat_anfrage_annehmen(p_anfrage_id uuid) RETURNS uuid
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

  -- Gleicher Schluessel wie direktSchluessel() im Service ("benutzer" sortiert vor "klient").
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

  -- Bei einem bestehenden Chat nur auffuellen, was fehlt (beide sind dauerhaft dabei, ausser jemand wurde per SQL entfernt).
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

REVOKE ALL ON FUNCTION chat_anfrage_annehmen(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_anfrage_annehmen(uuid) TO zimmerakte_app;

-- Echtzeit: wie in 0055 ohne Inhalt, nur "Anfrage X hat sich geaendert". Wer
-- das Signal bekommt, entscheidet der API-Stream je Abonnent:in per SELECT
-- unter dessen Identitaet (also nach chat_anfrage_lesen).
CREATE FUNCTION chat_anfrage_melden() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'chat_ereignis',
    json_build_object('mandant_id', NEW.mandant_id, 'art', 'anfrage', 'anfrage_id', NEW.id)::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER chat_anfrage_melden
  AFTER INSERT OR UPDATE ON chat_anfrage
  FOR EACH ROW EXECUTE FUNCTION chat_anfrage_melden();

-- Teil B: Historien-Grenze ---------------------------------------------------
-- Wer in eine Gruppe aufgenommen (oder wieder aufgenommen) wird, sieht nur
-- Nachrichten ab dem beigetreten_am der AKTUELLEN Teilnahme -- nicht, was vor
-- seiner Zeit besprochen wurde. Wiedereintritt ist eine neue Zeile (0055), die
-- fruehere Unterhaltung bleibt damit auch fuer Wiederkehrende verschlossen.
-- Durchgesetzt in der Datenbank, nicht im Service: die Policy auf
-- chat_nachricht gilt fuer JEDE Abfrage (Verlauf, Chatliste-Vorschau,
-- Ungelesen-Zaehler, Anhaenge, geteilte Termine).
-- Direktchats sind ausgenommen: man kann sie nicht verlassen, und eine
-- angenommene Chat-Anfrage soll in einen bestehenden Verlauf fuehren.
CREATE FUNCTION chat_nachricht_lesbar(p_chat_id uuid, p_erstellt_am timestamptz) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_teilnehmer ct
    JOIN chat c ON c.id = ct.chat_id
    WHERE ct.chat_id = p_chat_id
      AND ct.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND ct.verlassen_am IS NULL
      AND (
        ct.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
        OR ct.klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      )
      AND (c.art = 'direkt' OR p_erstellt_am >= ct.beigetreten_am)
  );
$$;

REVOKE ALL ON FUNCTION chat_nachricht_lesbar(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_nachricht_lesbar(uuid, timestamptz) TO zimmerakte_app;

DROP POLICY chat_nachricht_lesen ON chat_nachricht;
CREATE POLICY chat_nachricht_lesen ON chat_nachricht FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_nachricht_lesbar(chat_id, erstellt_am));

-- Anhaenge hingen an chat_nachricht_sichtbar() (0055) und folgen damit der Nachricht.
CREATE OR REPLACE FUNCTION chat_nachricht_sichtbar(p_nachricht_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_nachricht m WHERE m.id = p_nachricht_id AND chat_nachricht_lesbar(m.chat_id, m.erstellt_am)
  );
$$;

-- Ein geteilter Termin ist nur ueber Nachrichten sichtbar, die ich selbst sehen darf
-- (sonst liesse sich die Grenze ueber den Termin umgehen). Rest unveraendert zu 0055.
CREATE OR REPLACE FUNCTION termin_sichtbar(p_termin_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM termin t
    WHERE t.id = p_termin_id
      AND t.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND (
        t.erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
        OR t.erstellt_von_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM termin_teilnehmer tt
          WHERE tt.termin_id = t.id
            AND (
              tt.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
              OR tt.klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
            )
        )
        OR EXISTS (
          SELECT 1
          FROM chat_nachricht m
          WHERE m.termin_id = t.id
            AND m.geloescht_am IS NULL
            AND chat_nachricht_lesbar(m.chat_id, m.erstellt_am)
        )
      )
  );
$$;
