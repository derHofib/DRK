-- E-Mail-Adresse eines Klient-Zugangs aendern (0052 bleibt unveraendert).
-- Kein Server-Mailversand: wie beim Einladungslink (0052) und beim
-- Passwort-Reset (0025) bekommt die Leitung einen einmaligen Link, den sie
-- selbst weitergibt; gespeichert wird nur der SHA-256-Hash.
--
-- Ein bestehender Zugang aendert seine E-Mail NUR zusammen mit dem Passwort
-- (Link allein genuegt nicht): faellt der Link in falsche Haende, kann
-- niemand die Login-Adresse umbiegen und damit den Zugang uebernehmen. Das
-- Passwort wird in der Anwendung per bcrypt geprueft (bcrypt laeuft in
-- Node, nicht in der DB) -- deshalb liefert pruefen() den Hash an die
-- Anwendung, und einloesen() verlangt genau diesen Hash zurueck, damit ein
-- zwischenzeitlich geaendertes Passwort die Pruefung nicht unterlaeuft.
--
-- email_aenderung_von: wer den Link ausgestellt hat. Das Einloesen laeuft
-- ohne angemeldete Mitarbeitende, audit_log.benutzer_id ist aber NOT NULL
-- (0044) -- der Eintrag wird deshalb dem Aussteller des Links zugeordnet und
-- als "durch Klient:in" markiert.
ALTER TABLE klient_zugang
  ADD COLUMN email_aenderung_token_hash text UNIQUE,
  ADD COLUMN email_aenderung_ablauf     timestamptz,
  ADD COLUMN email_aenderung_von        uuid REFERENCES benutzer(id),
  ADD CONSTRAINT klient_zugang_email_aenderung_check CHECK (
    (email_aenderung_token_hash IS NULL) = (email_aenderung_ablauf IS NULL)
    AND (email_aenderung_token_hash IS NULL) = (email_aenderung_von IS NULL)
  );

COMMENT ON COLUMN klient_zugang.email_aenderung_token_hash IS
  'SHA-256 des Links zum Aendern der E-Mail; wird beim Einloesen, Deaktivieren, Archivieren und Anonymisieren auf NULL gesetzt.';

-- email bleibt fuer die App-Rolle gesperrt (0052, Regel 3): Aenderungen nur
-- ueber die SECURITY DEFINER-Funktionen unten.
GRANT UPDATE (email_aenderung_token_hash, email_aenderung_ablauf, email_aenderung_von)
  ON klient_zugang TO zimmerakte_app;

-- Anzeige-Seite: vor dem Einloesen gibt es keinen Tenant-Kontext (wie
-- klient_login_lookup). Gleiche Gueltigkeitsbedingungen wie einloesen().
CREATE FUNCTION klient_email_aendern_pruefen(p_token_hash text)
RETURNS TABLE (email citext, passwort_hash text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT z.email, z.passwort_hash
  FROM klient_zugang z
  WHERE z.email_aenderung_token_hash = p_token_hash
    AND z.email_aenderung_ablauf > now()
    AND z.aktiv
    AND z.passwort_hash IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM klient k
      WHERE k.id = z.klient_id AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL
    );
$$;

