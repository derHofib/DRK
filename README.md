# Zimmerakte

Mandantenfähiges Verwaltungswerkzeug für Betreutes Wohnen — Klienten,
Zimmerbelegung, Kassenbuch (inkl. HZL-Wochenauszahlung mit
Unterschriftsbestätigung), Kostenübernahmen.

Der vollständige Bauplan (Datenmodell-Philosophie, Mandantenmodell,
Rechtliches, Phasenplan mit Abnahmekriterien) ist als Artifact dokumentiert;
frag im laufenden Chat danach, falls der Link nicht mehr griffbereit ist.

## Stand: Phase 7 (Designsystem)

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

**Phase 5 — Mobile-Ansicht, PWA**
- Ein echtes, reproduzierbares Layout-Problem gefunden, bevor irgendetwas
  gebaut wurde: auf einem 390px-Viewport (iPhone-Breite) überliefen sowohl
  jede Tabelle als auch die obere Tab-Leiste die Seite horizontal — mit
  Playwright objektiv gemessen (`document.documentElement.scrollWidth >
  clientWidth`), nicht nur "sieht komisch aus"
- `.zv-table` scrollt jetzt für sich selbst (`display: block; overflow-x:
  auto` auf dem `<table>`-Element, `thead`/`tbody`/`tr`/`td` behalten ihre
  Tabellen-Ausrichtung), statt die ganze Seite aufzureißen — eine einzige
  CSS-Regel für alle sieben Tabellen-Stellen im Code, keine
  Komponentenänderung nötig
- Unter 640px wird die obere App-Navigation (`zv-tabbar-app`, nur die aus
  `Shell.tsx` — die zweite Reiterleiste innerhalb der Klientenakte bleibt
  bewusst oben) zu einer unteren Navigationsleiste, dem auf Mobilgeräten
  erwarteten Muster. "Office" (Desktop, oberer Tab-Leiste) und "Mobile"
  (unten, größere Touch-Ziele) bekommen damit tatsächlich unterschiedliche
  Layouts aus demselben Code — keine zweite Anwendung, eine Media Query
- Bewusst **kein** `position: fixed` für die untere Leiste: das kollidiert
  auf echten Mobilbrowsern mit dem ein-/ausblendenden Adressleisten-Bereich
  (Layout- vs. visueller Viewport bekommen unterschiedliche Höhen, die
  Leiste landet dann außerhalb des sichtbaren Bereichs — beim Testen exakt
  so reproduziert, siehe unten). Stattdessen eine Flex-Spalte über
  `100dvh`, in der `zv-content` scrollt und die Navigation ein normales
  Flex-Kind ist
- PWA-Grundausstattung über `vite-plugin-pwa`: Manifest (Name, Icons,
  `display: standalone`, Platzhalter-Markenfarbe wie in `tokens.css`) und
  ein generierter Service Worker, der ausschließlich die App-Shell cacht,
  **nie** API-Antworten — ein veralteter, gecachter Kassenbuch-Stand wäre
  irreführend. Verifiziert: der Service Worker registriert und aktiviert
  sich, und die Login-Seite lädt tatsächlich bei gekapptem Netzwerk (mit
  Playwright `context.setOffline(true)` erzwungen, nicht nur angenommen)
- Zwei Platzhalter-Icons (192px, 512px, plus maskable-Variante) als
  einfaches Monogramm in der Platzhalter-Markenfarbe — bewusst kein
  Rotkreuz-Symbol, aus denselben rechtlichen Gründen wie beim Design ganz
  am Anfang. Quell-SVGs liegen in `apps/web/design-sources/`, zum
  Austauschen sobald echte Icons vorliegen
- Zwei echte Layout-Bugs beim Bauen gefunden und behoben, beide nur durch
  tatsächliches Messen im Browser aufgefallen, nicht durch Ansehen:
  1. Die neue untere Navigation lag anfangs *über* der zweiten Reiterleiste
     der Klientenakte, weil beide dieselbe CSS-Klasse `zv-tabbar` teilten —
     behoben mit einer eigenen Klasse `zv-tabbar-app` nur für die
     App-weite Navigation.
  2. Nach dem Umstieg von `position: fixed` auf Flexbox erschien die
     Navigation zunächst *unter* dem Topbar statt am Fußende, weil sie im
     DOM vor `zv-content` steht — behoben mit CSS `order`, ohne die
     Quellreihenfolge in `Shell.tsx` anzufassen.

