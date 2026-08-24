-- Die API verbindet sich NIE als Migrations-/Superuser. Diese Rolle ist
-- absichtlich schwach: kein SUPERUSER, kein BYPASSRLS. Genau das macht RLS
-- wirksam -- ein Rechteinhaber, der Policies umgehen kann, macht die Policy
-- zur Dekoration.
--
-- Das Passwort hier ist ein Dev-Default (siehe .env.example) und MUSS in
-- jeder echten Umgebung ueberschrieben werden, z.B. per
--   ALTER ROLE zimmerakte_app WITH PASSWORD '...';
-- aus einem Secret-Store heraus -- nicht in dieser Migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zimmerakte_app') THEN
    CREATE ROLE zimmerakte_app WITH LOGIN PASSWORD 'dev_only_change_me_too' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE zimmerakte TO zimmerakte_app;
GRANT USAGE ON SCHEMA public TO zimmerakte_app;

-- Neue Tabellen sollen ihre Rechte nicht in jeder Migration einzeln
-- vergeben muessen.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zimmerakte_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO zimmerakte_app;
