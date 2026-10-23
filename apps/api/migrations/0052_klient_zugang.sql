-- Eigener Login fuer Klient:innen (Chat und eigene Termine, sonst nichts --
-- nie Akteninhalte). Bewusst eine eigene Tabelle statt Spalten auf klient
-- oder benutzer: klient bleibt reine Sozialdaten-Akte (0008), und ein
-- Klient-Zugang darf nie in benutzer landen -- sonst liefe er durch jede
-- Rechte-Pruefung, die benutzer_id voraussetzt, und bekaeme ueber
-- Position/Besetzung womoeglich Rechte.
--
-- Zustand wird abgeleitet, nicht gespeichert (CLAUDE.md Regel 4): "keiner"
-- = keine Zeile; "deaktiviert" = aktiv = false; "eingeladen" = aktiv und
-- passwort_hash IS NULL; "aktiv" = aktiv und Passwort gesetzt.
--
-- Wie bei Passwort-Reset (0025): nur der SHA-256-Hash des Einladungstokens
-- wird gespeichert, der Roh-Token erscheint einmalig als Link.
CREATE TABLE klient_zugang (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id           uuid NOT NULL REFERENCES mandant(id),
  klient_id            uuid NOT NULL UNIQUE REFERENCES klient(id),
  email                citext NOT NULL,
  passwort_hash        text,
  aktiv                boolean NOT NULL DEFAULT true,
  einladung_token_hash text UNIQUE,
  einladung_ablauf     timestamptz,
  eingeladen_von       uuid NOT NULL REFERENCES benutzer(id),
  erstellt_am          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (mandant_id, email),
  CHECK ((einladung_token_hash IS NULL) = (einladung_ablauf IS NULL))
);

COMMENT ON COLUMN klient_zugang.passwort_hash IS
  'NULL bis die Einladung eingeloest wurde. Ohne Hash ist kein Login moeglich.';
COMMENT ON COLUMN klient_zugang.einladung_token_hash IS
  'SHA-256 des Einladungstokens; wird beim Einloesen auf NULL gesetzt, damit der Link nur einmal funktioniert.';

ALTER TABLE klient_zugang ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_zugang FORCE ROW LEVEL SECURITY;

CREATE POLICY klient_zugang_isolation ON klient_zugang
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Spaltenscharf (Regel 3): klient_id und mandant_id duerfen nach dem Anlegen
-- nie wandern (sonst liesse sich ein Zugang auf eine fremde Akte umhaengen).
-- email bleibt ebenfalls fest; die Anonymisierung ueberschreibt sie ueber den
-- SECURITY DEFINER-Trigger unten. DELETE faellt weg: Chat-Nachrichten
-- (spaeterer Schritt) werden auf den Zugang verweisen, Deaktivieren ersetzt
-- Loeschen.
REVOKE UPDATE, DELETE ON klient_zugang FROM zimmerakte_app;
GRANT UPDATE (aktiv, passwort_hash, einladung_token_hash, einladung_ablauf, eingeladen_von)
  ON klient_zugang TO zimmerakte_app;

-- Wie login_lookup (0005): vor dem Login gibt es keinen Tenant-Kontext, RLS
-- lieferte null Zeilen. "gesperrt" fasst archiviert/anonymisiert (0027, 0036)
-- zusammen, damit die Anwendung nicht zwei Spalten kennen muss.
CREATE FUNCTION klient_login_lookup(p_mandant_slug text, p_email citext)
RETURNS TABLE (
  zugang_id      uuid,
  klient_id      uuid,
  mandant_id     uuid,
  mandant_aktiv  boolean,
  passwort_hash  text,
  zugang_aktiv   boolean,
  klient_gesperrt boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT z.id, z.klient_id, z.mandant_id, m.aktiv, z.passwort_hash, z.aktiv,
         (k.archiviert_am IS NOT NULL OR k.anonymisiert_am IS NOT NULL)
  FROM klient_zugang z
  JOIN mandant m ON m.id = z.mandant_id
  JOIN klient k ON k.id = z.klient_id
  WHERE m.slug = p_mandant_slug AND z.email = p_email;
$$;

REVOKE ALL ON FUNCTION klient_login_lookup(text, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION klient_login_lookup(text, citext) TO zimmerakte_app;

-- Pruefen, Verbrauchen und Passwort setzen in EINER Anweisung (Begruendung
-- wie passwort_reset_einloesen in 0025): ein zweiter gleichzeitiger Versuch
-- mit demselben Token findet die Bedingung nicht mehr erfuellt. Ein
-- deaktivierter oder gesperrter Zugang loest nichts ein -- sonst koennte ein
-- vor der Deaktivierung verschickter Link den Zugang wieder nutzbar machen.
CREATE FUNCTION klient_einladung_einloesen(p_token_hash text, p_passwort_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE klient_zugang z
  SET passwort_hash = p_passwort_hash,
      einladung_token_hash = NULL,
      einladung_ablauf = NULL
  WHERE z.einladung_token_hash = p_token_hash
    AND z.einladung_ablauf > now()
    AND z.aktiv
    AND EXISTS (
      SELECT 1 FROM klient k
      WHERE k.id = z.klient_id AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL
    )
  RETURNING z.id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION klient_einladung_einloesen(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION klient_einladung_einloesen(text, text) TO zimmerakte_app;

-- Archivierung/Anonymisierung gehen an mehreren Stellen in den Code (und
-- koennten es kuenftig weitere tun) -- ein Trigger an klient stellt sicher,
-- dass der Zugang nie "vergessen" wird. SECURITY DEFINER, damit er auch
-- ohne gesetzten Tenant-Kontext (Wartungsskripte) greift; er fasst nur
-- Zeilen mit klient_id = NEW.id an. Entarchivieren schaltet den Zugang
-- bewusst NICHT wieder ein: Wiederzulassen ist eine eigene Entscheidung der
-- Mitarbeitenden (PATCH /klienten/:id/zugang).
-- Anonymisierung entfernt zusaetzlich die E-Mail-Adresse (personenbezogen,
-- Art. 17 DSGVO) und das Passwort.
CREATE FUNCTION klient_zugang_bei_sperre() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.anonymisiert_am IS NOT NULL AND OLD.anonymisiert_am IS NULL THEN
    UPDATE klient_zugang
    SET aktiv = false, passwort_hash = NULL, einladung_token_hash = NULL, einladung_ablauf = NULL,
        email = 'anonymisiert-' || id::text || '@klient.invalid'
    WHERE klient_id = NEW.id;
  ELSIF NEW.archiviert_am IS NOT NULL AND OLD.archiviert_am IS NULL THEN
    UPDATE klient_zugang
    SET aktiv = false, einladung_token_hash = NULL, einladung_ablauf = NULL
    WHERE klient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER klient_zugang_bei_sperre
  AFTER UPDATE OF archiviert_am, anonymisiert_am ON klient
  FOR EACH ROW EXECUTE FUNCTION klient_zugang_bei_sperre();
