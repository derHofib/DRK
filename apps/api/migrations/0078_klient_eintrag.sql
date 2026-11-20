-- Verlauf der Klientenakte: Notizen, Telefonate, Gespraeche, Entscheidungen
-- (Rueckmeldung "Ueberblick / Chronik", Konzept
-- /mnt/project-files/chronik/konzept-chronik.md, freigegeben 20.11.2026).
--
-- Bisher gab es fuer "Jugendamt hat angerufen" oder "im Team wurde
-- entschieden" keinen Ort; der Schnelleintrag im Ueberblick legte einen
-- Tagesbericht an, und Tagesberichte und Protokolle wurden dadurch zu zwei
-- Wegen fuer dasselbe. Neu: alles ohne Formular ist ein Eintrag im Verlauf,
-- alles mit Formular ist Dokumentation (Tagesbericht/Protokoll).
--
-- Nur die von Hand erfassten Eintraege werden hier gespeichert. Einzug,
-- Kostenuebernahme, Tagesberichte usw. erscheinen im Verlauf, werden aber beim
-- Lesen aus ihren Quelltabellen abgeleitet (Regel 4: kein zweiter Ort fuer
-- dieselbe Wahrheit).
--
-- Feste Spalten je Art statt jsonb: die vier Arten sind klein und stabil,
-- und "alle Telefonate mit dem Jugendamt" muss filterbar sein.
--
-- Sozialdaten wie tagesbericht (Art. 9 DSGVO, SGB X): RLS mit FORCE,
-- zusammengesetzte Fremdschluessel, unveraenderlich bis auf den Text, und
-- jede Textkorrektur schreibt ein Trigger in klient_eintrag_aenderung --
-- dasselbe Muster wie 0069 (die Historie haengt an der Datenbank, nicht am
-- Anwendungscode).

CREATE TABLE klient_eintrag (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id          uuid NOT NULL REFERENCES mandant(id),
  klient_id           uuid NOT NULL,
  art                 text NOT NULL CHECK (art IN ('notiz', 'telefonat', 'gespraech', 'entscheidung')),
  zeitpunkt           timestamptz NOT NULL,
  text                text NOT NULL CHECK (length(btrim(text)) > 0 AND length(text) <= 20000),
  -- Telefonat: mit wem (Kontakt der Akte oder frei). Gespraech: weitere
  -- Teilnehmende ausser den Mitarbeitenden (klient_eintrag_teilnehmer).
  gegenueber          text CHECK (length(gegenueber) <= 300),
  richtung            text CHECK (richtung IN ('eingehend', 'ausgehend')),
  dauer_minuten       integer CHECK (dauer_minuten BETWEEN 1 AND 1440),
  gespraech_art       text CHECK (gespraech_art IN ('team', 'hilfeplan', 'klient', 'angehoerige', 'schule', 'amt', 'sonstiges')),
  ergebnis            text CHECK (length(ergebnis) <= 5000),
  entschieden_von_id  uuid,
  wiedervorlage_am    date,
  naechster_schritt   text CHECK (length(naechster_schritt) <= 300),
  autor_id            uuid NOT NULL,
  erstellt_am         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, mandant_id),
  -- Zusammengesetzt (CLAUDE.md, Regel 1): sonst koennte ein Eintrag von
  -- Traeger A auf eine Klient:in von Traeger B zeigen.
  FOREIGN KEY (klient_id, mandant_id) REFERENCES klient (id, mandant_id),
  FOREIGN KEY (autor_id, mandant_id) REFERENCES benutzer (id, mandant_id),
  FOREIGN KEY (entschieden_von_id, mandant_id) REFERENCES benutzer (id, mandant_id),

  -- Die Zusatzfelder gehoeren genau zu ihrer Art. In der Datenbank statt nur
  -- im Schema, damit kein Codepfad einen Telefonat-Eintrag ohne Richtung oder
  -- eine Entscheidung ohne Entscheider:in schreibt.
  CHECK ((art = 'telefonat') = (richtung IS NOT NULL)),
  CHECK (art = 'telefonat' OR dauer_minuten IS NULL),
  CHECK ((art = 'gespraech') = (gespraech_art IS NOT NULL)),
  CHECK ((art = 'entscheidung') = (entschieden_von_id IS NOT NULL)),
  CHECK (art IN ('gespraech', 'entscheidung') OR ergebnis IS NULL),
  CHECK (art = 'entscheidung' OR wiedervorlage_am IS NULL),
  CHECK (art <> 'notiz' OR (gegenueber IS NULL AND naechster_schritt IS NULL))
);

CREATE INDEX klient_eintrag_klient_zeit_idx ON klient_eintrag (klient_id, zeitpunkt DESC);
CREATE INDEX klient_eintrag_wiedervorlage_idx ON klient_eintrag (mandant_id, wiedervorlage_am) WHERE wiedervorlage_am IS NOT NULL;

ALTER TABLE klient_eintrag ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_eintrag FORCE ROW LEVEL SECURITY;
CREATE POLICY klient_eintrag_isolation ON klient_eintrag
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Unveraenderlich bis auf den Text (Korrektur mit Historie, siehe unten).
-- Geloescht wird nie: ein Eintrag ist Nachweis gegenueber dem Amt.
REVOKE UPDATE, DELETE ON klient_eintrag FROM zimmerakte_app;
GRANT UPDATE (text) ON klient_eintrag TO zimmerakte_app;

