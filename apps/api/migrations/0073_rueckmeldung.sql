-- Rueckmeldungen (Ideen und Fehler), die Mitarbeitende direkt aus der App melden,
-- mit Screenshot und Rahmenbedingungen (Seite, Version, Browser, Rolle).
--
-- Warum das hier mehr Schutz braucht als ein gewoehnliches Ticketsystem:
-- ein Screenshot der Akte, des Kassenbuchs oder des Chats zeigt Sozialdaten
-- (Art. 9 DSGVO, SGB X). Deshalb
--   1. wird das Bild im Browser VOR der Aufnahme maskiert (siehe
--      apps/web/src/rueckmeldung/maskierung.ts), nie danach;
--   2. liegt es in einer eigenen Tabelle, damit Listen nie Bilder laden und
--      die Geschaeftsfuehrung ein Bild einzeln verwerfen kann;
--   3. verlaesst nichts den Traeger, solange dessen Geschaeftsfuehrung es nicht
--      freigegeben UND der Traeger die Weitergabe an den Hersteller
--      eingeschaltet hat (mandant.rueckmeldung_weitergabe, Standard AUS);
--   4. loeschen sich Bilder 30 Tage und Eintraege 365 Tage nach Abschluss.
--
-- Der Hersteller-Zugang (Claude) laeuft NICHT ueber die RLS-Policy und nicht
-- ueber eine Rolle mit BYPASSRLS, sondern ueber vier enge SECURITY DEFINER-
-- Funktionen am Ende dieser Datei (Vorbild: chat_loeschfrist_anwenden(), 0061).
-- Sie liefern ausschliesslich freigegebene Eintraege eines Traegers mit
-- eingeschalteter Weitergabe, und jeder Zugriff wird unveraenderlich
-- protokolliert (rueckmeldung_service_zugriff).

ALTER TABLE mandant
  ADD COLUMN rueckmeldung_weitergabe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mandant.rueckmeldung_weitergabe IS
  'false = freigegebene Rueckmeldungen bleiben beim Traeger. true = der Hersteller darf sie ueber die Service-API lesen und bearbeiten. Standard AUS: eine geratene Voreinstellung wuerde Daten ohne Wissen des Traegers weitergeben.';

GRANT UPDATE (rueckmeldung_weitergabe) ON mandant TO zimmerakte_app;

-- Fuer den zusammengesetzten Fremdschluessel unten: eine Rueckmeldung darf nur
-- auf Benutzer DESSELBEN Mandanten zeigen. Ein einfacher FK auf benutzer(id)
-- liesse eine Zeile zu, deren mandant_id und erstellt_von zu verschiedenen
-- Traegern gehoeren -- RLS schuetzt dagegen nicht, weil die Policy nur die
-- eigene Spalte prueft.
ALTER TABLE benutzer ADD CONSTRAINT benutzer_id_mandant_uq UNIQUE (id, mandant_id);

