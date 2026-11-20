-- Standort-Steckbrief Phase 2 (Konzept standort-daten, 3.3 / 5.2 / 6):
-- Kontakte vor Ort und Vereinbarungen mit Kostentraegern und Behoerden.
--
-- Beides sind n Zeilen je Standort mit eigenem Zeitbezug, deshalb eigene
-- Tabellen statt weiterer Spalten an standort.
--
-- Kontakte vor Ort (Hausverwaltung, Hausmeister, Notdienste, Krisendienst,
-- Hausarzt, Apotheke, Polizei) sieht jede:r mit Zugriff auf den Standort --
-- sie sind genau das, was nachts gebraucht wird. Es sind Kontaktdaten
-- Dritter, aber dienstliche, keine Daten betreuter Menschen. Aendern und
-- Loeschen erlaubt (eine alte Hausmeister-Nummer hat keinen Nachweiswert),
-- jede Aenderung landet im audit_log.
--
-- Vereinbarungen (Leistungs-, Verguetungsvereinbarung, Betriebserlaubnis)
-- sind gegenueber Kostentraegern nachweisrelevant: wie kostenuebernahme
-- wird nichts geloescht und nur Laufzeitende, Kennung und Bemerkung sind
-- korrigierbar. Ein Tippfehler in Partner, Plaetzen oder Verguetung wird
-- nicht ueberschrieben, sondern storniert und neu erfasst -- sonst liesse
-- sich ein Verguetungssatz still aendern.

-- ---------------------------------------------------------------------------
-- Kontakte vor Ort
-- ---------------------------------------------------------------------------
CREATE TABLE standort_kontakt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  standort_id   uuid NOT NULL,
  -- Feste Rollen statt Freitext: die mobile Notfallansicht zeigt Notdienst,
  -- Krisendienst und Polizei oben; das geht nur mit verlaesslichen Werten.
  rolle         text NOT NULL CHECK (rolle IN ('vermieter', 'hausmeister', 'notdienst', 'krisendienst',
                                               'hausarzt', 'apotheke', 'polizei', 'sonstiges')),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  telefon       text,
  email         text,
  hinweis       text,
  erstellt_von  uuid REFERENCES benutzer(id),
  erstellt_am   timestamptz NOT NULL DEFAULT now(),
  -- Zusammengesetzt (CLAUDE.md Regel 1): ein FK nur auf standort(id) liesse
  -- einen Kontakt von Mandant A an einem Standort von Mandant B zu.
  FOREIGN KEY (standort_id, mandant_id) REFERENCES standort (id, mandant_id)
);

CREATE INDEX standort_kontakt_standort_idx ON standort_kontakt (standort_id);

ALTER TABLE standort_kontakt ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort_kontakt FORCE ROW LEVEL SECURITY;
CREATE POLICY standort_kontakt_isolation ON standort_kontakt
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Standort, Mandant und Herkunft sind fest; ein Kontakt wandert nicht.
REVOKE UPDATE ON standort_kontakt FROM zimmerakte_app;
GRANT UPDATE (rolle, name, telefon, email, hinweis) ON standort_kontakt TO zimmerakte_app;

-- ---------------------------------------------------------------------------
-- Vereinbarungen
-- ---------------------------------------------------------------------------
CREATE TABLE standort_vereinbarung (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id           uuid NOT NULL REFERENCES mandant(id),
  standort_id          uuid NOT NULL,
  art                  text NOT NULL CHECK (art IN ('leistungsvereinbarung', 'verguetungsvereinbarung',
                                                    'betriebserlaubnis', 'sonstige')),
  partner              text NOT NULL CHECK (btrim(partner) <> ''),  -- Kostentraeger bzw. Behoerde
  kennung              text,                   -- Aktenzeichen / Leistungserbringer-Nr.
  gueltig_von          date NOT NULL,
  gueltig_bis          date,
  -- Genehmigte Plaetze sind eine Behoerdenzahl, keine Ableitung (Konzept 3.1).
  plaetze              integer CHECK (plaetze > 0),
  verguetung_tag_cent  integer CHECK (verguetung_tag_cent >= 0),
  bemerkung            text,
  erstellt_von         uuid REFERENCES benutzer(id),
  erstellt_am          timestamptz NOT NULL DEFAULT now(),
  storniert_am         timestamptz,
  storniert_von        uuid REFERENCES benutzer(id),
  storno_grund         text,
  FOREIGN KEY (standort_id, mandant_id) REFERENCES standort (id, mandant_id),
  UNIQUE (id, mandant_id),
  CHECK (gueltig_bis IS NULL OR gueltig_bis > gueltig_von),
  CHECK ((storniert_am IS NULL) = (storniert_von IS NULL)),
  CHECK (storniert_am IS NULL OR btrim(coalesce(storno_grund, '')) <> '')
);

CREATE INDEX standort_vereinbarung_standort_idx ON standort_vereinbarung (standort_id);

