-- Rollenmodell auf eine Fuehrungshierarchie umgestellt:
--   leitung          -> bereichsleitung    (traegerweit, unveraendert alle Rechte)
--   verwaltung        -> einrichtungsleitung (zusaetzlich: Mitarbeiter der eigenen
--                                             Einrichtung anlegen, siehe benutzer.service.ts)
--   bezugsbetreuung  -> betreuer          (Basisrolle)
--   springer          -> betreuer          (Basisrolle)
--
-- bezugsbetreuung und springer verschmelzen zu einer einzigen Rolle: die
-- Unterscheidung "fest zugeordnete Bezugsbetreuung" vs. "Springer ohne feste
-- Zuordnung" war nie rechtlich abgebildet (siehe ROLLEN_MIT_*-Sets in
-- kassenbuch/rechnung/zimmer-Services vor dieser Migration -- beide standen
-- in jedem davon auf derselben Seite), nur organisatorisch. Wer das wieder
-- braucht, bildet es ueber benutzer_standort ab (fest zugeordnet = einem
-- Standort zugewiesen, Springer = keiner Zuordnung).
--
-- Postgres kann weder einen Enum-Wert entfernen noch zwei Werte zu einem
-- verschmelzen -- deshalb hier bewusst ueber einen neuen Typ (Spalte per
-- USING umgegossen, alter Typ verworfen) statt ueber ALTER TYPE ... RENAME
-- VALUE. RENAME VALUE haette bezugsbetreuung/springer als verwaiste, nie
-- wieder verwendbare Werte im Enum zurueckgelassen.
--
-- Zwei SECURITY-DEFINER-Funktionen (0005/0018 login_lookup, 0017
-- totp_login_lookup) haben "rolle benutzer_rolle" in ihrer Signatur und
-- haengen deshalb am Typ -- DROP TYPE wuerde sonst mit "other objects
-- depend on it" scheitern. Beide muessen vor dem Typwechsel weg und danach
-- unveraendert neu angelegt werden (der Funktionskoerper referenziert keine
-- konkreten Enum-Werte, nur den Typnamen -- der zeigt nach dem RENAME
-- automatisch wieder auf den aktuellen Typ).
DROP FUNCTION login_lookup(text, citext);
DROP FUNCTION totp_login_lookup(uuid, uuid);

CREATE TYPE benutzer_rolle_neu AS ENUM ('bereichsleitung', 'einrichtungsleitung', 'betreuer');

ALTER TABLE benutzer
  ALTER COLUMN rolle TYPE benutzer_rolle_neu
  USING (
    CASE rolle::text
      WHEN 'leitung' THEN 'bereichsleitung'
      WHEN 'verwaltung' THEN 'einrichtungsleitung'
      WHEN 'bezugsbetreuung' THEN 'betreuer'
      WHEN 'springer' THEN 'betreuer'
    END
  )::benutzer_rolle_neu;

DROP TYPE benutzer_rolle;
ALTER TYPE benutzer_rolle_neu RENAME TO benutzer_rolle;

-- Identisch zu 0018/0017 wiederhergestellt -- nur der Spaltentyp von "rolle"
-- zeigt jetzt auf den neuen Enum-Inhalt. GRANT/REVOKE muss mit, weil ein
-- DROP+CREATE einer Funktion ihre Rechte nicht mitnimmt.
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
