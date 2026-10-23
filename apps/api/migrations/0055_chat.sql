-- Chat zwischen Mitarbeitenden und mit Klient:innen (Chat-Plan, Schritt 3).
-- Leitprinzip wie beim Kalender (0053): Nachrichten sieht NUR, wer aktive:r
-- Teilnehmer:in des Chats ist -- durchgesetzt per RLS, damit auch ein
-- ist_vollzugriff-Konto fremde Chats nicht lesen kann (rechte/registry.ts:
-- "Chat steuert bewusst nur den Kanalzugriff, nie Nachrichteninhalte"). Es
-- gibt keinen Admin-Lesepfad.
--
-- Wer einen Chat verlaesst oder entfernt wird, sieht ihn und seine Historie
-- nicht mehr: chat_ist_teilnehmer() zaehlt nur Zeilen mit verlassen_am IS NULL.
--
-- Wiedereintritt = NEUE chat_teilnehmer-Zeile, keine Reaktivierung. So bleibt
-- verlassen_am als Beleg erhalten, wer wann dabei war, und ein verlassener
-- Eintrag kann nie wieder "aufwachen" (Trigger unten). Der partielle
-- Unique-Index erlaubt je Person genau EINE aktive Teilnahme pro Chat; eine
-- neue Zeile startet mit zuletzt_gelesen_am = jetzt, die Historie zaehlt also
-- nicht als ungelesen.
--
-- Sichtbarkeit von Klient:innen (Standort-Einschraenkung) laesst sich in einer
-- Policy nicht ausdruecken und wird im Service geprueft. Was die Policies
-- selbst erzwingen: Klient:innen koennen weder Chats anlegen (nur Benutzer
-- koennen "erstellt_von_benutzer_id" sein) noch jemanden hinzufuegen noch
-- Admin sein (CHECK unten).
CREATE TYPE chat_art AS ENUM ('direkt', 'gruppe');
CREATE TYPE chat_nachricht_art AS ENUM ('text', 'bild', 'termin', 'standort', 'system');

CREATE TABLE chat (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id                uuid NOT NULL REFERENCES mandant(id),
  art                       chat_art NOT NULL,
  name                      text,
  -- Kanonischer Schluessel eines Direktchats ("art:id|art:id", sortiert): macht
  -- "zwischen zwei Prinzipalen gibt es genau einen Direktchat" zu einem
  -- Unique-Index statt zu einer Race-anfaelligen Pruefung im Service.
  direkt_schluessel         text,
  erstellt_von_benutzer_id  uuid NOT NULL REFERENCES benutzer(id),
  erstellt_am               timestamptz NOT NULL DEFAULT now(),

  CHECK (
    (art = 'gruppe' AND name IS NOT NULL AND length(btrim(name)) > 0 AND direkt_schluessel IS NULL)
    OR (art = 'direkt' AND name IS NULL AND direkt_schluessel IS NOT NULL)
  )
);

CREATE UNIQUE INDEX chat_direkt_schluessel_uq ON chat (mandant_id, direkt_schluessel) WHERE direkt_schluessel IS NOT NULL;

CREATE TABLE chat_teilnehmer (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       uuid NOT NULL REFERENCES mandant(id),
  chat_id          uuid NOT NULL REFERENCES chat(id),
  benutzer_id      uuid REFERENCES benutzer(id),
  klient_id        uuid REFERENCES klient(id),
  ist_admin        boolean NOT NULL DEFAULT false,
  beigetreten_am   timestamptz NOT NULL DEFAULT now(),
  verlassen_am     timestamptz,
  zuletzt_gelesen_am timestamptz NOT NULL DEFAULT clock_timestamp(),

  CHECK (num_nonnulls(benutzer_id, klient_id) = 1),
  CHECK (NOT ist_admin OR benutzer_id IS NOT NULL)
);

