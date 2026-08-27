#!/usr/bin/env bash
# Interaktive Mitarbeiter-Verwaltung ueber das Terminal -- fuer den
# allerersten Account eines frischen Mandanten gibt es dafuer keinen
# anderen Weg: es existiert bewusst kein oeffentlicher Registrierungs-
# Endpunkt (siehe auth.controller.ts) und POST /benutzer setzt schon
# einen eingeloggten "bereichsleitung"- oder "einrichtungsleitung"-
# Account voraus. Fuer den taeglichen Betrieb (weitere Accounts anlegen,
# Rollen aendern) ist die "Mitarbeitende"-Seite in der App meist der
# bequemere Weg -- dieses Script deckt zusaetzlich ab, was die
# Oberflaeche (noch) nicht kann: Passwort-Hash direkt setzen, 2FA im
# Notfall zuruecksetzen, den allerersten Account ueberhaupt anlegen.
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

hash_erzeugen() {
  # $1 = Klartextpasswort, Ausgabe: Bcrypt-Hash auf stdout.
  "${COMPOSE[@]}" exec -T -e KLARTEXT_PW="$1" api \
    node -e "require('bcryptjs').hash(process.env.KLARTEXT_PW, 10).then(h => console.log(h))"
}

passwort_abfragen() {
  # Fuellt die globalen Variablen PW1 (Klartext) -- Aufrufer muss
  # "unset PW1" setzen, sobald der Hash erzeugt wurde.
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
    unset PW2
    break
  done
}

# Fuellt die globale Variable SLUG -- entweder durch Neuanlage eines
# Mandanten oder durch Auswahl eines vorhandenen. $1 = "j", wenn eine
# Neuanlage angeboten werden soll (nur beim Anlegen-Flow sinnvoll).
mandant_waehlen() {
  local neu_anbieten="${1:-n}"
  echo "Bestehende Mandanten:"
  psql_admin -c "SELECT slug, name FROM mandant ORDER BY name;"
  echo

  if [ "$neu_anbieten" = "j" ]; then
    read -rp "Neuen Mandanten anlegen? (j/N) " NEU
    if [[ "$NEU" =~ ^[jJ]$ ]]; then
      read -rp "Traegername (z.B. \"DRK Kreisverband XY\"): " TRAEGERNAME
      read -rp "Kennung/Slug fuer den Login (nur a-z, 0-9, Bindestrich, z.B. \"drk\"): " SLUG
      if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
        echo "Fehler: Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten." >&2
        return 1
      fi
      if ! psql_admin -v ON_ERROR_STOP=1 -v name="$TRAEGERNAME" -v slug="$SLUG" <<'SQL'
INSERT INTO mandant (name, slug) VALUES (:'name', :'slug');
SQL
      then
        echo "Fehler: Mandant konnte nicht angelegt werden (Slug evtl. schon vergeben)." >&2
        return 1
      fi
      echo "Mandant \"$TRAEGERNAME\" ($SLUG) angelegt."
      return 0
    fi
  fi

  read -rp "Slug des Mandanten: " SLUG
  local gefunden
  gefunden=$(psql_admin -tAq -v slug="$SLUG" <<'SQL'
SELECT 1 FROM mandant WHERE slug = :'slug';
SQL
  )
  if [ -z "$gefunden" ]; then
    echo "Fehler: kein Mandant mit Slug \"$SLUG\" gefunden." >&2
    return 1
  fi
}

neuen_account_anlegen() {
  mandant_waehlen "j" || return 1

  echo
  read -rp "E-Mail-Adresse: " EMAIL
  read -rp "Anzeigename: " NAME

  echo "Rolle waehlen:"
  PS3="Nummer eingeben: "
  select ROLLE in bereichsleitung einrichtungsleitung betreuer; do
    [ -n "$ROLLE" ] && break
  done

  passwort_abfragen
  local hash
  hash=$(hash_erzeugen "$PW1")
  unset PW1

  local ergebnis
  ergebnis=$(psql_admin -tAq \
    -v slug="$SLUG" -v email="$EMAIL" -v name="$NAME" -v hash="$hash" -v rolle="$ROLLE" <<'SQL'
WITH m AS (SELECT id FROM mandant WHERE slug = :'slug')
INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
SELECT m.id, :'email', :'name', :'hash', :'rolle'::benutzer_rolle FROM m
RETURNING id;
SQL
  )

  if [ -z "$ergebnis" ]; then
    echo "Fehler: Account konnte nicht angelegt werden (E-Mail bei diesem Mandanten evtl. schon vergeben)." >&2
    return 1
  fi

  echo
  echo "Fertig: $EMAIL ($ROLLE) bei Mandant \"$SLUG\" angelegt."
  echo "Login-Daten: Traeger-Kennung \"$SLUG\", E-Mail \"$EMAIL\", das eben vergebene Passwort."
}

accounts_anzeigen() {
  mandant_waehlen "n" || return 1
  echo
  psql_admin -v slug="$SLUG" <<'SQL'
SELECT b.email, b.name, b.rolle, b.aktiv, b.totp_aktiviert AS zwei_fa
FROM benutzer b JOIN mandant m ON m.id = b.mandant_id
WHERE m.slug = :'slug'
ORDER BY b.name;
SQL
}

