-- Standort-Sicht: welche Standorte eine Person sieht, an EINER Stelle
-- (Konzept /mnt/project-files/standort-sichtbarkeit/konzept-standort-sichtbarkeit.md,
-- Wunsch von Dennis 20.11.2026: "wer nur einem Standort zugewiesen ist, sieht
-- nur seinen Standort; eine Vertretung kann das aufheben").
--
-- Bisher las die Standort-Schranke (common/standort-restriction.ts und die
-- Chat-Funktionen aus 0056/0057) ausschliesslich benutzer_standort
-- ("Standorte zuweisen"). Zwei Luecken:
--   1. Wer nur ueber seinen Rang einem Haus zugeordnet ist ("Arbeitet an",
--      org_position_besetzung_einheit, 0066), sah ALLE Haeuser -- "keine Zeile
--      in benutzer_standort = keine Einschraenkung" ist offen statt geschlossen.
--   2. Eine genehmigte Vertretung gab Rechte weiter (rechte.service.ts,
--      delegierteAufloesung), aber keine Standorte: der Vertreter hatte die
--      Rechte der Kollegin, sah aber keine einzige ihrer Klient:innen.
--
-- Loesung: standort_sicht() leitet die Sicht ab (Regel 4, nichts gespeichert),
-- sichtbare_standorte() fasst sie zu einem Array zusammen, und jede bisherige
-- Leseseite ruft nur noch diese Funktion. Damit gilt die Regel in allen
-- Services gleichzeitig, ohne dass einer davon geaendert werden muss.
--
-- Umstellung schaltbar je Traeger (standort_sicht_aus_rang): die neue Regel
-- schraenkt Menschen ein, die heute mehr sehen. Bis die Leitung die Vorschau
-- ("wer sieht danach weniger") gesehen und umgeschaltet hat, bleibt Punkt 1
-- wie bisher. Die Vertretungs-Standorte (Punkt 2) gelten sofort: sie
-- erweitern nur, nehmen niemandem etwas weg.

ALTER TABLE mandant ADD COLUMN standort_sicht_aus_rang boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN mandant.standort_sicht_aus_rang IS
  'true: wer keine feste Sicht (benutzer_standort) hat, sieht die Einrichtungen aus seinem Rang statt aller Standorte. Siehe standort_sicht().';
-- REVOKE UPDATE ON mandant gilt seit 0019; nur diese eine Spalte kommt dazu.
GRANT UPDATE (standort_sicht_aus_rang) ON mandant TO zimmerakte_app;

-- Standorte, die eine Vertretung mitgibt. Nur Anlegen: was einmal genehmigt
-- wurde, soll im Nachhinein nicht still erweitert werden koennen (ein
-- Widerruf beendet die ganze Vertretung, delegation.status).
ALTER TABLE delegation ADD CONSTRAINT delegation_id_mandant_uq UNIQUE (id, mandant_id);

CREATE TABLE delegation_standort (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  delegation_id uuid NOT NULL,
  standort_id   uuid NOT NULL,
  UNIQUE (delegation_id, standort_id),
  -- Zusammengesetzt (CLAUDE.md Regel 1): sonst koennte eine Zeile auf eine
  -- Vertretung des einen und einen Standort eines anderen Traegers zeigen.
  FOREIGN KEY (delegation_id, mandant_id) REFERENCES delegation (id, mandant_id) ON DELETE CASCADE,
  FOREIGN KEY (standort_id, mandant_id) REFERENCES standort (id, mandant_id)
);
CREATE INDEX delegation_standort_standort_idx ON delegation_standort (standort_id);

ALTER TABLE delegation_standort ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_standort FORCE ROW LEVEL SECURITY;
CREATE POLICY delegation_standort_isolation ON delegation_standort
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
REVOKE UPDATE, DELETE ON delegation_standort FROM zimmerakte_app;

-- Rechte-Anker der heute gueltigen Besetzungen einer Person, genau wie die
-- Rechte-Engine sie bildet (rechte.service.ts, aktivePositionen): Heimat-
-- Einheit ausser bei Sammelrang (0067), weitere Einheiten der Position (0047),
-- Einheiten der Besetzung (0066); Stabsstellen nur ueber ihren Scope.
CREATE FUNCTION standort_sicht_anker(p_benutzer uuid) RETURNS TABLE (u uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT x.u
  FROM org_position_besetzung pb
  JOIN org_position p ON p.id = pb.position_id AND p.aktiv
  CROSS JOIN LATERAL (
    SELECT p.org_unit_id AS u WHERE p.typ = 'linie' AND NOT p.ist_sammelrang
    UNION SELECT w.org_unit_id FROM org_position_weitere_einheit w WHERE w.position_id = p.id AND p.typ = 'linie'
    UNION SELECT e.org_unit_id FROM org_position_besetzung_einheit e WHERE e.besetzung_id = pb.id
    UNION SELECT s.org_unit_id FROM org_position_stabsstelle_scope s WHERE s.position_id = p.id AND p.typ = 'stabsstelle'
  ) x
  WHERE pb.benutzer_id = p_benutzer
    AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE);
$$;

-- Die Sicht einer Person mit Herkunft je Standort. Eine Zeile mit
-- standort_id NULL heisst "alle Standorte". p_aus_rang ist ein Parameter
-- (statt die Traeger-Einstellung hier zu lesen), damit die Vorschau beide
-- Regeln nebeneinander rechnen kann.
--
-- Reihenfolge:
--   1. feste Sicht (benutzer_standort) -> genau diese ("fest")
--   2. ohne p_aus_rang -> alle (bisheriges Verhalten)
--   3. Vollzugriff -> alle
--   4. aus dem Rang: Anker jeder heute gueltigen Besetzung (wie die
--      Rechte-Engine: Heimat-Einheit ausser bei Sammelrang, weitere Einheiten,
--      Einheiten der Besetzung, bei Stabsstellen deren Scope).
--      Anker am Traeger -> alle. Anker in/unter einer Einrichtung -> deren
--      Standort. Anker oberhalb (Bereich) -> alle Einrichtungen darunter.
--      Kein Anker -> nichts (geschlossen, nicht offen).
--   5. dazu, wenn nicht schon "alle": Standorte aus heute laufenden,
--      GENEHMIGTEN Vertretungen, in denen die Person Vertreter ist.
--      Nie rekursiv: delegation_standort ist beim Anlegen schon gegen die
--      eigene Sicht (ohne Vertretung) des Vertretenen geprueft.
--
-- SECURITY INVOKER: aus der App laeuft sie unter RLS im Mandanten; aus den
-- SECURITY-DEFINER-Chat-Funktionen unten mit deren Rechten, wo alle Zugriffe
-- ueber p_benutzer bzw. seine eigenen Besetzungen ohnehin im Mandanten bleiben.
CREATE FUNCTION standort_sicht(p_benutzer uuid, p_aus_rang boolean)
RETURNS TABLE (standort_id uuid, herkunft text, delegation_id uuid)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_alle boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM benutzer_standort bs WHERE bs.benutzer_id = p_benutzer) THEN
    RETURN QUERY SELECT bs.standort_id, 'fest'::text, NULL::uuid
                 FROM benutzer_standort bs WHERE bs.benutzer_id = p_benutzer;
  ELSIF NOT p_aus_rang THEN
    v_alle := true;
  ELSIF EXISTS (
    SELECT 1
    FROM org_position_besetzung pb
    JOIN org_position p ON p.id = pb.position_id AND p.aktiv
    JOIN account_typ a ON a.id = p.account_typ_id
    WHERE pb.benutzer_id = p_benutzer AND a.ist_vollzugriff
      AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
  ) THEN
    v_alle := true;
  ELSE
    IF EXISTS (SELECT 1 FROM standort_sicht_anker(p_benutzer) a JOIN org_unit ou ON ou.id = a.u WHERE ou.typ = 'traeger') THEN
      v_alle := true;
    ELSE
      RETURN QUERY
      -- Anker in einer Einrichtung (die Einrichtung selbst oder darunter)
      SELECT DISTINCT ou.standort_id, 'rang'::text, NULL::uuid
      FROM standort_sicht_anker(p_benutzer) a
      JOIN org_unit_closure c ON c.descendant_id = a.u
      JOIN org_unit ou ON ou.id = c.ancestor_id AND ou.typ = 'einrichtung'
      UNION
      -- Anker oberhalb der Einrichtungen (Bereich): alle darunter
      SELECT DISTINCT ou.standort_id, 'rang'::text, NULL::uuid
      FROM standort_sicht_anker(p_benutzer) a
      JOIN org_unit_closure c ON c.ancestor_id = a.u
      JOIN org_unit ou ON ou.id = c.descendant_id AND ou.typ = 'einrichtung'
      WHERE NOT EXISTS (
        SELECT 1 FROM org_unit_closure c2 JOIN org_unit o2 ON o2.id = c2.ancestor_id
        WHERE c2.descendant_id = a.u AND o2.typ = 'einrichtung'
      );
    END IF;
  END IF;

  IF v_alle THEN
    RETURN QUERY SELECT NULL::uuid, 'alle'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ds.standort_id, 'vertretung'::text, d.id
  FROM delegation d
  JOIN delegation_standort ds ON ds.delegation_id = d.id
  WHERE d.vertreter_benutzer_id = p_benutzer
    AND d.status = 'genehmigt'
    AND d.von <= CURRENT_DATE AND d.bis >= CURRENT_DATE;
