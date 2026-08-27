#!/usr/bin/env bash
# Holt den neuesten Stand aus git und baut/startet den kompletten
# Produktions-Stack neu -- inklusive caddy, das dabei (sofern noch nicht
# geschehen) automatisch Let's-Encrypt-Zertifikate fuer app.hecaso.de und
# office.hecaso.de anfordert (siehe Caddyfile in der Repo-Wurzel).
#
# Voraussetzung: DNS fuer beide Domains zeigt bereits auf die IP dieses
# Servers (A-Record bei IONOS, siehe docs/DEPLOYMENT.md Abschnitt 7) --
# sonst kann Let's Encrypt die Kontrolle ueber die Domain nicht per
# HTTP-01-Challenge pruefen. Das laesst den restlichen Stack nicht
# abstuerzen, caddy versucht es einfach automatisch erneut.
#
# Nutzung (auf dem Server, im geklonten Repo-Verzeichnis):
#   ./scripts/aktualisieren.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "Fehler: .env.prod fehlt. Siehe docs/DEPLOYMENT.md, Abschnitt 3." >&2
  exit 1
fi

echo "-> Hole neuesten Stand aus git..."
git pull

echo "-> Baue und starte den Stack neu (db, migrate, api, web, caddy)..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo "-> Warte kurz, dann Status aller Container..."
sleep 3
docker compose -f docker-compose.prod.yml ps

cat <<'EOF'

Fertig. Zertifikate fuer app.hecaso.de/office.hecaso.de erscheinen in den
caddy-Logs, sobald Let's Encrypt sie ausgestellt hat:
  docker compose -f docker-compose.prod.yml logs -f caddy

Neue Migrationen laufen automatisch ueber den migrate-Dienst, bevor api
neu startet -- Fortschritt:
  docker compose -f docker-compose.prod.yml logs -f migrate api
EOF
