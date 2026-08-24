-- Dasselbe Henne-Ei-Problem wie beim Login (siehe 0005_login_lookup.sql),
-- diesmal fuer den zweiten Schritt eines 2FA-Logins: der "pending"-Token
-- kennt bereits benutzer_id und mandant_id, aber app.mandant_id ist in
-- dieser Anfrage noch nicht gesetzt (dieser Endpunkt haengt bewusst nicht
-- hinter AuthGuard/TenantContextInterceptor -- vor bestandener
-- TOTP-Pruefung gibt es noch keinen vollwertigen Tenant-Kontext).
CREATE FUNCTION totp_login_lookup(p_benutzer_id uuid, p_mandant_id uuid)
RETURNS TABLE (
  rolle               benutzer_rolle,
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
  SELECT b.rolle, m.aktiv, b.aktiv, b.totp_secret, b.totp_aktiviert, b.totp_letzter_schritt
  FROM benutzer b
  JOIN mandant m ON m.id = b.mandant_id
  WHERE b.id = p_benutzer_id AND b.mandant_id = p_mandant_id;
$$;

REVOKE ALL ON FUNCTION totp_login_lookup(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION totp_login_lookup(uuid, uuid) TO zimmerakte_app;

-- Schreibt den Replay-Schutz-Zeitschritt (siehe 0016) nach erfolgreicher
-- Verifikation im selben Login-Schritt zurueck -- ebenfalls vor einem
-- vollwertigen Tenant-Kontext, deshalb dieselbe Technik.
CREATE FUNCTION totp_letzten_schritt_setzen(p_benutzer_id uuid, p_mandant_id uuid, p_schritt bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE benutzer SET totp_letzter_schritt = p_schritt
  WHERE id = p_benutzer_id AND mandant_id = p_mandant_id;
$$;

REVOKE ALL ON FUNCTION totp_letzten_schritt_setzen(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION totp_letzten_schritt_setzen(uuid, uuid, bigint) TO zimmerakte_app;
