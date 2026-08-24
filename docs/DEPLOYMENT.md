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
| `POSTGRES_PASSWORD` | Passwort des Postgres-Superusers `zimmerakte_admin` | `openssl rand -base64 24` |
| `APP_DB_PASSWORD` | Passwort der eingeschränkten App-Rolle `zimmerakte_app` (die RLS tatsächlich durchsetzt) | `openssl rand -base64 24` |
| `JWT_SECRET` | Signiert die Login-Tokens | `openssl rand -base64 32` |
| `TOTP_ENCRYPTION_KEY` | AES-256-Schlüssel (32 Bytes, base64) zum Verschlüsseln der 2FA-Secrets in der Datenbank | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

`.env.prod` sollte danach z.B. so aussehen (Werte natürlich durch eure
eigenen ersetzen):

```
POSTGRES_PASSWORD=<zufälliger Wert>
APP_DB_PASSWORD=<zufälliger Wert>
JWT_SECRET=<zufälliger Wert>
TOTP_ENCRYPTION_KEY=<zufälliger Wert, 32 Bytes base64>
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
auf dem Server und startet vier Container:

- `db` -- PostgreSQL 16, Daten liegen im Docker-Volume `zimmerakte_prod_db_data`
- `migrate` -- läuft einmalig, wendet alle Migrationen an, beendet sich dann
- `api` -- die NestJS-API, startet erst nachdem `migrate` erfolgreich durchgelaufen ist
- `web` -- nginx, liefert die gebaute Web-App aus und leitet `/api/*` intern an `api` weiter

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

## 6. Prüfen, dass alles läuft

```bash
docker compose -f docker-compose.prod.yml ps
```

Alle vier Container sollten `running` bzw. (bei `migrate`) `exited (0)`
zeigen. Direkter Funktionstest ohne Reverse Proxy:

```bash
curl -i http://localhost:8080/          # sollte 200 liefern (Web-App)
curl -i http://localhost:3000/mandant/me  # sollte 401 liefern (API läuft, verlangt aber Login)
```

Im Browser: `http://<Server-IP>:8080` aufrufen.

## 7. Reverse Proxy + HTTPS (für den echten Betrieb empfohlen)

`docker-compose.prod.yml` exponiert `web` auf Port 8080 und `api` auf Port
3000 direkt am Host, ohne TLS. Für einen öffentlich erreichbaren Server
sollte davor ein Reverse Proxy mit HTTPS stehen; die App selbst braucht
dafür keine Anpassung, da das Frontend die API ausschließlich relativ über
`/api/...` anspricht (von `web`/nginx intern an `api` weitergereicht) --
nach außen muss also nur Port 8080 (bzw. der Reverse Proxy davor)
erreichbar sein. Port 3000 kann serverseitig per Firewall gesperrt bleiben,
wenn kein direkter API-Zugriff von außen gewünscht ist.

Einfachste Variante mit [Caddy](https://caddyserver.com/) (automatisches
Let's-Encrypt-Zertifikat, ein Zweizeiler):

```bash
# Caddy auf dem Server installieren, dann /etc/caddy/Caddyfile:
zimmerakte.eure-domain.de {
    reverse_proxy localhost:8080
}
# danach:
sudo systemctl reload caddy
```

Alternativ nginx + certbot oder Traefik, falls das schon im Einsatz ist --
das Prinzip ist immer dasselbe: TLS terminieren, dann an `localhost:8080`
weiterreichen.

## 8. Updates einspielen

```bash
cd zimmerakte
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Neue Migrationen laufen dabei automatisch über den `migrate`-Dienst, bevor
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

## 11. Bekannte, bewusste Lücken

Aus README.md, Abschnitt "Was hier bewusst fehlt" -- gilt unverändert auch
für den Server-Betrieb:

- Keine automatisierte Secret-Rotation für die `zimmerakte_app`-Rolle
  (Schritt 5 bleibt manuell).
- Offline-Unterstützung der PWA ist bewusst nur App-Shell (HTML/CSS/JS),
  keine gecachten Geschäftsdaten -- offline sieht man also keine
  veralteten Klientendaten, sondern nur die leere App-Shell.
- App-Icons sind Platzhalter-Grafiken, kein echter Design-Durchgang.