CREATE UNIQUE INDEX chat_teilnehmer_benutzer_aktiv_uq ON chat_teilnehmer (chat_id, benutzer_id) WHERE benutzer_id IS NOT NULL AND verlassen_am IS NULL;
CREATE UNIQUE INDEX chat_teilnehmer_klient_aktiv_uq ON chat_teilnehmer (chat_id, klient_id) WHERE klient_id IS NOT NULL AND verlassen_am IS NULL;
CREATE INDEX chat_teilnehmer_benutzer_idx ON chat_teilnehmer (benutzer_id) WHERE benutzer_id IS NOT NULL AND verlassen_am IS NULL;
CREATE INDEX chat_teilnehmer_klient_idx ON chat_teilnehmer (klient_id) WHERE klient_id IS NOT NULL AND verlassen_am IS NULL;
CREATE INDEX chat_teilnehmer_chat_idx ON chat_teilnehmer (chat_id);

CREATE TABLE chat_nachricht (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id            uuid NOT NULL REFERENCES mandant(id),
  chat_id               uuid NOT NULL REFERENCES chat(id),
  absender_benutzer_id  uuid REFERENCES benutzer(id),
  absender_klient_id    uuid REFERENCES klient(id),
  art                   chat_nachricht_art NOT NULL,
  text                  text CHECK (text IS NULL OR length(text) <= 4000),
  termin_id             uuid REFERENCES termin(id),
  standort_lat          numeric(9, 6) CHECK (standort_lat BETWEEN -90 AND 90),
  standort_lng          numeric(9, 6) CHECK (standort_lng BETWEEN -180 AND 180),
  standort_genauigkeit_m integer CHECK (standort_genauigkeit_m >= 0),
  standort_bezeichnung  text CHECK (standort_bezeichnung IS NULL OR length(standort_bezeichnung) <= 200),
  -- clock_timestamp() statt now(): now() ist der Transaktionsbeginn. Ein Bild,
  -- dessen Upload laenger dauert, bekaeme sonst einen Zeitstempel VOR einem
  -- zwischenzeitlichen "gelesen" und wuerde nie als ungelesen gezaehlt.
  erstellt_am           timestamptz NOT NULL DEFAULT clock_timestamp(),
  geloescht_am          timestamptz,

  CHECK (num_nonnulls(absender_benutzer_id, absender_klient_id) = CASE WHEN art = 'system' THEN 0 ELSE 1 END),
  CHECK (
    geloescht_am IS NOT NULL
    OR CASE art
      WHEN 'text' THEN text IS NOT NULL AND length(btrim(text)) > 0
      WHEN 'termin' THEN termin_id IS NOT NULL
      WHEN 'standort' THEN standort_lat IS NOT NULL AND standort_lng IS NOT NULL
      ELSE true
    END
  )
);

CREATE INDEX chat_nachricht_verlauf_idx ON chat_nachricht (chat_id, erstellt_am DESC, id DESC);
CREATE INDEX chat_nachricht_termin_idx ON chat_nachricht (termin_id) WHERE termin_id IS NOT NULL AND geloescht_am IS NULL;

CREATE TABLE chat_anhang (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  nachricht_id uuid NOT NULL REFERENCES chat_nachricht(id),
  dateiname    text NOT NULL,
  mime_type    text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  inhalt       bytea NOT NULL,
  inhalt_hash  text NOT NULL, -- sha256, hex-kodiert
  groesse      integer NOT NULL CHECK (groesse > 0)
);

CREATE INDEX chat_anhang_nachricht_idx ON chat_anhang (nachricht_id);

-- Hilfsfunktionen. SECURITY DEFINER, damit die Policies von chat,
-- chat_teilnehmer und chat_nachricht nicht gegenseitig in
-- "infinite recursion detected in policy" laufen (Begruendung wie
-- termin_sichtbar in 0053); jede Funktion prueft Mandant und Prinzipal selbst.
CREATE FUNCTION chat_ist_teilnehmer(p_chat_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_teilnehmer ct
    WHERE ct.chat_id = p_chat_id
      AND ct.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND ct.verlassen_am IS NULL
      AND (
        ct.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
        OR ct.klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      )
  );
$$;