**Phase 6 — Produktions-Deployment (Docker, CI)**
- `apps/api/Dockerfile`: Multi-Stage-Build, der `pnpm deploy --prod --legacy`
  benutzt, um ein eigenständiges, produktionsreines `node_modules` für nur
  `@zimmerakte/api` zu erzeugen (keine Symlinks nach außerhalb, keine
  devDependencies) — der von pnpm selbst für genau diesen
  Docker-Anwendungsfall vorgesehene Mechanismus. Läuft als eigener,
  nicht-root Benutzer.
- `apps/web/Dockerfile`: Multi-Stage-Build (Vite-Build → statische Dateien),
  ausgeliefert über `nginx:alpine` mit einer kleinen Konfiguration
  (`apps/web/nginx.conf`), die `/api/*` an den API-Container weiterreicht —
  dasselbe Verhältnis wie der Vite-Dev-Proxy, nur für den Produktivbetrieb.
- `docker-compose.prod.yml`: kompletter Stack (Datenbank + einmaliger
  `migrate`-Dienst + API + Web) für einen produktionsnahen Testlauf. Der
  bestehende `docker-compose.yml` bleibt unverändert für die lokale
  Entwicklung (nur Postgres).
- **Wichtiger Vorbehalt, transparent statt verschwiegen:** In dieser
  Entwicklungsumgebung ist kein Docker-Daemon verfügbar (siehe unten,
  "Was hier bewusst fehlt") — die Dockerfiles selbst konnten hier nicht
  gebaut werden. Der eigentliche Mechanismus dahinter (`pnpm deploy --prod
  --legacy`, dann `node dist/src/main.js` bzw. `tsx scripts/migrate.ts`
  aus dem deployten Verzeichnis) wurde stattdessen **außerhalb von Docker,
  aber mit genau derselben Verzeichnisstruktur** gegen eine echte
  PostgreSQL-Instanz nachgebaut und verifiziert: Server startet, Login
  funktioniert, Migrationen laufen durch. Die eigentliche Docker-Bauprobe
  läuft jetzt in der CI (siehe unten) — dort mit echtem Docker-Daemon.
- `.github/workflows/ci.yml`: drei Jobs bei jedem Push.
  1. `api-tests` — startet einen echten PostgreSQL-16-Service-Container,
     wendet die Migrationen an, führt die komplette Jest-Testsuite aus
     (alle 42 Tests, kein Mock).
  2. `web-build` — Typecheck + Vite-Build.
  3. `docker-build` — baut beide Dockerfiles wirklich, startet dann beide
     Images tatsächlich (API gegen einen echten Postgres-Container im
     selben Docker-Netzwerk, Web dahinter) und prüft per `curl` einen
     echten HTTP-Statuscode von jedem laufenden Container — nicht nur,
     dass der Build durchläuft, sondern dass die gebauten Images auch
     funktionieren.
- `tsx` (für `scripts/migrate.ts`) von `devDependencies` zu `dependencies`
  verschoben, nachdem der Deploy-Test zeigte, dass ein `--prod`-Deploy es
  sonst weggelassen hätte — Migrationen laufen zu lassen ist ein
  Produktivbetrieb-Vorgang, keine Dev-Bequemlichkeit.

Damit ist der ursprüngliche Phasenplan durch. Was jetzt noch fehlt, ist in
"Was hier bewusst fehlt" unten aufgeführt.

**Phase 7 — Designsystem (einstellbare Akzentfarbe, Hell/Dunkel, Icons)**
- **Akzentfarbe je Träger**, gesetzt von der Leitung, gilt für alle
  Mitarbeitenden. 9 kuratierte Pastellpaletten plus freier Farbwähler, mit
  Live-Vorschau, die sofort die ganze Anwendung umfärbt.
