-- Eigener Kalender fuer Mitarbeitende UND Klient:innen (Chat-Plan, Schritt 2).
-- Ein Termin gehoert nicht "dem Mandanten", sondern seinen Beteiligten:
-- sichtbar ist er nur fuer Ersteller:in und eingetragene Teilnehmende --
-- durchgesetzt per RLS, damit auch ein ist_vollzugriff-Konto fremde Termine
-- nicht lesen kann (es gibt keinen Admin-Lesepfad; ein Termin kann Ort und
-- Anlass eines Arztbesuchs oder Amtstermins verraten).
--
-- Abgesagt ist ein Termin, wenn abgesagt_am gesetzt ist -- kein Status-Feld
-- (CLAUDE.md Regel 4). Termine werden nie geloescht, sondern abgesagt: die
-- Teilnehmenden sollen sehen, DASS er entfaellt, statt dass er still
-- verschwindet. Deshalb gibt es auch kein DELETE, weder auf termin noch auf
-- termin_teilnehmer (Ablehnen ist eine Antwort, kein Entfernen der Zeile).
--
-- Ganztaegige Termine speichern beginn als UTC-Mitternacht des ersten und
-- ende als UTC-Mitternacht des Tages NACH dem letzten Tag (exklusiv, wie
-- iCalendar): so ist die Ueberlappungspruefung ohne Sonderfall dieselbe wie
-- bei Terminen mit Uhrzeit. Die API rechnet das ein- und ausgehend um.
--
-- Spaeter (0055, Chat) wird termin_sichtbar() per CREATE OR REPLACE um "in
-- einem Chat geteilt, in dem ich Teilnehmer bin" erweitert; die Policies
-- hier bleiben dafuer unveraendert.
CREATE TYPE termin_antwort AS ENUM ('offen', 'zugesagt', 'abgelehnt');

CREATE TABLE termin (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id                uuid NOT NULL REFERENCES mandant(id),
  titel                     text NOT NULL CHECK (length(btrim(titel)) > 0),
  beschreibung              text,
  ort                       text,
  beginn                    timestamptz NOT NULL,
  ende                      timestamptz NOT NULL,
  ganztaegig                boolean NOT NULL DEFAULT false,
  erstellt_von_benutzer_id  uuid REFERENCES benutzer(id),
  erstellt_von_klient_id    uuid REFERENCES klient(id),
  erstellt_am               timestamptz NOT NULL DEFAULT now(),
  abgesagt_am               timestamptz,

  CHECK (ende >= beginn),
  CHECK (num_nonnulls(erstellt_von_benutzer_id, erstellt_von_klient_id) = 1)
);

CREATE INDEX termin_mandant_beginn_idx ON termin (mandant_id, beginn);

CREATE TABLE termin_teilnehmer (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  termin_id      uuid NOT NULL REFERENCES termin(id),
  benutzer_id    uuid REFERENCES benutzer(id),
  klient_id      uuid REFERENCES klient(id),
  antwort        termin_antwort NOT NULL DEFAULT 'offen',
  geantwortet_am timestamptz,

  CHECK (num_nonnulls(benutzer_id, klient_id) = 1)
);

-- Partiell, weil je Zeile genau eine der beiden Spalten NULL ist -- ein
-- gemeinsamer UNIQUE (termin_id, benutzer_id, klient_id) liesse Duplikate durch
-- (NULL ist nie gleich NULL).
CREATE UNIQUE INDEX termin_teilnehmer_benutzer_uq ON termin_teilnehmer (termin_id, benutzer_id) WHERE benutzer_id IS NOT NULL;
CREATE UNIQUE INDEX termin_teilnehmer_klient_uq ON termin_teilnehmer (termin_id, klient_id) WHERE klient_id IS NOT NULL;
CREATE INDEX termin_teilnehmer_benutzer_idx ON termin_teilnehmer (benutzer_id) WHERE benutzer_id IS NOT NULL;
CREATE INDEX termin_teilnehmer_klient_idx ON termin_teilnehmer (klient_id) WHERE klient_id IS NOT NULL;

