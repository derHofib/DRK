#!/usr/bin/env bash
# Interaktiv einen Mitarbeiter-Account anlegen -- fuer den allerersten
# Account eines frischen Mandanten gibt es dafuer keinen anderen Weg: es
# existiert bewusst kein oeffentlicher Registrierungs-Endpunkt (siehe
# auth.controller.ts) und POST /benutzer setzt schon einen eingeloggten
# "bereichsleitung"- oder "einrichtungsleitung"-Account voraus. Fuer
# WEITERE Accounts eines Mandanten, der schon eine Leitung hat, ist die
# "Mitarbeitende"-Seite in der App der richtige Weg -- dieses Script ist
# nur fuer den Terminal-Zugriff auf dem Server gedacht (Ersteinrichtung,
# Notfall-Zugang).
#
# Das Passwort wird bewusst NIE als Kommandozeilen-Argument uebergeben,
# sondern per "read -s" eingelesen und dem Container nur als Umgebungs-
# variable mitgegeben -- Sonderzeichen koennen die Shell so nicht mehr
# durcheinanderbringen, und es landet nicht in der Prozessliste (ps aux)
# eines anderen Nutzers auf dem Host. Alle SQL-Werte laufen ueber psqls
# eigene :'variable'-Quotierung statt String-Verkettung -- damit kann
# weder ein Apostroph im Namen noch ein "$" im Passwort-Hash die Abfrage
# kaputt machen (beides ist beim allerersten manuell angelegten Account
# tatsaechlich passiert).
#
# Zwei Dinge dabei gegen eine echte PostgreSQL nachgeprueft, nicht nur
# angenommen: (1) die :'variable'-Ersetzung funktioniert bei psql NUR,
# wenn das SQL ueber die Standardeingabe (Heredoc) oder -f hereinkommt --
# ueber "-c" bleibt der Doppelpunkt woertlich stehen und ergibt einen
# Syntaxfehler. (2) psql beendet sich bei einem SQL-Fehler ohne weiteres
# Zutun mit Exit-Code 0 -- ohne "-v ON_ERROR_STOP=1" wuerde ein
# fehlgeschlagenes INSERT (z.B. Slug schon vergeben) als Erfolg gemeldet.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "Fehler: .env.prod fehlt. Siehe docs/DEPLOYMENT.md, Abschnitt 3." >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.prod)

# -T unterdrueckt die Pseudo-TTY-Zuweisung -- ohne das mischen sich bei
# "exec" leicht Steuerzeichen (\r) in die per $(...) eingefangene Ausgabe,
# was z.B. einen 60-Zeichen-Bcrypt-Hash unbemerkt verlaengern wuerde.
psql_admin() {
  "${COMPOSE[@]}" exec -T db psql -U zimmerakte_admin -d zimmerakte "$@"
}

echo "Bestehende Mandanten:"
psql_admin -c "SELECT slug, name FROM mandant ORDER BY name;"
echo

read -rp "Neuen Mandanten anlegen? (j/N) " NEU

if [[ "$NEU" =~ ^[jJ]$ ]]; then
  read -rp "Traegername (z.B. \"DRK Kreisverband XY\"): " TRAEGERNAME
  read -rp "Kennung/Slug fuer den Login (nur a-z, 0-9, Bindestrich, z.B. \"drk\"): " SLUG
  if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
    echo "Fehler: Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten." >&2
    exit 1
  fi
  if ! psql_admin -v ON_ERROR_STOP=1 -v name="$TRAEGERNAME" -v slug="$SLUG" <<'SQL'
INSERT INTO mandant (name, slug) VALUES (:'name', :'slug');
SQL
  then
    echo "Fehler: Mandant konnte nicht angelegt werden (Slug evtl. schon vergeben)." >&2
    exit 1
  fi
  echo "Mandant \"$TRAEGERNAME\" ($SLUG) angelegt."
else
  read -rp "Slug des vorhandenen Mandanten: " SLUG
  GEFUNDEN=$(psql_admin -tAq -v slug="$SLUG" <<'SQL'
SELECT 1 FROM mandant WHERE slug = :'slug';
SQL
  )
  if [ -z "$GEFUNDEN" ]; then
    echo "Fehler: kein Mandant mit Slug \"$SLUG\" gefunden." >&2
    exit 1
  fi
fi

echo
read -rp "E-Mail-Adresse: " EMAIL
read -rp "Anzeigename: " NAME

echo "Rolle waehlen:"
PS3="Nummer eingeben: "
select ROLLE in bereichsleitung einrichtungsleitung betreuer; do
  [ -n "$ROLLE" ] && break
done

while true; do
  read -rsp "Passwort (mind. 8 Zeichen): " PW1; echo
  read -rsp "Passwort wiederholen: " PW2; echo
  if [ "$PW1" != "$PW2" ]; then
    echo "Passwoerter stimmen nicht ueberein, bitte nochmal."
    continue
  fi
  if [ "${#PW1}" -lt 8 ]; then
    echo "Mindestens 8 Zeichen, bitte nochmal."
    continue
  fi
  break
done

HASH=$("${COMPOSE[@]}" exec -T -e KLARTEXT_PW="$PW1" api \
  node -e "require('bcryptjs').hash(process.env.KLARTEXT_PW, 10).then(h => console.log(h))")
unset PW1 PW2

ERGEBNIS=$(psql_admin -tAq \
  -v slug="$SLUG" -v email="$EMAIL" -v name="$NAME" -v hash="$HASH" -v rolle="$ROLLE" <<'SQL'
WITH m AS (SELECT id FROM mandant WHERE slug = :'slug')
INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
SELECT m.id, :'email', :'name', :'hash', :'rolle'::benutzer_rolle FROM m
RETURNING id;
SQL
)

if [ -z "$ERGEBNIS" ]; then
  echo "Fehler: Account konnte nicht angelegt werden (E-Mail bei diesem Mandanten evtl. schon vergeben)." >&2
  exit 1
fi

echo
echo "Fertig: $EMAIL ($ROLLE) bei Mandant \"$SLUG\" angelegt."
echo "Login-Daten: Traeger-Kennung \"$SLUG\", E-Mail \"$EMAIL\", das eben vergebene Passwort."
