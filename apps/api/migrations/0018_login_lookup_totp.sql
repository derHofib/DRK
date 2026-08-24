-- login_lookup() (0005) muss jetzt auch totp_aktiviert liefern, damit
-- auth.service.ts.login() nach der Passwortpruefung entscheiden kann, ob
-- ein zweiter (TOTP-)Schritt noetig ist. Der Rueckgabetyp aendert sich,
-- CREATE OR REPLACE erlaubt das bei einer TABLE-Funktion nicht -- deshalb
-- erst DROP, dann neu anlegen.
DROP FUNCTION login_lookup(text, citext);

CREATE FUNCTION login_lookup(p_mandant_slug text, p_email citext)
RETURNS TABLE (
  benutzer_id    uuid,
  mandant_id     uuid,
  mandant_aktiv  boolean,
  email          citext,
  name           text,
  passwort_hash  text,
  rolle          benutzer_rolle,
  benutzer_aktiv boolean,
  totp_aktiviert boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id, b.mandant_id, m.aktiv, b.email, b.name, b.passwort_hash, b.rolle, b.aktiv, b.totp_aktiviert
  FROM benutzer b
  JOIN mandant m ON m.id = b.mandant_id
  WHERE m.slug = p_mandant_slug AND b.email = p_email;
$$;

REVOKE ALL ON FUNCTION login_lookup(text, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_lookup(text, citext) TO zimmerakte_app;
