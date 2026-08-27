# Zimmerakte auf einem Server installieren

Diese Anleitung beschreibt die Docker-basierte Installation des kompletten
Stacks (PostgreSQL + API + Web) auf einem eigenen Server, mit
`docker-compose.prod.yml` aus der Repo-Wurzel. Sie richtet sich an jemanden,
der einen Linux-Server mit SSH-Zugriff hat, aber nicht zwingend
Docker-Vorerfahrung.

Kein Schritt hier wurde in dieser Entwicklungsumgebung gegen einen echten
Server getestet (kein Docker-Daemon verfügbar, siehe README.md). Geprüft ist
der zugrunde liegende Mechanismus aber sehr wohl -- über eine echte
GitHub-Actions-CI, die beide Images baut und tatsächlich gegeneinander
laufen lässt (`.github/workflows/ci.yml`, Job `docker-build`). Diese
Anleitung überträgt genau das auf einen Server.

## 1. Voraussetzungen

- Ein Linux-Server (z.B. Ubuntu 22.04/24.04) mit mindestens 2 GB RAM.
- Docker Engine + Docker Compose Plugin. Prüfen mit:
  ```bash
  docker --version
  docker compose version
  ```
  Falls nicht vorhanden, offizielle Anleitung: https://docs.docker.com/engine/install/
- Ein SSH-Zugang mit einem Benutzer, der `docker`-Befehle ausführen darf
  (Mitglied der Gruppe `docker`, oder `sudo`).
- Optional, aber für einen echten Betrieb empfohlen: eine Domain, die auf
  die Server-IP zeigt, für HTTPS über einen Reverse Proxy (Abschnitt 6).

## 2. Repository auf den Server holen

```bash
git clone https://github.com/derHofib/DRK.git zimmerakte
cd zimmerakte
git checkout claude/zimmer-verwalter-modul-omh2tu   # oder der Branch/Tag, den ihr betreiben wollt
```

## 3. Secrets konfigurieren (`.env.prod`)

Der Produktions-Stack liest seine Geheimnisse aus einer `.env.prod`-Datei,
die **nicht** im Repo liegt (siehe `.gitignore`). Als Vorlage:

```bash
cp .env.example .env.prod
```

Dann `.env.prod` öffnen und diese vier Werte auf echte, zufällige Werte
setzen -- die Dev-Platzhalter (`dev_only_change_me*`) dürfen in keiner
echten Umgebung stehen bleiben:

| Variable | Bedeutung | Erzeugen mit |
|---|---|---|
| `POSTGRES_PASSWORD` | Passwort des Postgres-Superusers `zimmerakte_admin` | `openssl rand -hex 24` |
| `APP_DB_PASSWORD` | Passwort der eingeschränkten App-Rolle `zimmerakte_app` (die RLS tatsächlich durchsetzt) | `openssl rand -hex 24` |
| `JWT_SECRET` | Signiert die Login-Tokens | `openssl rand -base64 32` |
| `TOTP_ENCRYPTION_KEY` | AES-256-Schlüssel (32 Bytes, base64) zum Verschlüsseln der 2FA-Secrets in der Datenbank | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

Wichtig: `POSTGRES_PASSWORD` und `APP_DB_PASSWORD` landen unverändert in
einer `postgresql://user:passwort@host/db`-Verbindungs-URL
(`docker-compose.prod.yml`) -- **unbedingt `-hex`, nicht `-base64`**
verwenden. Ein `/` oder `+` aus Base64 macht die URL ungültig und die
`api` kann sich dann gar nicht mehr verbinden (`TypeError: Invalid URL`,
bereits einmal live aufgetreten). `JWT_SECRET` und `TOTP_ENCRYPTION_KEY`
werden nirgends in eine URL eingebettet, dort ist Base64 unproblematisch.

Dazu noch ein fünfter Wert, kein Geheimnis, aber Pflicht für den
`caddy`-Dienst (siehe Abschnitt 7):

| Variable | Bedeutung |
|---|---|
| `ACME_EMAIL` | Kontaktadresse, die Let's Encrypt bei Problemen mit einem Zertifikat benachrichtigt |

`.env.prod` sollte danach z.B. so aussehen (Werte natürlich durch eure
eigenen ersetzen):

```
POSTGRES_PASSWORD=<zufälliger Wert>
APP_DB_PASSWORD=<zufälliger Wert>
JWT_SECRET=<zufälliger Wert>
TOTP_ENCRYPTION_KEY=<zufälliger Wert, 32 Bytes base64>
ACME_EMAIL=admin@hecaso.de
```

Wichtig: `APP_DB_PASSWORD` ist an dieser Stelle erstmal nur der Wert, den
ihr *später* setzen werdet (Schritt 5) -- die Migration legt die Rolle
`zimmerakte_app` beim ersten Start mit einem Dev-Default-Passwort an
(`migrations/0002_app_role.sql`) und kann selbst keine Umgebungsvariable
lesen. Behaltet den Wert also griffbereit für Schritt 5.

