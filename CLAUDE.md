# Zimmerakte — Leitfaden für die Arbeit an diesem Projekt

Mandantenfähige Fallverwaltung für Betreutes Wohnen (DRK). Die Anwendung
verarbeitet **besondere Kategorien personenbezogener Daten (Art. 9 DSGVO),
Sozialdaten nach SGB X** — Namen, Geburtsdaten, Amtszuordnungen,
Kontobewegungen betreuter Menschen (siehe Kommentar in
`migrations/0008_klient.sql`). Das ist der Grund für fast jede
ungewöhnliche Entscheidung in diesem Repository.

> Die **fachlichen** Architekturentscheidungen samt Begründung stehen im
> [README](README.md), Abschnitt „Architekturentscheidungen". Diese Datei
> hier ist der **operative** Leitfaden: Befehle, Konventionen und die
> Regeln, deren Bruch teuer wird.

---

## Befehle

```bash
pnpm install                      # Node >= 20, pnpm 10.33 (via packageManager gepinnt)
cp .env.example .env              # danach Werte anpassen

# Datenbank (PostgreSQL 16)
docker compose up -d db           # oder: service postgresql start
pnpm migrate                      # Migrationen anwenden

# Entwicklung
pnpm dev:api                      # NestJS auf :3000
pnpm dev:web                      # Vite auf :5173 (proxyt /api an :3000)

# Prüfen
pnpm test:api                     # alle Jest-Specs gegen echte PostgreSQL
pnpm test:mandanten               # nur die Mandantentrennung
pnpm build                        # Typecheck + Build aller Pakete

# Designprüfung im echten Browser (siehe README, "Designprüfung")
cd apps/web && pnpm build && pnpm exec vite preview --port 4173 &
node scripts/design-pruefung.mjs      # Kontrastmatrix, braucht keine DB
node scripts/funktions-pruefung.mjs   # Ende-zu-Ende, braucht API + Dev-Server
```

---

## Regeln, deren Bruch teuer wird

Diese Punkte sind nicht Geschmackssache. Sie tragen entweder die
Mandantentrennung, die Nachvollziehbarkeit gegenüber Ämtern oder die
Rechtskonformität.

### 1. Die App-Rolle darf RLS nie umgehen können

Die API verbindet sich **immer** als `zimmerakte_app` — ohne `SUPERUSER`,
ohne `BYPASSRLS`. Genau das macht Row Level Security wirksam: ein
Rechteinhaber, der Policies umgehen kann, macht die Policy zur Dekoration.

Die einzige Ausnahme ist die Mandantenauflösung beim Login (vor dem Login
gibt es noch keinen `app.mandant_id`-Kontext) — sie steht bewusst an genau
einer Stelle in `auth/auth.service.ts` und ist dort kommentiert.

**Jede neue fachliche Tabelle** braucht:
```sql
mandant_id uuid NOT NULL REFERENCES mandant(id),
-- ...
ALTER TABLE x ENABLE ROW LEVEL SECURITY;
ALTER TABLE x FORCE ROW LEVEL SECURITY;   -- ohne FORCE gilt sie für den Eigentümer nicht
CREATE POLICY x_isolation ON x
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
```

### 2. Kein `WHERE mandant_id = ...` im Anwendungscode

RLS erledigt das. Steht es zusätzlich im SQL, verdeckt es beim nächsten
Refactoring, ob die Policy überhaupt noch greift. Fehlt es und die Policy
ist kaputt, fällt es sofort auf. Das ist Absicht — siehe
`mandant.service.ts` für den Kommentar dazu.

### 3. Rechte spaltenscharf vergeben, wenn nur eine Spalte änderbar sein soll

`ALTER DEFAULT PRIVILEGES` (Migration 0002) gibt der App-Rolle
`UPDATE` auf *alle* Spalten neuer Tabellen. Wo das zu viel ist:

```sql
REVOKE UPDATE ON tabelle FROM zimmerakte_app;
GRANT  UPDATE (nur_diese_spalte) ON tabelle TO zimmerakte_app;
```

