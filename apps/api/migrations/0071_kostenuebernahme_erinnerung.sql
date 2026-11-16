-- Erinnerungen vor dem Ablauf einer Kostenuebernahme (90, 60 und 30 Tage).
--
-- Bis hierher zeigte nur das Dashboard Zeitraeume, die in den naechsten 30
-- Tagen enden -- wer es nicht oeffnete, erfuhr nichts. Ein Amt braucht aber
-- oft Wochen fuer die Verlaengerung; 30 Tage sind dafuer zu knapp. Jetzt
-- entsteht je Stufe (90/60/30 Tage vor "bis") eine Zimmer-Aufgabe, die in
-- der normalen Aufgabenliste landet und der Bezugsbetreuung zugewiesen ist
-- (ohne Bezugsbetreuung: offener Posten fuer den Standort).
--
-- Warum Zimmer-Aufgabe und keine persoenliche: persoenliche Aufgaben sieht
-- nur, wer sie erstellt hat oder wem sie gehoert (0033) -- faellt die
-- Bezugsbetreuung aus, saehe sie niemand. Eine Zimmer-Aufgabe sieht der
-- ganze Standort. Der Klientenname steht bewusst NICHT im Aufgabentext: die
-- Aufgabe ueberlebt eine Anonymisierung (Art. 17 DSGVO), der Bezug laeuft
-- ueber das Zimmer.
--
-- Idempotenz: kostenuebernahme_erinnerung haelt je Zeitraum und Stufe genau
-- eine Zeile (UNIQUE). Der Lauf kann beliebig oft kommen, jede Stufe loest
-- nur einmal aus -- auch dann, wenn die Aufgabe erledigt oder geloescht wird
-- (aufgabe_id wird dann NULL, die Zeile bleibt). Wird ein Zeitraum erst
-- spaet erfasst (z. B. noch 20 Tage), entsteht nur die dringendste Aufgabe;
-- die uebersprungenen Stufen werden ohne Aufgabe vermerkt, damit nicht
-- drei Aufgaben auf einmal aufpoppen.
--
-- Kein Erinnern, wenn schon ein Folge-Zeitraum nahtlos anschliesst.
--
-- Die Aufgaben entstehen ohne anfragende Person. Wie bei der Chat-Loeschfrist
-- (0061) bekommt die App-Rolle dafuer KEIN INSERT auf die Erinnerungstabelle,
-- sondern darf genau eine parameterlose SECURITY-DEFINER-Funktion aufrufen.
CREATE TABLE kostenuebernahme_erinnerung (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id           uuid NOT NULL REFERENCES mandant(id),
  kostenuebernahme_id  uuid NOT NULL REFERENCES kostenuebernahme(id) ON DELETE CASCADE,
  stufe_tage           integer NOT NULL CHECK (stufe_tage IN (90, 60, 30)),
  -- NULL = uebersprungene Stufe oder Aufgabe inzwischen geloescht.
  aufgabe_id           uuid REFERENCES aufgabe(id) ON DELETE SET NULL,
  erzeugt_am           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kostenuebernahme_id, stufe_tage)
);

ALTER TABLE kostenuebernahme_erinnerung ENABLE ROW LEVEL SECURITY;
ALTER TABLE kostenuebernahme_erinnerung FORCE ROW LEVEL SECURITY;

CREATE POLICY kostenuebernahme_erinnerung_isolation ON kostenuebernahme_erinnerung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Nur lesen: geschrieben wird ausschliesslich ueber die Funktion unten.
REVOKE INSERT, UPDATE, DELETE ON kostenuebernahme_erinnerung FROM zimmerakte_app;

