-- Abschaffung des alten Drei-Rollen-Modells (bereichsleitung/
-- einrichtungsleitung/betreuer) -- siehe Organigramm-Plan-Nachtrag
-- "Entwickler-Accounttyp". Jeder Mandant hat seit Migration 0048 einen
-- dauerhaften Vollzugriff-Accounttyp "Entwickler"; Rechte laufen seitdem
-- ausschliesslich ueber account_typ/org_position (hatRecht()), nicht mehr
-- ueber eine feste Rolle in der JWT. Die beiden verbliebenen
-- Geschaeftsregeln, die noch direkt an benutzer.rolle hingen
-- (Eskalationsschutz in benutzer.service.ts, Vier-Augen in
-- zimmer.service.ts), wurden im selben Zug im Anwendungscode auf die
-- Rechte-Engine umgestellt -- diese Migration zieht die Datenbankseite nach.
--
-- Exakt dieselbe Technik wie in Migration 0026 (dort wurden zwei Enum-
-- Werte verschmolzen, hier wird die ganze Spalte entfernt): zwei
-- SECURITY-DEFINER-Funktionen (login_lookup, totp_login_lookup) haben
-- "rolle benutzer_rolle" in ihrer Signatur und haengen deshalb am Typ --
-- DROP TYPE wuerde sonst mit "other objects depend on it" scheitern. Beide
-- muessen vor dem Spaltenwechsel weg und danach ohne das rolle-Feld neu
-- angelegt werden.
DROP FUNCTION login_lookup(text, citext);
DROP FUNCTION totp_login_lookup(uuid, uuid);

ALTER TABLE benutzer DROP COLUMN rolle;
DROP TYPE benutzer_rolle;

-- Identisch zu 0026/0018/0017 wiederhergestellt, nur ohne das rolle-Feld.
-- GRANT/REVOKE muss mit, weil ein DROP+CREATE einer Funktion ihre Rechte
-- nicht mitnimmt.
CREATE FUNCTION login_lookup(p_mandant_slug text, p_email citext)
RETURNS TABLE (
  benutzer_id    uuid,
  mandant_id     uuid,
  mandant_aktiv  boolean,
  email          citext,
  name           text,
  passwort_hash  text,
  benutzer_aktiv boolean,
  totp_aktiviert boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id, b.mandant_id, m.aktiv, b.email, b.name, b.passwort_hash, b.aktiv, b.totp_aktiviert
  FROM benutzer b
  JOIN mandant m ON m.id = b.mandant_id
  WHERE m.slug = p_mandant_slug AND b.email = p_email;
$$;

REVOKE ALL ON FUNCTION login_lookup(text, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_lookup(text, citext) TO zimmerakte_app;

CREATE FUNCTION totp_login_lookup(p_benutzer_id uuid, p_mandant_id uuid)
RETURNS TABLE (
  mandant_aktiv       boolean,
  benutzer_aktiv      boolean,
  totp_secret         text,
  totp_aktiviert      boolean,
  totp_letzter_schritt bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.aktiv, b.aktiv, b.totp_secret, b.totp_aktiviert, b.totp_letzter_schritt
  FROM benutzer b
  JOIN mandant m ON m.id = b.mandant_id
  WHERE b.id = p_benutzer_id AND b.mandant_id = p_mandant_id;
$$;

REVOKE ALL ON FUNCTION totp_login_lookup(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION totp_login_lookup(uuid, uuid) TO zimmerakte_app;
