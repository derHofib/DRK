# Zimmerakte

Mandantenfähiges Verwaltungswerkzeug für Betreutes Wohnen — Klienten,
Zimmerbelegung, Kassenbuch (inkl. HZL-Wochenauszahlung mit
Unterschriftsbestätigung), Kostenübernahmen.

Der vollständige Bauplan (Datenmodell-Philosophie, Mandantenmodell,
Rechtliches, Phasenplan mit Abnahmekriterien) ist als Artifact dokumentiert;
frag im laufenden Chat danach, falls der Link nicht mehr griffbereit ist.

## Stand: Phase 4 (2FA-Erzwingung)

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

**Phase 3 — Kostenübernahmen, Rechnungen, Klientenakte als Vollansicht**
- Schema für `kostenuebernahme` (Zeitraum-Zuordnung Klient↔Amt): wie
  `belegung` wird `bis` offen angelegt und genau einmal per Update
  geschlossen (`PATCH /kostenuebernahmen/:id/beenden`), kein Statusfeld.
  Eine Exclusion-Constraint verhindert zwei sich überschneidende Zeiträume
  desselben Klienten — dieselbe Technik wie bei `belegung`, hier auf ein
  fachlich anderes "kann sich nicht überlappen"-Problem angewendet
- Schema für `rechnung` (unveränderlich, append-only wie `kassenbuchung`)
  und `rechnung_statuswechsel`: der Status (`beantragt` → `genehmigt` →
  `ausgezahlt`, oder `beantragt`/`genehmigt` → `abgelehnt`) wird **nie als
  Feld gespeichert**, sondern ist immer die zuletzt eingefügte Zeile in
  `rechnung_statuswechsel` — dasselbe Ableitungsprinzip wie beim
  Zimmerstatus, hier auf einen mehrstufigen Workflow statt auf ein
  Ja/Nein angewendet
- Der Workflow selbst (welche Statuswechsel erlaubt sind, `ausgezahlt` und
  `abgelehnt` sind Endzustände) wird von einem `BEFORE INSERT`-Trigger in
  der Datenbank erzwungen (`rechnung_statuswechsel_pruefen()`), nicht im
  Service — es ist eine Prüfung innerhalb einer einzelnen Tabelle gegen die
  vorherige Zeile derselben `rechnung_id`, damit gehört sie dorthin, nach
  demselben Muster wie der `benutzer_standort`-Trigger aus Phase 0
- `rechnung_dokument` (optionales Beleg-Dokument, PDF oder Bild) folgt
  demselben `bytea`+SHA-256-Hash-Kompromiss wie `unterschrift` aus Phase 2,
  mit derselben offenen Objektspeicher-Frage für den Produktivbetrieb