REVOKE ALL ON FUNCTION klient_email_aendern_pruefen(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION klient_email_aendern_pruefen(text) TO zimmerakte_app;

-- Ergebnis als Text statt boolean, damit "E-Mail vergeben" (409) von
-- "Link ungueltig" (401) unterscheidbar bleibt, ohne eine Exception durch die
-- Transaktion der Anwendung zu schicken. Pruefen, Verbrauchen und Setzen in
-- EINER Anweisung (Begruendung wie 0025): ein zweiter gleichzeitiger Versuch
-- findet den Token nicht mehr. Bei "vergeben" bleibt der Token erhalten --
-- die Person kann es mit anderer Adresse nochmal versuchen.
CREATE FUNCTION klient_email_aendern_einloesen(p_token_hash text, p_neue_email citext, p_passwort_hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zugang klient_zugang%ROWTYPE;
  v_alt    citext;
BEGIN
  SELECT z.* INTO v_zugang
  FROM klient_zugang z
  WHERE z.email_aenderung_token_hash = p_token_hash
    AND z.email_aenderung_ablauf > now()
    AND z.aktiv
    AND z.passwort_hash IS NOT NULL
    AND z.passwort_hash = p_passwort_hash
    AND EXISTS (
      SELECT 1 FROM klient k
      WHERE k.id = z.klient_id AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'ungueltig';
  END IF;
  v_alt := v_zugang.email;

  BEGIN
    UPDATE klient_zugang
    SET email = p_neue_email,
        email_aenderung_token_hash = NULL,
        email_aenderung_ablauf = NULL,
        email_aenderung_von = NULL
    WHERE id = v_zugang.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'vergeben';
  END;

  INSERT INTO audit_log (mandant_id, benutzer_id, modul, aktion, objekt_typ, objekt_id, vorher, nachher)
  VALUES (v_zugang.mandant_id, v_zugang.email_aenderung_von, 'klienten', 'zugang-email-geaendert', 'klient_zugang',
          v_zugang.id,
          jsonb_build_object('email', v_alt::text),
          jsonb_build_object('klientId', v_zugang.klient_id, 'email', p_neue_email::text, 'durchKlient', true));

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION klient_email_aendern_einloesen(text, citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION klient_email_aendern_einloesen(text, citext, text) TO zimmerakte_app;

-- Tippfehler bei der Einladung: solange noch kein Passwort gesetzt ist, darf
-- die Leitung die Adresse direkt korrigieren (es gibt nichts zu schuetzen,
-- die Person hat den Zugang noch nie benutzt). Wird aus der Anwendung MIT
-- Tenant-Kontext aufgerufen; weil SECURITY DEFINER RLS umgeht, prueft die
-- Funktion den Mandanten selbst.
CREATE FUNCTION klient_zugang_email_korrigieren(p_klient_id uuid, p_neue_email citext)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mandant uuid := nullif(current_setting('app.mandant_id', true), '')::uuid;
  v_id      uuid;
  v_pw      text;
BEGIN
  IF v_mandant IS NULL THEN
    RETURN 'nicht_gefunden';
  END IF;

  SELECT z.id, z.passwort_hash INTO v_id, v_pw
  FROM klient_zugang z
  WHERE z.klient_id = p_klient_id AND z.mandant_id = v_mandant
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN 'nicht_gefunden';
  END IF;
  IF v_pw IS NOT NULL THEN
    RETURN 'passwort_gesetzt';
  END IF;

  BEGIN
    UPDATE klient_zugang SET email = p_neue_email WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'vergeben';
  END;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION klient_zugang_email_korrigieren(uuid, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION klient_zugang_email_korrigieren(uuid, citext) TO zimmerakte_app;

-- Wie 0052, zusaetzlich das E-Mail-Token: ein vor der Sperre ausgestellter
-- Link darf nach Archivieren/Anonymisieren nichts mehr bewirken.
CREATE OR REPLACE FUNCTION klient_zugang_bei_sperre() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.anonymisiert_am IS NOT NULL AND OLD.anonymisiert_am IS NULL THEN
    UPDATE klient_zugang
    SET aktiv = false, passwort_hash = NULL, einladung_token_hash = NULL, einladung_ablauf = NULL,
        email_aenderung_token_hash = NULL, email_aenderung_ablauf = NULL, email_aenderung_von = NULL,
        email = 'anonymisiert-' || id::text || '@klient.invalid'
    WHERE klient_id = NEW.id;
  ELSIF NEW.archiviert_am IS NOT NULL AND OLD.archiviert_am IS NULL THEN
    UPDATE klient_zugang
    SET aktiv = false, einladung_token_hash = NULL, einladung_ablauf = NULL,
        email_aenderung_token_hash = NULL, email_aenderung_ablauf = NULL, email_aenderung_von = NULL
    WHERE klient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
