-- Ein einheitliches Aufgaben-Modell fuer zwei Faelle statt zwei Tabellen:
-- Zimmer-Aufgaben ("Fenstergriff defekt") und persoenliche Aufgaben (gehoert
-- nur der erstellenden Person). zimmer_id und zugewiesen_an sind unabhaengig
-- voneinander nullable -- alle vier Kombinationen sind gueltig, eine
-- Zimmer-Aufgabe ohne Zuweisung ist ein offener Posten, kein Fehlerzustand.
--
-- Wie bei belegung.bis / kostenuebernahme.bis: kein Statusfeld. Eine
-- Aufgabe ist binaer offen oder erledigt, "offen" ist erledigt_am IS NULL,
-- abgeleitet statt gespeichert. Wiedereroeffnen ist bewusst NICHT
-- vorgesehen -- wenn spaeter gebraucht, ist das ein mehrstufiger Workflow
-- (aufgabe_statuswechsel nach dem Muster von rechnung_statuswechsel,
-- 0014), keine nachtraeglich eingefuehrte Statusspalte.
CREATE TYPE aufgabe_prioritaet AS ENUM ('niedrig', 'normal', 'hoch');

CREATE TABLE aufgabe (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),

  titel          text NOT NULL,
  beschreibung   text,
  prioritaet     aufgabe_prioritaet NOT NULL DEFAULT 'normal',
  faellig_am     date,

  -- Absichtlich ON DELETE CASCADE: eine Aufgabe ohne ihr Zimmer ist keine
  -- Zimmer-Aufgabe mehr und auch keine persoenliche Aufgabe (sie wurde nie
  -- ohne Zimmerbezug angelegt) -- sie haette ohne das Zimmer keine
  -- sinnvolle Bedeutung mehr. Anders als belegung (dort bleibt die Historie
  -- flotte gegen ein geloeschtes Zimmer bewusst erhalten, siehe 0009) ist
  -- eine Aufgabe reine Arbeitsorganisation ohne Aufbewahrungspflicht.
  zimmer_id      uuid REFERENCES zimmer(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL: eine geloeschte Zuweisung darf die Aufgabe nicht
  -- mitreissen -- sie wird zu einer nicht mehr zugewiesenen Aufgabe (wie
  -- "niemand" beim Zuweisen), nicht geloescht. Es gibt aktuell keinen
  -- Benutzer-Loeschpfad, das ist trotzdem die richtige Semantik.
  zugewiesen_an  uuid REFERENCES benutzer(id) ON DELETE SET NULL,
  erstellt_von   uuid NOT NULL REFERENCES benutzer(id),

  erledigt_am    timestamptz,
  erledigt_von   uuid REFERENCES benutzer(id),

  erstellt_am    timestamptz NOT NULL DEFAULT now(),
  geaendert_am   timestamptz NOT NULL DEFAULT now(),

  CHECK ((erledigt_am IS NULL) = (erledigt_von IS NULL))
);

CREATE INDEX aufgabe_zimmer_offen_idx ON aufgabe (mandant_id, zimmer_id) WHERE erledigt_am IS NULL;
CREATE INDEX aufgabe_zugewiesen_offen_idx ON aufgabe (mandant_id, zugewiesen_an) WHERE erledigt_am IS NULL;
CREATE INDEX aufgabe_faellig_offen_idx ON aufgabe (mandant_id, faellig_am) WHERE erledigt_am IS NULL;

ALTER TABLE aufgabe ENABLE ROW LEVEL SECURITY;
ALTER TABLE aufgabe FORCE ROW LEVEL SECURITY;

-- Ebene 1 (Mandant) und Ebene 3 (Person) sitzen beide hier, weil beide nur
-- Spalten dieser einen Tabelle gegen den Session-Kontext vergleichen --
-- app.benutzer_id steht seit jeher in DatabaseService.withTenant() zur
-- Verfuegung (SET LOCAL neben app.mandant_id/app.rolle), wurde bislang nur
-- noch nirgends fuer eine RLS-Policy gebraucht. Zimmer-Aufgaben
-- (zimmer_id IS NOT NULL) laesst diese Policy immer durch -- ihre eigentliche
-- Schranke ist der Standort, und der braucht einen Join ueber
-- benutzer_standort/zimmer (siehe common/standort-restriction.ts,
-- Kommentar zu "leere Liste vs. keine Einschraenkung nicht sauber in RLS
-- abbildbar") -- deshalb bleibt Ebene 2 im Service, wie bei Zimmer/Klient
-- auch. Persoenliche Aufgaben (zimmer_id IS NULL) muessen zusaetzlich
-- erstellt_von/zugewiesen_an treffen, sonst sieht sie niemand -- auch keine
-- Leitungsrolle, wie gefordert.
CREATE POLICY aufgabe_isolation ON aufgabe
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      zimmer_id IS NOT NULL
      OR erstellt_von = current_setting('app.benutzer_id', true)::uuid
      OR zugewiesen_an = current_setting('app.benutzer_id', true)::uuid
    )
  );

-- Bewusst KEIN Append-only, anders als kassenbuchung/rechnung: Aufgaben
-- sind Arbeitsorganisation, keine Buchfuehrung. Es gibt keine rechtliche
-- oder fachliche Notwendigkeit, eine falsch getippte Aufgabe fuer immer
-- sichtbar zu lassen oder ihren Verlauf zu protokollieren -- im Gegenteil,
-- eine wachsende Liste erledigter/veralteter Eintraege waere hier reine
-- Ablenkung vom eigentlichen Zweck (was ist gerade offen). UPDATE (Titel,
-- Beschreibung, Faelligkeit, Prioritaet, Zuweisung, Erledigen) und DELETE
-- bleiben deshalb die vollen Standardrechte der App-Rolle aus
-- ALTER DEFAULT PRIVILEGES (0002) -- keine REVOKE/GRANT-Einschraenkung
-- noetig. Das serverseitige Setzen von erledigt_am/erledigt_von (nie aus
-- dem Request-Body) ist trotzdem Aufgabe des Service, nicht der Datenbank
-- -- es gibt hier keine Spalte, die dauerhaft vor der App-Rolle geschuetzt
-- werden muesste, wie es storniert_von bei kassenbuchung waere.
CREATE FUNCTION aufgabe_geaendert_am_setzen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.geaendert_am := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER aufgabe_geaendert_am_setzen
  BEFORE UPDATE ON aufgabe
  FOR EACH ROW EXECUTE FUNCTION aufgabe_geaendert_am_setzen();
