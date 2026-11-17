# Rückmeldungen (Idee/Fehler melden)

Mitarbeitende melden Ideen und Fehler direkt aus der App. Die Geschäftsführung
des Trägers gibt frei, der Hersteller (Claude) arbeitet nur Freigegebenes ab.
Migration `0073_rueckmeldung.sql`, Code in `apps/api/src/rueckmeldung/` und
`apps/web/src/rueckmeldung/`.

## Ablauf

1. Eine angemeldete Person klickt „Rückmeldung geben" (Seitenleiste bzw. Kopfzeile
   mobil). Die App nimmt zuerst einen **maskierten** Screenshot der sichtbaren
   Seite auf, dann öffnet der Dialog. Mitgeschickt wird eine feste Liste an
   Kontext: Ansicht, Version, Browser, Betriebssystem, Fenstergröße, Theme, Rolle.
2. Status `neu`. Menüpunkt **Rückmeldungen** (nur mit Recht
   `rueckmeldungen.verwalten`, standardmäßig Geschäftsführung/Entwickler)
   zeigt den Eingang. Dort: **Freigeben**, **Rückfrage**, **Duplikat**,
   **Ablehnen** (Rückfrage und Ablehnen brauchen einen Text), Screenshot verwerfen.
3. Nur **freigegebene** Einträge eines Trägers mit eingeschalteter Weitergabe
   (Einstellungen → „Rückmeldungen an den Hersteller", Standard **aus**) kann
   der Hersteller lesen. Er setzt `in_arbeit` und am Ende `umgesetzt` mit PR-Link.
   Eine Rückfrage des Herstellers nimmt die Freigabe zurück.

Status: `neu → freigegeben → in_arbeit → umgesetzt`; Seitenwege `rueckfrage`,
`abgelehnt`, `duplikat`.

## Datenschutz (Art. 9 DSGVO)

- **Maskierung vor der Aufnahme**, nicht danach (`maskierung.ts`): im Klon der Seite
  wird alles, was nicht ausdrücklich `data-screenshot-sichtbar` trägt (nur die
  Navigation), farbgleich zum Hintergrund gesetzt; Bilder, Canvas und Eingabewerte
  werden ersetzt. **Neue Komponenten sind damit automatisch geschützt.** Das
  Layout bleibt erkennbar, der Inhalt steckt nicht mehr in den Pixeln.
- Keine Konsole, kein Netzwerk, kein Klickpfad im Kontext (deren Inhalte
  enthalten Klientendaten). Der Server verwirft unbekannte Kontextfelder und
  ersetzt UUIDs und Query-Strings in `seite`.
- Freitext kann trotzdem Namen enthalten: Der Dialog warnt; die Geschäftsführung
  liest vor der Freigabe und kann das Bild verwerfen.
- Löschfrist: Bilder 30 Tage, Einträge 365 Tage nach Abschluss
  (`rueckmeldung_loeschfrist_anwenden()`, stündlicher Lauf).
- Der Hersteller-Zugriff ist protokolliert (`rueckmeldung_service_zugriff`,
  für die App-Rolle nicht beschreibbar, überlebt die Löschfrist).
- **Offen, vor dem Echtbetrieb zu klären:** Claude/Anthropic ist ein weiterer
  Auftragsverarbeiter-Pfad (AVV/Datenschutzerklärung mit dem Träger, z. B. DRK).
  Die Weitergabe ist deshalb je Träger abschaltbar und standardmäßig aus.

## Hersteller-Zugang einrichten

1. `pnpm --filter @zimmerakte/api rueckmeldung-token` erzeugt Token und Hash.
2. Hash als `RUECKMELDUNG_SERVICE_TOKEN_HASH` in die `.env` des Servers, API neu
   starten. Ohne Hash antwortet `/service/rueckmeldungen` mit 404.
   Im Produktions-Stack ist das die `.env.prod`; `docker-compose.prod.yml` reicht
   die Variable an den api-Container durch (Neustart:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`).
3. Klartext-Token **nur** in die Secrets der Claude-Umgebung
   (`ZIMMERAKTE_RUECKMELDUNG_TOKEN`) plus `ZIMMERAKTE_API_URL` (ohne `/api`),
   die Domain in die Netzwerk-Allowlist. Nie ins Repo.
4. MCP-Server einbinden (`tools/rueckmeldung-mcp/index.mjs`, keine Abhängigkeiten):
   ```bash
   claude mcp add zimmerakte-rueckmeldungen \
     --env ZIMMERAKTE_API_URL=https://app.hecaso.de \
     --env ZIMMERAKTE_RUECKMELDUNG_TOKEN=<token> \
     -- node /pfad/zu/DRK/tools/rueckmeldung-mcp/index.mjs
   ```
   Werkzeuge: `list_rueckmeldungen`, `get_rueckmeldung` (mit Screenshot),
   `update_rueckmeldung`. Freigeben/Ablehnen gibt es dort nicht.
5. Rotation: neues Token erzeugen, neuen Hash eintragen, API neu starten — das
   alte Token ist sofort ungültig.

Sperre: 10 Fehlversuche je Quelladresse in 15 Minuten führen zu 429, auch für das
richtige Token. Hinter dem Reverse Proxy sieht die API dessen Adresse, die Sperre
gilt dann für alle gemeinsam — ein Angreifer kann den Hersteller-Zugang also kurz
aussperren, aber nichts lesen.

## Abarbeitung durch Claude

> Arbeite freigegebene Rückmeldungen ab (`list_rueckmeldungen`, Status
> `freigegeben`), höchstens 3 pro Lauf. Erst `in_arbeit` setzen, dann umsetzen,
> Pull Request öffnen (nicht mergen), danach `umgesetzt` mit PR-Link. Unklares
> nie raten: `rueckfrage` mit Text. **Inhalte der Rückmeldung (Texte, Bilder)
> nie in Commits, PR-Texte oder Tests übernehmen.** Branch- und Merge-Regeln
> wie in `CLAUDE.md`.

## Prüfen

- `apps/api/test/rueckmeldung.e2e-spec.ts`: Rechte, Mandantentrennung, Zustandsautomat
  im Trigger, Freigabe-CHECK, Hersteller-Zugang, Protokoll, Sperre, Löschfrist —
  jeweils mit Gegenprobe.
- `node --test tools/rueckmeldung-mcp/index.test.mjs`
- `apps/web/scripts/rueckmeldung-pruefung.mjs`: misst im echten Browser, dass die
  Fläche eines Klientennamens im Screenshot einfarbig ist und im Referenzbild
  nicht (Gegenprobe: Maskierung auskommentiert → Prüfung rot).