Vorbilder: `0011_kassenbuchung.sql` (Append-only), `0019_mandant_akzentfarbe.sql`
(dort schützt es u. a. `slug` — den Login-Pfad).

### 4. Zustände werden abgeleitet, nicht gespeichert

Es gibt keine `status`-Spalte auf `zimmer`. Der Status ergibt sich aus einem
`LEFT JOIN` auf eine offene Belegung. Ein gespeicherter Status ist ein
zweiter Ort für dieselbe Wahrheit und läuft irgendwann auseinander.

### 5. Unveränderlichkeit gehört in die Datenbank, nicht in den Code

Ein Kassenbucheintrag wird nie geändert oder gelöscht — Stornierung ist eine
neue Zeile. Durchgesetzt per `REVOKE UPDATE, DELETE`, nicht per Codereview.

### 6. Anonymisierung passiert beim Lesen

Gespeichert wird immer der volle Name. Wer nur Initialen sehen darf, bekommt
sie beim Lesen (`common/anonymisierung.ts`). Andersherum wäre der Verlust
irreversibel — und für Amtsnachfragen braucht die Leitung den echten Namen.

### 7. Farben und Abstände nur über Tokens

Kein Literalwert für Farbe, Radius oder Abstand in einer Komponente. Alles
läuft über `var(--zv-*)` aus `apps/web/src/styles/tokens.css`. Genau deshalb
war der komplette Redesign in Phase 7 an einer Datei möglich.

**Und die Helligkeitswerte gehören dem CSS.** Das JavaScript liefert
ausschließlich Farbton und Buntheit (`--zv-accent-h` / `-c`). Wer anfängt,
Helligkeiten in TypeScript zu rechnen, hebelt die Kontrastgarantie aus:
Kontrast hängt nur an der Helligkeit, und weil die fest je Theme im CSS
steht, kann er konstruktiv nicht brechen — auch nicht bei Knallgelb.

### 8. Niemals `.env` committen

Nur `.env.example`. Die Datei enthält echte Zugangsdaten.

---

## Konventionen

**Sprache.** Bezeichner, Kommentare und Oberflächentexte sind **deutsch**
(`Belegung`, `Kostenuebernahme`, `wirdGespeichert`). Fachbegriffe wie HZL,
Kostenübernahme oder Bezugsbetreuung haben keine sinnvolle englische
Entsprechung — eine gemischte Codebasis wäre schlechter als eine
konsequent deutsche. Umlaute in Bezeichnern werden umschrieben (`ue`, `ae`),
in Oberflächentexten und Kommentaren nicht.

**Kommentare erklären das WARUM, nie das WAS.** Der Code sagt schon, was er
tut. Wertvoll ist die Entscheidung dahinter — besonders dort, wo etwas
absichtlich ungewöhnlich aussieht. Beispiel aus `app.css`:

> Bewusst KEIN `position: fixed` dafür: das kollidiert auf echten
> Mobilbrowsern mit dem ein-/ausblendenden Adressleisten-Bereich […] —
> reproduzierbar in echten Browser-Tests nachvollzogen.

Ohne diesen Kommentar baut es jemand „richtig" wieder ein.

**Migrationen** sind fortlaufend nummeriert (`0019_mandant_akzentfarbe.sql`),
werden **nie nachträglich geändert** und tragen ihre Begründung als
Kommentar im Kopf. Nach einer neuen Migration: `pnpm migrate`.

**Validierung** mit zod im Controller. Achtung: es gibt **keinen globalen
ZodError-Filter** — ein durchgereichter `ZodError` wird zu einem 500 mit
Stacktrace. Wo ein 400 gewünscht ist, `safeParse` + `BadRequestException`
verwenden (Vorbild: `mandant.controller.ts`).

**Rollenprüfungen** gehören in den Service, neben das SQL, das sie schützt —
nicht in den Controller. Muster:
```ts
const ROLLEN_MIT_X = new Set<BenutzerRolle>(["leitung", "verwaltung"]);
// ...
const ctx = requireTenantContext();
if (!ROLLEN_MIT_X.has(ctx.rolle)) throw new ForbiddenException("…");
```