END;
$$;

-- NULL = alle Standorte, '{}' = keiner. Die Traeger-Einstellung wird ueber
-- den Mandanten DER PERSON gelesen, nicht ueber app.mandant_id -- so liefert
-- die Funktion auch im SECURITY-DEFINER-Kontext der Chat-Funktionen das
-- Richtige.
CREATE FUNCTION sichtbare_standorte(p_benutzer uuid) RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN bool_or(s.standort_id IS NULL) THEN NULL
           ELSE COALESCE(array_agg(DISTINCT s.standort_id), '{}'::uuid[])
         END
  FROM standort_sicht(
    p_benutzer,
    COALESCE((SELECT m.standort_sicht_aus_rang FROM benutzer b JOIN mandant m ON m.id = b.mandant_id WHERE b.id = p_benutzer), false)
  ) s;
$$;

-- bool_or ueber null Zeilen ist NULL, das CASE faellt dann in den ELSE-Zweig
-- und liefert '{}' -- genau "sieht nichts". Ohne das COALESCE oben waere
-- "keine Zeile" wieder "alle" gewesen, die Luecke, um die es hier geht.

GRANT EXECUTE ON FUNCTION standort_sicht_anker(uuid) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION standort_sicht(uuid, boolean) TO zimmerakte_app;
GRANT EXECUTE ON FUNCTION sichtbare_standorte(uuid) TO zimmerakte_app;