-- Admin gibt es nur in Gruppen und nur unter Benutzern (siehe CHECK oben).
CREATE FUNCTION chat_ist_admin(p_chat_id uuid) RETURNS boolean
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
      AND ct.ist_admin
      AND c.art = 'gruppe'
      AND ct.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
  );
$$;

-- Erst-Befuellung: die Person, die den Chat angelegt hat, darf die ersten
-- Teilnehmerzeilen setzen, solange es noch keine gibt. Funktioniert nur, wenn
-- ALLE Zeilen in EINEM INSERT-Statement stehen (die STABLE-Funktion sieht die
-- Zeilen des eigenen Statements nicht) -- danach regeln Admins (Gruppe) bzw.
-- niemand (Direktchat) die Mitgliedschaft.
CREATE FUNCTION chat_ersteller_befuellt(p_chat_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat c
    WHERE c.id = p_chat_id
      AND c.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND c.erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      AND NOT EXISTS (SELECT 1 FROM chat_teilnehmer ct WHERE ct.chat_id = c.id)
  );
$$;

CREATE FUNCTION chat_nachricht_sichtbar(p_nachricht_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_nachricht m WHERE m.id = p_nachricht_id AND chat_ist_teilnehmer(m.chat_id)
  );
$$;

CREATE FUNCTION chat_nachricht_ist_von_mir(p_nachricht_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_nachricht m
    WHERE m.id = p_nachricht_id
      AND m.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND (
        m.absender_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
        OR m.absender_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      )
      AND chat_ist_teilnehmer(m.chat_id)
  );
$$;

REVOKE ALL ON FUNCTION chat_ist_teilnehmer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_ist_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_ersteller_befuellt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_nachricht_sichtbar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_nachricht_ist_von_mir(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_ist_teilnehmer(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION chat_ist_admin(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION chat_ersteller_befuellt(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION chat_nachricht_sichtbar(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION chat_nachricht_ist_von_mir(uuid) TO zimmerakte_app;

-- chat ------------------------------------------------------------------
ALTER TABLE chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat FORCE ROW LEVEL SECURITY;

-- Anders als termin_lesen (0053) steht hier KEINE direkte Ersteller-Bedingung
-- in der SELECT-Policy: wer den Chat verlassen hat, soll ihn auch als
-- Ersteller:in nicht mehr sehen. Deshalb gilt fuer chat und seine Kinder:
-- IDs werden vorab erzeugt und INSERT ... RETURNING wird nicht verwendet
-- (RETURNING prueft die SELECT-Policy gegen die neue Zeile, die noch keine
-- Teilnehmerzeile hat).
CREATE POLICY chat_lesen ON chat FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_ist_teilnehmer(id));

CREATE POLICY chat_anlegen ON chat FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
  );

CREATE POLICY chat_umbenennen ON chat FOR UPDATE
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_ist_admin(id))
  WITH CHECK (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Spaltenscharf (Regel 3): nur der Name ist aenderbar; art, Mandant und
-- Ersteller:in duerfen nie wandern. Kein DELETE -- Chats bleiben als Beleg.
REVOKE UPDATE, DELETE ON chat FROM zimmerakte_app;
GRANT UPDATE (name) ON chat TO zimmerakte_app;

-- chat_teilnehmer ---------------------------------------------------------
ALTER TABLE chat_teilnehmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_teilnehmer FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_teilnehmer_lesen ON chat_teilnehmer FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_ist_teilnehmer(chat_id));

CREATE POLICY chat_teilnehmer_eintragen ON chat_teilnehmer FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (chat_ist_admin(chat_id) OR chat_ersteller_befuellt(chat_id))
  );

-- USING verlangt eine aktive Zeile, WITH CHECK bewusst NICHT: sonst waere das
-- Verlassen selbst (verlassen_am setzen) eine Policy-Verletzung, weil die
-- neue Zeile nicht mehr "aktiv" ist (ohne WITH CHECK gilt USING fuer die neue
-- Zeile mit).
CREATE POLICY chat_teilnehmer_aendern ON chat_teilnehmer FOR UPDATE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND verlassen_am IS NULL
    AND chat_ist_teilnehmer(chat_id)
    AND (
      benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      OR chat_ist_admin(chat_id)
    )
  )
  WITH CHECK (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Spaltengrenzen kann ein GRANT, aber nicht "ist_admin nur durch Admins"
-- oder "fremde Zeile nur entfernen": das erzwingt dieser Trigger. Ohne ihn
-- koennte jede:r Teilnehmer:in sich selbst zum Admin machen, weil die
-- Policy die eigene Zeile freigibt.
CREATE FUNCTION chat_teilnehmer_aenderung_pruefen() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ist_meine_zeile boolean :=
    (OLD.benutzer_id IS NOT NULL AND OLD.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid)
    OR (OLD.klient_id IS NOT NULL AND OLD.klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid);
BEGIN
  IF OLD.verlassen_am IS NOT NULL THEN
    RAISE EXCEPTION 'Eine beendete Teilnahme kann nicht mehr geaendert werden.' USING ERRCODE = '42501';
  END IF;
  IF NEW.ist_admin IS DISTINCT FROM OLD.ist_admin AND NOT chat_ist_admin(OLD.chat_id) THEN
    RAISE EXCEPTION 'Nur Admins duerfen Adminrechte aendern.' USING ERRCODE = '42501';
  END IF;
  IF NOT ist_meine_zeile AND NEW.zuletzt_gelesen_am IS DISTINCT FROM OLD.zuletzt_gelesen_am THEN
    RAISE EXCEPTION 'Der Lesestand gehoert der jeweiligen Person.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_teilnehmer_aenderung_pruefen
  BEFORE UPDATE ON chat_teilnehmer
  FOR EACH ROW EXECUTE FUNCTION chat_teilnehmer_aenderung_pruefen();

REVOKE UPDATE, DELETE ON chat_teilnehmer FROM zimmerakte_app;
GRANT UPDATE (ist_admin, verlassen_am, zuletzt_gelesen_am) ON chat_teilnehmer TO zimmerakte_app;

-- chat_nachricht ----------------------------------------------------------
ALTER TABLE chat_nachricht ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_nachricht FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_nachricht_lesen ON chat_nachricht FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_ist_teilnehmer(chat_id));

