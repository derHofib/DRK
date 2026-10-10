#!/usr/bin/env bash
# Interaktive Mitarbeiter-Verwaltung ueber das Terminal -- fuer den
# allerersten Account eines frischen Mandanten gibt es dafuer keinen
# anderen Weg: es existiert bewusst kein oeffentlicher Registrierungs-
# Endpunkt (siehe auth.controller.ts) und POST /benutzer setzt schon einen
# eingeloggten Account mit dem Recht mitarbeitende.anlegen voraus. Dieser
# allererste Account wird automatisch zum dauerhaften, mandantenweiten
# Vollzugriff-"Entwickler" (Organigramm-Plan, "Entwickler-Accounttyp") --
# er richtet darueber im Organigramm den echten ersten Accounttyp des
# Traegers ein (z.B. "Geschaeftsfuehrung"), vergibt dessen Rechte, und erst
# danach faengt der Traeger an zu arbeiten. Fuer den taeglichen Betrieb
# (weitere Accounts anlegen) ist die "Mitarbeitende"-Seite in der App meist
# der bequemere Weg -- dieses Script deckt zusaetzlich ab, was die
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

# Neuen Mandanten interaktiv anlegen und die globale Variable SLUG damit
# fuellen. Eigene Funktion, weil sowohl mandant_waehlen (Option "Neuen
# Mandanten anlegen") als auch ein direkter Aufruf denselben Ablauf
# brauchen.
mandant_neu_anlegen() {
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
}

# Fuellt die globale Variable SLUG -- per Auswahl aus einer nummerierten
# Liste statt durch Abtippen des Slugs (das war fehleranfaellig). $1 = "j",
# wenn zusaetzlich "Neuen Mandanten anlegen" als Option angeboten werden
# soll (nur beim Anlegen-Flow sinnvoll, nicht beim Bearbeiten/Anzeigen).
mandant_waehlen() {
  local neu_anbieten="${1:-n}"
  local zeilen
  zeilen=$(psql_admin -tAq -F'|' <<'SQL'
SELECT slug, name FROM mandant ORDER BY name;
SQL
  )

  local anzeige=() slugs=()
  if [ "$neu_anbieten" = "j" ]; then
    anzeige+=("Neuen Mandanten anlegen")
    slugs+=("__neu__")
  fi
  if [ -n "$zeilen" ]; then
    while IFS='|' read -r slug name; do
      anzeige+=("$name ($slug)")
      slugs+=("$slug")
    done <<< "$zeilen"
  fi

  if [ "${#anzeige[@]}" -eq 0 ]; then
    echo "Fehler: es gibt noch keine Mandanten." >&2
    return 1
  fi

  echo "Mandant waehlen:"
  PS3="Nummer eingeben: "
  local auswahl
  select auswahl in "${anzeige[@]}"; do
    if [ -n "$auswahl" ]; then
      SLUG="${slugs[$((REPLY - 1))]}"
      break
    fi
    echo "Ungueltige Nummer, nochmal."
  done

  if [ "$SLUG" = "__neu__" ]; then
    mandant_neu_anlegen
  fi
}

