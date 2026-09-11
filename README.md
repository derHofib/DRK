# Zimmerakte

Mandantenfähiges Verwaltungswerkzeug für Betreutes Wohnen — Klienten,
Zimmerbelegung, Kassenbuch (inkl. HZL-Wochenauszahlung mit
Unterschriftsbestätigung), Kostenübernahmen.

Der vollständige Bauplan (Datenmodell-Philosophie, Mandantenmodell,
Rechtliches, Phasenplan mit Abnahmekriterien) ist als Artifact dokumentiert;
frag im laufenden Chat danach, falls der Link nicht mehr griffbereit ist.

## Stand: Phase 8 (Aufgaben)

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
  Initialen, außer für die Rollen `bereichsleitung`/`einrichtungsleitung` — Anonymisierung
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
- **Akzentfarbe je Träger**, gesetzt von der Bereichsleitung, gilt für alle
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
  Unterbereich auf. Damit blieb die Hauptnavigation bei fünf Einträgen — ein
  sechster wäre auf 390 px nur 65 px breit gewesen (Phase 8 löst das mit
  einem Sammelmenü, siehe dort, als weitere Reiter dazukamen).

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

**Phase 8 — Aufgaben (Zimmer-Aufgaben und persönliche Aufgaben)**
- **Ein Modell für zwei Fälle statt zwei Tabellen:** `aufgabe` trägt
  `zimmer_id` und `zugewiesen_an` unabhängig voneinander nullable — alle
  vier Kombinationen (Zimmer×Zuweisung je gesetzt/leer) sind gültig. Eine
  Zimmer-Aufgabe ohne Zuweisung ist ein offener Posten, kein Fehlerzustand.
- **Kein Statusfeld**, gleiches Prinzip wie bei `zimmer`/`belegung`: offen
  ist `erledigt_am IS NULL`, abgeleitet statt gespeichert. Wiedereröffnen
  ist bewusst nicht vorgesehen — würde es gebraucht, wäre das ein
  mehrstufiger `aufgabe_statuswechsel` nach dem Muster von `rechnung`
  (0014), keine nachträglich eingeführte Statusspalte.
- **Bewusste Ausnahme vom Append-only-Muster:** anders als `kassenbuchung`
  und `rechnung` erlaubt `aufgabe` UPDATE und DELETE uneingeschränkt.
  Aufgaben sind Arbeitsorganisation, keine Buchführung — es gibt keine
  Aufbewahrungspflicht für eine falsch getippte oder erledigte Aufgabe, und
  eine wachsende Historie wäre hier reine Ablenkung vom eigentlichen Zweck
  (was liegt gerade an).
- **Drei Sichtbarkeitsebenen, zwei verschiedene Mechanismen.** Mandant
  (RLS) und Person (RLS) sitzen in derselben Policy, weil beide nur Spalten
  von `aufgabe` selbst gegen den Session-Kontext vergleichen —
  `app.benutzer_id` steht in `DatabaseService.withTenant()` seit jeher
  bereit, wurde bislang nur noch nie für eine Policy gebraucht:
  ```sql
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      zimmer_id IS NOT NULL
      OR erstellt_von = current_setting('app.benutzer_id', true)::uuid
      OR zugewiesen_an = current_setting('app.benutzer_id', true)::uuid
    )
  )
  ```
  Standort (Ebene 2) bleibt dagegen im Service (`aufgabe.service.ts`): sie
  braucht einen Join über `benutzer_standort`/`zimmer`, und „leere Liste vs.
  keine Einschränkung" lässt sich laut dem bestehenden Kommentar in
  `common/standort-restriction.ts` in RLS nicht sauber ausdrücken — exakt
  der Grund, aus dem sie schon bei Zimmer/Klient im Service sitzt.
- **Keine Anonymisierung für Aufgabentexte**, geprüft und bewusst
  verworfen: der Belegungsverlauf-Kompromiss (Initialen für Rollen ohne
  volles Recht) funktioniert nur, weil dort ein *strukturierter* Name
  anonymisiert wird. Aufgabentext ist Freitext — ein Klientenname lässt
  sich daraus nicht sauber herausschneiden. Wichtiger: es gibt keine Rolle,
  die eine Zimmer-Aufgabe sehen, aber den darin genannten Klienten *nicht*
  sehen dürfte. Der Schutz läuft vollständig über die drei
  Sichtbarkeitsebenen.