- Web-Oberfläche: die Klientenliste öffnet jetzt eine volle
  Klientenakten-Ansicht (nicht mehr nur eine Zeile in der Tabelle) mit den
  Reitern Übersicht, Kostenübernahmen, Rechnungen und Kassenbuch (gefiltert
  auf diesen Klienten) — das war die ursprüngliche Anforderung aus der
  allerersten Anfrage ("Ich brauche in der Klientensicht, dass ich das noch
  als volles Fenster anzeigen kann")
- Vierte e2e-Testsuite (14 Tests), mit Gegenprobe verifiziert: die
  Exclusion-Constraint auf `kostenuebernahme`, der
  Statuswechsel-Trigger und die Änderungssperre auf `rechnung` wurden
  einzeln testweise entfernt, genau die davon abhängigen Tests wurden rot
  (6 von 14), alle anderen blieben grün — wiederhergestellt, wieder alle 14
  grün
- Kompletter Klick-Durchlauf im echten Browser verifiziert (Login →
  Klientenakte → Kostenübernahme anlegen/überlappen lassen/beenden →
  Rechnung mit hochgeladenem PDF anlegen → genehmigen → auszahlen → zweite
  Rechnung ablehnen → Dokument abrufen), inklusive Screenshots

**Phase 4 — 2FA-Erzwingung**
- Login wird zweistufig, sobald `benutzer.totp_aktiviert = true` ist:
  `POST /auth/login` liefert dann kein Zugriffstoken mehr direkt, sondern
  ein kurzlebiges (5 Minuten) "pending"-Token; erst `POST /auth/login/totp`
  mit diesem Token plus einem gültigen TOTP-Code liefert das echte
  Zugriffstoken. Ohne aktivierte 2FA bleibt der Login einstufig wie bisher.
- Jedes JWT trägt jetzt ein `typ`-Feld (`"access"` vs. `"totp_pending"`).
  `AuthGuard` lässt nur `"access"` durch — eine explizite Allowlist, damit
  ein pending-Token niemals als vollwertiges Zugriffstoken auf einen
  normalen, geschützten Endpunkt durchgeht.
- Replay-Schutz: jeder erfolgreich verifizierte TOTP-Code merkt sich seinen
  Zeitschritt (`benutzer.totp_letzter_schritt`); ein Code aus einem
  bereits verbrauchten oder früheren Zeitschritt wird beim Login abgelehnt,
  selbst wenn er sonst gültig wäre.
- `benutzer.totp_secret` wird an der Anwendungsschicht mit AES-256-GCM
  verschlüsselt gespeichert (siehe `common/geheimnis.ts`) — das war schon
  in der Phase-0-Migration als Vorgabe kommentiert, jetzt eingelöst. Ein
  DB-Dump allein reicht nicht, um TOTP-Codes fälschen zu können.
- Self-Service-Flow: `POST /auth/totp/einrichten` erzeugt ein neues, noch
  nicht aktives Secret (inkl. QR-Code als Data-URL) für den eingeloggten
  Benutzer selbst — die ID kommt nie aus dem Request-Body, niemand kann
  2FA für ein fremdes Konto einrichten. Aktiv wird es erst nach einem
  bestätigten Code über `POST /auth/totp/aktivieren`, damit ein Tippfehler
  beim Einscannen niemand aussperrt. `POST /auth/totp/deaktivieren`
  verlangt ebenfalls einen gültigen Code.
- Web-Oberfläche: zweistufiges Login-Formular (Passwort → Code, sobald
  angefordert) und ein neuer "Sicherheit"-Tab zum Einrichten/Deaktivieren
  der eigenen 2FA (QR-Code, Secret zur manuellen Eingabe, Bestätigungscode).
- Fünfte e2e-Testsuite (11 Tests), inklusive zweier Gegenproben, die dieses
  Mal keine Datenbank-Policy betreffen, sondern Anwendungscode: die
  `typ`-Prüfung in `AuthGuard` und die Replay-Schutz-Prüfung in
  `totpVerifizieren()` wurden einzeln testweise auskommentiert, genau der
  jeweils zugehörige Test wurde rot, alle anderen blieben grün —
  wiederhergestellt, wieder alle 11 grün.
- Ein echter Bug wurde beim Bauen der Tests gefunden und behoben: TOTP-Codes
  sind deterministisch je 30-Sekunden-Zeitfenster, ein Testlauf schneller
  als 30s erzeugt für zwei aufeinanderfolgende Prüfungen denselben Code —
  der eigene Replay-Schutz hat das (korrekt!) abgelehnt. Betroffene Tests
  warten jetzt real bis zur nächsten Zeitscheibe, statt die Systemzeit zu
  fälschen.
- Ein zweiter, kompletter Klick-Durchlauf im echten Browser verifiziert:
  2FA einrichten (QR-Code + Secret aus der UI gelesen) → aktivieren →
  abmelden → mit Passwort neu anmelden → derselbe (bereits verbrauchte)
  Code wird abgelehnt → nach Warten auf eine neue Zeitscheibe wird ein
  frischer Code akzeptiert → deaktivieren.

Noch nicht angefasst: mobile Ansicht, Produktions-Deployment. Das sind die
nächsten Phasen.

## Was hier bewusst fehlt

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

Alle fünf Testsuiten (`mandanten-trennung.e2e-spec.ts`,
`belegung.e2e-spec.ts`, `kassenbuch.e2e-spec.ts`, `rechnung.e2e-spec.ts`,
`totp.e2e-spec.ts`) brauchen eine erreichbare, migrierte Datenbank
(`MIGRATIONS_DATABASE_URL`, `APP_DATABASE_URL` und `TOTP_ENCRYPTION_KEY`
gesetzt) — kein Mock, weder RLS noch Exclusion-Constraints noch Trigger
noch spaltenscharfe GRANTs lassen sich sinnvoll mocken.
`totp.e2e-spec.ts` braucht wegen zweier echter 30-Sekunden-Wartezeiten
(siehe Phase 4 oben) knapp eine Minute — das ist kein Hänger.

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
- **Ein mehrstufiger Workflow-Status (`rechnung`: beantragt → genehmigt →
  ausgezahlt/abgelehnt) ist eine Prüfung innerhalb einer Tabelle** (die
  neue Statuszeile gegen die vorherige Zeile derselben `rechnung_id`) und
  gehört deshalb als `BEFORE INSERT`-Trigger in die Migration, nicht in
  den Service — anders als die Unterschriftspflicht aus Phase 2, die eine
  Mehrzeilen-Transaktions-Invariante über zwei Tabellen ist. Die
  Faustregel: eine Tabelle betroffen → Trigger/Constraint in der
  Migration; mehrere Tabellen betroffen → Service.
- **Ein Token-Typ-Feld ist eine Allowlist, keine Denylist.** Jedes JWT
  trägt `typ: "access"` oder `typ: "totp_pending"`; `AuthGuard` prüft
  explizit auf `"access"`, statt nur die bekannten "schlechten" Typen
  auszuschließen — ein künftiger dritter Token-Typ (z. B. für
  Passwort-Reset) rutscht so nicht versehentlich als Zugriffstoken durch,
  nur weil niemand daran gedacht hat, ihn auf eine Sperrliste zu setzen.
- **Sicherheitsrelevante Prüfungen im Anwendungscode verdienen dieselbe
  Gegenprobe wie Datenbank-Constraints.** Die `typ`-Prüfung in
  `auth.guard.ts` und der Replay-Schutz in `totpVerifizieren()` wurden
  testweise auskommentiert, nicht nur gedanklich für richtig befunden —
  siehe Commit-Historie zu Phase 4. Ein Test, der nie beobachtet rot war,
  ist kein verifizierter Test.
- **Geheimnisse, die in der Datenbank landen müssen (hier:
  `benutzer.totp_secret`), gehören an der Anwendungsschicht verschlüsselt,
  nicht im Klartext im Schema vertraut** (siehe `common/geheimnis.ts`,
  AES-256-GCM mit Schlüssel aus `TOTP_ENCRYPTION_KEY`). Das war schon in
  der ursprünglichen Migration (0004) als Vorgabe kommentiert, bevor der
  2FA-Code überhaupt existierte — ein Hinweis, wie früh solche
  Entscheidungen festgelegt werden sollten.