CREATE FUNCTION kostenuebernahme_erinnerungen_erzeugen()
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
  v_zimmer uuid;
  v_betreuer uuid;
  v_ersteller uuid;
  v_aufgabe uuid;
  v_eingefuegt uuid;
  v_zaehler bigint;
  m uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('kostenuebernahme_erinnerungen_erzeugen', 0)) THEN
    RETURN;
  END IF;

  FOR m IN SELECT id FROM mandant ORDER BY id LOOP
    v_zaehler := 0;

    FOR r IN
      SELECT ko.id, ko.klient_id, ko.amt, ko.bis, ko.erstellt_von, (ko.bis - CURRENT_DATE) AS tage
      FROM kostenuebernahme ko
      JOIN klient k ON k.id = ko.klient_id
      WHERE ko.mandant_id = m
        AND ko.bis IS NOT NULL
        AND ko.bis BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
        AND k.anonymisiert_am IS NULL
        AND k.archiviert_am IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM kostenuebernahme folge
          WHERE folge.klient_id = ko.klient_id
            AND folge.id <> ko.id
            AND folge.von <= ko.bis
            AND (folge.bis IS NULL OR folge.bis > ko.bis)
        )
      ORDER BY ko.bis
    LOOP
      -- Die Aufgabe haengt am Zimmer; ohne aktuelle Belegung gibt es keins.
      -- Dann gar nichts vermerken, damit die Erinnerung nachgeholt wird,
      -- sobald jemand einzieht. Das Dashboard zeigt den Zeitraum trotzdem.
      SELECT bel.zimmer_id INTO v_zimmer
      FROM belegung bel
      WHERE bel.klient_id = r.klient_id AND bel.auszug IS NULL AND bel.einzug <= CURRENT_DATE
      ORDER BY bel.einzug DESC
      LIMIT 1;
      CONTINUE WHEN v_zimmer IS NULL;

      SELECT b.id INTO v_betreuer
      FROM klient_stammdaten st
      JOIN benutzer b ON b.id = st.bezugsbetreuer_id AND b.aktiv
      WHERE st.klient_id = r.klient_id;

      -- Pflichtfeld erstellt_von: Bezugsbetreuung, sonst wer den Zeitraum
      -- erfasst hat, sonst die dienstaelteste aktive Person des Mandanten (benutzer.rolle gibt
      -- es seit dem Organigramm nicht mehr; der Wert dient nur der Herkunft, die
      -- Sichtbarkeit laeuft ueber das Zimmer).
      v_ersteller := COALESCE(
        v_betreuer,
        (SELECT b.id FROM benutzer b WHERE b.id = r.erstellt_von AND b.aktiv),
        (SELECT b.id FROM benutzer b
          WHERE b.mandant_id = m AND b.aktiv
          ORDER BY b.erstellt_am LIMIT 1)
      );
      CONTINUE WHEN v_ersteller IS NULL;

      -- Dringendste zutreffende Stufe: die kleinste Schwelle, die noch >= Restzeit ist.
      v_stufe := CASE WHEN r.tage <= 30 THEN 30 WHEN r.tage <= 60 THEN 60 ELSE 90 END;

      FOREACH s IN ARRAY ARRAY[90, 60, 30] LOOP
        CONTINUE WHEN s < r.tage;

        INSERT INTO kostenuebernahme_erinnerung (mandant_id, kostenuebernahme_id, stufe_tage)
        VALUES (m, r.id, s)
        ON CONFLICT (kostenuebernahme_id, stufe_tage) DO NOTHING
        RETURNING id INTO v_eingefuegt;

        IF v_eingefuegt IS NOT NULL AND s = v_stufe THEN
          INSERT INTO aufgabe (mandant_id, titel, beschreibung, prioritaet, faellig_am, zimmer_id, zugewiesen_an, erstellt_von)
          VALUES (
            m,
            format('Kostenübernahme endet in %s Tagen', r.tage),
            format(
              'Die Kostenübernahme (%s) läuft am %s aus. Bitte rechtzeitig die Verlängerung beim Amt klären.',
              r.amt, to_char(r.bis, 'DD.MM.YYYY')
            ),
            CASE s WHEN 30 THEN 'hoch' ELSE 'normal' END::aufgabe_prioritaet,
            GREATEST(CURRENT_DATE, r.bis - CASE s WHEN 90 THEN 60 WHEN 60 THEN 30 ELSE 14 END),
            v_zimmer,
            v_betreuer,
            v_ersteller
          )
          RETURNING id INTO v_aufgabe;

          UPDATE kostenuebernahme_erinnerung SET aufgabe_id = v_aufgabe WHERE id = v_eingefuegt;
          v_zaehler := v_zaehler + 1;
        END IF;
        v_eingefuegt := NULL;
      END LOOP;
    END LOOP;

    IF v_zaehler > 0 THEN
      mandant_id := m;
      aufgaben := v_zaehler;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION kostenuebernahme_erinnerungen_erzeugen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kostenuebernahme_erinnerungen_erzeugen() TO zimmerakte_app;