ALTER TABLE standort_vereinbarung ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort_vereinbarung FORCE ROW LEVEL SECURITY;
CREATE POLICY standort_vereinbarung_isolation ON standort_vereinbarung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON standort_vereinbarung FROM zimmerakte_app;
GRANT UPDATE (gueltig_bis, kennung, bemerkung, storniert_am, storniert_von, storno_grund)
  ON standort_vereinbarung TO zimmerakte_app;

-- Spaltenrechte allein lassen ein Storno zuruecknehmen (storniert_am wieder
-- NULL) oder eine stornierte Zeile weiter bearbeiten. Beides wuerde den
-- Nachweis aushoehlen, deshalb hier in der Datenbank statt im Service.
CREATE FUNCTION standort_vereinbarung_storno_endgueltig() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Eine stornierte Vereinbarung kann nicht mehr geändert werden.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standort_vereinbarung_storno_endgueltig
  BEFORE UPDATE ON standort_vereinbarung
  FOR EACH ROW EXECUTE FUNCTION standort_vereinbarung_storno_endgueltig();

-- ---------------------------------------------------------------------------
-- Recht standorte.vereinbarungen
-- ---------------------------------------------------------------------------
-- Verguetungssaetze sind Geschaeftsdaten des Traegers: standardmaessig nur
-- Geschaeftsfuehrung und Bereichsleitung (Nachtrag 20.11.2026). Die
-- Geschaeftsfuehrung hat es ueber ist_vollzugriff ohnehin; die
-- Bereichsleitung ist in der Matrix erkennbar am Recht, neue Standorte
-- anzulegen (eine traegerweite Entscheidung, siehe standort.service.ts
-- anlegen()). Einrichtungsleitungen bekommen es bewusst nicht von selbst;
-- der Mandant vergibt es danach frei in der Matrix.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'standorte', 'vereinbarungen', r.scope, r.erlaubt
FROM account_typ_recht r
WHERE r.modul = 'standorte' AND r.aktion = 'anlegen'
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Erinnerungen vor dem Ende einer Vereinbarung (90, 60, 30 Tage)
-- ---------------------------------------------------------------------------
-- Muster 0071. Eine Verlaengerung beim Kostentraeger dauert Monate, deshalb
-- schon ab 90 Tagen. Die Aufgabe ist persoenlich und geht an die aus dem
-- Organigramm abgeleitete Leitung des Standorts (aufgabe kennt keinen
-- Standortbezug, nur Zimmer -- eine Zimmer-Aufgabe saehe das ganze Team,
-- und Vereinbarungen sind nicht fuer alle bestimmt). Ohne Leitung bekommt
-- sie, wer die Vereinbarung erfasst hat. Gibt es keinen von beiden, wird
-- nichts vermerkt, damit die Erinnerung nachgeholt wird, sobald jemand die
-- Stelle besetzt; der Hinweis im Steckbrief steht trotzdem.
--
-- Der Aufgabentext nennt Art, Partner und Datum, nie die Verguetung: die
-- Leitung eines Hauses hat nicht zwingend das Recht, sie zu sehen.
CREATE TABLE standort_vereinbarung_erinnerung (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  vereinbarung_id   uuid NOT NULL,
  stufe_tage        integer NOT NULL CHECK (stufe_tage IN (90, 60, 30)),
  aufgabe_id        uuid REFERENCES aufgabe(id) ON DELETE SET NULL,
  erzeugt_am        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (vereinbarung_id, mandant_id) REFERENCES standort_vereinbarung (id, mandant_id),
  UNIQUE (vereinbarung_id, stufe_tage)
);

ALTER TABLE standort_vereinbarung_erinnerung ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort_vereinbarung_erinnerung FORCE ROW LEVEL SECURITY;
CREATE POLICY standort_vereinbarung_erinnerung_isolation ON standort_vereinbarung_erinnerung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE INSERT, UPDATE, DELETE ON standort_vereinbarung_erinnerung FROM zimmerakte_app;