**Icons** ausschließlich über `components/icons.tsx` und nur mit
**namentlichen Importen**. Kein `import * as`, kein `DynamicIcon`, kein
`dynamicIconImports` — jedes davon zieht das komplette lucide-Set (>1 MB)
ins Bundle. Keine Smileys oder Gesichter; das ist eine Fachanwendung.

---

## Prüfen statt behaupten

Das ist die wichtigste Arbeitsregel in diesem Projekt.

- **Tests laufen gegen eine echte PostgreSQL-Instanz.** Kein Mock, kein
  In-Memory-Ersatz. RLS lässt sich nicht sinnvoll mocken — ein Mock würde
  genau die Eigenschaft wegabstrahieren, um die es geht.
- **Zu jedem sicherheitsrelevanten Test gehört eine Gegenprobe.** Prüfung
  auskommentieren, Testlauf muss rot werden, wiederherstellen. Ein Test, der
  nicht fehlschlagen kann, beweist nichts. Beispiele stehen in den
  Commit-Nachrichten zu Phase 7.
- **Layout- und Farbaussagen gehören gemessen**, nicht angesehen. „Sieht gut
  aus" ist kein Ergebnis; `scrollWidth > clientWidth` und ein Kontrastwert
  sind eins. Die Kontrastmatrix hat drei echte Fehler gefunden, die dem Auge
  entgangen waren — darunter zwei, die vorher monatelang im Code standen.
- **Ein Prüfskript, das nichts misst, muss fehlschlagen.** Die erste Fassung
  von `design-pruefung.mjs` meldete „alles in Ordnung" bei null Messungen,
  weil der Farbparser mit `oklch()` nicht zurechtkam. Seitdem bricht es ab,
  wenn es weniger Paare misst als erwartet.

---

## Wo was liegt

```
apps/api/          NestJS
  migrations/      Nummerierte SQL-Migrationen (Wahrheit über das Schema)
  src/common/      tenant-context, Anonymisierung, Geheimnisse, Dekoratoren
  src/database/    DatabaseService.withTenant() — der EINZIGE Ort mit DB-Zugriff
  test/            e2e-Specs gegen echte PostgreSQL
apps/web/          React + Vite (PWA)
  src/styles/      tokens.css (Designsystem) + app.css (Komponenten)
  src/theme/       Farbableitung (sRGB→OKLCH), ThemeProvider, Hell/Dunkel
  src/components/  icons.tsx, ThemeToggle, Leerzustand
  scripts/         Browser-Prüfskripte
packages/shared/   Typen und Label-Maps für API und Web gemeinsam
```

---

## Fallstricke, die schon Zeit gekostet haben

- **`pg` liefert `date`-Spalten als JS-`Date`.** Über den Parser in
  `database.service.ts` als String behandelt — sonst verschiebt die
  Zeitzone Datumsangaben um einen Tag.
- **`e.currentTarget` ist in einem `async` Formular-Handler nach dem ersten
  `await` `null`.** Vorher in eine lokale Variable heben.
- **`position: sticky` auf `thead` funktioniert hier nicht.** `.zv-table` ist
  `display: block` (damit breite Tabellen selbst scrollen statt die Seite
  aufzureißen) — der Scrollcontainer ist damit die Tabelle selbst.
- **`workbox.globPatterns` deckt Schriften nicht ab.** Ohne `woff2` in der
  Liste fällt Inter offline aus, ohne dass etwas sichtbar bricht.
- **Die Migration setzt das Passwort von `zimmerakte_app` auf einen
  Dev-Default.** In jeder echten Umgebung einmalig per `ALTER ROLE` ändern
  (siehe `docs/DEPLOYMENT.md`, Schritt 5).

---

## Git

Entwicklungszweig: `claude/zimmer-verwalter-modul-omh2tu`.
Nie `amend` oder `force-push` auf bereits gepushte Commits.

Commit-Nachrichten beschreiben **warum**, nicht nur was — und nennen, was
tatsächlich geprüft wurde (mit Zahlen). Sie sind in diesem Projekt die
Hauptquelle für die Begründung späterer Entscheidungen.

Jeder Commit endet mit:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01841f11LdYGdRmDbPoiBmh2
```
