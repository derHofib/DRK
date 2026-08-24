-- Nachtrag zur 2FA-Erzwingung (Phase 4): haelt den zuletzt erfolgreich
-- verifizierten TOTP-Zeitschritt fest (Unixzeit / 30), damit derselbe Code
-- -- oder ein aelterer -- nicht innerhalb seines Gueltigkeitsfensters ein
-- zweites Mal akzeptiert wird (siehe auth.service.ts, totpVerifizieren()).
ALTER TABLE benutzer ADD COLUMN totp_letzter_schritt bigint;

COMMENT ON COLUMN benutzer.totp_letzter_schritt IS
  'Letzter erfolgreich verifizierter TOTP-Zeitschritt -- Replay-Schutz, siehe auth.service.ts.';