- **Die tragende Idee:** Kontrast hängt ausschließlich an der Helligkeit.
  Deshalb liefert das Frontend nur **Farbton und Buntheit**
  (`--zv-accent-h`/`-c`, abgeleitet über sRGB→OKLCH in
  `apps/web/src/theme/farbe.ts`), während sämtliche Helligkeitswerte fest
  je Theme in `tokens.css` stehen. Kontrast kann damit **konstruktiv nicht
  brechen** — auch Knallgelb ergibt einen lesbaren (goldenen) Knopf.
  OKLCH statt HSL, weil HSLs „Lightness" nicht perzeptuell ist: dort haben
  Gelb und Blau bei gleichem L völlig verschiedene Leuchtdichte, genau der
  Fehlermodus „bei Türkis geht's, bei Gelb ist der Knopf unlesbar".
- **Hell und Dunkel** über `color-scheme` + `light-dark()`: jeder Token wird
  genau einmal geschrieben. Wichtiger Nebeneffekt — `color-scheme` themt die
  **nativen Steuerelemente** mit: `input[type=date]` (Klienten,
  Kostenübernahmen, Kassenbuch), `input[type=file]`, `select` und die
  Bildlaufleisten blieben im alten Dunkelmodus alle weiß. Ein Inline-Skript
  im `<head>` verhindert das Aufblitzen des falschen Themes beim Laden.
  Die Theme-Wahl ist eine persönliche Anzeigepräferenz und liegt bewusst im
  `localStorage`, nicht in der Datenbank (TTDSG §25 Abs. 2: vom Nutzer
  gewünschte Einstellung, einwilligungsfrei, kein Personenbezug).
- **Migration 0019** nutzt die Gelegenheit für einen eigenständigen
  Sicherheitsgewinn: bis dahin durfte die App-Rolle über
  `ALTER DEFAULT PRIVILEGES` **jede** Spalte von `mandant` ändern — auch
  `slug`, also den Login-Pfad. Jetzt spaltenscharf wie bei `kassenbuchung`
  (0011): `REVOKE UPDATE`, dann `GRANT UPDATE (akzentfarbe)`.
- **Icons:** lucide-react, ~50 Stück über ein Zentralmodul
  (`components/icons.tsx`) mit einheitlicher Größe, Strichstärke und
  `aria-hidden`-Voreinstellung. Ausschließlich namentliche Importe — kein
  `import * as`, kein `DynamicIcon`, sonst landet das ganze Set (>1 MB) im
  Bundle. Gemessener Zuwachs: **+7,4 kB gzip**.
- **Schrift:** Inter, selbst ausgeliefert, nur das Latin-Subset. Kein
  Google-Fonts-CDN (in Deutschland abgemahnt, LG München I, 3 O 17493/20)
  und keine per Hand abgelegte Binärdatei — die Version hängt an der
  `pnpm-lock.yaml`.
- **Navigation:** „Sicherheit" wurde zu „Einstellungen" und nimmt 2FA als
  Unterbereich auf. Damit bleibt die Hauptnavigation bei fünf Einträgen —
  ein sechster wäre auf 390 px nur 65 px breit, und „Kassenbuch" passt dort
  nicht mehr hinein.

**Zwei echte Fehler, die dabei nebenbei behoben wurden** (nachgerechnet,
nicht geschätzt):
- Im Dunkelmodus stand weißer Text auf `--zv-accent` (`#5fafa6`) —
  **2,57:1**. Jeder `.zv-btn` war dunkel unter der Lesbarkeitsschwelle.
