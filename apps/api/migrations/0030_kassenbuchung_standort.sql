-- Ein-/Auszahlungen fuer eine Freizeitveranstaltung, einen Ausflug o.ae.
-- gehoeren nicht einem einzelnen Klienten, sondern dem ganzen Haus
-- (Standort) -- "Spassgeld". klient_id wird deshalb nullable, dazu kommt
-- eine neue standort_id. Genau EINS von beiden muss gesetzt sein: eine
-- Buchung ist entweder einem Klienten oder einem Standort zugeordnet, nie
-- beidem und nie keinem.
--
-- HZL bleibt bewusst ausschliesslich klientenbezogen: eine woechentliche
-- Heimzahlungsleistung fuer einen ganzen Standort ergibt fachlich keinen
-- Sinn und wuerde ausserdem die Eindeutigkeit "hzl_einmal_je_woche" aus
-- Migration 0011 unterlaufen (die haengt an klient_id).
ALTER TABLE kassenbuchung ALTER COLUMN klient_id DROP NOT NULL;
ALTER TABLE kassenbuchung ADD COLUMN standort_id uuid REFERENCES standort(id);

ALTER TABLE kassenbuchung ADD CONSTRAINT kassenbuchung_klient_xor_standort CHECK (
  (klient_id IS NOT NULL AND standort_id IS NULL) OR
  (klient_id IS NULL AND standort_id IS NOT NULL)
);

ALTER TABLE kassenbuchung ADD CONSTRAINT kassenbuchung_hzl_nur_klient CHECK (
  typ <> 'hzl' OR klient_id IS NOT NULL
);

CREATE INDEX kassenbuchung_standort_idx ON kassenbuchung (standort_id) WHERE standort_id IS NOT NULL;

COMMENT ON COLUMN kassenbuchung.standort_id IS
  'Fuer Standort-Buchungen (Spassgeld/Freizeitveranstaltungen) statt klient_id gesetzt -- siehe kassenbuchung_klient_xor_standort.';

-- Teilnehmer einer Standort-Buchung -- Klienten UND Mitarbeitende koennen
-- teilnehmen, deshalb zwei nullable FKs statt einer polymorphen
-- "typ"+"id"-Spalte, die keine referenzielle Integritaet mehr pruefen
-- koennte. Genau wie bei kassenbuchung selbst: XOR per CHECK.
CREATE TABLE kassenbuchung_teilnehmer (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  kassenbuchung_id  uuid NOT NULL REFERENCES kassenbuchung(id),
  klient_id         uuid REFERENCES klient(id),
  benutzer_id       uuid REFERENCES benutzer(id),
  erstellt_am       timestamptz NOT NULL DEFAULT now(),

  CHECK (
    (klient_id IS NOT NULL AND benutzer_id IS NULL) OR
    (klient_id IS NULL AND benutzer_id IS NOT NULL)
  )
);

-- Doppelte Teilnahme derselben Person an derselben Buchung ist kein
-- fachlicher Fall, sondern ein Formularfehler -- hier statt im Service
-- verhindert, damit es auch bei einem kuenftigen zweiten Codepfad gilt.
CREATE UNIQUE INDEX kassenbuchung_teilnehmer_klient_eindeutig
  ON kassenbuchung_teilnehmer (kassenbuchung_id, klient_id) WHERE klient_id IS NOT NULL;
CREATE UNIQUE INDEX kassenbuchung_teilnehmer_benutzer_eindeutig
  ON kassenbuchung_teilnehmer (kassenbuchung_id, benutzer_id) WHERE benutzer_id IS NOT NULL;

CREATE INDEX kassenbuchung_teilnehmer_buchung_idx ON kassenbuchung_teilnehmer (kassenbuchung_id);

ALTER TABLE kassenbuchung_teilnehmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE kassenbuchung_teilnehmer FORCE ROW LEVEL SECURITY;

CREATE POLICY kassenbuchung_teilnehmer_isolation ON kassenbuchung_teilnehmer
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Genau wie die Buchung selbst und die Unterschrift (0011, 0012): einmal
-- geschrieben, nie mehr geaendert oder geloescht. Wer an einer
-- Veranstaltung teilgenommen hat, ist ein historisches Faktum, kein Feld,
-- das sich nachtraeglich zurechtbiegen liesse.
REVOKE UPDATE, DELETE ON kassenbuchung_teilnehmer FROM zimmerakte_app;