- **Rechte:** Anlegen ist für jede Rolle offen (Tagesgeschäft wie
  Tagesberichte, keine Stammdatenpflege). Ändern/Erledigen/Löschen einer
  fremden Aufgabe bleibt Ersteller:in, zugewiesener Person oder Leitung
  vorbehalten — mit einer gezielten Ausnahme: jede Person, die eine Aufgabe
  sehen darf, kann sich selbst zuweisen oder die eigene Zuweisung wieder
  entfernen, auch ohne die übrigen Rechte, damit eine offene Zimmer-Aufgabe
  sich jemand greifen kann.
- **Navigation: Sammelmenü statt sechstem/siebtem Eintrag.** Die mobile
  Reiterleiste zeigt nur die vier Reiter, die im Tagesbetrieb laufend
  gebraucht werden (Klienten, Tagesberichte, Kassenbuch, Aufgaben); der
  Rest (Dashboard, Zimmer, Mitarbeitende, Einstellungen) wandert hinter
  einen „Mehr"-Knopf mit Panel — vollständig barrierefrei (`aria-expanded`/
  `aria-controls`, Escape schließt, Fokusfalle solange offen, Fokus geht
  beim Schließen zurück auf den Knopf). Bewusst ein **reines
  Mobile-Muster**: die Desktop-Sidebar zeigt seit Phase 7 ohnehin immer
  alle Einträge direkt, dort gibt es kein Platzproblem. Kein
  `position: fixed` fürs Panel, gleiche Begründung wie bei der unteren
  Navigation selbst (Layout- vs. visueller Viewport auf echten
  Mobilbrowsern).
- **Prioritätskennzeichnung nicht allein über Farbe** (WCAG 1.4.1): jede
  der drei Stufen hat ein eigenes Signalstärke-Icon (`SignalHigh/-Medium/
  -Low`) zusätzlich zur Pill-Farbe.

**Zwei echte Fehler, die dabei gefunden wurden:**
- `COALESCE($4, 'normal')` beim Anlegen scheiterte an einer
  Typzweideutigkeit zwischen dem `text`-Parameter und dem
  `aufgabe_prioritaet`-Enum (`column "prioritaet" is of type
  aufgabe_prioritaet but expression is of type text`) — behoben mit
  explizitem Cast `$4::aufgabe_prioritaet`. Gefunden beim ersten echten
  Testlauf der neuen Spec, nicht beim Schreiben vorhergesehen.
- `scripts/funktions-pruefung.mjs` war seit der Sidebar (Phase 7) an zwei
  Stellen unbemerkt kaputt: `anmelden()` wartete auf `.zv-tabbar-app`
  („visible"), das ist aber oberhalb von 640 px per `display: none`
  versteckt — jeder Lauf bei Desktop-Breite hing dort auf ewig. Derselbe
  Fehler beim Theme-Umschalter-Klick (`.zv-topbar .zv-icon-btn`). Da das
  Skript nicht Teil der CI ist (nur `design-pruefung.mjs` läuft dort,
  siehe unten), ist das nie aufgefallen. Behoben, indem auf `.zv-content`
  statt der mobilen Leiste gewartet wird und der Theme-Knopf über sein
  `aria-label` mit `:visible` eindeutig angesprochen wird — beim
  vollständigen Durchlauf (32 Prüfungen über alle sechs Abschnitte)
  bestätigt.

**Nachtrag — Aufgaben im Dashboard:** zwei weitere Kacheln, nach demselben
Muster wie „Kostenübernahmen laufen bald aus" (Kartenliste statt Zahl):
„Unzugewiesene Zimmer-Aufgaben" (offene Zimmer-Aufgaben ohne Zuweisung,
standort-eingeschränkt wie überall) und „Mir zugewiesene Aufgaben" (offene
Aufgaben — Zimmer oder persönlich — die dem eigenen Benutzer zugewiesen
sind, ohne Standort-Filter, richtet sich rein nach der Zuweisung wie schon
beim Zähl-Endpunkt für die Zimmer-Badges). Beide standardmäßig für jede
Rolle sichtbar, keine Führungsinformation. Priorität-Icon/-Pill-Zuordnung
aus `AufgabeZeile.tsx` exportiert und hier wiederverwendet, statt ein
zweites Mal nachgebaut zu werden.