- `--zv-text-faint` (`#8c8c8c`) war **3,36:1** auf Weiß und nur **2,87:1**
  auf `--zv-surface-2`, wo die Tabellenköpfe stehen — und der Token trägt
  echten Inhalt (alle Leerzustände, „Kein Klient zugeordnet").
- Ein dritter Fehler fiel erst der neuen Kontrastmatrix auf: die
  Eingabefeldränder lagen bei **1,60:1** (hell) und **2,02:1** (dunkel),
  obwohl WCAG 1.4.11 für Umrisse, die ein Bedienelement identifizieren,
  3:1 verlangt — und weil die Felder dieselbe Flächenfarbe haben wie die
  Karte darunter, ist dieser Rand ihr einziges Erkennungsmerkmal.


## Was hier bewusst fehlt

- **fieldvibes echtes Design.** `fieldvibe.de` war aus dieser
  Entwicklungsumgebung nicht erreichbar. Das System in
  `apps/web/src/styles/tokens.css` ist deshalb ein eigenständiges,
  durchgerechnetes Designsystem und keine Annäherung an fieldvibe. Es
  bleibt austauschbar: die Trägerfarbe ist ohnehin einstellbar, und für
  eine andere Grundanmutung genügt weiterhin diese eine Datei.
- **Die App-Icons und `manifest.theme_color` sind bauzeitlich und damit
  nicht mandantenindividuell.** Das Manifest wird einmal gebaut und von
  allen Trägern geteilt — Startbildschirm und Splash zeigen für alle
  dieselbe Standardfarbe (DRK Rot). Eingefärbt ist erst die laufende
  Anwendung. Pro Träger eigene Icons bräuchte einen Build je Mandant oder
  ein serverseitig erzeugtes Manifest.
- **Die Dockerfiles wurden nie in dieser Entwicklungsumgebung selbst
  gebaut.** Kein Docker-Daemon hier verfügbar (`dockerd` startet nicht,
  fehlende Berechtigung für `ulimit` in dieser Sandbox). Der zugrunde
  liegende Mechanismus (`pnpm deploy --prod --legacy` + Start aus dem
  deployten Verzeichnis) wurde stattdessen manuell nachgebaut und gegen
  eine echte Datenbank verifiziert (siehe Phase 6 oben); die tatsächliche
  Docker-Bauprobe — inklusive beide Images wirklich starten und per `curl`
  echte Antworten prüfen — läuft jetzt bei jedem Push in
  `.github/workflows/ci.yml` (Job `docker-build`) mit echtem
  Docker-Daemon. Vor dem ersten echten Produktivbetrieb trotzdem einmal
  lokal (oder auf dem Zielserver) durchbauen und -starten, bevor man sich
  darauf verlässt.
- **Kein Secret-Rotations-Mechanismus.** `docker-compose.prod.yml`
  dokumentiert den nötigen manuellen `ALTER ROLE`-Schritt nach dem ersten
  Start (siehe Kommentar dort), automatisiert ihn aber nicht. Für einen
  echten Produktivbetrieb gehört das in ein Secret-Management-Werkzeug,
  nicht in eine Compose-Datei.
- **Offline-Unterstützung ist bewusst nur die App-Shell, keine Daten.** Der
  Service Worker (Phase 5) cacht HTML/CSS/JS, damit die Anwendung ohne
  Netzwerk überhaupt startet — er cacht nie Zimmer-, Klienten- oder
  Kassenbuch-Daten. Ohne Verbindung sieht man also die Login-Seite (oder
  die zuletzt geladene Ansicht als leere Hülle), nicht die zuletzt
  bekannten Daten. Ein echtes Offline-Arbeiten (z. B. eine Auszahlung ohne
  Empfang erfassen und später synchronisieren) ist nicht Teil dieser
  Phase und bräuchte eine eigene Warteschlangen-Logik.

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

### Designprüfung (Browser)

Zwei eigenständige Skripte, beide gegen einen echten Chromium:

```bash
# Kontrastmatrix -- braucht nur einen Vorschauserver, keine Datenbank.
cd apps/web && pnpm build && pnpm exec vite preview --port 4173 &
node scripts/design-pruefung.mjs
```

Misst für **jede der 9 Paletten × beide Themes** plus vier Extremfälle
(Knallgelb, Fast-Weiß, Fast-Schwarz, Sattblau) 19 Farbpaare an echten
Elementen — 494 Messungen. Wichtig dabei: gemessen werden die
**tatsächlich gerenderten sRGB-Bytes** über eine 1×1-Leinwand, nicht die
geschriebenen Tokenwerte. Das hat zwei Gründe. Erstens liefert
`getComputedStyle` in Chromium für `oklch()` die rohe Zeichenkette zurück
statt eines aufgelösten `rgb()` — ein naiver Parser misst dadurch still
gar nichts. Zweitens geht so das Gamut-Mapping des Browsers mit ein, das
bei Werten außerhalb von sRGB greift.

Das Skript bricht deshalb ausdrücklich ab, wenn es **weniger Paare als
erwartet** misst: „kein Paar unter der Schwelle" ist bei null Messungen
trivialerweise wahr, und genau so hat die erste Fassung fälschlich Erfolg
gemeldet.

```bash
# Funktionsprüfung -- braucht laufende API + Dev-Server und Dev-Konten.
node scripts/funktions-pruefung.mjs
```

Prüft Navigation und Icons, dass der Theme-Umschalter messbar etwas kippt,
dass beim Laden nichts aufblitzt, dass kein horizontaler Überlauf bei
390 px auftritt und die mobile Navigation unverändert funktioniert — und
die vollständige Kette der Akzentfarbe: live umfärben, speichern,
Neuladen überstehen, bei einem **anderen Mitarbeitenden desselben Trägers**
ankommen, und für eine Rolle ohne Branding-Recht weder angeboten werden
noch per direktem `PATCH` durchgehen (403).


### Deployment (Docker)

```bash
cp .env.example .env.prod
# .env.prod anpassen: POSTGRES_PASSWORD, APP_DB_PASSWORD, JWT_SECRET,
# TOTP_ENCRYPTION_KEY -- echte, zufällige Werte, nicht die dev_only_*-Platzhalter.

docker compose -f docker-compose.prod.yml --env-file .env.prod up --build
```

Danach einmalig (siehe Kommentar in `docker-compose.prod.yml`) das
App-Rollen-Passwort von seinem Migrations-Default auf den echten Wert
setzen. Web läuft danach auf Port 8080, API auf Port 3000.

Siehe "Was hier bewusst fehlt" für den wichtigen Vorbehalt: dieser Stack
wurde nicht in der Entwicklungsumgebung selbst gebaut (kein Docker-Daemon
verfügbar), sondern nur über die CI (`.github/workflows/ci.yml`) und einen
manuellen Nachbau des Deploy-Mechanismus außerhalb von Docker verifiziert.

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
- **Layout-Behauptungen ("passt jetzt auf dem Handy") gehören gemessen,
  nicht nur angeschaut.** `document.documentElement.scrollWidth >
  clientWidth` per Playwright ist eine objektive Ja/Nein-Prüfung für
  horizontales Überlaufen; ein Screenshot allein hätte das anfängliche
  `position: fixed`-Problem der unteren Navigation (siehe Phase 5) nicht
  zuverlässig gezeigt, weil es erst bei echtem Scroll-Verhalten sichtbar
  wird.
- **`position: fixed` für eine untere Mobile-Navigation ist ein bekannter
  Stolperstein**, nicht die naheliegendste Lösung: Layout- und visueller
  Viewport haben auf echten Mobilbrowsern wegen der ein-/ausblendenden
  Adressleiste unterschiedliche Höhen. Eine Flex-Spalte über `100dvh` mit
  der Navigation als normalem Flex-Kind (Reihenfolge per CSS `order`
  gesteuert) ist robuster als jede Sonderbehandlung für `position: fixed`.
- **Ein Service Worker, der API-Antworten cacht, ist ein Feature, kein
  Standardverhalten.** Der hier generierte Service Worker cacht bewusst
  nur die App-Shell (HTML/CSS/JS) über `workbox.navigateFallbackDenylist`
  für `/api/*` — jede Erweiterung auf echtes Offline-Arbeiten mit Daten
  braucht eine explizite, separat zu entwerfende Synchronisationsstrategie
  (siehe "Was hier bewusst fehlt").
- **Ein Deploy-Mechanismus lässt sich verifizieren, auch ohne das
  Ziel-Tool (hier: Docker) selbst zur Verfügung zu haben** -- den
  eigentlichen Kern (`pnpm deploy --prod --legacy`, dann aus dem
  deployten Verzeichnis heraus starten) manuell außerhalb von Docker
  gegen eine echte Datenbank nachzubauen, hat vor dem Schreiben des
  Dockerfiles zwei echte Probleme aufgedeckt (fehlendes `tsx` bei
  `--prod`, die richtige `pnpm deploy`-Variante für diesen Workspace) --
  billiger, sie so zu finden, als sie erst beim ersten echten
  Docker-Build zu entdecken.
- **CI ist der Ort, an dem sich eine unbewiesene Behauptung ("die
  Dockerfiles sollten bauen") tatsächlich beweisen lässt**, wenn die
  lokale Umgebung das nicht kann. `docker-build` in der CI baut nicht nur
  beide Images, sondern startet sie auch wirklich (API gegen einen echten
  Postgres-Container, Web dahinter) und prüft per `curl` einen echten
  HTTP-Status -- dieselbe Faustregel wie überall sonst in diesem Projekt:
  laufen lassen und messen, nicht nur beschreiben.