-- Teilnehmende Mitarbeitende eines Gespraechs als Zeilen (nicht als Text),
-- damit "meine Gespraeche" spaeter abfragbar ist und ein Namenswechsel
-- nicht die Dokumentation verfaelscht.
CREATE TABLE klient_eintrag_teilnehmer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  eintrag_id  uuid NOT NULL,
  benutzer_id uuid NOT NULL,
  FOREIGN KEY (eintrag_id, mandant_id) REFERENCES klient_eintrag (id, mandant_id),
  FOREIGN KEY (benutzer_id, mandant_id) REFERENCES benutzer (id, mandant_id),
  UNIQUE (eintrag_id, benutzer_id)
);

ALTER TABLE klient_eintrag_teilnehmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_eintrag_teilnehmer FORCE ROW LEVEL SECURITY;
CREATE POLICY klient_eintrag_teilnehmer_isolation ON klient_eintrag_teilnehmer
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
REVOKE UPDATE, DELETE ON klient_eintrag_teilnehmer FROM zimmerakte_app;

-- Historie der Textkorrekturen, append-only wie tagesbericht_aenderung (0069).
-- Der Grund kommt aus der Transaktionseinstellung app.korrektur_grund, die
-- der Service vor dem UPDATE setzt -- so bleibt das Schreiben der Historie
-- trotzdem Sache der Datenbank.
CREATE TABLE klient_eintrag_aenderung (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  eintrag_id     uuid NOT NULL,
  geaendert_von  uuid REFERENCES benutzer(id),
  geaendert_am   timestamptz NOT NULL DEFAULT clock_timestamp(),
  text_alt       text NOT NULL,
  text_neu       text NOT NULL,
  grund          text,
  FOREIGN KEY (eintrag_id, mandant_id) REFERENCES klient_eintrag (id, mandant_id)
);

CREATE INDEX klient_eintrag_aenderung_eintrag_idx ON klient_eintrag_aenderung (eintrag_id, geaendert_am);

ALTER TABLE klient_eintrag_aenderung ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_eintrag_aenderung FORCE ROW LEVEL SECURITY;
CREATE POLICY klient_eintrag_aenderung_isolation ON klient_eintrag_aenderung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
REVOKE UPDATE, DELETE ON klient_eintrag_aenderung FROM zimmerakte_app;

CREATE FUNCTION klient_eintrag_aenderung_protokollieren() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO klient_eintrag_aenderung (mandant_id, eintrag_id, geaendert_von, text_alt, text_neu, grund)
  VALUES (
    OLD.mandant_id, OLD.id,
    NULLIF(current_setting('app.benutzer_id', true), '')::uuid,
    OLD.text, NEW.text,
    NULLIF(current_setting('app.korrektur_grund', true), '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER klient_eintrag_aenderung_protokoll
  BEFORE UPDATE OF text ON klient_eintrag
  FOR EACH ROW
  WHEN (OLD.text IS DISTINCT FROM NEW.text)
  EXECUTE FUNCTION klient_eintrag_aenderung_protokollieren();

-- "Naechster Schritt" kann eine Aufgabe werden. Die Aufgabe verweist auf den
-- Eintrag statt seinen Text zu kopieren. Der Bezug soll nachtraeglich nicht
-- umgehaengt werden koennen. aufgabe hat ueber 0002 UPDATE auf ALLE Spalten,
-- und ein REVOKE auf eine einzelne Spalte nimmt ein Tabellenrecht nicht
-- zurueck -- deshalb ein Trigger statt einer Spaltenrechte-Umstellung, die
-- den bestehenden Aufgaben-Code beruehren wuerde.
ALTER TABLE aufgabe ADD CONSTRAINT aufgabe_id_mandant_uq UNIQUE (id, mandant_id);
ALTER TABLE aufgabe ADD COLUMN klient_eintrag_id uuid;
ALTER TABLE aufgabe ADD CONSTRAINT aufgabe_klient_eintrag_fk
  FOREIGN KEY (klient_eintrag_id, mandant_id) REFERENCES klient_eintrag (id, mandant_id);
CREATE INDEX aufgabe_klient_eintrag_idx ON aufgabe (klient_eintrag_id) WHERE klient_eintrag_id IS NOT NULL;
CREATE FUNCTION aufgabe_eintrag_bezug_fest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.klient_eintrag_id IS DISTINCT FROM OLD.klient_eintrag_id THEN
    RAISE EXCEPTION 'Der Bezug einer Aufgabe auf einen Verlaufseintrag kann nicht geändert werden.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aufgabe_eintrag_bezug_fest
  BEFORE UPDATE OF klient_eintrag_id ON aufgabe
  FOR EACH ROW EXECUTE FUNCTION aufgabe_eintrag_bezug_fest();

-- ---------------------------------------------------------------------------
-- Rechte (Registry: modul "verlauf")
-- ---------------------------------------------------------------------------
-- Ohne Zeile ein impliziter Deny (siehe 0072). Wer heute Tagesberichte sehen
-- bzw. anlegen darf, darf dasselbe im Verlauf -- es ist dieselbe Faehigkeit
-- "ueber die eigene Klientel dokumentieren". Entscheidungen eintragen und
-- fremde Eintraege korrigieren bekommt die Leitungsebene, erkennbar wie in
-- 0072/0074/0075 am Recht, Storno-Antraege zu entscheiden. Mandanten aendern
-- das danach frei in der Matrix.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'verlauf', neu.aktion, r.scope, r.erlaubt
FROM account_typ_recht r
JOIN LATERAL (
  SELECT 'ansehen' AS aktion WHERE r.modul = 'tagesberichte' AND r.aktion = 'ansehen'
  UNION ALL SELECT 'anlegen' WHERE r.modul = 'tagesberichte' AND r.aktion = 'anlegen'
  UNION ALL SELECT 'entscheidungen-anlegen' WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
  UNION ALL SELECT 'korrigieren-fremde' WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
) neu ON true
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