neuen_account_anlegen() {
  mandant_waehlen "j" || return 1

  echo
  read -rp "E-Mail-Adresse: " EMAIL
  read -rp "Anzeigename: " NAME

  passwort_abfragen
  local hash
  hash=$(hash_erzeugen "$PW1")
  unset PW1

  local benutzer_id
  benutzer_id=$(psql_admin -tAq \
    -v slug="$SLUG" -v email="$EMAIL" -v name="$NAME" -v hash="$hash" <<'SQL'
WITH m AS (SELECT id FROM mandant WHERE slug = :'slug')
INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
SELECT m.id, :'email', :'name', :'hash' FROM m
RETURNING id;
SQL
  )

  if [ -z "$benutzer_id" ]; then
    echo "Fehler: Account konnte nicht angelegt werden (E-Mail bei diesem Mandanten evtl. schon vergeben)." >&2
    return 1
  fi

  # Der allererste Account eines Mandanten wird automatisch der Entwickler
  # (Organigramm-Plan, "Entwickler-Accounttyp") -- erkennbar daran, dass
  # dieser Mandant noch gar keine aktive Positionsbesetzung hat. Der
  # Entwickler-Accounttyp selbst existiert bereits (Seed-Trigger aus
  # Migration 0048, laeuft beim INSERT INTO mandant) -- hier fehlt nur noch
  # eine Position dafuer plus die Besetzung durch genau diesen Account.
  local anzahl_besetzungen
  anzahl_besetzungen=$(psql_admin -tAq -v slug="$SLUG" <<'SQL'
SELECT count(*)
FROM org_position_besetzung b
JOIN mandant m ON m.id = b.mandant_id
WHERE m.slug = :'slug';
SQL
  )

  if [ "$anzahl_besetzungen" -eq 0 ]; then
    if ! psql_admin -v ON_ERROR_STOP=1 -v slug="$SLUG" -v benutzer_id="$benutzer_id" <<'SQL'
WITH m AS (SELECT id FROM mandant WHERE slug = :'slug'),
     entwickler_typ AS (
       SELECT id FROM account_typ WHERE mandant_id = (SELECT id FROM m) AND ist_vollzugriff LIMIT 1
     ),
     traeger AS (
       SELECT id FROM org_unit WHERE mandant_id = (SELECT id FROM m) AND typ = 'traeger'
     ),
     neue_position AS (
       INSERT INTO org_position (mandant_id, org_unit_id, account_typ_id, titel)
       SELECT m.id, traeger.id, entwickler_typ.id, 'Entwickler'
       FROM m, traeger, entwickler_typ
       RETURNING id
     )
INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id)
SELECT m.id, neue_position.id, :'benutzer_id' FROM m, neue_position;
SQL
    then
      echo "Fehler: Entwickler-Position konnte nicht angelegt werden." >&2
      return 1
    fi
    echo
    echo "Fertig: $EMAIL ist der erste Account bei Mandant \"$SLUG\" -- automatisch als Entwickler eingerichtet (Vollzugriff)."
    echo "Login-Daten: Traeger-Kennung \"$SLUG\", E-Mail \"$EMAIL\", das eben vergebene Passwort."
    echo "Naechster Schritt: als Entwickler anmelden, im Organigramm den echten ersten Accounttyp des Traegers anlegen (z. B. \"Geschäftsführung\"), dessen Rechte vergeben, dann eine Position dafuer besetzen -- danach kann der Traeger normal arbeiten."
  else
    echo
    echo "Fertig: $EMAIL bei Mandant \"$SLUG\" angelegt -- noch OHNE Position, also ohne Rechte."
    echo "Naechster Schritt: eine bestehende Entwickler- oder Geschaeftsfuehrung-Person weist im Organigramm eine Position zu."
  fi
}

accounts_anzeigen() {
  mandant_waehlen "n" || return 1
  echo
  psql_admin -v slug="$SLUG" <<'SQL'
SELECT b.email, b.name,
       COALESCE(string_agg(a.name, ', ' ORDER BY a.name), '(keine Position)') AS accounttyp,
       b.aktiv, b.totp_aktiviert AS zwei_fa
FROM benutzer b
JOIN mandant m ON m.id = b.mandant_id
LEFT JOIN org_position_besetzung pb ON pb.benutzer_id = b.id
       AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
LEFT JOIN org_position p ON p.id = pb.position_id AND p.aktiv
LEFT JOIN account_typ a ON a.id = p.account_typ_id
WHERE m.slug = :'slug'
GROUP BY b.id, b.email, b.name, b.aktiv, b.totp_aktiviert
ORDER BY b.name;
SQL
}

# Fuellt BENUTZER_ID und BENUTZER_EMAIL -- Auswahl per Nummer aus der
# Mitarbeiterliste des zuvor per mandant_waehlen gewaehlten Mandanten.
benutzer_waehlen() {
  local zeilen
  zeilen=$(psql_admin -tAq -F'|' -v slug="$SLUG" <<'SQL'
SELECT b.id, b.email, b.name,
       COALESCE(string_agg(a.name, ', ' ORDER BY a.name), '(keine Position)')
FROM benutzer b
JOIN mandant m ON m.id = b.mandant_id
LEFT JOIN org_position_besetzung pb ON pb.benutzer_id = b.id
       AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
LEFT JOIN org_position p ON p.id = pb.position_id AND p.aktiv
LEFT JOIN account_typ a ON a.id = p.account_typ_id
WHERE m.slug = :'slug'
GROUP BY b.id, b.email, b.name
ORDER BY b.name;
SQL
  )
  if [ -z "$zeilen" ]; then
    echo "Fehler: Mandant \"$SLUG\" hat keine Mitarbeitenden." >&2
    return 1
  fi

  local ids=() anzeige=()
  while IFS='|' read -r id email name accounttyp; do
    ids+=("$id")
    anzeige+=("$name <$email> ($accounttyp)")
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
  select AUSWAHL in "Name" "E-Mail" "Aktiv/Inaktiv umschalten" "Passwort zuruecksetzen" "2FA zuruecksetzen (Notfall)" "Abbrechen"; do
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