-- Funktion statt Unterabfrage in der Policy: die Policy von termin_teilnehmer
-- muesste termin lesen, die von termin wiederum termin_teilnehmer -- Postgres
-- bricht das mit "infinite recursion detected in policy" ab. SECURITY DEFINER
-- liest an RLS vorbei (die Migrationsrolle ist kein Tabellen-Opfer von
-- FORCE, vgl. klient_login_lookup in 0052) und prueft dafuer selbst Mandant
-- und Prinzipal. search_path ist festgenagelt (Schutz vor Schema-Umbiegen).
CREATE FUNCTION termin_sichtbar(p_termin_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM termin t
    WHERE t.id = p_termin_id
      AND t.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND (
        t.erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
        OR t.erstellt_von_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM termin_teilnehmer tt
          WHERE tt.termin_id = t.id
            AND (
              tt.benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
              OR tt.klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION termin_sichtbar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION termin_sichtbar(uuid) TO zimmerakte_app;

-- Nur Ersteller:in darf Termindaten aendern; als Funktion, weil die Policy von
-- termin_teilnehmer sie fuer die FREMDE Tabelle termin braucht.
CREATE FUNCTION termin_ist_ersteller(p_termin_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM termin t
    WHERE t.id = p_termin_id
      AND t.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND (
        t.erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
        OR t.erstellt_von_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      )
  );
$$;

REVOKE ALL ON FUNCTION termin_ist_ersteller(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION termin_ist_ersteller(uuid) TO zimmerakte_app;

ALTER TABLE termin ENABLE ROW LEVEL SECURITY;
ALTER TABLE termin FORCE ROW LEVEL SECURITY;

-- Die Ersteller-Spalten stehen bewusst DIREKT in der SELECT-Policy und nicht
-- nur in termin_sichtbar(): INSERT ... RETURNING prueft die SELECT-Policy
-- gegen die neue Zeile, und eine STABLE-Funktion sieht die Zeile ihres
-- eigenen Statements nicht. Ohne die direkte Bedingung schluege das Anlegen
-- mit "new row violates row-level security policy" fehl.
CREATE POLICY termin_lesen ON termin FOR SELECT
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR erstellt_von_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      OR termin_sichtbar(id)
    )
  );

-- Anlegen nur als man selbst: niemand kann einen Termin "im Namen" einer
-- anderen Person erzeugen.
CREATE POLICY termin_anlegen ON termin FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR erstellt_von_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
  );

CREATE POLICY termin_aendern ON termin FOR UPDATE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      erstellt_von_benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR erstellt_von_klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
  );

-- Spaltenscharf (Regel 3): mandant_id und die Ersteller-Spalten duerfen nach
-- dem Anlegen nie wandern, sonst liesse sich ein Termin "uebergeben" oder in
-- einen fremden Mandanten schieben. Kein DELETE (siehe oben).
REVOKE UPDATE, DELETE ON termin FROM zimmerakte_app;
GRANT UPDATE (titel, beschreibung, ort, beginn, ende, ganztaegig, abgesagt_am) ON termin TO zimmerakte_app;

ALTER TABLE termin_teilnehmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE termin_teilnehmer FORCE ROW LEVEL SECURITY;

-- Wer den Termin sieht, sieht auch, wer eingeladen ist und wie sie geantwortet
-- haben -- das gehoert zum Termin dazu.
CREATE POLICY termin_teilnehmer_lesen ON termin_teilnehmer FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND termin_sichtbar(termin_id));

-- Eintragen darf entweder Ersteller:in (Einladen) oder man sich selbst, sofern
-- man den Termin sehen darf ("uebernehmen"). Ob die Eingeladenen fuer die
-- einladende Person sichtbar sein duerfen (Standort-Einschraenkung), kann
-- eine Policy nicht ausdruecken und wird im Service geprueft.
CREATE POLICY termin_teilnehmer_eintragen ON termin_teilnehmer FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      termin_ist_ersteller(termin_id)
      OR (
        (
          benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
          OR klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
        )
        AND termin_sichtbar(termin_id)
      )
    )
  );

-- Antworten darf nur, wer gemeint ist -- auch Ersteller:in nicht fuer andere.
CREATE POLICY termin_teilnehmer_antworten ON termin_teilnehmer FOR UPDATE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
  );

REVOKE UPDATE, DELETE ON termin_teilnehmer FROM zimmerakte_app;
GRANT UPDATE (antwort, geantwortet_am) ON termin_teilnehmer TO zimmerakte_app;