Rechte auf die Datei einschränken, da dort echte Secrets drinstehen:

```bash
chmod 600 .env.prod
```

## 4. Stack starten

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Das baut beide Images (`apps/api/Dockerfile`, `apps/web/Dockerfile`) lokal
auf dem Server und startet fünf Container:

- `db` -- PostgreSQL 16, Daten liegen im Docker-Volume `zimmerakte_prod_db_data`
- `migrate` -- läuft einmalig, wendet alle Migrationen an, beendet sich dann
- `api` -- die NestJS-API, startet erst nachdem `migrate` erfolgreich durchgelaufen ist
- `web` -- nginx, liefert die gebaute Web-App aus und leitet `/api/*` intern an `api` weiter
- `caddy` -- terminiert TLS für `app.hecaso.de`/`office.hecaso.de` und reicht an `web` weiter (Details in Abschnitt 7)

Fortschritt verfolgen:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

`migrate` sollte in den Logs `N Migration(en) angewendet.` ausgeben und mit
Exit-Code 0 enden, danach startet `api`.

## 5. App-Rollen-Passwort setzen (nur einmalig, direkt nach dem ersten Start)

Die Migration legt die Datenbankrolle `zimmerakte_app` mit einem
Dev-Default-Passwort an (`dev_only_change_me_too`) und kann kein Passwort
aus der Umgebung übernehmen. Direkt nach dem ersten erfolgreichen Start
muss das Passwort einmalig manuell auf den echten Wert aus `.env.prod`
(`APP_DB_PASSWORD`) gesetzt werden:

```bash
docker compose -f docker-compose.prod.yml exec db \
  psql -U zimmerakte_admin -d zimmerakte -c \
  "ALTER ROLE zimmerakte_app WITH PASSWORD '<euer APP_DB_PASSWORD-Wert>';"
```

Ohne diesen Schritt kann sich die API nicht einloggen (`api`-Container
läuft dann in einer Restart-Schleife mit Authentifizierungsfehlern in den
Logs). Diesen Schritt nach jedem kompletten Neuaufsetzen der Datenbank
(z.B. nach Löschen des `zimmerakte_prod_db_data`-Volumes) wiederholen.

## 5.1 Ersten Account anlegen

Es gibt bewusst keinen öffentlichen Registrierungs-Endpunkt (siehe
README, Abschnitt "Architekturentscheidungen") -- der allererste Account
(Rolle `leitung`) für einen neuen Mandanten muss einmalig über das
Terminal angelegt werden:

```bash
./scripts/account-anlegen.sh
```

Fragt interaktiv nach Mandant (neu oder vorhanden), E-Mail, Anzeigename,
Rolle und Passwort (per verdeckter Eingabe, landet nirgends im
Kommandozeilenverlauf). Für **weitere** Accounts eines Mandanten, der
schon eine `leitung` hat, ist stattdessen die "Mitarbeitende"-Seite in
der App der richtige Weg -- das Script ist nur für die Ersteinrichtung
bzw. einen Notfallzugang ohne funktionierenden Login gedacht.

## 6. Prüfen, dass alles läuft

```bash
docker compose -f docker-compose.prod.yml ps
```

Alle fünf Container sollten `running` bzw. (bei `migrate`) `exited (0)`
zeigen. Direkter Funktionstest ohne Domain/TLS (funktioniert schon vor
Schritt 7):

```bash
curl -i http://localhost:8080/          # sollte 200 liefern (Web-App)
curl -i http://localhost:3000/mandant/me  # sollte 401 liefern (API läuft, verlangt aber Login)
```

Im Browser: `http://<Server-IP>:8080` aufrufen.

## 7. Domain + HTTPS: app.hecaso.de und office.hecaso.de

Der Stack enthält bereits einen `caddy`-Dienst, der TLS für beide Domains
automatisch über Let's Encrypt bezieht -- dafür sind nur zwei Dinge nötig,
beide **außerhalb** von Docker.

### 7.1 DNS bei IONOS setzen

Im IONOS-Kundencenter unter **Domains & SSL** → `hecaso.de` → **DNS** je
einen A-Record anlegen:

| Hostname | Typ | Wert |
|---|---|---|
| `app` | A | `<IP dieses Servers>` |
| `office` | A | `<IP dieses Servers>` |

Beide zeigen bewusst auf dieselbe IP -- es ist (noch) derselbe Server und
dieselbe Anwendung, siehe Hinweis in der `Caddyfile`. Propagation prüfen:

```bash
nslookup app.hecaso.de
nslookup office.hecaso.de
```

Beide müssen die Server-IP zurückgeben, bevor Schritt 7.2 funktionieren
kann -- Let's Encrypt prüft die Kontrolle über die Domain per HTTP-01, das
scheitert, solange DNS noch auf etwas anderes (oder gar nichts) zeigt.

### 7.2 Stack (neu) starten