**Nachtrag — Standort-Umschalter im Dashboard:** eine Reiterleiste
(„Alle Standorte" + ein Reiter je erlaubtem Standort, `.zv-tabbar`-Muster
aus `KlientDetail.tsx`) engt alle standort-abhängigen Kacheln auf einen
einzelnen Standort ein. `GET /dashboard` akzeptiert dafür einen optionalen
Query-Parameter `standortId`, geprüft mit demselben `standortIstErlaubt()`
aus `common/standort-restriction.ts`, das schon Kassenbuch-Standortbuchungen
absichert — die Auswahl darf die serverseitig ohnehin ermittelte
Standort-Menge nur einengen, nie erweitern; eine fremde oder nicht erlaubte
ID liefert `403`, nicht stillschweigend ungefilterte Daten. „Mir zugewiesene
Aufgaben" bleibt bewusst außen vor (siehe Nachtrag oben) — dafür markiert
ein kleiner „alle Standorte"-Hinweis an der Kachel das, sobald ein
einzelner Standort aktiv gewählt ist, damit die Reiterleiste dort nichts
Falsches suggeriert. Die Auswahl ist eine reine Geräte-Anzeigepräferenz
(localStorage, wie schon die Widget-Sichtbarkeit) und fällt bei einer
inzwischen ungültigen gespeicherten ID still auf „Alle Standorte" zurück.
Bei nur einem erlaubten Standort (der typische Betreuer-Fall) entfällt die
Reiterleiste ganz zugunsten einer Standort-Subline im Seitenkopf.

**Nachtrag — sieben Funde aus einem realen Systemtest gegen `office.hecaso.de`:**
- **Rechte-Eskalation:** `PUT /benutzer/:id/standorte` mit `standortIds: []`
  hob bei einer Einrichtungsleitung die Standort-Einschränkung eines
  Betreuers vollständig auf, statt sie nur zu ändern — die vorhandene
  Prüfung griff nur bei einer NICHT-leeren, fremden Liste, ein leeres Array
  lief an ihr vorbei durch. Jetzt ein eigener, vorgezogener Check in
  `benutzer.service.ts::standorteSetzen()`. Für die Bereichsleitung bleibt
  die leere Liste weiterhin der vorgesehene Weg, jede Einschränkung
  aufzuheben.
- **Zwei unbehandelte CHECK-Constraints als 500:** `PATCH /belegungen/:id`
  mit einem Auszug vor/am Einzug (`belegung_check`,
  migrations/0010) und `PATCH /kostenuebernahmen/:id/beenden` mit einem
  Enddatum vor/am Start (`kostenuebernahme_check`, migrations/0013) stürzten
  unbehandelt mit `500` ab — beide Services übersetzen das jetzt nach dem
  etablierten Muster aus `rechnung.service.ts` (SQLSTATE `23514` →
  `BadRequestException`). Bei `beenden()` zusätzlich ein vorgezogener
  Anwendungscheck, weil „von" dort erst nach einem Datenbank-Lookup bekannt
  ist.
- **32-Bit-Integer-Overflow als 500:** Die zod-Schemas für
  `kassenbuchung.betragCent` und `rechnung.betragCent` prüften nur `int()`,
  nicht die Grenzen der Postgres-Spalte (`integer`, 32-Bit signed) — ein
  hinreichend großer Betrag löste „numeric field overflow" ungefangen aus.
  Beide Schemas haben jetzt `.min()/.max()` auf `±2147483647`;
  `kassenbuchung.betragCent` zusätzlich `.refine(v => v !== 0, …)`, weil ein
  Betrag von exakt 0 fachlich keine Buchung ist (anders als bei `rechnung`,
  wo die DB-`CHECK (betrag_cent > 0)` das ohnehin schon erzwingt).
