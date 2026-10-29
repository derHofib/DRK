-- Mehrfach besetzte "Mitarbeiter"-Positionen je Person zusammenfuehren.
--
-- Ausgangslage: Wer an mehreren Standorten arbeitet, hat je Einrichtung eine
-- eigene Position vom Typ "Mitarbeiter" (eine Person mit sechs Besetzungen).
-- Gewollt ist: der Rang kommt je Person einmal vor, die Standorte haengen an
-- der Person (0066/0067).
--
-- Was diese Migration tut -- je Person mit MEHR ALS EINER aktuellen
-- Besetzung auf einer aktiven Linienposition vom Account-Typ "Mitarbeiter":
--   1. eine einzige Besetzung auf der gemeinsamen Sammelposition
--      "Mitarbeiter" am Traeger (wird bei Bedarf angelegt),
--   2. deren Standorte = alle Einheiten der bisherigen Positionen (Heimat-
--      Einheit, weitere Einheiten, Besetzungs-Einheiten) -- der Rechte-Anker
--      ist damit Einheit fuer Einheit derselbe wie vorher,
--   3. die alten Besetzungen enden "sofort" (gueltig_bis = gestern, wie in
--      0065) und bleiben als Historie erhalten, nichts wird geloescht,
--   4. alte Positionen, die dadurch leer sind, werden deaktiviert (nicht
--      geloescht), sofern niemand mehr darauf sitzt.
--
-- Was sie bewusst NICHT anfasst:
--   - Personen mit nur einer Mitarbeiter-Besetzung (nichts zu vereinheitlichen),
--   - Positionen mit Positions-Override fuer Rechte: ein Zusammenfuehren
--     wuerde den Override stillschweigend verlieren,
--   - Positionen, unter denen andere Positionen berichten (parent_position_id).
--   - jeden anderen Account-Typ (Leitungen sind Einzelstellen je Einrichtung).
--
-- Je Person laeuft alles in einem eigenen Unterblock: scheitert ein Schutz-
-- Trigger (z. B. in einem Mandanten ohne Vollzugriff-Besetzung), wird diese
-- Person uebersprungen und die Meldung ausgegeben, statt die ganze Migration
-- und damit jedes Update zu blockieren. Erneutes Ausfuehren ist harmlos: wer
-- nur noch eine Besetzung hat, wird nicht mehr angefasst.
DO $$
DECLARE
  r           record;
  v_traeger   uuid;
  v_ziel      uuid;
  v_neu       uuid;
  v_alt       uuid[];
  v_positionen uuid[];
  v_pos       uuid;
BEGIN
  FOR r IN
    SELECT b.mandant_id, b.benutzer_id, p.account_typ_id
    FROM org_position_besetzung b
    JOIN org_position p ON p.id = b.position_id AND p.aktiv AND p.typ = 'linie'
    JOIN account_typ a ON a.id = p.account_typ_id
      AND a.name = 'Mitarbeiter' AND a.kategorie = 'intern' AND NOT a.ist_vollzugriff
    WHERE b.gueltig_ab <= CURRENT_DATE
      AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE)
      AND NOT EXISTS (SELECT 1 FROM org_position_recht_override o WHERE o.position_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM org_position k WHERE k.parent_position_id = p.id)
    GROUP BY b.mandant_id, b.benutzer_id, p.account_typ_id
    HAVING count(*) > 1
  LOOP
    BEGIN
      SELECT id INTO v_traeger FROM org_unit WHERE mandant_id = r.mandant_id AND typ = 'traeger';
      IF v_traeger IS NULL THEN
        CONTINUE;
      END IF;

      -- Alle aktuellen Besetzungen dieser Person auf passenden Positionen.
      SELECT array_agg(b.id), array_agg(DISTINCT b.position_id)
        INTO v_alt, v_positionen
      FROM org_position_besetzung b
      JOIN org_position p ON p.id = b.position_id AND p.aktiv AND p.typ = 'linie'
      WHERE b.benutzer_id = r.benutzer_id AND p.account_typ_id = r.account_typ_id
        AND b.gueltig_ab <= CURRENT_DATE
        AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE)
        AND NOT EXISTS (SELECT 1 FROM org_position_recht_override o WHERE o.position_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM org_position k WHERE k.parent_position_id = p.id);

      -- Gemeinsame Sammelposition am Traeger: vorhandene wiederverwenden.
      SELECT id INTO v_ziel FROM org_position
      WHERE mandant_id = r.mandant_id AND account_typ_id = r.account_typ_id
        AND org_unit_id = v_traeger AND typ = 'linie' AND aktiv
        AND ist_sammelrang AND parent_position_id IS NULL
      ORDER BY erstellt_am LIMIT 1;

      IF v_ziel IS NULL THEN
        INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id, ist_sammelrang, soll_besetzung)
        VALUES (r.mandant_id, v_traeger, 'Mitarbeiter', r.account_typ_id, true, NULL)
        RETURNING id INTO v_ziel;
      END IF;

      -- Besetzung auf der Sammelposition: vorhandene weiterverwenden, sonst neu.
      SELECT id INTO v_neu FROM org_position_besetzung
      WHERE benutzer_id = r.benutzer_id AND position_id = v_ziel
        AND gueltig_ab <= CURRENT_DATE AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)
      LIMIT 1;
      IF v_neu IS NULL THEN
        INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id)
        VALUES (r.mandant_id, v_ziel, r.benutzer_id)
        RETURNING id INTO v_neu;
      END IF;

      -- Standorte: die Anker aller bisherigen Besetzungen, ohne den Traeger.
      INSERT INTO org_position_besetzung_einheit (mandant_id, besetzung_id, org_unit_id)
      SELECT r.mandant_id, v_neu, u.id
      FROM (
        SELECT p.org_unit_id AS id FROM org_position p WHERE p.id = ANY (v_positionen)
        UNION
        SELECT w.org_unit_id FROM org_position_weitere_einheit w WHERE w.position_id = ANY (v_positionen)
        UNION
        SELECT e.org_unit_id FROM org_position_besetzung_einheit e WHERE e.besetzung_id = ANY (v_alt)
      ) u
      WHERE u.id <> v_traeger
      ON CONFLICT (besetzung_id, org_unit_id) DO NOTHING;

      -- Alte Besetzungen sofort beenden (nicht die auf der Sammelposition).
      UPDATE org_position_besetzung SET gueltig_bis = GREATEST(gueltig_ab, CURRENT_DATE) - 1
      WHERE id = ANY (v_alt) AND position_id <> v_ziel;

      -- Leer gewordene alte Positionen deaktivieren.
      FOREACH v_pos IN ARRAY v_positionen LOOP
        IF v_pos <> v_ziel AND NOT EXISTS (
          SELECT 1 FROM org_position_besetzung b
          WHERE b.position_id = v_pos AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE)
        ) THEN
          UPDATE org_position SET aktiv = false WHERE id = v_pos;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Mitarbeiter % (Mandant %) nicht zusammengefuehrt: %', r.benutzer_id, r.mandant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
