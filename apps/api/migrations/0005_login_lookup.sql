-- Das Henne-Ei-Problem des Logins: Vor der Anmeldung ist app.mandant_id
-- noch nicht gesetzt. Ohne ihn liefert RLS (korrekt!) exakt null Zeilen --
-- auch fuer den Login-Query selbst. Die App-Rolle kann also nicht einfach
-- "SELECT ... FROM benutzer WHERE email = ..." vor dem Login ausfuehren.
--
-- Die uebliche, saubere Loesung ist eine einzelne SECURITY DEFINER-Funktion:
-- sie laeuft mit den Rechten ihres Eigentuemers (der Migrations-Rolle),
-- nicht mit denen der aufrufenden App-Rolle, und bypassed RLS dadurch --
-- aber NUR fuer genau diese eine, eng begrenzte Abfrage. Die App-Rolle
-- bekommt EXECUTE auf die Funktion, niemals direkten Zugriff auf die
-- Tabellen ohne gesetzten Tenant-Kontext.
--
-- Voraussetzung: Die Migrations-Rolle (siehe MIGRATIONS_DATABASE_URL) muss
-- entweder Superuser sein (lokal/Docker per POSTGRES_USER der Fall) oder
-- explizit BYPASSRLS haben. Bei einer verwalteten Postgres-Instanz eines
-- Hosters ist das ggf. manuell nachzuziehen -- ohne das liefert auch diese
-- Funktion nichts.
CREATE FUNCTION login_lookup(p_mandant_slug text, p_email citext)
RETURNS TABLE (
  benutzer_id    uuid,
  mandant_id     uuid,
  mandant_aktiv  boolean,
  email          citext,
  name           text,
  passwort_hash  text,
  rolle          benutzer_rolle,
  benutzer_aktiv boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id, b.mandant_id, m.aktiv, b.email, b.name, b.passwort_hash, b.rolle, b.aktiv
  FROM benutzer b
  JOIN mandant m ON m.id = b.mandant_id
  WHERE m.slug = p_mandant_slug AND b.email = p_email;
$$;

REVOKE ALL ON FUNCTION login_lookup(text, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_lookup(text, citext) TO zimmerakte_app;