-- Senden nur als man selbst, nur in einen Chat, in dem man aktiv ist, und
-- einen Termin nur teilen, den man selbst sehen darf. art 'system' ist fuer
-- die App-Rolle nicht erzeugbar (kein Absender passt).
CREATE POLICY chat_nachricht_senden ON chat_nachricht FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND chat_ist_teilnehmer(chat_id)
    AND (
      absender_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR absender_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
    AND (termin_id IS NULL OR termin_sichtbar(termin_id))
  );

CREATE POLICY chat_nachricht_loeschen ON chat_nachricht FOR UPDATE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND chat_ist_teilnehmer(chat_id)
    AND (
      absender_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR absender_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
  )
  WITH CHECK (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Append-only (wie das Kassenbuch, 0011): geaendert werden darf nur, was
-- zum Loeschen gehoert. termin_id steht dabei, weil das Loeschen einer
-- Termin-Nachricht die Freigabe des Termins widerruft (termin_sichtbar unten
-- zaehlt nur nicht geloeschte Nachrichten). Kein DELETE.
REVOKE UPDATE, DELETE ON chat_nachricht FROM zimmerakte_app;
GRANT UPDATE (text, termin_id, standort_lat, standort_lng, standort_genauigkeit_m, standort_bezeichnung, geloescht_am)
  ON chat_nachricht TO zimmerakte_app;

-- Die Grants erlauben dem Absender, text & Co. zu setzen -- dieser Trigger
-- macht daraus ausschliesslich "loeschen" (Inhalt leeren, geloescht_am
-- setzen); nachtraegliches Bearbeiten einer Nachricht gibt es nicht.
CREATE FUNCTION chat_nachricht_nur_loeschen() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.geloescht_am IS NOT NULL
     OR NEW.geloescht_am IS NULL
     OR NEW.text IS NOT NULL
     OR NEW.termin_id IS NOT NULL
     OR NEW.standort_lat IS NOT NULL
     OR NEW.standort_lng IS NOT NULL
     OR NEW.standort_genauigkeit_m IS NOT NULL
     OR NEW.standort_bezeichnung IS NOT NULL THEN
    RAISE EXCEPTION 'Nachrichten koennen nur geloescht, nicht bearbeitet werden.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_nachricht_nur_loeschen
  BEFORE UPDATE ON chat_nachricht
  FOR EACH ROW EXECUTE FUNCTION chat_nachricht_nur_loeschen();

-- chat_anhang -------------------------------------------------------------
ALTER TABLE chat_anhang ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_anhang FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_anhang_lesen ON chat_anhang FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_nachricht_sichtbar(nachricht_id));

