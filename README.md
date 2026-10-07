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

**Nachtrag — Klient archivieren mit PDF-Aktenauszug.** Wenn ein Klient
auszieht und nicht mehr Teil der Einrichtung ist, kann die Leitung ihn
archivieren: es entsteht ein vollständiger, strukturierter PDF-Aktenauszug
(Stammdaten, Kontakte, Unterbringungshistorie, Kassenbuch,
Kostenübernahmen, Rechnungen, Tagesberichte — inklusive aller
hochgeladenen Fotos/Dokumente, vollständig eingebettet statt nur
referenziert), der Klient wird eingefroren und aus der Standardliste
ausgeblendet. Reversibel — anders als die Anonymisierung (Art. 17 DSGVO,
siehe oben) ist das keine Löschung, sondern eine operative
Statusänderung.
- **Migration 0036**: `klient.archiviert_am`/`archiviert_von` (gleiches
  Muster wie `anonymisiert_am`, spaltenscharf freigegeben) plus neue
  Tabelle `klient_archiv_pdf` — ein Snapshot pro Archivierungsvorgang,
  append-only wie `tagesbericht_dokument`/`rechnung_dokument`. Bewusst
  ohne `UNIQUE(klient_id)`: Archivieren → Entarchivieren → erneutes
  Archivieren erzeugt einen weiteren, unabhängigen Snapshot, keiner wird
  überschrieben — alle bleiben als Beleg herunterladbar.
- **„Eingefroren" ist zweifach durchgesetzt.** Serverseitig prüft eine
  neue Funktion `klientIstArchiviert()` (`common/standort-restriction.ts`,
  bewusst getrennt von `klientIstErlaubt()` — Sichtbarkeit und
  Schreibbarkeit sind unterschiedliche Achsen) an 16 Schreibpfaden über
  sechs Services (Tagesberichte, Rechnungen, Kostenübernahmen,
  Kassenbuch, Stammdaten/Kontakte, Zimmer-Ein-/Auszug). Frontend-seitig
  steht das gesamte Tab-Inhaltsgebiet in `KlientDetail.tsx` in einem
  einzigen `<fieldset disabled={...}>` — deaktiviert automatisch jeden
  verschachtelten Button/Input/Select/Textarea (auch die Knöpfe, die ein
  Bearbeiten-Modal erst öffnen), ohne dass jede einzelne Schreibaktion
  separat verdrahtet werden musste. Reine Lese-Links bleiben unberührt,
  `<a>` ist kein „listed" Formularelement. `.zv-link-btn` bekam dabei
  einen fehlenden `:disabled`-Stil nachgerüstet (sonst sah ein
  eingefrorener Link-Knopf identisch zu einem aktiven aus).
- **PDF-Erzeugung mit `pdf-lib`** (neue Abhängigkeit, reines JS, keine
  nativen Bindings). Zweistufiger Aufbau, weil Seitenzahlen fürs
  Inhaltsverzeichnis erst nach dem vollständigen Aufbau feststehen
  (eingebettete Fotos/PDF-Anhänge verschieben nachfolgende Kapitel um eine
  vorab unbekannte Seitenzahl): zuerst wird der komplette Inhalt in ein
  eigenständiges Dokument gebaut, das dabei mitzählt, auf welcher Seite
  jedes Kapitel beginnt; erst danach entsteht das finale Dokument mit
  Deckblatt und Inhaltsverzeichnis davor, dessen Seitenzahlen jetzt
  bekannt sind. Kassenbuch/Rechnungen/Tagesberichte werden ab zwei
  Kalenderjahren automatisch nach Jahr gruppiert, damit das
  Inhaltsverzeichnis bei langen Aufenthalten nicht unlesbar wird.
  Hochgeladene PDF-Dokumente werden direkt hinter ihrem Eintrag per
  `copyPages()` eingehängt, Fotos (PNG/JPEG) auf einer eigenen Seite
  eingebettet — WebP (ebenfalls erlaubter Upload-Mimetyp) kann `pdf-lib`
  nicht einbetten, dafür steht ein Verweistext im PDF, das Original
  bleibt über die normale Dokumentenansicht der Akte weiterhin abrufbar.
- **DSGVO/Anonymisierung bleiben unabhängig.** `KlientService.anonymisieren()`
  prüft bewusst nicht auf Archivierung — das Recht auf Löschung darf nicht
  durch einen operativen Status blockierbar sein.
- **`GET /klienten` filtert jetzt standardmäßig** auf `archiviert_am IS
  NULL`, mit `?archiviert=true` für den neuen Archiv-Reiter. Das ist
  zugleich der zentrale Hebel gegen versehentliche Aktionen: jede
  Klient-Auswahl im Frontend, die aus dieser Liste speist (Kassenbuch-,
  Tagesbericht-, Rechnungs-Formular), schließt archivierte Klient:innen
  damit automatisch aus — die 16 Schreibsperren oben sind die zweite
  Verteidigungslinie für eine schon offene `KlientDetail`-Seite.

Geprüft: 8 neue e2e-Tests (`klient-archivierung.e2e-spec.ts`) — Rollen-Gate
für Archivieren/Entarchivieren (`403`, Zustand bleibt nachweislich
unverändert), PDF-Snapshot entsteht und ist mit korrekten Headern
(`Content-Type`, `Content-Disposition: attachment`, `X-Datei-Hash`)
herunterladbar und beginnt mit `%PDF-`, `409` bei doppeltem Archivieren
bzw. Entarchivieren eines nicht archivierten Klienten, `400` an allen
sechs betroffenen Schreibpfaden, Sichtbarkeitsfilter in beide Richtungen,
Entarchivieren stellt Schreibbarkeit wieder her bei erhaltenem
PDF-Snapshot, Mandantentrennung. Alle 275 API-Tests grün (24 Suiten). Zwei
Gegenproben: Rollenprüfung in `archivieren()` auskommentiert → der
403-Test wurde rot (und zwei weitere kaskadierend, weil der unautorisierte
Archivierungsversuch den Zustand tatsächlich verändert hatte); Prüfung
wiederhergestellt, wieder grün. `klientIstArchiviert()`-Guard an einer
repräsentativen Stelle (`rechnung.service.ts`, `anlegen()`) auskommentiert
→ genau der zugehörige 400-Test wurde rot (`201` statt `400`);
wiederhergestellt, wieder grün — nicht an allen 16 Stellen einzeln
geprüft, da das Muster überall identisch ist. `pnpm build` (shared + api +
web) sauber. Live im Browser geprüft (Hell- und Dunkelmodus): Tagesbericht
vor dem Archivieren anlegen, archivieren, „schreibgeschützt"-Hinweis und
sichtbar deaktivierte Knöpfe prüfen, echten PDF-Download auslösen und den
Inhalt verifiziert (Deckblatt, Inhaltsverzeichnis mit korrekten
Seitenzahlen, der zuvor angelegte Tagesbericht erscheint im PDF),
entarchivieren, erneut archivieren → zweiter, unabhängiger Snapshot in der
Liste — Testmandant danach wieder entfernt.

**Nachtrag — Ein-/Auszüge vorausschauend planen + Zimmer-Warteliste.**
Zwei Lücken schlossen sich zusammen: ein Auszug ließ sich zwar mit
beliebigem Datum eintragen, aber die Oberfläche behandelte jeden
gesetzten Auszug sofort als „schon ausgezogen" — auch wenn das Datum noch
in der Zukunft lag. Wer vorausschauend plante, sah den Bewohner und das
Zimmer sofort als frei, obwohl niemand ausgezogen war. Dazu kam: ein
einmal eingetragener Ein- oder Auszug ließ sich nicht mehr korrigieren,
wenn sich ein Termin verschob.
- **Bugfix „noch wohnhaft" statt „kein Auszug gesetzt".** Die drei
  Stellen, die daraus den aktuellen Bewohner ableiten
  (`zimmer.service.ts: ladeBewohner()`, `klient.service.ts: findeAlle()`/
  `holeDetail()`), prüfen jetzt `einzug <= heute AND (auszug IS NULL OR
  auszug > heute)` statt nur `auszug IS NULL`. Ein geplanter künftiger
  Auszug wird jetzt als „Auszug geplant am …"-Hinweis neben dem Namen
  angezeigt, statt den Bewohner verschwinden zu lassen; `entlassenAm`
  bleibt entsprechend `null`, solange der Aufenthalt noch läuft.
- **Belegung nachträglich korrigieren** (Migration 0037): die App-Rolle
  darf jetzt neben `auszug` auch `einzug` ändern (vorher für immer fest,
  siehe 0020). Neue Route `PATCH /belegungen/:id/bearbeiten` nimmt immer
  beide Felder entgegen (kein Partial-Update — sonst wäre unklar, ob ein
  fehlendes Feld „unverändert" oder „auf null setzen" bedeutet); `auszug:
  null` nimmt einen irrtümlich eingetragenen Auszug wieder zurück. Die
  bestehenden Überlappungs-/Kapazitätsprüfungen (0010, 0032) greifen
  automatisch auch bei diesem `UPDATE`, eine Korrektur, die mit einer
  anderen Belegung kollidiert, wird genauso mit `409` abgelehnt wie ein
  neuer Einzug. Offen für alle Rollen, wie `einziehen()`/`ausziehen()`
  selbst — operatives Tagesgeschäft, kein Zimmer-Stammdaten-Fall.
- **Zimmer-Warteliste** (Migration 0038, neue Tabelle
  `zimmer_warteliste`): für den Fall, dass ein Zimmer voll ist, aber ein
  zugesagter neuer Klient oder ein bestehender Bewohner, der umziehen
  möchte, schon vorgemerkt werden soll, sobald ein Platz frei wird.
  Bewusst **ohne Datum** — nur eine Reihenfolge nach Eintragungszeitpunkt,
  kein festes Versprechen. Ein Klient kann gleichzeitig auf mehreren
  Wartelisten stehen; sobald er **irgendwo** tatsächlich einzieht,
  verschwindet er automatisch von **allen** — durchgesetzt per Trigger
  `zimmer_warteliste_aufraeumen()` (`AFTER INSERT ON belegung`), nicht im
  Anwendungscode, damit das unabhängig vom Aufrufer garantiert passiert.
  „Einziehen" direkt aus der Warteliste öffnet denselben Zuweisen-Dialog
  wie sonst, nur mit festgelegtem statt wählbarem Klienten.
- **Auf beiden Seiten sichtbar und bearbeitbar**, wie gefordert: die
  Zimmerkarte zeigt Warteliste, Belegungsverlauf (jetzt mit „Geplant"-Pille
  für noch nicht begonnene Einträge) und eine Bearbeiten-Aktion je Eintrag;
  die Klientenakte zeigt denselben Auszug-geplant-Hinweis, eine
  Bearbeiten-Aktion für die laufende Belegung und eine neue
  „Wartelisten"-Zeile mit allen Zimmern, für die der Klient vorgemerkt ist.