# Fuellt BENUTZER_ID und BENUTZER_EMAIL -- Auswahl per Nummer aus der
# Mitarbeiterliste des zuvor per mandant_waehlen gewaehlten Mandanten.
benutzer_waehlen() {
  local zeilen
  zeilen=$(psql_admin -tAq -F'|' -v slug="$SLUG" <<'SQL'
SELECT b.id, b.email, b.name, b.rolle
FROM benutzer b JOIN mandant m ON m.id = b.mandant_id
WHERE m.slug = :'slug'
ORDER BY b.name;
SQL
  )
  if [ -z "$zeilen" ]; then
    echo "Fehler: Mandant \"$SLUG\" hat keine Mitarbeitenden." >&2
    return 1
  fi

  local ids=() anzeige=()
  while IFS='|' read -r id email name rolle; do
    ids+=("$id")
    anzeige+=("$name <$email> ($rolle)")
  done <<< "$zeilen"

  echo "Mitarbeitende bei \"$SLUG\":"
  PS3="Nummer eingeben: "
  local ausgewaehlt
  select ausgewaehlt in "${anzeige[@]}"; do
    if [ -n "$ausgewaehlt" ]; then
      BENUTZER_ID="${ids[$((REPLY - 1))]}"
      BENUTZER_EMAIL="$ausgewaehlt"
      break
    fi
    echo "Ungueltige Nummer, nochmal."
  done
}

account_bearbeiten() {
  mandant_waehlen "n" || return 1
  echo
  benutzer_waehlen || return 1

  echo
  echo "Was moechtest du fuer $BENUTZER_EMAIL aendern?"
  PS3="Nummer eingeben: "
  local AUSWAHL
  select AUSWAHL in "Name" "E-Mail" "Rolle" "Aktiv/Inaktiv umschalten" "Passwort zuruecksetzen" "2FA zuruecksetzen (Notfall)" "Abbrechen"; do
    [ -n "$AUSWAHL" ] && break
  done

  case "$AUSWAHL" in
    "Name")
      read -rp "Neuer Anzeigename: " NEUER_NAME
      psql_admin -v ON_ERROR_STOP=1 -v id="$BENUTZER_ID" -v name="$NEUER_NAME" <<'SQL'
UPDATE benutzer SET name = :'name' WHERE id = :'id';
SQL
      echo "Name geaendert."
      ;;
    "E-Mail")
      read -rp "Neue E-Mail-Adresse: " NEUE_EMAIL
      if ! psql_admin -v ON_ERROR_STOP=1 -v id="$BENUTZER_ID" -v email="$NEUE_EMAIL" <<'SQL'
UPDATE benutzer SET email = :'email' WHERE id = :'id';
SQL
      then
        echo "Fehler: E-Mail konnte nicht geaendert werden (bei diesem Mandanten evtl. schon vergeben)." >&2
        return 1
      fi
      echo "E-Mail geaendert."
      ;;
    "Rolle")
      echo "Neue Rolle waehlen:"
      PS3="Nummer eingeben: "
      local NEUE_ROLLE
      select NEUE_ROLLE in bereichsleitung einrichtungsleitung betreuer; do
        [ -n "$NEUE_ROLLE" ] && break
      done
      psql_admin -v ON_ERROR_STOP=1 -v id="$BENUTZER_ID" -v rolle="$NEUE_ROLLE" <<'SQL'
UPDATE benutzer SET rolle = :'rolle'::benutzer_rolle WHERE id = :'id';
SQL
      echo "Rolle geaendert zu \"$NEUE_ROLLE\"."
      ;;
    "Aktiv/Inaktiv umschalten")
      local neuer_stand
      neuer_stand=$(psql_admin -tAq -v ON_ERROR_STOP=1 -v id="$BENUTZER_ID" <<'SQL'
UPDATE benutzer SET aktiv = NOT aktiv WHERE id = :'id' RETURNING aktiv;
SQL
      )
      echo "Neuer Status: $([ "$neuer_stand" = "t" ] && echo aktiv || echo inaktiv)."
      ;;
    "Passwort zuruecksetzen")
      passwort_abfragen
      local hash
      hash=$(hash_erzeugen "$PW1")
      unset PW1
      psql_admin -v ON_ERROR_STOP=1 -v id="$BENUTZER_ID" -v hash="$hash" <<'SQL'
UPDATE benutzer SET passwort_hash = :'hash' WHERE id = :'id';
SQL
      echo "Passwort zurueckgesetzt."
      ;;
    "2FA zuruecksetzen (Notfall)")
      read -rp "Wirklich 2FA fuer $BENUTZER_EMAIL deaktivieren? (j/N) " BESTAETIGT
      if [[ "$BESTAETIGT" =~ ^[jJ]$ ]]; then
        psql_admin -v ON_ERROR_STOP=1 -v id="$BENUTZER_ID" <<'SQL'
UPDATE benutzer SET totp_secret = NULL, totp_aktiviert = false WHERE id = :'id';
SQL
        echo "2FA deaktiviert -- die Person kann sich jetzt wieder ohne Code anmelden und muss 2FA bei Bedarf neu einrichten."
      else
        echo "Abgebrochen."
      fi
      ;;
    "Abbrechen")
      echo "Abgebrochen."
      ;;
  esac
}

echo "Zimmerakte -- Mitarbeiter-Verwaltung"
PS3="Nummer eingeben: "
select HAUPTAUSWAHL in "Neuen Account anlegen" "Account bearbeiten" "Accounts anzeigen" "Beenden"; do
  case "$HAUPTAUSWAHL" in
    "Neuen Account anlegen")
      neuen_account_anlegen
      break
      ;;
    "Account bearbeiten")
      account_bearbeiten
      break
      ;;
    "Accounts anzeigen")
      accounts_anzeigen
      break
      ;;
    "Beenden")
      exit 0
      ;;
    *)
      echo "Ungueltige Nummer, nochmal."
      ;;
  esac
done