- **Rohe `ThrottlerException`-Meldung im UI:** Ein `429` von der
  Raten-Schranke (`@nestjs/throttler`) zeigte die englische
  Systemmeldung unformatiert an. `api/client.ts::request()` übersetzt
  `429` jetzt fest ins Deutsche, vor dem sonstigen Body-Parsing.
- **`window.prompt()` für Begründungen ersetzt:** In installierten PWAs
  (vor allem iOS Standalone) wird `window.prompt()` häufig unterdrückt oder
  ignoriert, und er folgt ohnehin nicht den Design-Tokens. Neue,
  wiederverwendbare Komponente `components/GrundAbfrage.tsx` (baut auf dem
  bestehenden `Modal` auf) ersetzt alle vier Stellen: Kapazitätsantrag
  ablehnen (`Zimmer.tsx`), Storno beantragen/ablehnen (`Kassenbuch.tsx`,
  zwei Stellen mit identischem Code dank gemeinsamer Funktionen automatisch
  mit erledigt) und Rechnung ablehnen (`KlientDetail.tsx`).
- **Kosmetik:** Der Anlege-Knopf in `Mitarbeitende.tsx` hieß „Neuer
  Mitarbeiter" neben der Überschrift „Mitarbeitende" — jetzt einheitlich
  „Mitarbeiter:in anlegen".

Geprüft: 5 neue e2e-Fälle (Rechte-Eskalation mit Gegenprobe, beide
CHECK-Constraint-Fälle je mit Gegenprobe, Integer-Overflow für Rechnung,
Nullbetrag + Overflow für Kassenbuch) — alle 223 API-Tests grün, `pnpm
build` sauber. Die vier `window.prompt()`-Ersetzungen und die
429-Übersetzung live im Browser bestätigt (Playwright: kein
`window.prompt()`/`alert()`/`confirm()` mehr ausgelöst, Modal erscheint
und schließt sich korrekt, echte Raten-Schranke ausgelöst und die
übersetzte Meldung im UI geprüft, nicht nur der Code gelesen).

**Nachtrag — zwei weitere Funde aus einem Chaos-/Grenzwert-Test gegen
`office.hecaso.de`** (die übrigen sieben aus demselben Testlauf waren
bereits durch den vorigen Nachtrag abgedeckt):
- **Fehlende UUID-Validierung an allen `:id`-Routen:** kein Controller
  validiert seine Pfad- oder Query-Parameter einzeln (kein
  `ParseUUIDPipe`) -- eine syntaktisch ungültige ID (`GET
  /klienten/keine-uuid`) erreichte Postgres unverändert und löste dort
  SQLSTATE `22P02` ("invalid input syntax for type uuid") aus, ungefangen
  als `500`. Statt `ParseUUIDPipe` an über 15 Stellen zu wiederholen (und
  bei jedem neuen Endpunkt erneut zu vergessen), sitzt der Fix einmal
  zentral in einem neuen globalen Filter,
  `common/postgres-exception.filter.ts`, nach demselben Prinzip wie der
  bestehende `ZodExceptionFilter`. Er erbt von Nests eigenem
  `BaseExceptionFilter` und reicht alles außer dem einen bekannten
  SQLSTATE unverändert per `super.catch()` durch -- sonst bräche er das
  Verhalten für jede andere Fehlerart in der gesamten Anwendung, da er als
  `@Catch()` ohne Typ für wirklich jede nicht spezifischer behandelte
  Exception aufgerufen wird. **Stolperfalle dabei:** Nest löst mehrere
  `APP_FILTER`-Provider in *umgekehrter* Registrierungsreihenfolge auf --
  der neue, alles fangende Filter musste deshalb in `app.module.ts`
  *vor* `ZodExceptionFilter` eingetragen werden, sonst hätte er dessen
  ZodErrors ebenfalls abgefangen. Per Gegenprobe bemerkt (die erste Fassung
  verschluckte reihenweise ZodErrors als 500) und mit einem Kommentar an
  der Registrierungsstelle festgehalten, damit es niemand intuitiv wieder
  umdreht.