CREATE TABLE rueckmeldung (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  erstellt_von      uuid NOT NULL,
  art               text NOT NULL CHECK (art IN ('idee', 'fehler')),
  titel             text NOT NULL CHECK (length(titel) BETWEEN 1 AND 200),
  beschreibung      text NOT NULL CHECK (length(beschreibung) BETWEEN 1 AND 5000),
  -- Ideen: "Warum/Nutzen", Fehler: "Was haette passieren sollen".
  erwartet          text CHECK (erwartet IS NULL OR length(erwartet) <= 3000),
  prioritaet        text NOT NULL DEFAULT 'mittel' CHECK (prioritaet IN ('niedrig', 'mittel', 'hoch', 'blockierend')),
  status            text NOT NULL DEFAULT 'neu'
                    CHECK (status IN ('neu', 'freigegeben', 'rueckfrage', 'abgelehnt', 'duplikat', 'in_arbeit', 'umgesetzt')),
  -- Rahmenbedingungen: Seite (UUIDs ersetzt), Version, Browser, Rolle, ... Das
  -- Frontend schickt nur Whitelist-Felder; Konsole/Netzwerk gibt es absichtlich
  -- nicht (Bodies enthalten Klientendaten).
  kontext           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(kontext) <= 8192),
  erstellt_am       timestamptz NOT NULL DEFAULT now(),
  freigegeben_am    timestamptz,
  freigegeben_von   uuid,
  -- Notiz der Geschaeftsfuehrung (Begruendung, Rueckfrage an die meldende Person).
  entscheidungsnotiz text CHECK (entscheidungsnotiz IS NULL OR length(entscheidungsnotiz) <= 2000),
  -- Notiz des Herstellers (Rueckfrage, Stand der Umsetzung) und PR-Link.
  bearbeitungsnotiz text CHECK (bearbeitungsnotiz IS NULL OR length(bearbeitungsnotiz) <= 2000),
  pr_url            text CHECK (pr_url IS NULL OR (pr_url ~ '^https://[^ ]+$' AND length(pr_url) <= 500)),
  -- Wird nur vom Trigger unten gesetzt (kein UPDATE-Recht fuer die App-Rolle).
  abgeschlossen_am  timestamptz,

  UNIQUE (id, mandant_id),
  FOREIGN KEY (erstellt_von, mandant_id) REFERENCES benutzer (id, mandant_id),
  FOREIGN KEY (freigegeben_von, mandant_id) REFERENCES benutzer (id, mandant_id),
  CHECK (prioritaet <> 'blockierend' OR art = 'fehler'),
  -- Kern der Freigabe, in der Datenbank statt im Code (CLAUDE.md, Regel 5):
  -- "freigegeben/in Arbeit/umgesetzt" und "Freigabe vermerkt" sind dasselbe.
  -- Kein Pfad kann eine Rueckmeldung in Arbeit setzen, die niemand freigegeben hat.
  CHECK (
    (status IN ('freigegeben', 'in_arbeit', 'umgesetzt'))
    = (freigegeben_am IS NOT NULL AND freigegeben_von IS NOT NULL)
  )
);

CREATE INDEX rueckmeldung_status_idx ON rueckmeldung (mandant_id, status, erstellt_am DESC);
CREATE INDEX rueckmeldung_ersteller_idx ON rueckmeldung (erstellt_von, erstellt_am DESC);

COMMENT ON TABLE rueckmeldung IS
  'Idee/Fehler aus der App. Status wird gespeichert, weil er eine Entscheidung ist (Freigabe), nicht ableitbar. Sozialdaten koennen im Freitext und im Bild stehen -> Frist und Freigabe siehe Kopf dieser Migration.';

-- Spaltenscharf (CLAUDE.md, Regel 3): Inhalt und Herkunft bleiben nach dem
-- Absenden unveraenderlich, geaendert werden nur Entscheidung und Notiz.
REVOKE UPDATE, DELETE ON rueckmeldung FROM zimmerakte_app;
GRANT UPDATE (status, freigegeben_am, freigegeben_von, entscheidungsnotiz) ON rueckmeldung TO zimmerakte_app;

ALTER TABLE rueckmeldung ENABLE ROW LEVEL SECURITY;
ALTER TABLE rueckmeldung FORCE ROW LEVEL SECURITY;
CREATE POLICY rueckmeldung_isolation ON rueckmeldung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Zustandsautomat. Die App-Rolle (Geschaeftsfuehrung ueber die API) darf nie
-- auf in_arbeit/umgesetzt setzen: das ist dem Hersteller-Zugang vorbehalten,
-- dessen Funktionen als Eigentuemer laufen (current_user ist dort nicht die
-- App-Rolle). Zusatzlich: umgesetzt ist endgueltig.
CREATE FUNCTION rueckmeldung_status_wechsel() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'umgesetzt' THEN
      RAISE EXCEPTION 'Eine umgesetzte Rueckmeldung ist abgeschlossen.' USING ERRCODE = 'P0001';
    END IF;
    IF current_user = 'zimmerakte_app' AND NEW.status IN ('in_arbeit', 'umgesetzt') THEN
      RAISE EXCEPTION 'in_arbeit/umgesetzt setzt nur der Hersteller-Zugang.' USING ERRCODE = 'P0001';
    END IF;
    NEW.abgeschlossen_am := CASE WHEN NEW.status IN ('umgesetzt', 'abgelehnt', 'duplikat') THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rueckmeldung_status_wechsel
  BEFORE UPDATE ON rueckmeldung
  FOR EACH ROW EXECUTE FUNCTION rueckmeldung_status_wechsel();

