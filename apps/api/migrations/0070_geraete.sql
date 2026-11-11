-- Gekoppelte Geraete (iPhone-App). Die App kennt keine feste Server-Adresse:
-- jeder Traeger hostet selbst. Eine angemeldete Person erzeugt deshalb in der
-- Weboberflaeche einen QR-Code mit einem einmaligen Kopplungs-Token; die App
-- scannt ihn und tauscht ihn gegen eine Sitzung, die an GENAU dieses Geraet
-- gebunden ist. Dadurch laesst sich ein verlorenes Handy einzeln sperren,
-- ohne das Passwort der Person aendern zu muessen.
--
-- Kopplungs-Token: wie Reset-Tokens (0025) -- 256 Bit zufaellig, nur der
-- SHA-256 wird gespeichert, einmalig einloesbar, kurz gueltig. Das Einloesen
-- passiert VOR einer Sitzung und damit ohne Tenant-Kontext; wie bei
-- passwort_reset_einloesen laeuft Pruefen, Verbrauchen und Geraet anlegen
-- deshalb atomar in einer einzigen, eng begrenzten SECURITY DEFINER-Funktion.
-- Zwei getrennte Roundtrips liessen ein Zeitfenster fuer doppeltes Einloesen.
--
-- Ein Token fuer eine deaktivierte Person oder einen deaktivierten Mandanten
-- wird NICHT verbraucht und liefert nichts -- gleiche Antwort wie "abgelaufen",
-- damit sich daran nichts erraten laesst.
--
-- apns_token: das Geraete-Token fuer Push. Es ist am Geraet gespeichert, nicht
-- am Benutzer: eine Sperre des Geraets beendet damit auch den Push, und ein
-- Mensch mit zwei Geraeten bekommt auf beiden. Der Push selbst enthaelt nie
-- Nachrichtentext oder Namen (laeuft ueber Apple) -- das ist Sache des
-- Versenders, nicht dieser Tabelle.
CREATE TABLE geraet (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id          uuid NOT NULL REFERENCES mandant(id),
  benutzer_id         uuid NOT NULL REFERENCES benutzer(id),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  plattform           text NOT NULL CHECK (plattform IN ('ios')),
  erstellt_am         timestamptz NOT NULL DEFAULT now(),
  zuletzt_gesehen_am  timestamptz NOT NULL DEFAULT now(),
  gesperrt_am         timestamptz,
  apns_token          text
);

CREATE INDEX geraet_benutzer_idx ON geraet (benutzer_id);

ALTER TABLE geraet ENABLE ROW LEVEL SECURITY;
ALTER TABLE geraet FORCE ROW LEVEL SECURITY;
CREATE POLICY geraet_isolation ON geraet
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Benutzer, Name und Plattform sind ab dem INSERT fest; ein Fehler im Code
-- koennte sonst ein Geraet einer anderen Person zuordnen.
REVOKE UPDATE ON geraet FROM zimmerakte_app;
GRANT UPDATE (apns_token, gesperrt_am, zuletzt_gesehen_am) ON geraet TO zimmerakte_app;

CREATE TABLE geraet_kopplung (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  benutzer_id    uuid NOT NULL REFERENCES benutzer(id),
  token_hash     text NOT NULL UNIQUE,
  erstellt_am    timestamptz NOT NULL DEFAULT now(),
  laeuft_ab_am   timestamptz NOT NULL,
  eingeloest_am  timestamptz
);

ALTER TABLE geraet_kopplung ENABLE ROW LEVEL SECURITY;
ALTER TABLE geraet_kopplung FORCE ROW LEVEL SECURITY;
CREATE POLICY geraet_kopplung_isolation ON geraet_kopplung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Verbraucht wird nur ueber die Funktion unten, nie ueber die App-Rolle.
REVOKE UPDATE ON geraet_kopplung FROM zimmerakte_app;

CREATE FUNCTION geraet_koppeln(p_token_hash text, p_name text, p_plattform text)
RETURNS TABLE (geraet_id uuid, benutzer_id uuid, mandant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_benutzer_id uuid;
  v_mandant_id  uuid;
  v_geraet_id   uuid;
BEGIN
  UPDATE geraet_kopplung k
  SET eingeloest_am = now()
  FROM benutzer b, mandant m
  WHERE k.token_hash = p_token_hash
    AND k.eingeloest_am IS NULL
    AND k.laeuft_ab_am > now()
    AND b.id = k.benutzer_id AND b.aktiv
    AND m.id = k.mandant_id AND m.aktiv
  RETURNING k.benutzer_id, k.mandant_id INTO v_benutzer_id, v_mandant_id;

  IF v_benutzer_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO geraet (mandant_id, benutzer_id, name, plattform)
  VALUES (v_mandant_id, v_benutzer_id, p_name, p_plattform)
  RETURNING id INTO v_geraet_id;

  RETURN QUERY SELECT v_geraet_id, v_benutzer_id, v_mandant_id;
END;
$$;

REVOKE ALL ON FUNCTION geraet_koppeln(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION geraet_koppeln(text, text, text) TO zimmerakte_app;