- **Reine Leerzeichen in Pflicht-Textfeldern:** `z.string().min(1)` allein
  akzeptiert `"     "` als "nicht leer" -- `verwendungszweck`
  (Kassenbuch), `beschreibung`/Ablehnungs-`grund` (Rechnung, Kassenbuch)
  und `titel`/`beschreibung` (Aufgaben) ließen sich dadurch fachlich leer
  anlegen. Jetzt überall `.string().trim().min(1, "…")` -- die Reihenfolge
  ist wichtig: `.trim()` vor `.min(1)`, sonst zählt das Leerraum-Padding
  weiterhin als Inhalt. `.trim()` transformiert dabei auch den
  gespeicherten Wert, nicht nur die Prüfung -- ein Titel mit nur
  umlaufenden Leerzeichen wird also tatsächlich getrimmt abgespeichert.

Geprüft: 7 neue Fälle für den UUID-Filter (fünf verschiedene Controller
inklusive eines Query-Parameters, nicht nur `:id`-Pfade, plus zwei
Regressionsschutz-Fälle: eine wohlgeformte, aber unbekannte UUID liefert
weiterhin `404`, ein gewöhnlicher `403/404`-Pfad bleibt vom neuen Filter
unberührt) und 6 neue Fälle für die Leerzeichen-Validierung (inklusive
einem Fall, der das korrekte Trimmen eines gültigen Werts belegt) -- alle
mit Gegenprobe (Prüfung deaktiviert, genau die vorgesehenen Tests werden
rot, wiederhergestellt, wieder grün; bei der Leerzeichen-Gegenprobe lief
zusätzlich eine erwartete Kettenreaktion in `rechnung.e2e-spec.ts` mit, weil
ein fälschlich durchgelassenes "abgelehnt" den für nachfolgende Tests
vorausgesetzten Status "beantragt" konsumierte -- genau der Beleg, dass die
Prüfung etwas Echtes verhindert). Alle 238 API-Tests grün, `pnpm build`
sauber.

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

**Nachtrag — erweiterte Klienten-Stammdaten (Aufnahme-Datenblatt) und
Kontakte.** Auf Wunsch wurden alle Felder aus dem Papier-Aufnahme-Datenblatt
als ausfüllbare Stammdaten im Reiter „Übersicht" ergänzt, plus beliebig viele
Kontaktpersonen je Klient als Unterformular:
- **Neue Tabellen statt neuer Spalten auf `klient`:** `klient_stammdaten`
  (1:1, `UNIQUE` auf `klient_id`) und `klient_kontakt` (1:n), beide RLS- und
  standort-eingeschränkt wie jede andere klientenbezogene Tabelle
  (`migrations/0034_klient_stammdaten.sql`). Der Grund liegt in einer
  bestehenden Entscheidung aus Phase 3: `klient` selbst ist seit der
  Anonymisierungs-Migration (0027) spaltenscharf gesperrt (`REVOKE UPDATE,
  DELETE … GRANT UPDATE (vorname, nachname, geburtsdatum, …)`) — eine neue
  Tabelle mit den Standard-Rechten aus Migration 0002 ist der einfachste Weg
  zu einem frei bearbeitbaren erweiterten Profil, ohne diese Sperre
  aufzuweichen.
- **„Zuständiges Jugendamt (Name)" wurde nicht dupliziert** — das ist
  inhaltlich `klient.amt`, das es bereits seit Phase 1 gibt. Nur die
  zusätzlichen Detailfelder (Adresse, Sachbearbeiter:in, Stellenzeichen,
  Telefon, E-Mail) sind neu.
