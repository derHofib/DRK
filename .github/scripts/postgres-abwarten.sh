#!/usr/bin/env bash
# Wartet auf postgres-16-starten.sh (im Hintergrund gestartet) und reicht
# dessen Ausgabe und Exit-Code weiter -- ein Fehler dort lässt den Job hier
# rot werden, nicht erst später mit einer unklaren Verbindungsmeldung.
set -euo pipefail
for i in $(seq 1 240); do
  [ -f "$RUNNER_TEMP/pg.exit" ] && break
  sleep 0.5
done
cat "$RUNNER_TEMP/pg.log" || true
test -f "$RUNNER_TEMP/pg.exit" || { echo "PostgreSQL-Start nach 120 s nicht fertig." >&2; exit 1; }
exit "$(cat "$RUNNER_TEMP/pg.exit")"
