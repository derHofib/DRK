# Zimmerakte

Mandantenfähiges Verwaltungswerkzeug für Betreutes Wohnen — Klienten,
Zimmerbelegung, Kassenbuch (inkl. HZL-Wochenauszahlung mit
Unterschriftsbestätigung), Kostenübernahmen.

Der vollständige Bauplan (Datenmodell-Philosophie, Mandantenmodell,
Rechtliches, Phasenplan mit Abnahmekriterien) ist als Artifact dokumentiert;
frag im laufenden Chat danach, falls der Link nicht mehr griffbereit ist.

## Stand: Phase 1 (Standorte, Zimmer, Klienten, Belegung)

Umgesetzt und **gegen eine echte PostgreSQL-Instanz getestet**:

**Phase 0 — Fundament**
- Monorepo (pnpm-Workspaces): `apps/api` (NestJS), `apps/web` (React/Vite),
  `packages/shared` (gemeinsame Typen)
- Schema für `mandant` und `benutzer` inkl. Row-Level-Security, als reine
  SQL-Migrationen (`apps/api/migrations/`)
- Eine schwache Datenbankrolle (`zimmerakte_app`, kein BYPASSRLS) für den
  laufenden Betrieb — die Migrations-Rolle wird nur für Migrationen benutzt,
  nie zur Laufzeit
- Tenant-Kontext pro Request (`SET LOCAL app.mandant_id` etc. innerhalb
  einer Transaktion, aus dem JWT befüllt)
- Minimaler Login (E-Mail + Passwort, JWT) — **ohne 2FA-Erzwingung**, siehe
  unten
- Der Mandantentrennungs-Test: legt zwei Mandanten mit je einem Benutzer an
  und beweist über den echten HTTP-Pfad (Login → Token → Abfrage), dass
  niemals Zeilen des anderen Mandanten sichtbar werden

**Phase 1 — Standorte, Zimmer, Klienten, Belegung**
- Schema für `standort`, `zimmer` (kein Statusfeld), `klient`, `belegung`
  und `benutzer_standort` (optionale Standort-Einschränkung je Benutzer)
- Zwei Exclusion-Constraints auf `belegung`: ein Zimmer kann nicht doppelt
  belegt werden, eine Person nicht gleichzeitig in zwei Zimmern — beide von
  der Datenbank erzwungen, nicht im Anwendungscode
- `GET /zimmer` leitet den Status ausschließlich per `LEFT JOIN` auf offene
  Belegungen ab; kein gespeichertes Statusfeld existiert
- `GET /zimmer/:id/belegungsverlauf` liefert frühere Bewohner:innen nur mit
  Initialen, außer für die Rollen `leitung`/`verwaltung` — Anonymisierung
  passiert beim Lesen, gespeichert wird immer der volle Name
- `POST /belegungen` übersetzt eine verletzte Exclusion-Constraint
  (SQLSTATE `23P01`) in ein `409 Conflict`
- Web-Oberfläche: Zimmerübersicht (gruppiert nach Standort, mit
  Belegungsverlauf), Klientenliste mit Anlegeformular
- Zwei e2e-Testsuiten (9 Tests), beide mit Gegenprobe verifiziert: RLS bzw.
  die jeweilige Exclusion-Constraint testweise entfernt, Test wird rot,
  wieder hergestellt, Test wird grün — siehe Commit-Historie

Noch nicht angefasst: Kassenbuch, HZL-Wochenauszahlung mit
Unterschriftsbestätigung, Kostenübernahmen, Rechnungen, Dokumente, mobile
Ansicht, 2FA-Erzwingung. Das sind die nächsten Phasen.

## Was hier bewusst fehlt

- **2FA-Erzwingung.** Das Feld `benutzer.totp_secret` existiert, der
  Anmelde-Flow prüft es aber noch nicht ab. Vor Produktivbetrieb
  nachzuziehen (siehe `auth.service.ts`, TODO-Kommentar an der Stelle).
- **fieldvibes echtes Design.** `fieldvibe.de` war aus dieser
  Entwicklungsumgebung nicht erreichbar. `apps/web/src/styles/tokens.css`
  enthält ein neutrales Platzhaltersystem — austauschbar, ohne dass
  irgendwo sonst im Code eine Farbe oder Schriftart fest verdrahtet ist.
  Sobald echte Werte vorliegen: nur diese eine Datei ersetzen.
- **Produktions-Deployment.** Kein Dockerfile für API/Web, kein CI. Folgt,
  sobald es etwas Sinnvolles zu deployen gibt.

