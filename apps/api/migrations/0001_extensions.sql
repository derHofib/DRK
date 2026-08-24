-- Grundausstattung. btree_gist kommt erst mit der Belegungstabelle in Phase 1
-- dazu (Exclusion-Constraint gegen Doppelbelegung), pgcrypto brauchen wir
-- schon jetzt fuer gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Case-insensitive Text fuer E-Mail-Adressen: "Anna@drk.de" und "anna@drk.de"
-- sind derselbe Login, nicht zwei UNIQUE-Verletzungen, die erst beim
-- zweiten Registrierungsversuch auffallen.
CREATE EXTENSION IF NOT EXISTS citext;
