#!/bin/sh
# Prueft auf dem Server, ob das Docker-Datenverzeichnis auf einem
# verschluesselten Geraet (LUKS/dm-crypt) liegt. Bewusst ein Skript statt
# nur Doku: "ist die Platte verschluesselt?" ist eine Behauptung, die sich
# nach einem Serverumzug oder Hosterwechsel still aendern kann.
#
# Aufruf: sh scripts/pruefe-datentraeger.sh [Pfad]   (Standard: Docker-Root)
# Exit 0 = verschluesselt erkannt, 1 = nicht erkannt, 2 = nicht pruefbar.
#
# Grenze: Volume-Verschluesselung des Hosters (ausserhalb der VM) ist hier
# NICHT sichtbar. Dann meldet das Skript 1 -- die schriftliche Bestaetigung
# des Hosters (docs/DEPLOYMENT.md, Abschnitt 1.1) ersetzt die Pruefung.
set -eu

PFAD="${1:-}"
if [ -z "$PFAD" ]; then
  PFAD=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  PFAD="${PFAD:-/var/lib/docker}"
fi
[ -e "$PFAD" ] || { echo "Pfad $PFAD existiert nicht." >&2; exit 2; }
command -v lsblk >/dev/null 2>&1 || { echo "lsblk fehlt." >&2; exit 2; }

QUELLE=$(df --output=source "$PFAD" | tail -n 1)
# Geraet samt allen darunterliegenden Ebenen (Partition, LVM, crypt ...)
TYPEN=$(lsblk -s -n -o TYPE "$QUELLE" 2>/dev/null || true)

if echo "$TYPEN" | grep -qx crypt; then
  echo "OK: $PFAD liegt auf $QUELLE, darunter ein verschluesseltes Geraet (crypt)."
  exit 0
fi
echo "NICHT ERKANNT: $PFAD liegt auf $QUELLE ohne crypt-Ebene (Typen: $(echo $TYPEN | tr '\n' ' '))." >&2
echo "Entweder LUKS einrichten oder die Volume-Verschluesselung des Hosters schriftlich bestaetigen lassen." >&2
exit 1