- **Aufnahme- und Entlassungsdatum werden nicht gespeichert, sondern aus der
  Zimmer-Belegung abgeleitet** (frühester Einzug / spätester Auszug, aber nur
  wenn aktuell kein offener Aufenthalt mehr besteht) — dieselbe Philosophie
  wie beim abgeleiteten Zimmerstatus (CLAUDE.md, „Zustände werden
  abgeleitet, nicht gespeichert").
- **Partial-Update statt vollständigem Formular:** `PATCH
  /klienten/:id/stammdaten` speichert nur die mitgeschickten Felder
  (`INSERT … ON CONFLICT (klient_id) DO UPDATE SET spalte = COALESCE(
  EXCLUDED.spalte, klient_stammdaten.spalte)`), alle anderen bleiben
  unangetastet — das Formular ist nach den sechs Abschnitten des
  Datenblatts gegliedert (Schnelle Informationen, Weitere Informationen,
  Kontakt/Betreuung, Gesundheit, Bildung/Ausbildung, Vorherige Einrichtung)
  und jeder Abschnitt speichert unabhängig. Ein leerer String leert ein Feld
  gezielt.
- **Bezugsbetreuer:in ist eine echte Verknüpfung** (`bezugsbetreuer_id uuid
  REFERENCES benutzer`), keine Freitextspalte — ein Dropdown aus den
  Mitarbeitenden. Eine unbekannte Benutzer-id liefert `404` statt eines
  rohen FK-Verletzungs-`500`ers (derselbe Grundsatz wie beim
  UUID-Validierungs-Nachtrag oben). Bewusste Lücke: die Zuordnung lässt sich
  über dieses Formular aktuell nicht wieder entfernen, weil ein leerer
  String bei einer `uuid`-Spalte kein gültiger „löschen"-Wert ist wie bei
  Text — anders als bei den übrigen Feldern würde er den Insert/Update mit
  einem Typfehler scheitern lassen. Für ein späteres "nicht zugeordnet"
  bräuchte es eine eigene Handhabung dieser einen Spalte.
- **Gesundheitsdaten (Medikamente, Diagnosen, Allergien, Besonderheiten)**
  sind eine Stufe sensibler als der Rest der Akte, bleiben aber bewusst ohne
  gesonderte Rollensperre lesbar/bearbeitbar für alle mit Klienten-Zugriff —
  ausdrückliche Projektentscheidung, weil Betreuer:innen sie im Alltag
  brauchen (siehe Kommentar in der Migration).
- **Kontakte** (`klient_kontakt`) sind bewusst 1:n mit freiem Feld
  „Beziehung/Rolle" — das Datenblatt hat vier identische, unbeschriftete
  Kontaktblöcke, damit bleibt erkennbar, wer wer ist. Volle CRUD
  (`POST`/`PATCH`/`DELETE /klienten/:id/kontakte[/:kontaktId]`).

Geprüft: 15 neue e2e-Tests (`klient-stammdaten.e2e-spec.ts`) gegen echtes
PostgreSQL — Partial-Update-Semantik (drei Fälle: erstes Speichern, zweites
unabhängiges Speichern lässt vorherige Felder unangetastet, leerer String
leert gezielt), Bezugsbetreuer-Verknüpfung inkl. `404` bei unbekannter und
`400` bei syntaktisch ungültiger id, Standort-Einschränkung für Stammdaten
UND Kontakte (mit eingebauter Gegenprobe: dieselbe Aktion klappt für eine
unrestricted Rolle), volle Kontakte-CRUD inklusive doppeltem Löschen, sowie
das abgeleitete Aufnahme-/Entlassungsdatum in beiden Fällen (offener und
abgeschlossener Aufenthalt). Beide sicherheitsrelevanten Prüfungen
(Standort-Zugriff, Bezugsbetreuer-FK-Vorprüfung) per Gegenprobe verifiziert:
Prüfung im Service auskommentiert, exakt die vorgesehenen zwei Tests wurden
rot (`500` statt `404` bzw. `200` statt `404`), Prüfung wiederhergestellt,
wieder alle 253 API-Tests grün. `pnpm build` (shared + api + web) sauber.
Zusätzlich live im Browser geprüft (Hell- und Dunkelmodus): Abschnitt
bearbeiten, Kontakt anlegen und wieder löschen, abgeleitetes Aufnahmedatum
sichtbar — Testmandant danach wieder entfernt.

**Nachtrag — Nachbetreuung ausgezogener Klient:innen war für
standortbeschränkte Betreuer:innen unmöglich.** `klientIstErlaubt()`
(`common/standort-restriction.ts`) prüfte ausschließlich die aktuell offene
Belegung. Im selben Moment, in dem ein Klient auszieht (z. B.
Verselbstständigung in eine eigene Wohnung), verlor das bis dahin
zuständige Standort-Team — und sogar der in `klient_stammdaten` eingetragene
Bezugsbetreuer — jeden Lese- und Schreibzugriff auf Stammdaten,
Tagesberichte usw. (`404` auf allen darauf aufbauenden Endpunkten). Die
Prüfung erlaubt jetzt zusätzlich den Zugriff, wenn (a) der Mitarbeitende in
`klient_stammdaten.bezugsbetreuer_id` eingetragen ist — unabhängig vom
aktuellen Aufenthaltsort, weil eine Bezugsbetreuung bewusst über einen Umzug
hinaus bestehen bleiben kann —, oder (b) die letzte, auch längst
abgeschlossene Belegung (`ORDER BY einzug DESC LIMIT 1`) an einem der
erlaubten Standorte lag. Bewusst **nicht** angefasst:
`klientStandortBedingung()` (Listenabfragen wie `GET /klienten`) bleibt
unverändert — ein ausgezogener Klient soll weiterhin nicht in der
allgemeinen Klientenliste auftauchen, die Nachbetreuung geschieht gezielt
über die schon bekannte Akte.

Geprüft: 4 neue e2e-Tests (`nachbetreuung.e2e-spec.ts`) — Zugriff über den
letzten historischen Standort, ein neuer Tagesbericht für denselben
ausgezogenen Klienten, Zugriff allein über die Bezugsbetreuer-Zuordnung
(ohne jeden Standort-Bezug), und eine Gegenprobe ohne beides, die weiterhin
`404` liefert. Per Gegenprobe verifiziert: Erweiterung in
`klientIstErlaubt()` auf die ursprüngliche Prüfung zurückgesetzt — exakt die
drei vom Fix abhängigen Tests wurden rot (`404` statt `200`/`201`), die
Negativprobe blieb grün, wiederhergestellt, wieder alle 257 API-Tests grün.
`pnpm build` sauber.

**Nachtrag — frei definierbare Kassenbuch-Typen statt fester Dreier-Auswahl.**
Der Typ einer Kassenbuchung war bislang ein Postgres-ENUM mit genau drei
Werten (HZL/Einzahlung/Sonstiges). Auf Wunsch der Leitung sind Typen jetzt
pro Träger frei definierbar, und ob eine Buchung dieses Typs einen
Verwendungszweck braucht, ist je Typ einstellbar:
- **ENUM → echte Tabelle** (`kassenbuchung_typ`,
  `migrations/0035_kassenbuchung_typ.sql`): mandantenscoped wie jede andere
  Tabelle (RLS `ENABLE`+`FORCE`), mit `bezeichnung`, `kommentar_pflicht` und
  `ist_hzl`. Die alte ENUM-Spalte wird per `CASE`-Mapping auf die drei
  Standardtypen zurückgeführt und dann gelöscht.
- **Jeder Mandant bekommt die drei Standardtypen automatisch** — nicht per
  Anwendungscode, sondern per `AFTER INSERT ON mandant`-Trigger
  (`mandant_kassenbuchung_typ_standard`). Diese App hat bewusst keinen
  öffentlichen Registrierungs-Endpunkt (siehe CLAUDE.md) — ein neuer Mandant
  entsteht immer per manuellem `INSERT`, an dem kein Anwendungscode beteiligt
  ist. Ein „lege drei Zeilen an, wenn ein Mandant angelegt wird" muss deshalb
  in der Datenbank selbst passieren.
- **HZL bleibt ein geschützter Systemtyp** — weder umbenennbar noch
  deaktivierbar, auch nicht für die Leitung (`BadRequestException` in
  `kassenbuchung-typ.service.ts`, `aktualisieren()`). Daran hängt die
  HZL-Wochenübersicht und die Sperre gegen doppelte Auszahlung je
  Klient/Kalenderwoche. Weil eine partielle Unique-Index-Bedingung keinen
  Join auf eine andere Tabelle erlaubt, wurde `ist_hzl` zusätzlich auf
  `kassenbuchung` selbst denormalisiert, damit `hzl_einmal_je_woche`
  weiterhin ein einfaches Boolean-Prädikat prüfen kann. Einzahlung und
  Sonstiges sind dagegen normale, von der Leitung frei umbenennbare und
  deaktivierbare Einträge.
- **„Verwendungszweck" heißt „Kommentar", wenn er für diesen Typ nicht
  Pflicht ist** — sowohl in der Typverwaltung als auch im Kassenbuch-
  Formular selbst liest das Feldlabel `kommentarPflicht` des gewählten Typs.
  HZL hat bewusst `kommentar_pflicht = false` (Nutzervorgabe: „HZL kann so
  bleiben, dabei wird aus Verwendungszweck Kommentar").
- **Validierung wandert vom Controller in den Service:** Ob ein
  Verwendungszweck Pflicht ist, hängt vom gewählten Typ ab (Datenbankstand),
  nicht von einer statischen Form — ein zod-Schema kann das nicht prüfen.
  `kassenbuchung.service.ts` liest den Typ innerhalb der Transaktion und
  prüft `aktiv`/`kommentar_pflicht`/`ist_hzl` dort.
- **Deaktivieren statt Löschen** — dieselbe Philosophie wie bei Standorten:
  ein deaktivierter Typ verschwindet nur aus der Auswahl beim Anlegen neuer
  Buchungen, bestehende Buchungen mit diesem Typ bleiben unangetastet
  (`kassenbuchung` ist ohnehin Append-only).
- **Rollenprüfung**: Kassenbuch-Typen anlegen/bearbeiten ist leitenden
  Positionen vorbehalten (`bereichsleitung`/`einrichtungsleitung`) — eine
  trägerweite Festlegung, keine persönliche Einstellung.

Geprüft: 10 neue e2e-Tests (`kassenbuch-typen.e2e-spec.ts`) — automatische
Standardtypen bei Mandantenanlage, Anlegen/Umbenennen/Pflicht-Umschalten/
Deaktivieren durch die Leitung, `403` für andere Rollen, `409` bei doppelter
Bezeichnung je Mandant, HZL-Schutz (`400` bei Umbenennen/Deaktivieren, auch
für die Leitung), `kommentarPflicht` durchgesetzt beim Anlegen einer Buchung
(`400` ohne Pflichtfeld, `201` mit leerem optionalem Feld), `400` bei
deaktiviertem Typ, `404` bei unbekannter `typId`, sowie Mandantentrennung.
Alle 267 API-Tests grün (23 Suiten), inklusive Anpassung von 17 weiteren
Testdateien, die einen Mandanten anlegen: die neue Trigger-Zeile in
`kassenbuchung_typ` musste vor dem `DELETE FROM mandant` in jedem `afterAll`
mit aufgeräumt werden, sonst schlägt die Fremdschlüssel-Prüfung fehl. Drei
Gegenproben durchgeführt: Rollenprüfung in `anlegen()` auskommentiert → genau
der 403-Test wurde rot (`201` statt `403`); Rollenprüfung in
`aktualisieren()` auskommentiert → derselbe Test wurde rot, diesmal `400`
(die HZL-Schutzprüfung dahinter greift weiterhin) statt `403`; HZL-Schutz
auskommentiert → der Systemtyp-Test wurde rot (`200` statt `400` bei
Umbenennen). Alle drei nach Wiederherstellung erneut grün. `pnpm build`
(shared + api + web) sauber. Live im Browser geprüft (Hell- und
Dunkelmodus): Einstellungen → Kassenbuch zeigt die drei Standardtypen mit
HZL als „Systemtyp" ohne Bearbeiten-Aktion, ein neuer Typ mit abgewählter
Pflicht erscheint korrekt als „Kommentar (optional)", und im
Kassenbuch-Buchungsformular wechselt das Feldlabel abhängig vom gewählten
Typ live zwischen „Verwendungszweck" und „Kommentar" — Testmandant danach
wieder entfernt.

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

Es gibt bewusst keinen öffentlichen Registrierungs-Endpunkt (siehe
"Architekturentscheidungen" unten) -- auf einem echten Server übernimmt das
`scripts/account-anlegen.sh` (siehe `docs/DEPLOYMENT.md`, Abschnitt 5.1).
Für die lokale Entwicklung geht es genauso schnell von Hand:

```sql
INSERT INTO mandant (name, slug) VALUES ('Mein Träger', 'mein-traeger');

-- Passwort-Hash erzeugen: node -e "console.log(require('bcryptjs').hashSync('DEIN_PASSWORT', 10))"
INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
SELECT id, 'du@beispiel.de', 'Dein Name', '<bcrypt-hash>', 'bereichsleitung'
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