`ACME_EMAIL` muss in `.env.prod` gesetzt sein (siehe Abschnitt 3), dann:

```bash
./scripts/aktualisieren.sh
```

Das Script zieht den neuesten Stand aus git und startet den kompletten
Stack inklusive `caddy` neu (dasselbe wie
`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`,
nur mit ein paar Komfort-Ausgaben davor/danach). Zertifikate erscheinen
in den Logs, sobald sie ausgestellt sind:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

Danach sind `https://app.hecaso.de` und `https://office.hecaso.de` beide
erreichbar. Ports 80/443 müssen dafür am Server (bzw. in der
IONOS-Firewall/dem Sicherheitsgruppen-Regelwerk des VPS) offen sein; Port
8080 bleibt zusätzlich für den direkten Test aus Schritt 6 erreichbar,
Port 3000 kann weiterhin per Firewall gesperrt bleiben, wenn kein direkter
API-Zugriff von außen gewünscht ist.

### Andere Domain oder ein zusätzlicher Reverse Proxy

Wer eine andere Domain als `hecaso.de` einträgt, passt einfach die
`Caddyfile` in der Repo-Wurzel an (zwei Hostnamen im Site-Block ersetzen)
und committet die Änderung, bevor `./scripts/aktualisieren.sh` läuft.
Wird stattdessen schon ein anderer Reverse Proxy betrieben (nginx +
certbot, Traefik, ein vorgelagerter Load Balancer), lässt sich der
`caddy`-Dienst aus `docker-compose.prod.yml` streichen und stattdessen an
`localhost:8080` weiterleiten -- das Prinzip bleibt: TLS terminieren, dann
an Port 8080 reichen.

## 8. Updates einspielen

```bash
cd zimmerakte
./scripts/aktualisieren.sh
```

Entspricht `git pull` + `docker compose -f docker-compose.prod.yml
--env-file .env.prod up -d --build`, nur mit Statusausgabe danach. Neue
Migrationen laufen dabei automatisch über den `migrate`-Dienst, bevor
`api` neu gestartet wird (`depends_on: migrate: condition:
service_completed_successfully`).

## 9. Backups

Alle Daten liegen im Docker-Volume `zimmerakte_prod_db_data`. Ein einfacher
`pg_dump`-Snapshot:

```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U zimmerakte_admin -d zimmerakte > backup-$(date +%F).sql
```

Diese Datei enthält alle Klienten-, Kassenbuch- und Rechnungsdaten -- wie
jedes andere Backup mit personenbezogenen Daten entsprechend geschützt
lagern (verschlüsselt, Zugriff eingeschränkt).

Rücksichern in eine neue, leere Instanz:

```bash
cat backup-2026-08-24.sql | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U zimmerakte_admin -d zimmerakte
```

## 10. Bekannte Fallstricke (Troubleshooting)

- **`api` startet nicht / Authentifizierungsfehler in den Logs**: Schritt 5
  (`ALTER ROLE`) wurde vergessen oder das dort gesetzte Passwort stimmt
  nicht mit `APP_DB_PASSWORD` in `.env.prod` überein.
- **`migrate` schlägt fehl**: Logs prüfen mit
  `docker compose -f docker-compose.prod.yml logs migrate` -- meist ein
  Problem mit `POSTGRES_PASSWORD`/Erreichbarkeit von `db`.
- **`.env.prod` versehentlich committet**: sofort aus der Git-Historie
  entfernen und alle vier Secrets neu erzeugen (rotieren), sie gelten ab
  dem Moment des Commits als kompromittiert.
- **Nach `docker compose down -v` (Volume gelöscht)**: das ist ein
  kompletter Neuanfang, Schritt 5 muss erneut ausgeführt werden.
- **`caddy` stellt kein Zertifikat aus** (`https://app.hecaso.de` bleibt
  unerreichbar): fast immer DNS -- mit `nslookup app.hecaso.de` bzw.
  `nslookup office.hecaso.de` prüfen, ob beide wirklich auf die Server-IP
  zeigen (Abschnitt 7.1), und `docker compose -f docker-compose.prod.yml
  logs caddy` auf die genaue Fehlermeldung. Zweithäufigste Ursache: Port 80
  oder 443 ist am Server/in der IONOS-Firewall nicht offen -- Let's
  Encrypts HTTP-01-Challenge braucht Port 80 von außen erreichbar.

## 11. Bekannte, bewusste Lücken

Aus README.md, Abschnitt "Was hier bewusst fehlt" -- gilt unverändert auch
für den Server-Betrieb:

- Keine automatisierte Secret-Rotation für die `zimmerakte_app`-Rolle
  (Schritt 5 bleibt manuell).
- Offline-Unterstützung der PWA ist bewusst nur App-Shell (HTML/CSS/JS),
  keine gecachten Geschäftsdaten -- offline sieht man also keine
  veralteten Klientendaten, sondern nur die leere App-Shell.
- App-Icons sind Platzhalter-Grafiken, kein echter Design-Durchgang.