CREATE TABLE rueckmeldung_bild (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  rueckmeldung_id   uuid NOT NULL,
  daten             bytea NOT NULL CHECK (octet_length(daten) BETWEEN 1 AND 2000000),
  breite            integer NOT NULL CHECK (breite BETWEEN 1 AND 4000),
  hoehe             integer NOT NULL CHECK (hoehe BETWEEN 1 AND 4000),
  erstellt_am       timestamptz NOT NULL DEFAULT now(),

  -- Ein Bild je Rueckmeldung; Kaskade, damit die Loeschfrist keine
  -- verwaisten Bilder (= Sozialdaten ohne Besitzer) hinterlaesst.
  UNIQUE (rueckmeldung_id),
  FOREIGN KEY (rueckmeldung_id, mandant_id) REFERENCES rueckmeldung (id, mandant_id) ON DELETE CASCADE
);

REVOKE UPDATE ON rueckmeldung_bild FROM zimmerakte_app;

ALTER TABLE rueckmeldung_bild ENABLE ROW LEVEL SECURITY;
ALTER TABLE rueckmeldung_bild FORCE ROW LEVEL SECURITY;
CREATE POLICY rueckmeldung_bild_isolation ON rueckmeldung_bild
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Protokoll der Hersteller-Zugriffe. Unveraenderlich wie audit_log (0044);
-- die App-Rolle darf nicht einmal schreiben -- nur die Funktionen unten. Kein
-- FK auf rueckmeldung: das Protokoll soll die Loeschfrist der Eintraege
-- ueberleben, sonst waere der Zugriff nicht mehr nachweisbar.
CREATE TABLE rueckmeldung_service_zugriff (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  rueckmeldung_id   uuid NOT NULL,
  aktion            text NOT NULL CHECK (aktion IN ('liste', 'detail', 'bild', 'status')),
  zeitpunkt         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rueckmeldung_service_zugriff_idx ON rueckmeldung_service_zugriff (mandant_id, zeitpunkt DESC);

REVOKE INSERT, UPDATE, DELETE ON rueckmeldung_service_zugriff FROM zimmerakte_app;

ALTER TABLE rueckmeldung_service_zugriff ENABLE ROW LEVEL SECURITY;
ALTER TABLE rueckmeldung_service_zugriff FORCE ROW LEVEL SECURITY;
CREATE POLICY rueckmeldung_service_zugriff_isolation ON rueckmeldung_service_zugriff
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Hersteller-Zugang. Gemeinsame Bedingung aller Funktionen: Status
-- freigegeben/in_arbeit/umgesetzt (also nachweislich freigegeben, siehe CHECK
-- oben) UND Weitergabe des Traegers eingeschaltet.
-- ---------------------------------------------------------------------------

CREATE FUNCTION rueckmeldung_service_liste(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, traeger text, art text, titel text, prioritaet text, status text,
  erstellt_am timestamptz, freigegeben_am timestamptz, hat_bild boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('freigegeben', 'in_arbeit', 'umgesetzt') THEN
    RAISE EXCEPTION 'Status % ist fuer den Hersteller-Zugang nicht lesbar.', p_status USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH treffer AS (
    SELECT r.id, m.name AS traeger, r.art, r.titel, r.prioritaet, r.status, r.erstellt_am, r.freigegeben_am,
           EXISTS (SELECT 1 FROM rueckmeldung_bild b WHERE b.rueckmeldung_id = r.id) AS hat_bild,
           r.mandant_id
    FROM rueckmeldung r
    JOIN mandant m ON m.id = r.mandant_id
    WHERE m.rueckmeldung_weitergabe
      AND r.status IN ('freigegeben', 'in_arbeit', 'umgesetzt')
      AND (p_status IS NULL OR r.status = p_status)
  ), protokoll AS (
    INSERT INTO rueckmeldung_service_zugriff (mandant_id, rueckmeldung_id, aktion)
    SELECT t.mandant_id, t.id, 'liste' FROM treffer t
  )
  SELECT t.id, t.traeger, t.art, t.titel, t.prioritaet, t.status, t.erstellt_am, t.freigegeben_am, t.hat_bild
  FROM treffer t
  ORDER BY t.freigegeben_am DESC;
END;
$$;

CREATE FUNCTION rueckmeldung_service_detail(p_id uuid)
RETURNS TABLE (
  id uuid, traeger text, art text, titel text, beschreibung text, erwartet text, prioritaet text,
  status text, kontext jsonb, erstellt_am timestamptz, freigegeben_am timestamptz,
  entscheidungsnotiz text, bearbeitungsnotiz text, pr_url text, hat_bild boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO rueckmeldung_service_zugriff (mandant_id, rueckmeldung_id, aktion)
  SELECT r.mandant_id, r.id, 'detail'
  FROM rueckmeldung r JOIN mandant m ON m.id = r.mandant_id
  WHERE r.id = p_id AND m.rueckmeldung_weitergabe AND r.status IN ('freigegeben', 'in_arbeit', 'umgesetzt');

  RETURN QUERY
  SELECT r.id, m.name, r.art, r.titel, r.beschreibung, r.erwartet, r.prioritaet, r.status, r.kontext,
         r.erstellt_am, r.freigegeben_am, r.entscheidungsnotiz, r.bearbeitungsnotiz, r.pr_url,
         EXISTS (SELECT 1 FROM rueckmeldung_bild b WHERE b.rueckmeldung_id = r.id)
  FROM rueckmeldung r JOIN mandant m ON m.id = r.mandant_id
  WHERE r.id = p_id AND m.rueckmeldung_weitergabe AND r.status IN ('freigegeben', 'in_arbeit', 'umgesetzt');
END;
$$;

CREATE FUNCTION rueckmeldung_service_bild(p_id uuid)
RETURNS bytea
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_daten bytea;
  v_mandant uuid;
BEGIN
  SELECT b.daten, r.mandant_id INTO v_daten, v_mandant
  FROM rueckmeldung r
  JOIN mandant m ON m.id = r.mandant_id
  JOIN rueckmeldung_bild b ON b.rueckmeldung_id = r.id
  WHERE r.id = p_id AND m.rueckmeldung_weitergabe AND r.status IN ('freigegeben', 'in_arbeit', 'umgesetzt');

  IF v_daten IS NOT NULL THEN
    INSERT INTO rueckmeldung_service_zugriff (mandant_id, rueckmeldung_id, aktion) VALUES (v_mandant, p_id, 'bild');
  END IF;
  RETURN v_daten;
END;
$$;

-- Erlaubte Wechsel des Herstellers (alles andere: P0001 -> 409):
--   freigegeben -> in_arbeit, rueckfrage
--   in_arbeit   -> umgesetzt, freigegeben (aufgeben), rueckfrage
-- "rueckfrage" nimmt die Freigabe zurueck: die Geschaeftsfuehrung muss nach
-- ihrer Antwort erneut freigeben, der Hersteller kann sich nie selbst
-- weiterhelfen. Freigeben, ablehnen oder umdeuten kann er nie.
CREATE FUNCTION rueckmeldung_service_status(p_id uuid, p_status text, p_notiz text DEFAULT NULL, p_pr_url text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF p_status NOT IN ('in_arbeit', 'umgesetzt', 'freigegeben', 'rueckfrage') THEN
    RAISE EXCEPTION 'Status % darf der Hersteller nicht setzen.', p_status USING ERRCODE = 'P0001';
  END IF;

  SELECT x.id, x.mandant_id, x.status INTO r
  FROM rueckmeldung x JOIN mandant m ON m.id = x.mandant_id
  WHERE x.id = p_id AND m.rueckmeldung_weitergabe AND x.status IN ('freigegeben', 'in_arbeit')
  FOR UPDATE OF x;
  IF NOT FOUND THEN
    -- Auch "nicht freigegeben" und "Weitergabe aus" sehen von aussen wie "gibt es nicht" aus.
    RAISE EXCEPTION 'Rueckmeldung nicht gefunden oder nicht freigegeben.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT ((r.status = 'freigegeben' AND p_status IN ('in_arbeit', 'rueckfrage'))
       OR (r.status = 'in_arbeit' AND p_status IN ('umgesetzt', 'freigegeben', 'rueckfrage'))) THEN
    RAISE EXCEPTION 'Wechsel % -> % ist nicht erlaubt.', r.status, p_status USING ERRCODE = 'P0001';
  END IF;
  IF p_status = 'rueckfrage' AND coalesce(trim(p_notiz), '') = '' THEN
    RAISE EXCEPTION 'Eine Rueckfrage braucht einen Text.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status = 'umgesetzt' AND p_pr_url IS NULL THEN
    RAISE EXCEPTION 'Umgesetzt braucht den PR-Link.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE rueckmeldung SET
    status = p_status,
    bearbeitungsnotiz = coalesce(p_notiz, bearbeitungsnotiz),
    pr_url = coalesce(p_pr_url, pr_url),
    freigegeben_am = CASE WHEN p_status = 'rueckfrage' THEN NULL ELSE freigegeben_am END,
    freigegeben_von = CASE WHEN p_status = 'rueckfrage' THEN NULL ELSE freigegeben_von END
  WHERE id = r.id;

  INSERT INTO rueckmeldung_service_zugriff (mandant_id, rueckmeldung_id, aktion) VALUES (r.mandant_id, r.id, 'status');
  RETURN p_status;
END;
$$;

-- Loeschfrist: Bilder 30 Tage, Eintraege 365 Tage nach Abschluss. Feste Werte
-- statt Mandanten-Einstellung: weniger Schalter, die falsch stehen koennen; ein
-- offener Eintrag wird nie angefasst. Parameterlos, wie die anderen
-- Fristfunktionen (0061, 0070).
CREATE FUNCTION rueckmeldung_loeschfrist_anwenden()
RETURNS TABLE (bilder bigint, eintraege bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('rueckmeldung_loeschfrist_anwenden', 0)) THEN
    RETURN;
  END IF;

  DELETE FROM rueckmeldung_bild b
  USING rueckmeldung r
  WHERE r.id = b.rueckmeldung_id
    AND r.abgeschlossen_am IS NOT NULL
    AND r.abgeschlossen_am < now() - interval '30 days';
  GET DIAGNOSTICS bilder = ROW_COUNT;

  DELETE FROM rueckmeldung r
  WHERE r.abgeschlossen_am IS NOT NULL
    AND r.abgeschlossen_am < now() - interval '365 days';
  GET DIAGNOSTICS eintraege = ROW_COUNT;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION rueckmeldung_service_liste(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rueckmeldung_service_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rueckmeldung_service_bild(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rueckmeldung_service_status(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rueckmeldung_loeschfrist_anwenden() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rueckmeldung_service_liste(text) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION rueckmeldung_service_detail(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION rueckmeldung_service_bild(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION rueckmeldung_service_status(uuid, text, text, text) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION rueckmeldung_loeschfrist_anwenden() TO zimmerakte_app;
