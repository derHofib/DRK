-- Abwesenheiten und Terminarten (Rueckmeldung "Filter Kalender", Konzept
-- kalender-filter/konzept-filter-kalender.md): die Leitung will im
-- Jahreskalender sehen, wer wann krank, im Urlaub, frei oder auf Fortbildung
-- ist, und nach Person und Art filtern.
--
-- Warum eine eigene Tabelle und kein Art-Feld am Termin: ein Termin ist per
-- RLS nur fuer seine Beteiligten sichtbar (0053), ausdruecklich auch nicht
-- fuer Vollzugriffskonten. "Urlaub" als Termin bliebe fuer die Leitung also
-- unsichtbar, und die Sichtbarkeit von Terminen aufzuweichen, wuerde private
-- Arzt- und Amtstermine offenlegen. Eine Abwesenheit dagegen ist eine
-- Information ueber die Arbeitszeit, die das Team planen koennen muss.
--
-- Sichtbarkeit: alle Mitarbeitenden des Traegers sehen, DASS und WANN jemand
-- abwesend ist (Urlaubsplanung, Vertretung). Den GRUND (art, notiz) sieht nur
-- die Person selbst und wer das Recht abwesenheiten.art-sehen hat. "krank"
-- ist ein Gesundheitsdatum (Art. 9 DSGVO); deshalb gibt es bewusst kein Feld
-- fuer eine Diagnose. Ausgeblendet wird beim Lesen im Service (CLAUDE.md
-- Regel 6): gespeichert ist immer die echte Art.
--
-- Klient:innen sehen Abwesenheiten nie: die Policy unten verlangt einen
-- Benutzer-Kontext (app.benutzer_id), den eine Klient-Sitzung nicht hat.
--
-- Unveraenderlich wie Kassenbuch und Stunden: eine falsch eingetragene
-- Abwesenheit wird storniert und neu eingetragen, nicht geaendert -- bei
-- Krankmeldungen muss nachvollziehbar bleiben, wer wann was eingetragen hat.
-- Durchgesetzt per REVOKE/GRANT und Trigger, nicht per Codereview.
--
-- bis ist der letzte Tag INKLUSIVE (anders als termin.ende): Abwesenheiten
-- sind immer ganze Tage, und "Urlaub 3. bis 7." ist die Sprache der Leute,
-- die sie eintragen. Hoechstens ein Jahr am Stueck, mehr ist ein Tippfehler.
CREATE TABLE abwesenheit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  benutzer_id     uuid NOT NULL,
  art             text NOT NULL CHECK (art IN ('urlaub', 'krank', 'frei', 'fortbildung')),
  von             date NOT NULL,
  bis             date NOT NULL,
  notiz           text CHECK (notiz IS NULL OR length(notiz) <= 500),
  eingetragen_von uuid NOT NULL,
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  storniert_am    timestamptz,
  storniert_von   uuid,

  CHECK (bis >= von),
  CHECK (bis - von <= 366),
  CHECK ((storniert_am IS NULL) = (storniert_von IS NULL)),
  -- Zusammengesetzt (CLAUDE.md Regel 1): Person und Eintragende:r muessen zum
  -- selben Traeger gehoeren wie die Zeile.
  FOREIGN KEY (benutzer_id, mandant_id) REFERENCES benutzer (id, mandant_id),
  FOREIGN KEY (eingetragen_von, mandant_id) REFERENCES benutzer (id, mandant_id),
  FOREIGN KEY (storniert_von, mandant_id) REFERENCES benutzer (id, mandant_id)
);

CREATE INDEX abwesenheit_mandant_zeitraum_idx ON abwesenheit (mandant_id, von, bis) WHERE storniert_am IS NULL;

ALTER TABLE abwesenheit ENABLE ROW LEVEL SECURITY;
ALTER TABLE abwesenheit FORCE ROW LEVEL SECURITY;

CREATE POLICY abwesenheit_isolation ON abwesenheit
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND NULLIF(current_setting('app.benutzer_id', true), '') IS NOT NULL
  );

REVOKE UPDATE, DELETE ON abwesenheit FROM zimmerakte_app;
GRANT UPDATE (storniert_am, storniert_von) ON abwesenheit TO zimmerakte_app;

-- Ein Storno ist endgueltig (wie stundenbuchung, 0072): eine stornierte
-- Abwesenheit wieder aktiv zu setzen, waere eine stille Korrektur.
CREATE FUNCTION abwesenheit_storno_endgueltig() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'abwesenheit: eine stornierte Abwesenheit kann nicht mehr geaendert werden'
      USING ERRCODE = 'ZA003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER abwesenheit_storno_endgueltig
  BEFORE UPDATE ON abwesenheit
  FOR EACH ROW EXECUTE FUNCTION abwesenheit_storno_endgueltig();

-- Terminart: feste, kleine Liste wie leistungsart (0072). Erweitern ist eine
-- Migration (CHECK austauschen), kein Umbau. Bestehende Termine werden
-- "termin" (allgemein) -- es gibt keine Information, aus der man eine andere
-- Art ableiten koennte.
ALTER TABLE termin
  ADD COLUMN art text NOT NULL DEFAULT 'termin'
  CHECK (art IN ('termin', 'besprechung', 'klient'));

-- 0053 hat UPDATE spaltenscharf vergeben; die neue Spalte muss dazu, sonst
-- koennte niemand die Art eines Termins nachtraeglich aendern.
GRANT UPDATE (art) ON termin TO zimmerakte_app;

-- Neue Rechte der Registry sind ohne Zeile ein impliziter Deny. Wer heute
-- Storno-Antraege im Kassenbuch entscheiden darf (Leitungsebene), bekommt
-- beide Abwesenheitsrechte -- dieselbe Ableitung wie bei den Stunden (0072).
-- Mandanten koennen das danach in der Matrix frei aendern.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'abwesenheiten', neu.aktion, r.scope, r.erlaubt
FROM account_typ_recht r
CROSS JOIN (VALUES ('art-sehen'), ('verwalten')) AS neu (aktion)
WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
