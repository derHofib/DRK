-- "Passwort vergessen" ohne E-Mail-Versand: die Leitung stoesst den Reset
-- an, bekommt aber nur einen einmaligen, zeitlich begrenzten LINK gezeigt --
-- nie das neue Passwort selbst. Die betroffene Person oeffnet den Link und
-- vergibt ihr Passwort SELBST; die Leitung hat zu keinem Zeitpunkt Zugriff
-- darauf. Gespeichert wird nur der SHA-256-Hash des Tokens, nie der Token
-- selbst -- genau wie beim Passwort: kaeme die Datenbank je in falsche
-- Haende, waeren die Tokens damit wertlos statt ein Generalschluessel zu
-- allen offenen Reset-Vorgaengen.
CREATE TABLE benutzer_reset_token (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  benutzer_id    uuid NOT NULL REFERENCES benutzer(id),
  token_hash     text NOT NULL UNIQUE,
  erstellt_von   uuid NOT NULL REFERENCES benutzer(id),
  erstellt_am    timestamptz NOT NULL DEFAULT now(),
  laeuft_ab_am   timestamptz NOT NULL,
  eingeloest_am  timestamptz
);

COMMENT ON COLUMN benutzer_reset_token.token_hash IS
  'SHA-256 des Reset-Tokens. Der Token selbst wird nirgends gespeichert, nur einmalig als Link an die Leitung zurueckgegeben.';
COMMENT ON COLUMN benutzer_reset_token.eingeloest_am IS
  'NULL = noch nicht benutzt. Einmal gesetzt, bleibt der Token dauerhaft ungueltig -- auch innerhalb seiner Gueltigkeitsdauer.';

CREATE INDEX benutzer_reset_token_benutzer_idx ON benutzer_reset_token (benutzer_id);

ALTER TABLE benutzer_reset_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE benutzer_reset_token FORCE ROW LEVEL SECURITY;

CREATE POLICY benutzer_reset_token_isolation ON benutzer_reset_token
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Nach dem Anlegen darf sich nur noch eingeloest_am aendern (das Einloesen
-- selbst laeuft ueber die SECURITY DEFINER-Funktion unten, die RLS und
-- Spaltenrechte ohnehin umgeht) -- token_hash, benutzer_id etc. sind ab dem
-- INSERT fuer die App-Rolle unveraenderlich. Dasselbe Muster wie
-- kassenbuchung (0011).
REVOKE UPDATE ON benutzer_reset_token FROM zimmerakte_app;
GRANT UPDATE (eingeloest_am) ON benutzer_reset_token TO zimmerakte_app;

-- Bislang hatte die App-Rolle ueber ALTER DEFAULT PRIVILEGES (0002) UPDATE
-- auf JEDE Spalte von benutzer -- also auch email, rolle, mandant_id. Ein
-- Fehler im Code haette darueber z.B. die eigene Rolle auf "leitung" heben
-- koennen. Jetzt, wo ein Passwort-Aendern-Pfad hinzukommt, ist der richtige
-- Moment, das spaltenscharf zu fassen. Alle vier hier gelisteten Spalten
-- sind die einzigen, die der bestehende Code tatsaechlich per UPDATE
-- anfasst (2FA-Einrichtung/-Aktivierung/-Deaktivierung plus das neue
-- Passwort-Aendern) -- gegengeprueft per Volltextsuche im Repo.
REVOKE UPDATE ON benutzer FROM zimmerakte_app;
GRANT UPDATE (passwort_hash, totp_secret, totp_aktiviert, totp_letzter_schritt) ON benutzer TO zimmerakte_app;

-- Analog zu login_lookup (0005): vor dem Einloesen eines Reset-Tokens ist
-- kein Tenant-Kontext bekannt (die Person ist ja gerade ausgesperrt), RLS
-- liefert also null Zeilen. Eine einzelne, eng begrenzte SECURITY DEFINER-
-- Funktion bypassed RLS nur fuer genau diesen einen Vorgang.
--
-- Pruefung UND Verbrauch (eingeloest_am setzen) UND das eigentliche Setzen
-- des neuen Passworts laufen bewusst in EINER atomaren Funktion:
-- "UPDATE ... WHERE eingeloest_am IS NULL ... RETURNING" sperrt die Zeile
-- fuer die Dauer der Transaktion, ein zweiter, gleichzeitiger Versuch mit
-- demselben Token findet die Bedingung dann nicht mehr erfuellt. Zwei
-- getrennte Anwendungs-Roundtrips (erst pruefen, dann verbrauchen) haetten
-- hier ein Zeitfenster fuer doppeltes Einloesen offengelassen.
CREATE FUNCTION passwort_reset_einloesen(p_token_hash text, p_neuer_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_benutzer_id uuid;
BEGIN
  UPDATE benutzer_reset_token
  SET eingeloest_am = now()
  WHERE token_hash = p_token_hash
    AND eingeloest_am IS NULL
    AND laeuft_ab_am > now()
  RETURNING benutzer_id INTO v_benutzer_id;

  IF v_benutzer_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE benutzer SET passwort_hash = p_neuer_hash WHERE id = v_benutzer_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION passwort_reset_einloesen(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION passwort_reset_einloesen(text, text) TO zimmerakte_app;