## Lokale Entwicklung

Voraussetzungen: Node ≥ 20, pnpm, eine PostgreSQL-16-Instanz (per Docker
oder lokal installiert).

```bash
cp .env.example .env
# .env bei Bedarf anpassen (Zugangsdaten, JWT_SECRET)

# Datenbank per Docker:
docker compose up -d

pnpm install
pnpm migrate          # wendet apps/api/migrations/*.sql an
pnpm dev:api          # NestJS auf Port 3000
pnpm dev:web          # Vite auf Port 5173, proxyt /api -> Port 3000
```

Ohne Docker (z. B. eine bereits laufende lokale PostgreSQL): Rolle
`zimmerakte_admin` (Superuser, für Migrationen) und Datenbank `zimmerakte`
manuell anlegen, dann `MIGRATIONS_DATABASE_URL` / `APP_DATABASE_URL` in
`.env` entsprechend setzen. Die Migration `0002_app_role.sql` legt die
eingeschränkte `zimmerakte_app`-Rolle danach selbst an.

### Einen ersten Mandanten anlegen

Es gibt noch keine Weboberfläche fürs Onboarding (kommt mit Phase 5, siehe
Bauplan). Für die lokale Entwicklung von Hand:

```sql
INSERT INTO mandant (name, slug) VALUES ('Mein Träger', 'mein-traeger');

-- Passwort-Hash erzeugen: node -e "console.log(require('bcryptjs').hashSync('DEIN_PASSWORT', 10))"
INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
SELECT id, 'du@beispiel.de', 'Dein Name', '<bcrypt-hash>', 'leitung'
FROM mandant WHERE slug = 'mein-traeger';
```

Login danach mit `mandantSlug: "mein-traeger"`.

### Tests

```bash
pnpm test:api          # alle API-Tests
pnpm test:mandanten    # nur der Mandantentrennungs-Test
```

Beide Testsuiten (`mandanten-trennung.e2e-spec.ts`, `belegung.e2e-spec.ts`)
brauchen eine erreichbare, migrierte Datenbank (`MIGRATIONS_DATABASE_URL`
und `APP_DATABASE_URL` gesetzt) — kein Mock, weder RLS noch
Exclusion-Constraints lassen sich sinnvoll mocken.

## Architekturentscheidungen, die man beim Weiterbauen kennen sollte

- **Zustände werden nie gespeichert, nur abgeleitet.** Kein
  `zimmer.status`-Feld existiert — der Belegungsstatus folgt per `LEFT
  JOIN` aus der `belegung`-Tabelle (siehe `zimmer.service.ts`). Siehe
  Bauplan, Punkt 03. Dasselbe Prinzip gilt für alles, was noch kommt:
  Stundensaldo, Kassenbuch-Kontostand — Bewegungstabelle, nie ein Feld.
- **Jede neue fachliche Tabelle braucht eine `mandant_id`-Spalte und eine
  RLS-Policy nach dem Muster in `migrations/0003_mandant.sql` /
  `0004_benutzer.sql`.** Kein `WHERE mandant_id = ...` im Anwendungscode als
  Ersatz — das ist genau der Fehler, den RLS verhindern soll.
- **Zeiträume, die sich nicht überlappen dürfen, gehören als
  Exclusion-Constraint in die Datenbank**, nicht als Prüfung im
  Service-Layer (siehe `migrations/0010_belegung.sql`) — sonst ist es eine
  Race Condition zwischen zwei gleichzeitigen Anfragen.
- **Der einzige Ort, der mit der Datenbank spricht, ist `DatabaseService`.**
  `withTenant()` für alles Normale, `withoutTenant()` ausschließlich für den
  Login-Pfad vor dem Kennen des Mandanten (siehe Kommentar dort).
- **Anonymisierung passiert beim Lesen, nie beim Schreiben.** Gespeichert
  wird immer der volle Name; welche Rolle wie viel davon zu sehen bekommt,
  entscheidet der Service (siehe `ROLLEN_MIT_VOLLEM_VERLAUF` in
  `zimmer.service.ts`).
- **`pg` liefert `date`-Spalten sonst als JS-`Date`-Objekt zurück.** Der
  globale Type-Parser in `database.service.ts` (OID 1082) reicht sie
  stattdessen als reinen `YYYY-MM-DD`-String durch — ohne das kippt ein
  Einzugsdatum je nach Server-Zeitzone auf den falschen Tag, sobald es über
  JSON läuft.