Geprüft: zwei neue e2e-Spec-Dateien — `belegung-bearbeiten.e2e-spec.ts`
(Korrektur beider Datumsfelder, Zurücksetzen von `auszug` auf `null`,
Kollision mit bestehender Belegung → `409`, Auszug vor Einzug → `400`,
Standort-Sichtbarkeit, archivierter Klient → `400`, sowie der zentrale
Regressionstest: ein künftig geplanter Auszug lässt Zimmerstatus,
Bewohnerliste, `aktuellesZimmer` und `entlassenAm` unverändert aktuell)
und `zimmer-warteliste.e2e-spec.ts` (Hinzufügen, doppeltes Hinzufügen →
`409`, Entfernen, mehrere gleichzeitige Wartelisten, archivierter Klient
→ `400`, Standort-Sichtbarkeit, und als Kernaussage: Einzug in ein
drittes, unbeteiligtes Zimmer entfernt den Klienten von allen
Wartelisten). Alle 290 API-Tests grün (26 Suiten). Gegenproben: die
korrigierte JOIN-Bedingung in `ladeBewohner()` testweise auf die alte
Fassung zurückgesetzt → sowohl der Korrektur- als auch der
Regressionstest wurden rot wie erwartet, wiederhergestellt wieder grün;
der Warteliste-Aufräum-Trigger per `DROP TRIGGER` entfernt → derselbe
Einzug-in-ein-drittes-Zimmer-Ablauf ließ den Klienten jetzt nachweislich
fälschlich auf der alten Warteliste stehen, Trigger wiederhergestellt.
`pnpm build` (shared + api + web) sauber. Live im Browser geprüft: Auszug
in der Zukunft eintragen → Bewohner bleibt mit „Auszug geplant"-Pille
sichtbar (Zimmer- und Klientenseite), Belegung nachträglich korrigieren
über das neue Bearbeiten-Modal, zwei Klient:innen auf die Warteliste
eines vollen Zimmers setzen, einen davon direkt aus der Warteliste mit
einem nach dem geplanten Auszug liegenden Datum einziehen lassen → er
erscheint im Belegungsverlauf als „Geplant ab …", verschwindet aus der
Warteliste, der aktuelle Bewohner bleibt unberührt. Testmandant danach
wieder entfernt.

**Nachtrag — Anwärter: abgespeckter Klient für Anfragen.** Bisher begann
jeder Datensatz als vollständiger Klient mit Aktenzeichen und
Amtszuordnung — beides Pflichtfelder, eindeutig je Träger. Für eine bloße
Anfrage (Jugendamt ruft an, Familie meldet sich) gibt es das Aktenzeichen
aber oft noch nicht, eine Aufnahme ist ja gerade erst in Prüfung. Dafür
jetzt eine eigene, schlanke Tabelle `anwaerter` (Migration 0039) statt
optionaler Felder auf `klient` — ein Klient bleibt dadurch immer
vollständig, nichts im bestehenden Code (Kassenbuch, Rechnungen,
Zimmerzuweisung) muss einen unvollständigen Klienten vertragen.
- **Pflichtfelder nur Vor- und Nachname**, dazu optional Telefon, E-Mail,
  anfragende Stelle (Freitext — Jugendamt, Familie, andere Einrichtung …),
  Geburtsdatum und eine Notiz. Anlegen/Bearbeiten/Löschen bleibt für alle
  Rollen offen, solange die Anfrage `offen` ist — reines Tagesgeschäft,
  kein Stammdaten-Fall.
- **Status `offen → angenommen/abgelehnt`**, durchgesetzt über
  CHECK-Constraints nach demselben Muster wie
  `zimmer_kapazitaetsantrag`/`kassenbuchung_stornoantrag`: `angenommen`
  verlangt eine gesetzte `klient_id` und verbietet einen Ablehnungsgrund,
  `abgelehnt` umgekehrt. Eine einmal getroffene Entscheidung ist endgültig
  — `aktualisieren()`/`loeschen()` greifen per `WHERE status = 'offen'`
  nicht mehr, ein zweiter Entscheidungsversuch liefert `409`.
- **„Annehmen" legt in derselben Transaktion einen echten Klienten an**
  (Vorname/Nachname/Geburtsdatum übernommen, Aktenzeichen/Amt/
  HZL-Rhythmus werden dabei erstmals erfragt) und verweist vom
  Anwärter-Datensatz darauf; die Route gibt den fertigen `KlientDetailDto`
  zurück, damit die Oberfläche direkt in die neue Akte wechseln kann.
  **Rollengegated auf Bereichs-/Einrichtungsleitung** (wie
  `ROLLEN_MIT_ARCHIVIERUNG`): eine Aufnahmeentscheidung ist eine
  strukturelle Entscheidung über die Einrichtung, kein alltägliches
  Erfassen einer Anfrage. „Ablehnen" verlangt denselben Rollen und ein
  Pflichtfeld „Grund" (`GrundAbfrage`-Komponente, schon von der
  Kapazitäts-Ablehnung bekannt).
- **Kein neuer Sidebar-Eintrag.** Die Anfragen hängen als dritter Reiter
  „Anwärter" auf der bestehenden Klienten-Seite, mit eigenen Status-
  Unterreitern (Offen/Angenommen/Abgelehnt) und eigener Tabelle.
  Annehmen/Ablehnen-Aktionen erscheinen clientseitig nur für die
  berechtigten Rollen (`tokenRolle()`, wie `darfArchivieren`) — die API
  lehnt zusätzlich serverseitig ab.
- Erstes Modul in diesem Repository, das `KlientService` modulübergreifend
  importiert (`KlientModule` bekam dafür erstmals ein `exports: [...]`),
  um nach „Annehmen" direkt den fertigen `KlientDetailDto` zu liefern —
  gleiches Kompositionsmuster wie `KlientController.archivieren()`.

Geprüft: neue `anwaerter.e2e-spec.ts` (Anlegen mit nur Vorname/Nachname,
Status-Filter, Bearbeiten/Löschen nach Entscheidung → `400`, Annehmen/
Ablehnen `403` für `betreuer` mit Gegenprobe-Folge-GET auf unverändert
`offen`, Ablehnen ohne Grund → `400`, erfolgreiches Annehmen mit Prüfung
der neu angelegten Klientenfelder und der `klientId`-Verknüpfung, doppelte
Entscheidung → `409`, Mandantentrennung) — 10 neue Tests. Alle 300
API-Tests grün (27 Suiten). Zwei Gegenproben: Rollenprüfung in
`annehmen()`/`ablehnen()` auskommentiert → beide `403`-Tests wurden rot,
wiederhergestellt wieder grün; `WHERE status = 'offen'`-Klausel beim
Ablehnen entfernt → der 409-Test (zweite Entscheidung) wurde rot (`200`
statt `409`), wiederhergestellt wieder grün. `pnpm build` (shared + api +
web) sauber. Live im Browser geprüft: Anfrage mit nur Vor-/Nachnamen
anlegen, bearbeiten, annehmen → neuer Klient mit korrektem Aktenzeichen
erscheint und öffnet sich automatisch in der Akte; zweite Anfrage
ablehnen → Grund sichtbar, Status-Filter zeigt sie unter „Abgelehnt";
Rollen-Check mit einem `betreuer`-Konto (Annehmen/Ablehnen-Knöpfe fehlen
clientseitig). Dabei zusätzlich eine unabhängige, vorbestehende Anzeige-
Lücke gefunden und behoben: das Geburtsdatum in der Kopfzeile der
Klientenakte erschien unformatiert (`2008-04-12` statt `12.04.2008`), weil
dort als einzige Stelle im Dateikopf `formatDatum()` fehlte. Testmandant
danach wieder entfernt.

**Nachtrag — Anwärter als Untermenüpunkt + anpassbare Menü-Reihenfolge.**
Zwei Wünsche zur Hauptnavigation: „Anwärter" steckte bisher nur als Reiter
*innerhalb* der Klienten-Seite und war darüber kaum zu entdecken; und die
Reihenfolge der Hauptmenüpunkte lag fest im Code (`Shell.tsx`), mit
Dashboard bewusst nicht an erster Stelle (Kriterium war Aufrufhäufigkeit,
nicht Wichtigkeit) — das sollte stattdessen jede:r selbst einstellen
können.
- **Neues Modul `apps/web/src/navigation.ts`** zentralisiert die
  Hauptmenüpunkte (`STANDARD_REITER`) und die Reihenfolge-Logik
  (`ladeMenuReihenfolge()`/`speichereMenuReihenfolge()`/
  `reiterNachReihenfolge()`), damit `Shell.tsx` (rendert die Navigation)
  und `Einstellungen.tsx` (rendert den Editor) dieselbe Quelle nutzen.
  Dashboard steht in `STANDARD_REITER` jetzt an erster Stelle.
- **„Klienten" ist jetzt eine aufklappbare Gruppe** in der Sidebar: ein
  Pfeil klappt zwei Unterzeilen auf, „Klienten" und „Anwärter" — beide
  führen auf dieselbe Seite, nur direkt auf die jeweilige Ansicht. Der
  Zustand „welche Ansicht zeigt Klienten" liegt dafür jetzt in `Shell.tsx`
  statt lokal in `Klienten.tsx` (als Props `ansicht`/`onAnsichtChange`
  durchgereicht); das bestehende Segmented-Control „Aktiv / Archiv /
  Anwärter" in der Seite selbst bleibt unverändert erhalten — wichtig für
  Mobilgeräte ohne Sidebar und als zweiter Zugang auf Desktop. Im
  eingeklappten Menüband bleiben Pfeil und Unterpunkte bewusst
  ausgeblendet (kein Platz, keine Funktion verloren: „Klienten" selbst
  bleibt klickbar, „Anwärter" weiterhin über den Reiter in der Seite
  erreichbar).