CREATE FUNCTION standort_vereinbarung_erinnerungen_erzeugen()
RETURNS TABLE (mandant_id uuid, aufgaben bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  s integer;
  v_stufe integer;
  v_empfaenger uuid;
  v_aufgabe uuid;
  v_eingefuegt uuid;
  v_zaehler bigint;
  m uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('standort_vereinbarung_erinnerungen_erzeugen', 0)) THEN
    RETURN;
  END IF;

  FOR m IN SELECT id FROM mandant ORDER BY id LOOP
    v_zaehler := 0;

    FOR r IN
      SELECT v.id, v.standort_id, v.art, v.partner, v.gueltig_bis, v.erstellt_von,
             st.name AS standort_name, (v.gueltig_bis - CURRENT_DATE) AS tage
      FROM standort_vereinbarung v
      JOIN standort st ON st.id = v.standort_id
      WHERE v.mandant_id = m
        AND st.aktiv
        AND v.storniert_am IS NULL
        AND v.gueltig_bis IS NOT NULL
        AND v.gueltig_bis BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
        -- Schon verlaengert: eine SPAETER beginnende Vereinbarung derselben Art
        -- schliesst an (eine aeltere unbefristete ist keine Verlaengerung).
        AND NOT EXISTS (
          SELECT 1 FROM standort_vereinbarung folge
          WHERE folge.standort_id = v.standort_id
            AND folge.art = v.art
            AND folge.id <> v.id
            AND folge.storniert_am IS NULL
            AND folge.gueltig_von > v.gueltig_von
            AND folge.gueltig_von <= v.gueltig_bis + 1
            AND (folge.gueltig_bis IS NULL OR folge.gueltig_bis > v.gueltig_bis)
        )
      ORDER BY v.gueltig_bis
    LOOP
      -- Leitung wie leitungJeStandort() in standort.service.ts: besetzte
      -- Linienposition am Einrichtungsknoten (oder ihm zugeordnet), die dort
      -- oben steht; die oberste zuerst.
      SELECT b.id INTO v_empfaenger
      FROM (
        SELECT p.id AS position_id, ou.id AS unit_id
        FROM org_position p JOIN org_unit ou ON ou.id = p.org_unit_id
        WHERE ou.standort_id = r.standort_id
        UNION
        SELECT we.position_id, ou.id
        FROM org_position_weitere_einheit we JOIN org_unit ou ON ou.id = we.org_unit_id
        WHERE ou.standort_id = r.standort_id
      ) a
      JOIN org_position p ON p.id = a.position_id
      LEFT JOIN org_position eltern ON eltern.id = p.parent_position_id
      JOIN org_position_besetzung pb ON pb.position_id = p.id
        AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
      JOIN benutzer b ON b.id = pb.benutzer_id AND b.aktiv
      WHERE p.aktiv AND p.typ = 'linie' AND NOT p.ist_sammelrang AND NOT p.ist_geplant
        AND (eltern.id IS NULL OR eltern.org_unit_id <> a.unit_id OR p.titel ~* '(leitung|stellv)')
      ORDER BY (eltern.id IS NULL OR eltern.org_unit_id <> a.unit_id) DESC,
               p.reihenfolge NULLS LAST, b.name
      LIMIT 1;

      IF v_empfaenger IS NULL THEN
        SELECT b.id INTO v_empfaenger FROM benutzer b WHERE b.id = r.erstellt_von AND b.aktiv;
      END IF;
      CONTINUE WHEN v_empfaenger IS NULL;

      v_stufe := CASE WHEN r.tage <= 30 THEN 30 WHEN r.tage <= 60 THEN 60 ELSE 90 END;

      FOREACH s IN ARRAY ARRAY[90, 60, 30] LOOP
        CONTINUE WHEN s < r.tage;

        INSERT INTO standort_vereinbarung_erinnerung (mandant_id, vereinbarung_id, stufe_tage)
        VALUES (m, r.id, s)
        ON CONFLICT (vereinbarung_id, stufe_tage) DO NOTHING
        RETURNING id INTO v_eingefuegt;

        IF v_eingefuegt IS NOT NULL AND s = v_stufe THEN
          INSERT INTO aufgabe (mandant_id, titel, beschreibung, prioritaet, faellig_am, zimmer_id, zugewiesen_an, erstellt_von)
          VALUES (
            m,
            format('%s: %s endet in %s Tagen', r.standort_name,
              CASE r.art
                WHEN 'leistungsvereinbarung' THEN 'Leistungsvereinbarung'
                WHEN 'verguetungsvereinbarung' THEN 'Vergütungsvereinbarung'
                WHEN 'betriebserlaubnis' THEN 'Betriebserlaubnis'
                ELSE 'Vereinbarung'
              END,
              r.tage),
            format(
              'Die Vereinbarung mit %s läuft am %s aus. Bitte rechtzeitig die Verlängerung klären und die Folgevereinbarung im Standort-Steckbrief erfassen.',
              r.partner, to_char(r.gueltig_bis, 'DD.MM.YYYY')
            ),
            CASE s WHEN 30 THEN 'hoch' ELSE 'normal' END::aufgabe_prioritaet,
            GREATEST(CURRENT_DATE, r.gueltig_bis - CASE s WHEN 90 THEN 60 WHEN 60 THEN 30 ELSE 14 END),
            NULL,
            v_empfaenger,
            v_empfaenger
          )
          RETURNING id INTO v_aufgabe;

          UPDATE standort_vereinbarung_erinnerung SET aufgabe_id = v_aufgabe WHERE id = v_eingefuegt;
          v_zaehler := v_zaehler + 1;
        END IF;
        v_eingefuegt := NULL;
      END LOOP;
      v_empfaenger := NULL;
    END LOOP;

    IF v_zaehler > 0 THEN
      mandant_id := m;
      aufgaben := v_zaehler;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION standort_vereinbarung_erinnerungen_erzeugen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION standort_vereinbarung_erinnerungen_erzeugen() TO zimmerakte_app;
