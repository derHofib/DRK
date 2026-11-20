#!/usr/bin/env bash
# Startet PostgreSQL 16 für die api-tests-Jobs. Läuft im Hintergrund, während
# der Job Node einrichtet und installiert; der Schritt "Migrationen anwenden"
# wartet über postgres-abwarten.sh auf das Ergebnis.
#
# Das Runner-Image bringt PostgreSQL mit; es nur zu starten dauert einige
# Sekunden, ein Service-Container kostete jedes Mal ~12 s (Image ziehen,
# Health-Check). Produktion läuft auf 16 -- hat das Image eine andere
# Version, weicht das Skript auf den Container postgres:16 aus, statt still
# gegen eine andere Hauptversion zu testen. fsync & Co. aus: reine
# Wegwerf-Datenbank, Haltbarkeit egal, CREATE DATABASE … TEMPLATE schneller.
set -euo pipefail

if [ -x /usr/lib/postgresql/16/bin/postgres ]; then
  sudo systemctl start postgresql.service
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q \
    -c "CREATE ROLE zimmerakte_admin LOGIN SUPERUSER PASSWORD 'ci_only_not_secret'" \
    -c "CREATE DATABASE zimmerakte OWNER zimmerakte_admin" \
    -c "ALTER SYSTEM SET fsync = off" \
    -c "ALTER SYSTEM SET synchronous_commit = off" \
    -c "ALTER SYSTEM SET full_page_writes = off" \
    -c "SELECT pg_reload_conf()"
else
  echo "Kein PostgreSQL 16 im Runner-Image -- weiche auf postgres:16 aus."
  docker run -d -p 5432:5432 \
    -e POSTGRES_USER=zimmerakte_admin \
    -e POSTGRES_PASSWORD=ci_only_not_secret \
    -e POSTGRES_DB=zimmerakte \
    postgres:16 -c fsync=off -c synchronous_commit=off -c full_page_writes=off
  for i in $(seq 1 60); do
    psql "$MIGRATIONS_DATABASE_URL" -Atc "SELECT 1" > /dev/null 2>&1 && break
    sleep 0.5
  done
fi

version=$(psql "$MIGRATIONS_DATABASE_URL" -Atc "SHOW server_version_num")
echo "PostgreSQL $version"
test "${version:0:2}" = "16"
