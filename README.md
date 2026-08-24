# Zimmerakte

Mandantenfähiges Verwaltungswerkzeug für Betreutes Wohnen — Klienten,
Zimmerbelegung, Kassenbuch (inkl. HZL-Wochenauszahlung mit
Unterschriftsbestätigung), Kostenübernahmen.

Der vollständige Bauplan (Datenmodell-Philosophie, Mandantenmodell,
Rechtliches, Phasenplan mit Abnahmekriterien) ist als Artifact dokumentiert;
frag im laufenden Chat danach, falls der Link nicht mehr griffbereit ist.

## Stand: Phase 2 (Kassenbuch, HZL-Wochenübersicht, Unterschriftsbestätigung)

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

**Phase 2 — Kassenbuch, HZL-Wochenübersicht, Unterschriftsbestätigung**
- Schema für `kassenbuchung` (Beträge als `betrag_cent`, nie Fließkomma) und
  `unterschrift` (Bild als `bytea` + SHA-256-Hash, 1:1 an eine Buchung
  gebunden)
- Beide Tabellen sind **auf Datenbankebene** unveränderlich (Append-only):
  `REVOKE UPDATE, DELETE ... FROM zimmerakte_app` nach dem Anlegen der
  Tabelle. Bei `kassenbuchung` gibt es eine einzige, spaltenscharfe
  Ausnahme (`GRANT UPDATE (storniert, storno_grund, storniert_von,
  storniert_am)`) — Betrag, Datum, Klient und Verwendungszweck lassen sich
  von der App-Rolle nie ändern, nur stornieren
- Ein partieller Unique-Index (`hzl_einmal_je_woche`, nur `WHERE typ='hzl'
  AND NOT storniert`) verhindert eine zweite HZL-Auszahlung für
  Klient+Kalenderwoche — ein Storno gibt die Woche wieder frei, die
  ursprüngliche (stornierte) Buchung bleibt als Zeile erhalten
- Die Unterschriftspflicht bei Auszahlungen (`betrag_cent < 0`) ist die
  einzige Regel dieser Phase, die im Service-Layer statt in der Datenbank
  sitzt — bewusst, weil sie eine Mehrzeilen-Transaktions-Invariante ist
  (Buchung + Unterschrift zusammen oder gar nicht), siehe Kommentar in
  `kassenbuchung.service.ts`
- `GET /kassenbuchungen/wochenuebersicht?jahr=&kw=` liefert für alle
  Klient:innen mit `hzl_rhythmus = 'woechentlich'`, ob für die gewählte
  Kalenderwoche bereits bezahlt wurde
- Web-Oberfläche: HZL-Wochenübersicht (Jahr/KW wählbar, "Jetzt auszahlen"
  pro offenem Klienten), Kassenbuch-Liste mit Storno, Unterschriften-Ansicht
  und einem Canvas-Unterschriftenfeld im Buchungsformular
- Dritte e2e-Testsuite (8 Tests), ebenfalls mit Gegenprobe verifiziert: der
  partielle Unique-Index und die spaltenscharfe Änderungssperre wurden
  testweise entfernt, genau die zwei zugehörigen Tests wurden rot, sonst
  nichts — wiederhergestellt, wieder grün
- Ein echter Bug wurde beim Testen der Weboberfläche im Browser gefunden und
  behoben: `e.currentTarget` wird von React nach einem `await` im
  Submit-Handler auf `null` gesetzt (facebook/react#20544) — betraf sowohl
  das neue Kassenbuch-Formular als auch das bereits bestehende
  Klienten-Anlegeformular aus Phase 1

Noch nicht angefasst: Kostenübernahmen, Rechnungen, Dokumente, mobile
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

Alle drei Testsuiten (`mandanten-trennung.e2e-spec.ts`,
`belegung.e2e-spec.ts`, `kassenbuch.e2e-spec.ts`) brauchen eine erreichbare,
migrierte Datenbank (`MIGRATIONS_DATABASE_URL` und `APP_DATABASE_URL`
gesetzt) — kein Mock, weder RLS noch Exclusion-Constraints noch
spaltenscharfe GRANTs lassen sich sinnvoll mocken.

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
- **Unveränderlichkeit (Append-only) gehört als Datenbankrecht durchgesetzt,
  nicht als Konvention im Service.** `REVOKE UPDATE, DELETE ... FROM
  zimmerakte_app` nach dem Anlegen einer Tabelle (siehe
  `migrations/0011_kassenbuchung.sql`, `0012_unterschrift.sql`); wo eine
  einzelne, eng begrenzte Änderung trotzdem erlaubt sein muss (der
  Storno-Flag), ein spaltenscharfes `GRANT UPDATE (spalte, ...)` statt eines
  vollen Tabellen-GRANTs.
- **Was sich nicht als Constraint auf einer einzelnen Tabelle ausdrücken
  lässt, gehört in den Service — alles andere nicht.** Die
  Unterschriftspflicht bei Auszahlungen ist eine
  Mehrzeilen-Transaktions-Invariante (`kassenbuchung` + `unterschrift`
  zusammen oder gar nicht) und sitzt deshalb in
  `kassenbuchung.service.ts`, während Eindeutigkeit, Überlappung und
  Änderungsschutz konsequent in den Migrationen stehen.
- **`e.currentTarget` in einem async Formular-Handler vor dem ersten
  `await` zwischenspeichern.** React setzt es danach auf `null` zurück
  (facebook/react#20544) — betrifft jeden `onSubmit`-Handler, der nach
  einem await noch `.reset()` o. Ä. auf dem Formularelement aufruft.