- **Reihenfolge der Hauptmenüpunkte frei einstellbar** (Einstellungen →
  Darstellung, neuer Abschnitt): eine Liste aller Menüpunkte, sortierbar
  per nativem HTML5-Drag-and-Drop *und* per Auf/Ab-Pfeil-Knöpfen an jeder
  Zeile. Die Pfeile sind dabei kein optischer Fallback, sondern
  gleichwertig — natives Drag & Drop funktioniert nicht per Tastatur und
  auf den meisten Touch-Browsern nicht (iOS/Android), und diese PWA läuft
  nachweislich auf echten Mobilgeräten (siehe „Fallstricke" oben). Ein
  „Standardreihenfolge wiederherstellen"-Knopf dient als Sicherheitsnetz,
  falls sich jemand z. B. „Einstellungen" selbst wegsortiert. Gilt nur für
  dieses Gerät (`localStorage`, wie Theme und Menüband-Einklappen),
  einwilligungsfrei nach TTDSG §25 Abs. 2.

Geprüft: `pnpm --filter @zimmerakte/web build` (Typecheck + Vite-Build)
sauber, `pnpm test:api` erneut grün (300 Tests, 27 Suiten — reine
Backend-Regression, diese Änderung betrifft nur das Frontend). Live im
Browser geprüft (Playwright): Sidebar zeigt „Klienten" mit Pfeil, Klick
klappt „Klienten"/„Anwärter" auf und zu, Klick auf „Anwärter" öffnet direkt
die Anwärter-Ansicht (Segmented Control in der Seite zeigt sie als aktiv);
in den Einstellungen Dashboard sowohl per Drag & Drop als auch per
Pfeil-Knopf verschoben, Reihenfolge ändert Sidebar sofort und übersteht
einen Reload, „Standardreihenfolge wiederherstellen" setzt sie zurück;
eingeklapptes Menüband zeigt erwartungsgemäß weder Pfeil noch Unterpunkte,
„Klienten" bleibt klickbar. Testmandant danach wieder entfernt.

**Nachtrag — Klienten-Reiterleiste entfernt, Archiv als zweiter
Sidebar-Unterpunkt.** Die eben eingeführten Sidebar-Unterpunkte sollten
die komplette Navigation übernehmen — die „Aktiv / Archiv / Anwärter"-
Reiterleiste *auf* der Klienten-Seite selbst war dann nur noch doppelt
gemoppelt und sollte ganz verschwinden.
- **`KLIENTEN_UNTERPUNKTE`** in `Shell.tsx` zeigt jetzt genau die zwei
  Unterpunkte „Anwärter" und „Archiv" (vorher stand "Klienten" dort
  zusätzlich doppelt neben dem Hauptknopf). Der Hauptknopf „Klienten"
  navigiert weiterhin direkt auf die Standardansicht.
- **`Klienten.tsx` zeigt keine eigene Reiterleiste mehr** — die
  `zv-segmented`-Gruppe mit den drei Ansichts-Knöpfen ist komplett
  entfernt. Die Seitenüberschrift zeigt stattdessen die aktive Ansicht
  („Klienten"/„Archiv"/„Anwärter") als einzige verbleibende Orientierung.
  Der Status-Filter *innerhalb* der Anwärter-Ansicht (Offen/Angenommen/
  Abgelehnt) bleibt unverändert, das war nicht gemeint.
- **Mobile Navigation nachgezogen**, sonst hätte es auf dem Handy (keine
  Sidebar vorhanden) gar keinen Weg mehr zu Archiv/Anwärter gegeben: ein
  Tap auf „Klienten" in der unteren Reiterleiste öffnet dort jetzt ein
  eigenes Panel mit allen drei Ansichten (`Klienten`/`Anwärter`/`Archiv`),
  nach demselben Muster wie das bestehende „Mehr"-Sammelmenü (gleiche
  `.zv-sammelmenue`-Optik, Escape/Außenklick/Tab-Fokusfalle). Der bisherige
  `mehrOffen`-Boolean wurde dafür zu einem gemeinsamen
  `offenesPanel: "mehr" | "klienten" | null` verallgemeinert, damit nie
  beide Panels gleichzeitig offen sind — unabhängig davon, ob „Klienten"
  gerade in der sichtbaren Reiterleiste steht oder (nach einer eigenen
  Umsortierung) im „Mehr"-Menü gelandet ist.

Geprüft: `pnpm --filter @zimmerakte/web build` sauber, `pnpm test:api`
weiterhin 300/300 grün (reine Frontend-Änderung). Live im Browser
geprüft (Playwright, Desktop- und 390px-Mobilbreite): Klick auf „Klienten"
landet auf der Seite ohne jede Reiterleiste; die Sidebar-Unterpunkte
zeigen „Anwärter"/„Archiv", ein Klick wechselt die Ansicht und die
Überschrift korrekt; auf dem Handy öffnet ein Tap auf „Klienten" das neue
Panel mit allen drei Ansichten, eine Auswahl schließt es und wechselt
sauber, Escape schließt es ebenfalls. Testmandant danach wieder entfernt.

**Nachtrag — Organigramm-Modul, Schritt 2: zentrale Rechte-Engine.**
Zweiter Schritt des mit dem Nutzer abgestimmten Organigramm-Plans (siehe
Nachtrag "Schritt 1" oben für das Datenmodell). Baut die Rechte-Engine
selbst, verdrahtet sie aber noch an keinen bestehenden Endpunkt — alle 14
heutigen `ROLLEN_MIT_*`-Prüfungen bleiben unverändert in Kraft.
- `apps/api/src/rechte/registry.ts` — Modul×Aktion ist eine Code-Registry,
  nicht die Datenbank: "neue Module erscheinen automatisch in der Matrix"
  heißt, diese Liste zu erweitern reicht, keine DB-Zeile nötig. Markiert
  sensible Aktionen (Klientenakte lesen, Kassenbuch buchen/freigeben,
  Kostenübernahme genehmigen) und `manage-permissions` als nie delegierbar.
- `apps/api/src/rechte/rechte.service.ts` — `hatRecht(modul, aktion)` und
  `ermittleErlaubteOrgUnitIds(modul, aktion)`, als eigenständige,
  dokumentierte Schrittfolge geschrieben statt einer großen SQL-Abfrage.
  Wildcard-Kurzschluss für `ist_vollzugriff`-Account-Typen (Geschäftsführung)
  — liefert das Sentinel `"alle"`, das von keinem Deny eingeschränkt wird.
  Jede andere Position mit Scope `tenant` wird dagegen zur konkreten Liste
  aller `org_unit`-Ids aufgelöst, damit ein Deny einer anderen Position sie
  noch einschränken kann ("Deny gewinnt pro Org-Unit, nicht pro
  Mitarbeiter" — exakt für den Mehrfachpositionen-Fall nachgewiesen).
  Stabsstellen ignorieren den gespeicherten Scope-Wert komplett und nutzen
  ausschließlich `org_position_stabsstelle_scope`, über die Closure-Tabelle
  auf ihre Nachfahren ausgeweitet. Vertretung nie rekursiv (löst die Rechte
  des Vertretenen immer direkt aus dessen Positionen auf, nie über eine
  zweite eingehende Delegation) — schließt Kettenvertretung strukturell
  aus, nicht nur per Regel.
- `apps/api/src/rechte/rechte.guard.ts` + `rechte.decorator.ts` —
  `@ErfordertRecht(modul, aktion)`, analog zu `@Authenticated()`. Eigene
  Herausforderung: Guards laufen in Nest vor allen Interceptoren, also vor
  `TenantContextInterceptor` — der Guard spannt den Tenant-Kontext deshalb
  für die Dauer seiner eigenen Prüfung selbst auf (aus `request.benutzer`,
  das `AuthGuard` bereits gesetzt hat), unabhängig von der späteren,
  inhaltlich identischen Aufspannung durch den Interceptor für den
  eigentlichen Handler.
- Noch nicht an einem echten Endpunkt im Einsatz — das folgt in
  Lieferreihenfolge-Schritt 4 (die 14 bestehenden Stellen einzeln
  umstellen) bzw. Schritt 6 (neue API-Module).

Gefunden und behoben während der Verifikation: zwei echte Testbugs, kein
Produktivcode betroffen. (1) Eine Testerwartung ging von einem falschen
Verständnis der Stabsstellen-Scope-Auflösung aus (erwartete nur die
Einrichtung selbst, tatsächlich korrekt ist die Ausweitung auf den
gesamten Teilbaum darunter). (2) Das Test-Teardown löschte pauschal alle
Positionszuweisungen eines Testmandanten und verletzte dabei den
"letzter Vollzugriff-Inhaber bleibt bestehen"-Schutz aus Schritt 1 — ein
mitten im Aufräumen geworfener Fehler ließ `admin.end()`/`app.close()`
nie laufen und hängte dadurch offene Datenbankverbindungen, was den
Jest-Prozess unbegrenzt am Leben hielt (sichtbar als scheinbar
hängender Testlauf). Behoben durch gezieltes Deaktivieren des Schutz-
Triggers nur für die Dauer des Aufräumens plus `try/finally`, damit die
Verbindungen auch bei einem Fehlschlag garantiert geschlossen werden.

Geprüft: neue `rechte-engine.e2e-spec.ts` (16 Tests) — Account-Typ-Default,
impliziter Deny, Override (additiv und subtraktiv), Deny-pro-Scope bei
Mehrfachposition, Stabsstelle-Sonderfall, Subtree-Scope über mehrere
Ebenen, Einrichtungs-Scope-Ermittlung von einer Team-Position aus
(überspringt den Bereich), Wildcard-Geschäftsführung (inkl. eines
Modul/Aktion-Paars ohne jede Datenbank-Zeile), Subjekt-Typ extern
(Zugriff über `assigned`-Scope, aber nie eine Org-Unit-Menge, nie
Vollzugriff), sowie der komplette Vertretungs-Themenblock (Erbschaft,
sensible Rechte per Default ausgeschlossen, `manage-permissions`
strukturell ausgeschlossen, keine Kettenvertretung, Addition statt
Ersetzung der eigenen Rechte). Alle 316 API-Tests grün (28 Suiten,
16 davon neu). Zwei Gegenproben: Wildcard-Kurzschluss auskommentiert →
der Wildcard-Test wurde rot (`false` statt `true`), wiederhergestellt;
Kettenvertretungs-Schutz testweise aufgehoben → der
Kettenvertretungs-Test wurde rot (`true` statt `false`),
wiederhergestellt. `pnpm build` sauber. Testmandant danach wieder
entfernt.

**Nachtrag — Organigramm-Modul, Schritt 3: Rollen→Systemvorlage-Migration.**
Dritter Schritt des Organigramm-Plans (Schritt 1: Datenmodell, Schritt 2:
Rechte-Engine, siehe die beiden Nachträge oben). Bildet `benutzer.rolle`
auf die drei Systemvorlagen-Account-Typen ab, **additiv** — die 14
bestehenden `ROLLEN_MIT_*`-Prüfungen bleiben weiterhin unverändert in
Kraft, nichts Bestehendes ändert sein Verhalten.
- `apps/api/src/rechte/rollen-mapping.ts` — die eine Quelle für "was
  bedeutet `einrichtungsleitung` in Rechten", von Migrationsskript UND
  Abgleichstest gleichermaßen importiert, damit beide nie auseinanderlaufen
  können. `bereichsleitung` braucht keine eigene Liste — das deckt der
  Geschäftsführung-Vollzugriff-Wildcard komplett ab, auch die zwei heute
  `bereichsleitung`-exklusiven Sets (`ROLLEN_MIT_BRANDING`,
  `ROLLEN_MIT_STANDORT_ANLEGEN`).
- `apps/api/src/rechte/registry.ts` erweitert um die bislang fehlenden
  Modul/Aktion-Paare, die die 14 Sets abdecken (u. a. `zimmer.voller-verlauf`,
  `kassenbuch.storno-entscheiden`, neue Module `standorte`, `rechnungen`,
  `mandanten`) — jede neue Zeile trägt einen Kommentar, welches
  `ROLLEN_MIT_*`-Set sie ablöst.
- `apps/api/scripts/rollen-migration.ts` — Dry-Run (Default) und
  `--anwenden` teilen sich **denselben** Code (`verarbeiteMandant()`),
  unterscheiden sich nur darin, ob die umschließende Transaktion
  `COMMIT`et oder `ROLLBACK`t wird — kein zweiter, parallel gepflegter
  Simulationspfad. Idempotent (jede `sicherXyz()`-Funktion prüft zuerst,
  ob die Zeile schon existiert), `--mandant <slug>` beschränkt auf einen
  Mandanten, `--rueckgaengig` entfernt die drei Systemtypen wieder
  (geschützt, solange niemand von Hand an der neuen Struktur
  weitergearbeitet hat). `verarbeiteMandant()` ist exportiert, damit der
  Abgleichstest die ECHTE Abbildungslogik aufruft, nicht eine im Test
  nachgebaute Kopie.
  - `bereichsleitung` → Geschäftsführung (`ist_vollzugriff`), eine
    Position am Träger-Wurzelknoten.
  - `einrichtungsleitung`/`betreuer` → je eine Position pro Einrichtung,
    aus `benutzer_standort` abgeleitet (leer = alle Einrichtungen, sonst
    genau die zugeordneten — deckt den Springer-Fall aus Schritt 1 direkt
    ab, ohne eigenen Sonderfall im Skript).
- `apps/api/test/rollen-migration-abgleich.e2e-spec.ts` — genau die vom
  Plan geforderte Verifikation ("jede der 14 Mengen gegen die neu
  aufgelösten Rechte", nicht per Annahme): ein frischer Testmandant mit je
  einem Benutzer pro Rolle, `verarbeiteMandant()` darauf angewendet, dann
  `RechteService.hatRecht()` für alle 14 Gates gegen die tatsächliche
  `ROLLEN_MIT_*`-Zugehörigkeit geprüft (`bereichsleitung`: alle 14 inkl.
  der 2 exklusiven; `einrichtungsleitung`: genau die 12 gemeinsamen, die 2
  exklusiven explizit verneint; `betreuer`: keines).

Geprüft: neue `rollen-migration-abgleich.e2e-spec.ts` (5 Tests, davon eine
Gegenprobe: die Zusatzrechte-Zeilen der Einrichtungsleitung testweise
gelöscht → alle 12 Gates wurden `false` statt `true`, wiederhergestellt).
Zusätzlich manuell gegen einen Testmandanten mit 2 Standorten/5 Benutzern
(Bereichsleitung, eingeschränkte und uneingeschränkte Einrichtungsleitung,
Mehrfachstandort-"Springer", einfacher Betreuer) verifiziert: Dry-Run
schreibt nachweislich nichts (per Datenbankabfrage direkt nach dem Lauf),
`--anwenden` legt genau die erwarteten Zeilen an (inkl. korrekter
Positions-Wiederverwendung bei mehreren Benutzern derselben Einrichtung),
ein zweiter Dry-Run danach meldet 0 neue Zeilen (Idempotenz),
`--rueckgaengig` entfernt alles wieder vollständig. Alle 321 API-Tests
grün (29 Suiten, 5 davon neu gegenüber Schritt 2). `pnpm build` sauber.
Beide Testmandanten danach wieder vollständig entfernt.

**Nachtrag — Organigramm-Modul, Schritt 4: die 14 `ROLLEN_MIT_*`-Stellen
auf die Rechte-Engine umgestellt.** Vierter Schritt des Organigramm-Plans
(additiv, neun einzelne Commits — je ein Fachmodul, bestehende Tests
blieben nach jedem Schritt grün). Jede Stelle `if (!ROLLEN_MIT_X.has(ctx.rolle))`
wurde durch `if (!(await rechte.hatRecht(modul, aktion)))` ersetzt:

| Datei | Gate(s) |
|---|---|
| `mandant.service.ts` | `mandanten.branding-bearbeiten` |
| `standort.service.ts` | `standorte.anlegen`, `standorte.bearbeiten` |
| `klient-archiv.service.ts` / `klient.service.ts` | `klienten.archivieren`, `klienten.anonymisieren` |
| `benutzer.service.ts` | `mitarbeitende.anlegen`, `mitarbeitende.standort-zuweisen` |
| `anwaerter.service.ts` | `anwaerter.entscheiden` |
| `rechnung.service.ts` | `rechnungen.status-wechseln` |
| `aufgabe.service.ts` | `aufgaben.koordinieren` |
| `kassenbuchung-typ.service.ts` / `kassenbuchung.service.ts` | `kassenbuch.typen-verwalten`, `kassenbuch.storno-entscheiden` |
| `zimmer.service.ts` | `zimmer.bearbeiten`, `zimmer.voller-verlauf` |

- **Was bewusst NICHT umgestellt wurde**, weil es keine der 14 Mengen ist,
  sondern eigene Anwendungslogik: die ODER-Bedingung „eigene/zugewiesene
  Aufgabe" in `aufgabe.service.ts` (`darfSchreiben()` dafür async
  geworden, mit der Rechte-Engine per `await` kombiniert, nicht ersetzt);
  die Eskalationsschutz-Prüfungen in `benutzer.service.ts` („Einrichtungsleitung
  darf niemanden zur Bereichsleitung machen", „nur die eigenen Standorte
  zuweisen"); die Vier-Augen-Gegenrolle in `zimmer.service.ts::kapazitaetEntscheiden()`
  (`gegenrolle()` — „die jeweils andere Leitungsrolle muss bestätigen" hat
  keine Entsprechung in der Rechte-Engine). Alle drei bleiben auf der
  literalen `ctx.rolle`/`benutzer.rolle`.
- **Jedes betroffene Fachmodul bekam `RechteService` injiziert**
  (Konstruktor-Parameter), sein Modul importiert dafür `RechteModule`
  (nicht global, gleiches Muster wie `AuthModule`).
- **Testfixtures**: bestehende e2e-Specs legen ihre Testbenutzer seit jeher
  per rohem SQL nur mit `benutzer.rolle` an, ohne je die echte
  Rollen-Migration zu durchlaufen — die Rechte-Engine kennt `rolle` aber
  nicht mehr direkt, sie braucht eine echte Position. Neuer Helfer
  `test/support/rollen-migration-test-helper.ts` ruft dafür dieselbe,
  bereits verifizierte `verarbeiteMandant()`-Logik auf (kein zweiter
  Zuordnungspfad nur für Tests) und räumt sie im Teardown wieder auf.
  17 betroffene Testdateien entsprechend ergänzt — davon drei mit einer
  Falle, die erst beim **vollen** Suitelauf auffiel, nicht beim gezielten
  Testlauf des jeweiligen Fachmoduls: ein separater „fremder Mandant" in
  einem Mandantentrennungstest (eigene Migration nötig, sonst scheitert
  der Zugriffsversuch schon an der Rechte-Engine statt — wie dort
  geprüft — an der Mandantentrennung), eine Selbstbewilligungs-Weiche bei
  Kassenbuch-Storno und ein `belegungsverlauf()`-Aufruf mit vollem Namen,
  jeweils in einer Datei, deren Name das nicht erkennen ließ.

Geprüft: nach jedem der neun Teilschritte `pnpm test:api` vollständig
321/321 grün (29 Suiten), `pnpm build` sauber — kein Schritt hat
Bestehendes gebrochen. `benutzer.rolle`/`TenantContext.rolle` bleiben
bestehen (Default-Zuordnung neuer Mitarbeiter, die drei oben genannten
Ausnahmen), werden aber für keine der 14 Rechteprüfungen mehr direkt
befragt — das war der Zweck dieses Schritts.

**Nachtrag — Organigramm-Modul, Schritte 5 und 6 (lesend), parallel über
zwei isolierte Subagenten erarbeitet.** Beide Schritte berühren disjunkte
Dateien (Kassenbuch vs. drei neue Module) und liefen deshalb in eigenen
Git-Worktrees gleichzeitig; diese Session hat anschließend beide Branches
geprüft, gemergt, die Testfolgen der Vier-Augen-Verschärfung in zwei
bestehenden Dateien nachgezogen und die volle Suite einmal gemeinsam
grün bekommen.

**Schritt 5 — Kassenbuch-Vier-Augen-Verschärfung.** Bislang durfte sich
eine Bereichs- oder Einrichtungsleitung, die selbst gebucht hatte, den
eigenen Storno-Antrag im selben Zug bewilligen. Migration 0045 erzwingt
jetzt per `BEFORE UPDATE`-Trigger auf `kassenbuchung_stornoantrag`
(Custom-SQLSTATE `ZA002`), dass die entscheidende Person nie die buchende
sein darf — **ohne Ausnahme, auch nicht für Geschäftsführung** (eine der
drei harten Ausnahmen vom Vollzugriff-Wildcard). `stornoBeantragen()`
fängt den Normalfall schon vorher mit einer verständlichen Meldung ab
(Antrag bleibt offen statt automatisch bewilligt), `stornoEntscheiden()`
übersetzt das Custom-SQLSTATE in einen 403 statt eines rohen 500ers. Neuer
Test `kassenbuch-vier-augen.e2e-spec.ts` (4 Tests) deckt den Normalfall,
eine DB-Gegenprobe (roher `UPDATE` als App-Rolle scheitert mit `ZA002`)
und den explizit geforderten „unter Vertretung"-Fall ab: eine Person ohne
eigenes Recht, die sich `kassenbuch.storno-entscheiden` per direkt
angelegter Delegation leiht, darf trotzdem nicht über die eigene Buchung
entscheiden — die Regel kennt keine Ausnahme für den Rechte-Herkunftsweg.
Diese Verhaltensänderung brach 7 bestehende Tests in
`kassenbuch-storno-antrag.e2e-spec.ts` und `kassenbuch.e2e-spec.ts`, die
bislang explizit die alte Selbstbewilligung prüften oder sie implizit
voraussetzten (Buchung und Entscheidung über denselben Leitungs-Token) —
nachgezogen auf das neue Verhalten (eine zweite Leitung entscheidet),
ohne die eigentliche Prüfaussage der Tests zu verändern.

**Schritt 6 (lesend) — neue Module `organigramm/`, `delegation/`,
`audit/`.** Ausschließlich `GET`-Endpunkte, Mutationen (Reparenting,
Account-Typ-Matrix bearbeiten, Delegation anlegen/genehmigen/widerrufen)
folgen in einem späteren Schritt:
- `GET /organigramm/org-units`, `/positions`, `/account-typen` — gated mit
  `organigramm.ansehen`. `/positions` leitet `besetztMit` live aus
  `org_position_besetzung` ab (CLAUDE.md Regel 4) und redigiert
  `benutzerId`/`benutzerName` auf `null`, wenn der Aufrufer
  `organigramm.personendaten-sehen` fehlt — eine Feldredaktion innerhalb
  des Service, nicht Teil des Guards (CLAUDE.md Regel 6, gleiches Muster
  wie `zimmer.voller-verlauf`).
- `GET /delegationen/meine` — Delegationen, an denen der Aufrufer in
  beiderlei Richtung (Vertretener oder Vertreter) beteiligt ist, mit
  abgeleitetem `effektiverStatus` (`beantragt`/`genehmigt`/`aktiv`/
  `abgelaufen`/`widerrufen` aus `status` + `von`/`bis` vs. heute, nie
  gespeichert). Kein besonderes Recht nötig, nur `@Authenticated()`.
- `GET /audit-log` — paginiert (`offset`/`limit`, zod `safeParse` +
  `BadRequestException`), filterbar nach `modul`/`objektTyp`/`objektId`.
  Gated mit `organigramm.manage-permissions`, nicht `ansehen` (Audit-Log
  gehört fachlich zur Rechteverwaltung). Kein Schreib-Endpunkt — das
  Protokoll ist unveränderlich (`REVOKE UPDATE, DELETE`, Migration 0044),
  Schreiben passiert künftig aus den jeweiligen Fachservices heraus.
- **Bewusste Zwischenstand-Einschränkung**: `rollen-mapping.ts` (Schritt 3)
  kennt `organigramm.*` noch nicht für Einrichtungsleitung/Mitarbeiter —
  bis diese Zuordnung ergänzt wird (kein Teil dieses Schritts, wäre
  Scope-Creep in Schritt 3 gewesen), sehen nur `ist_vollzugriff`-Konten
  (Geschäftsführung) diese drei neuen Endpunkte. Das ist erwartetes
  Verhalten, kein Bug — in den Köpfen der drei neuen Testdateien
  dokumentiert.
- 20 neue Tests (`organigramm-lesen.e2e-spec.ts` 10,
  `delegation-lesen.e2e-spec.ts` 4, `audit-log-lesen.e2e-spec.ts` 6),
  Fixtures direkt über `account_typ`/`org_position`/`org_position_besetzung`
  (wie `rechte-engine.e2e-spec.ts`), weil `rollen-mapping.ts` die
  benötigten Rechte für Nicht-Vollzugriff-Konten noch nicht kennt.

Geprüft: `pnpm --filter @zimmerakte/api build` sauber nach dem Merge
beider Branches. Volle Suite **345/345 grün (33 Suiten)** — 321 vorher +
4 (Vier-Augen) + 20 (lesende Endpunkte), keine Regression durch die
parallele Arbeit oder den Merge.

**Nachtrag — Organigramm-Modul, Schritt 7: schreibende Endpunkte für
Delegation und Organigramm, wieder parallel über zwei isolierte
Subagenten.** Vorab ein gemeinsamer Helfer, selbst geschrieben, damit
beide Agenten ihn nicht unabhängig voneinander anlegen und dabei in
Konflikt geraten: `AuditService.protokollieren(client, {...})` schreibt
EINEN `audit_log`-Eintrag innerhalb der Transaktion des aufrufenden
Services (kein eigenes `db.withTenant()` — sonst wäre der Eintrag nicht
atomar mit der Änderung, die er protokolliert). `handelnd_als_vertreter_von`
bleibt dabei vorerst immer `null`: kein bestehender Code-Pfad weiß heute,
ob ein `hatRecht()`-Erfolg über eine eigene Position oder über eine
Delegation aufgelöst wurde — das wird erst mit der UI für Vertretung
nachgezogen.

**Delegation anlegen/genehmigen/widerrufen.** Fachliches Vier-Augen-Prinzip
exakt wie beim Kassenbuch-Storno (Migration 0045), nur ist die "andere
Person" hier nicht über eine Rechteprüfung bestimmt, sondern durch die
Delegation selbst bereits eindeutig festgelegt:
- `POST /delegationen` — nur die VERTRETENE Person kann anlegen (man
  verleiht nur die eigenen Rechte, man beantragt sie nicht für jemand
  anderen). Bei `umfang="auswahl"` wird jedes `{modul,aktion}`-Paar vor
  jedem DB-Insert gegen `istDelegierbar()` geprüft (klare 400-Meldung statt
  dem rohen Fehler aus dem Insert-Trigger von Migration 0043) — eine
  mitgeschickte Rechte-Liste bei `umfang="alle"` wird abgelehnt statt
  stillschweigend ignoriert.
- `PATCH /delegationen/:id/genehmigen` — ausschließlich die im Antrag
  benannte `vertreter_benutzer_id` darf entscheiden, **niemand sonst, auch
  keine eigene Anfrage**. Migration 0046 erzwingt das zusätzlich hart in
  der DB (`BEFORE UPDATE`-Trigger, Custom-SQLSTATE `ZA003`), unabhängig vom
  Code-Pfad — gleiches Zwei-Schichten-Prinzip wie bei Migration 0045.
- `PATCH /delegationen/:id/widerrufen` — beide Seiten dürfen (Widerruf ist
  die "sichere Richtung", kein Vier-Augen-Prinzip nötig).
- Alle drei bleiben wie `GET /delegationen/meine` rein `@Authenticated()`
  — die Berechtigung ist spezifisch für die einzelne Zeile, kein globales
  Modul-Recht.
- 14 neue Tests, inklusive einer DB-Gegenprobe (roher `UPDATE` als
  App-Rolle mit falschem `genehmigt_von` scheitert mit `ZA003`, derselbe
  `UPDATE` mit dem richtigen Wert geht durch).

**Organigramm-Mutationen: Organisationseinheiten, Positionen,
Account-Typen.** Jede Invariante (Closure-Table-Pflege, Zyklenschutz beim
Umhängen, `ist_geplant`-Auto-Clear beim Besetzen, Stabsstelle-Scope nur für
`typ=stabsstelle`, "letzter Vollzugriff-Inhaber bleibt bestehen",
Account-Typ-Matrix-Regeln) steckt bereits als Postgres-Trigger in den
Migrationen 0040–0042 — die neuen Service-Methoden lösen nichts davon
selbst, sie übersetzen nur die resultierenden `P0001`/`23503`/`23505`-Fehler
in verständliche HTTP-Antworten (Vorbild: `rechnung.service.ts`):
- `POST`/`PATCH /organigramm/org-units` — nur `typ="bereich"|"team"`
  anlegbar (Träger/Einrichtung entstehen automatisch per Trigger),
  Umhängen mit Zyklen-Gegenprobe.
- `POST`/`PATCH /organigramm/positions` + `/deaktivieren` +
  `/besetzen` + `/besetzung/:id/beenden` + `/stabsstelle-scope` — kompletter
  Positions-Lebenszyklus (Platzhalter → besetzen → beenden → erneut
  besetzen → deaktivieren), inkl. Zyklen- und `istGeplant`-Gegenprobe.
- `POST`/`PATCH /organigramm/account-typen` + `/rechte` — jedes
  `{modul,aktion}`-Paar wird vor jedem Schreibzugriff komplett gegen
  `istGueltigesRecht()` validiert, bevor überhaupt etwas gelöscht wird;
  `ist_system`-Typen sind vor Umbenennung geschützt, `ist_vollzugriff`-Typen
  bekommen laut Trigger nie einzelne Rechte-Zeilen.
- Struktur-Endpunkte gated mit `organigramm.bearbeiten`, Account-Typ-/
  Rechte-Endpunkte bewusst mit dem engeren `organigramm.manage-permissions`.
- 34 neue Tests, inklusive der "letzter Vollzugriff-Inhaber"-Gegenprobe und
  zwei direkten `audit_log`-Prüfungen gegen echte PostgreSQL.
- Bewusste Zwischenstand-Einschränkung weiterhin unverändert: nur ein
  `ist_vollzugriff=true`-Konto nutzt diese Endpunkte heute (siehe Nachtrag
  zu Schritt 6 oben).

Geprüft: `pnpm --filter @zimmerakte/api build` sauber nach dem Merge beider
Branches (disjunkte Dateien, keine Konflikte). Volle Suite **393/393 grün
(35 Suiten)** — 345 vorher + 14 (Delegation) + 34 (Organigramm-Mutationen).

**Nachtrag — Organigramm-Modul, Schritt 7 (UI), erster Teilschritt:
Organigramm-Grundansicht (lesend).** Diesmal selbst gebaut statt über
Subagenten — die UI-Teilschritte bauen stark aufeinander auf und teilen
sich dieselben Dateien (`Organigramm.tsx`, `Shell.tsx`, `icons.tsx`),
parallele Agenten hätten sich hier eher im Weg gestanden als Zeit gespart.

- Neuer zehnter Hauptreiter „Organigramm" (`navigation.ts`,
  `STANDARD_REITER`) — eigenständiges Modul mit eigener Fläche, bewusst
  kein Unterpunkt wie Anwärter/Archiv unter Klienten.
- `OrgUnitDto`/`PositionDto`/`BesetzungDto`/`AccountTypDto` wandern nach
  `packages/shared` (gespiegelt aus `organigramm.service.ts`) — erster
  Schritt, in dem das Web-Paket diese Typen braucht.
- **Baum-Rendering**: ein selbstgebautes, einfaches Ebenen-Layout statt
  einer neuen Graph-Library (im Projekt existiert keine, siehe
  Organigramm-Plan) — Blätter bekommen aufsteigende eindeutige Spalten in
  Durchlaufreihenfolge, jeder innere Knoten wird über dem Mittel seiner
  Kinder zentriert. Überschneidungsfrei, solange jede Spalte dieselbe
  Breite hat (hier der Fall) — ein vollwertiger Tidy-Tree-Algorithmus wäre
  für die erwartete Knotenzahl unnötiger Aufwand. Verbindungslinien als
  SVG-Pfade (rechtwinklig, klassischer Organigramm-Stil), Knoten als
  absolut positionierte HTML-Boxen darüber — Geometrie kommt aus
  `Organigramm.tsx` (echte Pixelkoordinaten, keine Design-Entscheidung,
  deshalb bewusst Inline-Style), Farbe/Radius/Abstand ausschließlich aus
  Tokens (CLAUDE.md Regel 7).
- Organisationseinheiten UND Positionen stehen im selben Baum: eine
  Position hängt unter ihrer Einheit (`org_unit_id`) und zusätzlich, falls
  gesetzt, unter einer anderen Position **derselben** Einheit
  (`parent_position_id`) — eine einheitsübergreifende
  `parent_position_id` wird für dieses einfache Layout bewusst ignoriert
  (die Position hängt dann direkt unter ihrer eigenen Einheit), sonst
  könnten sich Teilbäume überschneiden. Dokumentiert als bewusste
  Vereinfachung in `baueBaum()`, keine spätere Drag&Drop-Ansicht
  betroffen.
- Statusdarstellung nicht nur über Farbe (WCAG 1.4.1): Stabsstelle =
  gestrichelter Rahmen, eigenes Icon je Positionstyp
  (`IPosition`/`IStabsstelle`), Status-Pill zusätzlich mit Text
  („Besetzt"/„Besetzt 1/2"/„Vakant"/„Geplant (Platzhalter)").
  `organigramm.personendaten-sehen` (CLAUDE.md Regel 6) greift bereits:
  ohne das Recht zeigt eine besetzte Position „Namen ausgeblendet" statt
  der echten Namen — im Browser gegen beide Fälle geprüft (Konto mit und
  ohne das Recht, siehe unten).
- **Ein echter CSS-Bug im echten Browser gefunden, nicht nur vermutet**:
  `overflow: hidden` auf den Unterzeilen-Spans ließ deren automatische
  Flex-Mindesthöhe laut Spezifikation auf 0 fallen (statt `min-content`),
  der Spaltenflex quetschte sie bei knappem Platz auf wenige Pixel
  zusammen — abgeschnittene Buchstaben, keine sauber abgeschnittene
  Zeile. Sichtbar erst im gerenderten DOM (`getBoundingClientRect` zeigte
  6,9px Zeilenhöhe bei 11,5px Schrift), nicht im Code. Behoben mit
  `flex-shrink: 0` auf allen vier Zeilen plus einer auf die tatsächlich
  gemessenen Zeilenhöhen abgestimmten `BOX_HOEHE` (112px statt 86px) —
  genau das Prinzip „Layout- und Farbaussagen gehören gemessen, nicht
  angesehen" aus CLAUDE.md, hier einmal mehr bestätigt.
- Seitenpanel, Drag & Drop, Account-Typ-Verwaltung, „Anzeigen als…" und
  die Tabellenansicht/Export bleiben eigene, später committete
  Teilschritte (Organigramm-Plan, Lieferreihenfolge Schritt 7/UI).

Geprüft: `pnpm build` sauber (API+shared+Web, Vite-Bundle 364 kB).
Live-Browser-Check (Playwright, echte API + Dev-Server, eigens angelegter
Testmandant mit Träger→Einrichtung→Bereich→Team und sieben Positionen
inkl. Stabsstelle/Platzhalter/Vakanz/Mehrfachbesetzung): Baum rendert
korrekt (11 Knoten), horizontales Scrollen der Leinwand funktioniert,
Personendaten-Redaktion korrekt für ein Konto ohne
`organigramm.personendaten-sehen`, kein horizontaler Seiten-Overflow bei
390px (`scrollWidth - clientWidth === 0`), keine Konsolenfehler. Volle
API-Suite weiterhin **393/393 grün (35 Suiten)** — UI-Schritt berührt kein
Backend.

**Nachtrag — Organigramm-Modul, Schritt 7 (UI), zweiter Teilschritt:
Seitenpanel pro Knoten.** Klick auf einen Knoten (Organisationseinheit
oder Position) öffnet die bestehende `Seitenpanel`-Komponente (slide-in,
wie beim Klient-Detail) mit Stammdaten und Aktionen.

- **Eine kleine, aber notwendige Backend-Erweiterung vorab**:
  `BesetzungDto` bekam `besetzungId` und `gueltigAb` (POSITIONEN_SELECT in
  `organigramm.service.ts`, `packages/shared`) — ohne `besetzungId` hätte
  das Seitenpanel keine Möglichkeit gehabt, `PATCH .../besetzung/:id/beenden`
  für eine bestimmte Besetzung aufzurufen. Die Redaktionsfunktion
  `zuPositionDto()` behält beide Felder auch ohne
  `organigramm.personendaten-sehen` bei (nur `benutzerId`/`benutzerName`
  werden `null`) — ein bestehender Fehler dabei entdeckt und mitbehoben:
  die alte Fassung hätte diese Felder beim Redigieren stillschweigend
  verworfen. Bestehende `toEqual()`-Assertions in `organigramm-lesen`/
  `organigramm-schreiben.e2e-spec.ts` entsprechend ergänzt (exakte
  Objektgleichheit, neue Felder mussten mit).
- **Organisationseinheit-Panel**: Name/Typ/Status, Liste der enthaltenen
  Positionen, „Bereich/Team anlegen" (neue Unter-Einheit) und „Position
  anlegen" — beides als Modal nach dem etablierten Muster
  (`KassenbuchTypen.tsx`).
- **Positions-Panel**: Titel/Typ/Account-Typ/Status, Liste der aktiven
  Besetzungen mit „seit"-Datum (aus dem neuen `gueltigAb`-Feld) und je
  einem „Beenden"-Link, „Besetzen" (Mitarbeiter-Auswahl aus
  `api.benutzerListe()` + Datum) und „Deaktivieren" (mit Bestätigungs-Modal,
  da über die API nicht rückgängig zu machen).
- **Bewusst keine clientseitige Rechteprüfung, die Aktionen ausblendet**:
  `rollen-mapping.ts` (Schritt 3) kennt `organigramm.bearbeiten` für
  Einrichtungsleitung/Mitarbeiter noch nicht — ein serverseitiges 403 wäre
  heute für die meisten Konten der Normalfall. Die Knöpfe bleiben trotzdem
  sichtbar (der Server bleibt die einzige Instanz, die wirklich
  entscheidet, sinngemäß dasselbe Prinzip wie CLAUDE.md Regel 1 für RLS),
  Fehlermeldungen vom Server erscheinen direkt im Panel.
- Nach jeder Mutation werden alle vier Listen (Org-Units, Positionen,
  Account-Typen, Benutzer) neu geladen; das Panel hält dabei nicht die
  alte Knoten-Referenz fest, sondern nur einen Schlüssel (`u:<id>`/
  `p:<id>`) und findet den aktuellen Knoten nach jedem Neuaufbau frisch —
  eine gehaltene Objekt-Referenz wäre nach dem Neuladen veraltet gewesen.
- **Im Live-Test eine eigene Fehlannahme aufgedeckt, kein App-Bug**: ein
  Testlauf, der eine Besetzung mit „Ende = gestern" sofort beenden wollte,
  obwohl die Besetzung selbst erst „heute" begann, bekam zu Recht ein 400
  vom Server (`gueltig_bis >= gueltig_ab`, derselbe CHECK wie überall
  sonst im Projekt) — die Fehlermeldung erschien korrekt im Panel. Und:
  „Ende = heute" lässt die Besetzung bis einschließlich heute als besetzt
  stehen (dieselbe inklusive Enddatums-Semantik wie beim bestehenden
  „Auszugsdatum" in `KlientDetail.tsx`) — kein Bug, nur eine falsche
  Testerwartung, die beim Nachmessen aufgefallen ist.

Geprüft: `pnpm build` sauber, volle API-Suite weiterhin **393/393 grün
(35 Suiten)**. Live-Browser-Check (Playwright, eigens angelegter
Testmandant): vakante Position besetzen → Panel zeigt Namen und
„Besetzt"-Pill; Besetzung beenden → Server-Validierung inkl. Fehlertext im
Panel geprüft; neue Position in einer Einheit anlegen → erscheint sofort im
Baum (11→12 Knoten); neue Unter-Einheit anlegen → erscheint im Baum;
Position deaktivieren → Knoten und Panel zeigen „inaktiv". Keine
Konsolenfehler in allen vier Abläufen.

**Nachtrag — Organigramm-Modul, Schritt 7 (UI), dritter Teilschritt:
Umhängen per Drag & Drop + „Verschieben nach…".** Der Organigramm-Plan
verlangt hier ausdrücklich zwei gleichwertige Wege, nicht Maus mit
Tastatur-Fallback.

- **Zwei neue PATCH-Aufrufe im API-Client** (`organigrammOrgUnitAktualisieren`,
  `organigrammPositionAktualisieren`) — beide Endpunkte existierten bereits
  seit Schritt 6 (schreibend), sie waren im Web-Client nur noch nicht
  verdrahtet.
- **Eine Funktion, zwei Zugänge**: `gueltigeZiele(quelle, alleKnoten)`
  berechnet die erlaubten Ziele (gleiche Art, nicht man selbst, nicht der
  eigene Teilbaum) — sowohl für Drag & Drop als auch für „Verschieben
  nach…" im Seitenpanel. Eine „falsche Reihenfolge" (z. B. Bereich unter
  Team) wird bewusst NICHT zusätzlich ausgeschlossen: der
  Zyklenschutz-Trigger in der Datenbank kennt diese Unterscheidung auch
  nicht, Client und Server ziehen dieselbe Grenze.
- **Drag & Drop**: jede Box mit `typ ∈ {bereich,team}` (Organisations-
  einheiten) oder jede Position ist ziehbar (Griff-Icon oben rechts,
  Muster aus `Einstellungen.tsx::MenuReihenfolge`, State-getrieben statt
  `dataTransfer`-Payload). Während des Ziehens bekommen **alle** gültigen
  Ziele einen gestrichelten Akzentrahmen, nicht nur das gerade überflogene
  — sonst wäre „wohin darf ich überhaupt ziehen" nur durch Ausprobieren
  herausfindbar.
- **„Verschieben nach…" als die gleichwertige Tastatur-Alternative** — ganz
  bewusst ein Modal mit einer fokussierbaren `<select>`-Zielliste, **kein**
  literales Rechtsklick-Kontextmenü: ein echtes Kontextmenü ist für
  Tastatur- und Screenreader-Nutzung notorisch schlecht zugänglich, ein
  Modal mit einer normalen Formular-Auswahl ist die tatsächlich
  gleichwertige Alternative. Erscheint in `EinheitPanel` nur für
  Bereich/Team (dieselbe Grenze wie beim Ziehen), in `PositionPanel`
  immer (jede Position kann eine neue `parentPositionId` bekommen) —
  jeweils ausgeblendet, wenn keine gültigen Ziele existieren.
- Bekannte, bewusst nicht behobene Grenze: `org_position.org_unit_id` ist
  über die API nicht änderbar (nur `parentPositionId`) — eine Position
  wechselt ihre Organisationseinheit also nur indirekt, wenn ihre ganze
  Einheit verschoben wird. Das ist der heutige Stand von
  `aktualisierePosition()` (Schritt 6), keine Lücke dieses UI-Schritts.

Geprüft: `pnpm build` sauber, volle API-Suite weiterhin **393/393 grün
(35 Suiten)** (dieser Schritt nutzt nur bestehende Endpunkte, keine
Backend-Änderung). Live-Browser-Check (Playwright, echte API +
Dev-Server): Drag & Drop einer Organisationseinheit auf eine neue
übergeordnete Einheit (per `dragTo`, inkl. Tiefenprüfung der Boxen
vorher/nachher) korrekt; „Verschieben nach…" für eine Position auf eine
neue übergeordnete Position korrekt; **Gegenprobe** — derselbe Drag auf
den eigenen Nachkommen feuert keinen PATCH-Request und lässt den Baum
unverändert (Zyklenschutz greift schon clientseitig, bevor der Server
überhaupt gefragt wird). Keine Konsolenfehler.

**Nachtrag — Organigramm-Modul, Schritt 7 (UI), vierter Teilschritt:
Account-Typ-Verwaltung.** Letzter Baustein vor „Anzeigen als…" und der
Tabellenansicht/Export.

- **Ein neuer Endpunkt, weil die Matrix sonst nicht dieselbe Liste wie
  serverseitig hätte**: `GET /rechte/registry` (neuer `RechteController`,
  `apps/api/src/rechte/`) gibt `RECHTE_REGISTRY` unverändert zurück --
  gated mit `organigramm.manage-permissions`, genau wie `GET /audit-log`.
  `RechteModule` bekommt dafür erstmals einen eigenen Controller (vorher
  nur Service/Guard für andere Module); `GET /rechte/simulation`
  ("Anzeigen als…") zieht laut Plan in denselben Controller, wenn dieser
  Teilschritt kommt. Neue e2e-Spec `rechte-registry-lesen.e2e-spec.ts` (3
  Tests, inkl. 403 ohne das Recht und einer Gegenprobe gegen die echte
  `RECHTE_REGISTRY`-Konstante statt nur gegen eine erwartete Zeilenzahl).
- Im Web-Client ein neuer Reiter **innerhalb** der Organigramm-Seite
  („Baum" / „Account-Typen", `.zv-segmented`-Muster aus `Klienten.tsx`)
  statt eines eigenen Hauptmenüpunkts -- Account-Typen sind ein
  Verwaltungsaspekt des Organigramms, kein eigenständiges Modul.
- **Liste + Anlegen/Umbenennen** nach dem Muster von `KassenbuchTypen.tsx`:
  `ist_system`-Zeilen (Systemvorlagen) bekommen keinen
  „Umbenennen"-Knopf, ihre Rechte-Matrix bleibt trotzdem bearbeitbar --
  „Systemvorlage" heißt laut Organigramm-Plan nur „vorbefüllt und vor
  Löschen/Umbenennen geschützt", nicht „nicht editierbar".
- **Rechte-Matrix im Seitenpanel** (eigene `AccountTypRechteEditor`-
  Komponente, per Vollbild-Umschalter bei Bedarf mehr Platz): eine Zeile
  pro `(modul, aktion)` aus der Registry, ohne Eintrag in der lokalen
  Auswahl ein impliziter Deny -- exakt wie eine fehlende
  `account_typ_recht`-Zeile serverseitig. Scope kommt aus einer
  festen Acht-Werte-Liste (`own`/`team`/`wohngruppe`/`subtree`/
  `einrichtung`/`bereich`/`tenant`/`assigned`, aus dem Organigramm-Plan),
  nicht aus einem Freitextfeld, obwohl die Spalte selbst in der DB freier
  Text ist. Änderungen werden lokal gesammelt und erst auf „Speichern"
  als Ganzes per `PUT` geschrieben (der Endpunkt ersetzt ohnehin die
  komplette Rechte-Menge, ein Request pro Zelle wäre sinnlos).
- `ist_vollzugriff=true`-Typen zeigen statt der Matrix nur den Hinweistext
  „nicht reduzierbar" -- reiner Anzeigezustand, kein Grid, exakt wie im
  Organigramm-Plan vorgegeben.
- `GET /rechte/registry` wird bewusst NICHT im Haupt-`laden()` der Seite
  mitgeladen, sondern erst, sobald „Account-Typen" tatsächlich angeklickt
  wird: das Recht dafür ist enger als `organigramm.ansehen` (das für den
  Baum reicht), ein Konto ohne `manage-permissions` soll beim bloßen
  Öffnen der Organigramm-Seite keinen Fehlerbanner sehen.

Geprüft: `pnpm build` sauber, volle API-Suite **396/396 grün (36
Suiten)** -- 393 vorher + 3 neue (Registry-Endpunkt). Live-Browser-Check
(Playwright, eigens angelegter Testmandant): Account-Typ anlegen →
erscheint sofort in der Liste; Rechte-Matrix zeigt alle 39
Registry-Zeilen; eine Zelle auf Scope „Team" gesetzt, gespeichert, Panel
geschlossen und neu geöffnet → Wert korrekt aus der DB gelesen (nicht nur
im Client-State hängengeblieben); Vollzugriff-Typ zeigt den Hinweistext
statt eines Grids; eine auf `ist_system=true` gesetzte Zeile verliert
korrekt den „Umbenennen"-Knopf; kein horizontaler Seiten-Overflow bei
390px. Keine Konsolenfehler.

**Nachtrag — Organigramm-Modul, Schritt 8: Vertretung-UI.** Die
Delegation-API (`delegation.service.ts`/`delegation.controller.ts`, siehe
Schritt 7) bekommt ihre Oberfläche -- bewusst **kein eigener Unterreiter
im Organigramm**, sondern ein eigenständiger Hauptmenüpunkt
(`apps/web/src/pages/Vertretung.tsx`): Vertretung ist kein
Organisationsstruktur-Thema, sondern etwas, das jeder Mitarbeitende
selbst beantragt/entscheidet, unabhängig von der eigenen Position im Baum.

- **`effektiverStatus`, nie `status`** (CLAUDE.md Regel 4): die Pill zeigt
  ausschließlich den abgeleiteten Wert aus `DelegationDto`. Eigene
  Statusfarbe pro Wert, aber ausschließlich über die vorhandenen
  `.zv-pill-*`-Klassen aus `app.css` (Regel 7) -- `beantragt`→info,
  `genehmigt`→teilweise/amber (wartet auf den Starttermin, bewusst eine
  andere Farbe als „beantragt": zwei verschiedene Wartezustände),
  `aktiv`→ok, `abgelaufen`→neutral (vergeben), `widerrufen`→danger.
- **„Ablehnen" ist derselbe Endpunkt wie „Widerrufen"** -- die Tabelle
  kennt keinen eigenen Ablehnen-Status (siehe Auftrag). Damit eine Zeile
  nicht zwei Knöpfe für denselben `PATCH .../widerrufen`-Aufruf zeigt,
  blendet die Vertretung-Zeile „Widerrufen" aus, solange sie schon
  „Genehmigen"/„Ablehnen" zeigt (Vertreter, Status `beantragt`) --
  `Ablehnen` dort, `Widerrufen` für alle anderen berechtigten Fälle
  (inkl. der vertretenen Person, die den eigenen Antrag zurückzieht).
- **Richtungstext** „Du vertrittst X" / „X vertritt dich" statt roher
  Feldnamen -- aus Sicht des eingeloggten Benutzers (`tokenBenutzerId()`,
  wie in `Aufgaben.tsx`), nicht aus Sicht der Datenbank.
- **Fund beim Live-Check, kein Bug dieses Schritts**: `GET
  /rechte/registry` (für die Rechte-Checkbox-Liste bei `umfang="auswahl"`)
  hängt an `organigramm.manage-permissions` (`rechte.controller.ts`) --
  genau das Recht, das laut `rollen-mapping.ts` heute nur
  Geschäftsführung-Konten (Vollzugriff-Wildcard) bekommen, kein
  Betreuer/Einrichtungsleitung. Für die meisten Mitarbeitenden bleibt
  „Nur ausgewählte Rechte" damit praktisch unbenutzbar, bis
  `rollen-mapping.ts` organigramm-Rechte für weitere Rollen vorsieht --
  dieselbe „bewusste, noch ausstehende Einschränkung" wie bei den
  Organigramm-Leseendpunkten (Schritt 6). Die Seite fängt das ab, statt
  daran zu zerbrechen: wie bei der Account-Typ-Verwaltung
  (`Organigramm.tsx`) wird die Registry NICHT beim Öffnen der Seite
  mitgeladen, sondern erst beim Öffnen des Beantragen-Formulars -- ein
  Konto ohne das Recht sieht nie einen Fehlerbanner, nur eine leere
  Checkbox-Liste mit Hinweistext; „Alle eigenen Rechte" bleibt für jede
  Rolle uneingeschränkt nutzbar.
- Neues Icon `IVertretung` (`UserRoundCheck`) für den Hauptreiter,
  `ILeerVertretung` (`Shuffle`) für den Leerzustand -- beide bisher nicht
  im Set verwendet (siehe Kommentarkopf `icons.tsx`: nur namentliche
  Importe).

Geprüft: `pnpm build` sauber (API+shared+Web), volle API-Suite
**396/396 grün (36 Suiten)** -- unverändert, da keine Backend-Datei
angefasst wurde. Live-Browser-Check (Playwright, zwei eigens angelegte
Testbenutzer A/B in einem frischen Testmandanten, Anmeldung über die
echte UI): Leerzustand vor der ersten Vertretung; A beantragt
(`umfang="alle"`) → Zeile erscheint sofort mit Status „Beantragt"
(info-Pill), Richtungstext aus A-Sicht „X vertritt dich"; B sieht
„Du vertrittst X" plus Genehmigen/Ablehnen, klickt Genehmigen → Status
„Aktiv" (ok-Pill) bei beiden; A widerruft über das Bestätigungs-Modal →
Status „Widerrufen" (danger-Pill) bei beiden, kein Widerrufen-Knopf mehr.
Zweiter Durchlauf mit `umfang="auswahl"` (Testbenutzer mit
Vollzugriff-Account-Typ, s.o.): 38 Checkbox-Zeilen erscheinen,
`organigramm.manage-permissions` (nieDelegierbar) fehlt korrekt in der
Liste, „inkl. sensibler Rechte"-Hinweis sichtbar, Ablehnen-Bestätigung
zeigt den richtigen Titel/Text und führt ebenfalls zu Status „Widerrufen".
Dritter Durchlauf bestätigt den Lazy-Load: `/rechte/registry` wird beim
bloßen Öffnen der Seite nicht aufgerufen, erst beim Öffnen des
Beantragen-Formulars, dann genau einmal. Keine Konsolenfehler, alle
Testdaten (Mandant, Benutzer, Positionen, Delegationen) im Anschluss
wieder gelöscht.

**Nachtrag — Organigramm-Modul, Schritt 9: Externe Parteien, Schema-Verifikation.**
Kein neuer Code -- das Schema für „Externe Parteien" (Kostenträger,
Betreuungsgerichte u. ä.) existiert bereits vollständig seit Schritt 1/2:
`account_typ.kategorie='extern'` kann per `CHECK` nie `ist_vollzugriff=true`
sein, ein Trigger (`account_typ_recht_pruefen`) lehnt für einen
extern-Account-Typ jede `account_typ_recht`-Zeile mit `erlaubt=true` und
`scope <> 'assigned'` ab, und `org_position_objekt_scope` liegt für den
objektbezogenen Zugriff bereit, bleibt aber ungenutzt, bis eine UI sie
befüllt. Dieser Schritt belegt diese drei Invarianten mit einer neuen
e2e-Spec, statt sie weiter nur als Kommentar zu behaupten.

- Neue Datei `apps/api/test/externe-parteien-schema.e2e-spec.ts`. Da kein
  bestehender Endpunkt `RechteService.ermittleErlaubteOrgUnitIds()`
  aufruft (verifiziert: alle heutigen `@ErfordertRecht()`/`hatRecht()`-
  Stellen sind reine Ja/Nein-Prüfungen, kein Service filtert eine Liste
  danach), kombiniert die Spec echtes HTTP-Login über das volle
  `AppModule` (Login, `@Authenticated()`, ein rechte-gegateter 403) mit
  direktem Zugriff auf `RechteService` aus demselben Container für die
  Scope-Auflösung selbst -- Muster und Begründung stehen im Dateikopf.
- **CHECK-Invariante**: ein roher `INSERT` mit `kategorie='extern'` und
  `ist_vollzugriff=true` scheitert an `account_typ_check` (Postgres-Code
  `23514`).
- **Trigger-Invariante als Gegenprobe-Paar**: für denselben extern-Typ und
  dasselbe `(modul,aktion)`-Paar scheitert `scope='tenant'` (`P0001`),
  `scope='assigned'` gelingt -- belegt, dass der Trigger gezielt
  `scope<>'assigned'` abfängt, nicht pauschal jede Zeile blockiert.
- **Rechte-Engine, Anwenderperspektive**: ein extern-Konto mit genau einer
  erlaubten Zeile (`klienten.lesen-akte`, `scope='assigned'`) hat
  `hatRecht()===true`, aber `ermittleErlaubteOrgUnitIds()` liefert dafür
  immer `[]` -- nie `"alle"`, nie irgendeine Org-Unit-Id. Gegenprobe:
  dasselbe Konto hat für ein anderes Modul/Aktion-Paar `hatRecht()===false`
  -- die Erlaubnis ist exakt auf die eine Zeile begrenzt.
  Default-Deny (extern-Typ ganz ohne jede `account_typ_recht`-Zeile) ist
  sowohl direkt am Service als auch über einen echten 403 auf
  `GET /organigramm/org-units` belegt.
- Keine Abweichung vom erwarteten Stand gefunden, bis auf eine
  Testinfrastruktur-Nebensache: der Vollzugriff-Schutztrigger auf
  `org_position_besetzung` feuert für einen Mandanten ganz ohne
  Vollzugriff-Position bei JEDER Löschung dieser Tabelle (nicht nur beim
  Entfernen einer tatsächlichen Vollzugriff-Zeile) -- bereits bekanntes,
  in `rollen-migration-abgleich.e2e-spec.ts` ebenso gehandhabtes Verhalten
  (Trigger kurz deaktivieren, danach wieder aktivieren), kein neuer Bug
  und keine Migration nötig.
- `.env.example` bekommt `FEATURE_EXTERNE_PARTEIEN=false` (reserviert,
  liest heute noch kein Code) für die nächste Phase (Login + Einladung +
  Protokollierung für externe Parteien).

Geprüft: `pnpm --filter @zimmerakte/api build` sauber, volle API-Suite
**403/403 grün (37 Suiten)** -- 396 vorher + 7 neue.

**Nachtrag — Organigramm-Modul, Schritt 7 (UI), fünfter Teilschritt:
„Anzeigen als…" (Rechte-Simulation).** Vorletzter fehlender UI-Teilschritt
vor Tabellenansicht/Export: eine Admin-Ansicht, die für eine gewählte
Person ODER eine gewählte Position zeigt, welche Rechte effektiv gelten
würden, inklusive Herkunft je Zelle -- rein lesend, keine Mutation.

- **Zwei getrennte Simulationspfade statt eines gemeinsamen**, weil es
  fachlich zwei verschiedene Fragen sind: `simuliereFuerBenutzer()`
  beantwortet „was gilt heute effektiv" (alle aktiven Positionen der
  Person, vereinigt, PLUS eine greifende Vertretung -- exakt dieselbe
  Logik wie `hatRecht()`), `simuliereFuerPosition()` beantwortet „was
  würde DIESE Position allein gewähren". Deshalb filtert
  `simuliereFuerPosition()` bewusst NICHT nach `p.aktiv`: eine geplante
  Platzhalter-Position (`ist_geplant=true`, noch unbesetzt) muss
  simulierbar sein, das ist laut Organigramm-Plan der Hauptanwendungsfall
  für diese Ansicht (Rechte vorab konfigurieren und prüfen, bevor überhaupt
  jemand zugewiesen wird).
- **`positionsGrant()` refaktoriert, Verhalten unverändert**: die
  Override/Default-Abfrage steckt jetzt in der neuen privaten
  `positionsGrantRoh()` (liefert zusätzlich die Herkunft
  `"override"`/`"account-typ-default"`), `positionsGrant()` baut daraus wie
  bisher das `PositionsErgebnis` per `orgUnitIdsFuerScope()`. Die
  bestehende API-Suite bleibt dabei unverändert grün -- der Beleg, dass
  sich am Produktivverhalten nichts verschoben hat.
- **Fünf Herkunftswerte** (`RechtHerkunft`, neu in `packages/shared`):
  `vollzugriff` (Wildcard-Kurzschluss), `account-typ-default`, `override`,
  `delegation` (kommt ausschließlich über eine aktive Vertretung herein,
  nie aus einer eigenen Position) und `kein-eintrag` (impliziter Deny).
  `RECHT_HERKUNFT_LABEL` übersetzt sie für die Oberfläche.
- **`GET /rechte/simulation`** (neu im bestehenden `RechteController`, wie
  im Kommentar dort seit Schritt 7/UI, vierter Teilschritt angekündigt):
  genau eines von `benutzerId`/`positionId` als Query-Parameter
  (`safeParse` + `BadRequestException` statt ungefangenem `ZodError`,
  CLAUDE.md-Pflicht), sonst 400. Gated mit demselben
  `organigramm.manage-permissions` wie `/rechte/registry` -- „Anzeigen
  als…" deckt auf, wie Rechte für eine Person/Position aufgelöst werden,
  dieselbe Vertraulichkeitsstufe wie die Account-Typ-Verwaltung selbst.
  `apps/api/package.json` bekommt dafür erstmals eine Abhängigkeit auf
  `@zimmerakte/shared` (bisher importierte keine API-Datei von dort --
  `RechtHerkunft`/`SimulationZelleDto`/`SimulationDto` sollen nicht doppelt
  gepflegt werden, API und Web teilen jetzt dieselbe Quelle).
- **Web-Client**: dritter Reiter „Anzeigen als…" im Organigramm-Segmented-
  Control (neues Icon `IAnzeigenAls`, `Glasses` -- noch nicht im Set
  verwendet). `SimulationAnsicht` lädt wie `AccountTypenAnsicht` NICHTS
  automatisch beim Öffnen des Reiters, sondern erst nach einer
  tatsächlichen Auswahl (Mitarbeiter/in ODER Position, zwei getrennte
  `<select>`-Formulare statt eines gemeinsamen Dropdowns, weil beide IDs
  aus unterschiedlichen Wertebereichen stammen). Ergebnis als
  `.zv-karten-liste`-Tabelle, „Zugriff" über die vorhandenen
  `.zv-pill-ok`/`.zv-pill-neutral`-Klassen (Regel 7: keine neue Farbe),
  „Herkunft" als Klartext über `RECHT_HERKUNFT_LABEL`. Fehlerbehandlung
  wie bei `EinheitPanel`/`PositionPanel`: der Server entscheidet, das UI
  zeigt nur die Server-Antwort an.

Geprüft: `pnpm build` sauber (shared+API+Web), volle API-Suite **411/411
grün (38 Suiten)** -- 403 vorher + 8 neue (`rechte-simulation-lesen.e2e-
spec.ts`: beide Zielarten, Override- vs. Account-Typ-Default-Herkunft,
Vollzugriff-Kurzschluss, beide 400-Fälle, 403, 401, 404 bei unbekannter
`positionId`). Live-Browser-Check (Playwright, eigens angelegter
Testmandant mit Admin-Konto, Vollzugriff-Konto, einer besetzten Position
mit Override und einer UNBESETZTEN Platzhalter-Position, echte
UI-Anmeldung): Reiter „Anzeigen als…" klickbar, zeigt erklärenden Satz und
bleibt zunächst ergebnislos; Mitarbeiter/in „Team Leitung Nord" ausgewählt
→ 39 Zeilen (= `RECHTE_REGISTRY.length`) erscheinen sofort, `zimmer ·
ansehen` zeigt „Erlaubt" mit Herkunft „Override · Teilbaum (Linie)";
Wechsel auf Position → die unbesetzte Platzhalter-Position „Platzhalter:
neue Teamleitung" ausgewählt → dieselben 39 Zeilen, `zimmer · ansehen`
jetzt korrekt „Account-Typ · Team" (kein Override auf dieser Position) --
belegt, dass eine noch nie zugewiesene Position tatsächlich simulierbar
ist. Keine Konsolenfehler. Testmandant anschließend vollständig gelöscht.

**Nachtrag — Organigramm-Modul, Schritt 7 (UI), sechster Teilschritt:
Tabellenansicht + CSV/PDF-Export.** Letzter fehlender UI-Teilschritt aus der
ursprünglichen Lieferreihenfolge (Baum → Seitenpanel → Umhängen →
Account-Typ-Verwaltung → Anzeigen als… → Tabellenansicht/Export). Vierter
Reiter im bestehenden `.zv-segmented`-Umschalter (`Organigramm.tsx`), neben
„Baum", „Account-Typen" und „Anzeigen als…".

- **Keine neue Leseroute für die Tabelle selbst**: `orgUnits`/`positionen`/
  `accountTypen` sind über `laden()` in der `Organigramm()`-Komponente schon
  vollständig geladen -- die Tabellenansicht ist nur eine andere Darstellung
  derselben Daten, kein zweiter Request.
- **CSV clientseitig, PDF serverseitig** -- unterschiedliche Gründe: die CSV
  braucht keine Daten, die der Client nicht ohnehin schon hat (ein
  Server-Roundtrip für denselben Stand wäre reiner Umweg), ein PDF dagegen
  braucht `pdf-lib`, eine Node-Bibliothek, die im Browser-Bundle nichts zu
  suchen hat. Neuer Endpunkt `GET /organigramm/export/pdf`, gated mit dem
  SCHWÄCHEREN `organigramm.ansehen` (nicht `manage-permissions`) -- der
  Export zeigt dieselben Daten, die ohnehin schon in der Baumansicht
  sichtbar sind, keine zusätzliche Sensibilität.
- **Derselbe Redaktionsmechanismus, nicht dupliziert** (CLAUDE.md Regel 6):
  `OrganigrammService.exportPdf()` ruft `findeOrgUnits()`/`findePositionen()`/
  `findeAccountTypen()` -- genau die Methoden, die auch die bestehenden
  GET-Endpunkte bedienen -- statt ein zweites Mal direkt per SQL zu lesen.
  Wer ohne `organigramm.personendaten-sehen` exportiert, bekommt automatisch
  "Namen ausgeblendet" im PDF, ohne dass der PDF-Code das selbst prüfen
  müsste; eine zweite Prüfstelle hätte irgendwann vom Original abweichen
  können.
- **Semikolon statt Komma als CSV-Trennzeichen**: ein deutsches Excel
  erwartet per Locale das Komma als Dezimaltrennzeichen und würde eine
  komma-getrennte Datei sonst als eine einzige Spalte einlesen -- Semikolon
  ist die in Deutschland übliche Excel-Konvention. Aus demselben Grund ein
  BOM-Präfix vor dem Inhalt, sonst erkennt Excel unter Windows die
  enthaltenen Umlaute nicht korrekt.
- **`besetzteNamen()`/`besetztMitText()` als gemeinsame Hilfsfunktionen**
  (`Organigramm.tsx`) statt doppelter Logik: dieselbe Herleitung
  (Namen/„Namen ausgeblendet"/„Derzeit nicht besetzt") bedient jetzt sowohl
  `KnotenBox` (Baumansicht) als auch `TabellenAnsicht` und `erzeugeCsv()` --
  alle drei liefen vorher Gefahr, bei einer künftigen Änderung
  auseinanderzulaufen. Der PDF-Generator (`organigramm-export-pdf.ts`, API)
  bekommt dieselbe Herleitung zwangsläufig noch einmal: die API hängt
  bewusst nicht von `@zimmerakte/shared` ab (das Paket ist für Typen/Label,
  die Web UND API gemeinsam brauchen -- die API braucht diese Label bisher
  nirgends außer hier), ein React-/DOM-Import quer über den Build-Grenzen
  wäre ohnehin nicht möglich.
- Echtes `<table className="zv-table">`-Element statt des
  `.zv-karten-liste`-Grid-Patterns der anderen Organigramm-Unteransichten:
  export-taugliche tabellarische Daten passen in eine echte Tabelle
  natürlicher, und `.zv-table` existierte als CSS-Klasse bereits
  (`display: block` + `overflow-x: auto`, siehe „Fallstricke" oben) --
  diese Ansicht ist ihre erste tatsächliche Verwendung im Projekt.
- Neues Icon `ITabelle` (`Table2`) für den dritten Reiter -- bisher nicht im
  Set verwendet.

Geprüft: `pnpm build` sauber (API+shared+Web), volle API-Suite **406/406
grün (38 Suiten)** -- 403 vorher + 3 neue (`organigramm-export-pdf.e2e-spec.ts`:
200 mit Recht inkl. PDF-Magic-Bytes-Prüfung, 403 ohne Recht, 401 ohne Token).
Gegenprobe: `@ErfordertRecht()` am neuen Endpunkt auskommentiert -- der
403-Test wird rot (200 statt 403), wiederhergestellt wieder grün. Eigens
angelegter Testmandant, Live-Browser-Check (Playwright, echte Anmeldung über
die UI): Tabellen-Tab zeigt alle drei angelegten Positionen mit korrekten
Spalten (inkl. „Besetzt 1/2"-Teilbesetzung, einer vakanten Stabsstelle und
dem Vollzugriff-Konto); CSV-Download liefert BOM + Semikolon-Kopfzeile +
exakt dieselben drei Zeilen wie die Tabelle; PDF-Download liefert eine
nicht-leere Datei mit gültigen `%PDF-`-Magic-Bytes. Kein horizontaler
Seiten-Overflow bei 390px (die Tabelle scrollt intern). Keine
Konsolenfehler. Testdaten im Anschluss wieder gelöscht.

**Nachtrag — Organigramm-Modul, Schritt 10 (Abschluss): durchgängige
Verifikation + E2E-Hauptszenario.** Letzter Punkt der Lieferreihenfolge
aus dem ursprünglichen Plan. Kein neuer Code am Fachmodell oder an der
Rechte-Engine selbst -- dieser Schritt prüft nur, dass das in den
Schritten 1–9 gebaute Ganze tatsächlich als Ganzes funktioniert, mit dem
im Auftrag wörtlich vorgegebenen Szenario als einzigem, zusammenhängenden
Test statt nur in Einzelteilen über die vielen Teilschritt-Specs
verstreut:

- **`apps/api/test/organigramm-e2e-hauptszenario.e2e-spec.ts`** (neu):
  Platzhalter-Position „Einrichtungsleitung (geplant)" anlegen → Rechte
  konfigurieren (neuer Account-Typ + `PUT .../rechte`) → Mitarbeiter
  zuweisen (`POST .../besetzen`) → Rechte greifen sofort → Audit-Eintrag
  vorhanden. Alles über echte HTTP-Endpunkte, nicht nur `RechteService`
  direkt (anders als `rechte-engine.e2e-spec.ts`) -- das Szenario ist eine
  Behauptung über das Zusammenspiel von Controller, Guard und Engine,
  nicht nur über die Engine allein.
- **„Sofort" konkret geprüft, nicht nur behauptet**: der Zielbenutzer wird
  VOR jeder Positionszuweisung eingeloggt (JWT ausgestellt, als der
  Benutzer noch null Positionen hatte), danach wird genau dieses -- zu dem
  Zeitpunkt bereits ausgestellte -- Token nach der Zuweisung unverändert
  wiederverwendet, kein Re-Login, kein Refresh. Der Erfolg belegt damit
  nicht nur "nach der Zuweisung geht es", sondern konkret, dass Rechte pro
  Request aus der Datenbank aufgelöst werden und nicht im Token oder in
  einem zwischengespeicherten Zustand stecken (Organigramm-Plan: "keine
  Cross-Request-Caches").
- **Audit-Nachweis über zwei verschiedene `objekt_typ`-Werte**: die
  Positions-Mutationen (`position.anlegen`, `position.bearbeiten` fürs
  `istGeplant`-Flag) protokollieren mit `objekt_typ='org_position'`, die
  Zuweisung selbst (`position.besetzen`) aber mit
  `objekt_typ='org_position_besetzung'` und der ID der neuen
  Besetzungszeile, nicht der Position (siehe
  `organigramm.service.ts::besetzen()`) -- der Test sucht diesen Eintrag
  deshalb bewusst über den im `nachher`-Snapshot weiterhin enthaltenen
  Positions-`id`-Wert, statt fälschlich denselben `objekt_typ`-Filter wie
  bei den beiden anderen Mutationen anzunehmen.
- Gegenprobe nach Projektkonvention: die Zuweisung (`POST .../besetzen`)
  testweise übersprungen -- der „sofort"-Test wird korrekt rot (403 statt
  200 bei der abschließenden `GET /organigramm/org-units`-Prüfung),
  danach wiederhergestellt.

Geprüft: `pnpm build` sauber (shared+API+Web), volle API-Suite **415/415
grün (40 Suiten)** -- 414 vorher + 1 neu (das Hauptszenario selbst zählt
als genau ein Test, deckt aber die komplette Kette ab). Damit ist das
Organigramm-Modul mit Positions- und Rechteverwaltung laut der
ursprünglichen Lieferreihenfolge (Schritte 1–10) vollständig umgesetzt:
Datenmodell, zentrale Rechte-Engine, Migration aller 14 ehemaligen
`ROLLEN_MIT_*`-Stellen, Kassenbuch-Vier-Augen, lesende und schreibende
API, alle sechs UI-Teilschritte (Grundansicht, Seitenpanel,
Drag&Drop/Verschieben, Account-Typ-Verwaltung, Anzeigen als…,
Tabellenansicht/Export), Vertretung (API+UI), Externe-Parteien-Schema
und diese abschließende Verifikation.

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