-- Chat-Anfragen (0056/0057) auf dieselbe Regel umstellen, sonst liefen
-- Akte und Chat-Zustellung auseinander. Rumpf sonst unveraendert.
CREATE OR REPLACE FUNCTION chat_anfrage_team_mitglied(p_standort_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM benutzer b
    CROSS JOIN LATERAL (SELECT sichtbare_standorte(b.id) AS ids) s
    WHERE b.id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      AND b.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND b.aktiv
      AND (s.ids IS NULL OR p_standort_id = ANY (s.ids))
  );
$$;

CREATE OR REPLACE FUNCTION chat_anfrage_klient_sichtbar(p_klient_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM benutzer b
    JOIN klient k ON k.id = p_klient_id AND k.mandant_id = b.mandant_id
    CROSS JOIN LATERAL (SELECT sichtbare_standorte(b.id) AS ids) s
    WHERE b.id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      AND b.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND b.aktiv
      AND (
        s.ids IS NULL
        OR EXISTS (
          SELECT 1
          FROM belegung bg
          JOIN zimmer z ON z.id = bg.zimmer_id
          WHERE bg.klient_id = p_klient_id AND bg.auszug IS NULL AND bg.einzug <= CURRENT_DATE
            AND z.standort_id = ANY (s.ids)
        )
        OR EXISTS (
          SELECT 1 FROM klient_stammdaten ks WHERE ks.klient_id = p_klient_id AND ks.bezugsbetreuer_id = b.id
        )
        OR EXISTS (
          SELECT 1
          FROM (
            SELECT z2.standort_id
            FROM belegung b2
            JOIN zimmer z2 ON z2.id = b2.zimmer_id
            WHERE b2.klient_id = p_klient_id
            ORDER BY b2.einzug DESC
            LIMIT 1
          ) letzte
          WHERE letzte.standort_id = ANY (s.ids)
        )
      )
  );
$$;