CREATE POLICY chat_anhang_anlegen ON chat_anhang FOR INSERT
  WITH CHECK (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_nachricht_ist_von_mir(nachricht_id));

-- DELETE ist hier erlaubt (anders als bei der Nachricht): beim Loeschen einer
-- Nachricht soll das Bild wirklich verschwinden, nicht nur unsichtbar werden.
CREATE POLICY chat_anhang_entfernen ON chat_anhang FOR DELETE
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_nachricht_ist_von_mir(nachricht_id));

REVOKE UPDATE ON chat_anhang FROM zimmerakte_app;

-- Im Chat geteilte Termine -------------------------------------------------
-- Ersetzt termin_sichtbar() aus 0053 um "in einem Chat geteilt, in dem ich
-- aktive:r Teilnehmer:in bin". Die Policies termin_lesen und
-- termin_teilnehmer_eintragen/-lesen rufen die Funktion auf und bleiben
-- unveraendert: ein geteilter Termin ist damit lesbar UND per
-- "uebernehmen" eintragbar, ohne dass man sonst etwas ueber den Ersteller
-- erfaehrt. Eine geloeschte Nachricht teilt nichts mehr.
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
          JOIN chat_teilnehmer ct ON ct.chat_id = m.chat_id
          WHERE m.termin_id = t.id
            AND m.geloescht_am IS NULL
            AND ct.verlassen_am IS NULL
            AND (
              ct.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
              OR ct.klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
            )
        )
      )
  );
$$;

-- Echtzeit-Signale ----------------------------------------------------------
-- NOTIFY traegt bewusst KEINEN Inhalt, nur wo etwas passiert ist: der
-- API-Stream (chat-ereignis.service.ts) prueft je Abonnent die Mitgliedschaft
-- und der Client laedt Inhalte danach per REST -- so laufen alle
-- Inhaltszugriffe unter RLS. Zugestellt wird erst beim COMMIT.
CREATE FUNCTION chat_ereignis_melden() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ereignis_art text := TG_ARGV[0];
  chat_ref uuid := CASE WHEN TG_TABLE_NAME = 'chat' THEN NEW.id ELSE NEW.chat_id END;
BEGIN
  PERFORM pg_notify(
    'chat_ereignis',
    json_build_object('mandant_id', NEW.mandant_id, 'chat_id', chat_ref, 'art', ereignis_art)::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER chat_nachricht_melden
  AFTER INSERT OR UPDATE ON chat_nachricht
  FOR EACH ROW EXECUTE FUNCTION chat_ereignis_melden('nachricht');

-- Nicht bei jedem Lesestand (zuletzt_gelesen_am): jedes "gelesen" wuerde sonst
-- allen Chat-Mitgliedern ein Ereignis schicken, das fuer sie nichts aendert.
CREATE TRIGGER chat_teilnehmer_melden
  AFTER INSERT OR UPDATE OF ist_admin, verlassen_am ON chat_teilnehmer
  FOR EACH ROW EXECUTE FUNCTION chat_ereignis_melden('teilnehmer');

CREATE TRIGGER chat_melden
  AFTER UPDATE OF name ON chat
  FOR EACH ROW EXECUTE FUNCTION chat_ereignis_melden('chat');
