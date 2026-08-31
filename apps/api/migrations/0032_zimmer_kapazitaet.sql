-- Zimmer koennen jetzt mehr als eine Person gleichzeitig tragen
-- (Mehrbettzimmer). Bislang erzwang belegung_zimmer_ohne_ueberlappung
-- (0010_belegung.sql) strikte Einzelbelegung -- ein EXCLUDE-Constraint
-- kann aber nur "0 Ueberlappungen" oder "beliebig viele" ausdruecken,
-- nie "hoechstens N gleichzeitig". Die Kapazitaetspruefung wandert
-- deshalb in einen Trigger, der die Zeilenzahl gegen zimmer.kapazitaet
-- zaehlt -- mit demselben Ziel wie vorher (keine Race Condition
-- zwischen zwei gleichzeitigen Zuweisungen), nur mit einer Obergrenze
-- statt eines festen Werts von 1.
ALTER TABLE zimmer ADD COLUMN kapazitaet integer NOT NULL DEFAULT 1
  CHECK (kapazitaet >= 1 AND kapazitaet <= 12);

COMMENT ON COLUMN zimmer.kapazitaet IS
  'Maximale Anzahl gleichzeitiger Bewohner:innen. Aenderung an einem bestehenden Zimmer nur ueber zimmer_kapazitaetsantrag (Vier-Augen), siehe dort.';

-- 0023 hat UPDATE auf zimmer bereits spaltenscharf auf (nummer, etage,
-- aktiv) eingeschraenkt -- eine neue Spalte erbt dabei KEIN Recht, ein
-- ALTER TABLE ADD COLUMN ist kein Fall fuer ALTER DEFAULT PRIVILEGES (das
-- greift nur bei neuen Tabellen). kapazitaet muss deshalb explizit
-- ergaenzt werden, sonst schlaegt das UPDATE in kapazitaetEntscheiden()
-- mit "permission denied" fehl. Direkte Zuweisung (anlegen()) und die
-- Erst-Beantragung (kapazitaetAendern()) schreiben kapazitaet nicht per
-- UPDATE, nur die Bestaetigung eines Antrags tut das.
REVOKE UPDATE ON zimmer FROM zimmerakte_app;
GRANT  UPDATE (nummer, etage, aktiv, kapazitaet) ON zimmer TO zimmerakte_app;

ALTER TABLE belegung DROP CONSTRAINT belegung_zimmer_ohne_ueberlappung;

-- Ersatz fuer den entfallenen EXCLUDE-Constraint: zaehlt beim Anlegen oder
-- Aendern einer Belegung, wie viele ANDERE Belegungen desselben Zimmers im
-- selben Zeitraum bereits offen sind, und lehnt ab, wenn das die Kapazitaet
-- erreichen wuerde. "SELECT ... FOR UPDATE" auf die zimmer-Zeile serialisiert
-- zwei gleichzeitige Zuweisungen zum selben Zimmer -- ohne das koennten zwei
-- Transaktionen parallel "noch ein Platz frei" lesen und beide einziehen,
-- obwohl nur einer frei war (dieselbe Race-Condition-Ueberlegung wie beim
-- urspruenglichen EXCLUDE-Constraint, hier nur als Trigger statt als
-- deklarativer Constraint, weil "hoechstens N" sich nicht deklarativ
-- ausdruecken laesst).
CREATE FUNCTION belegung_kapazitaet_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kapazitaet_wert integer;
  ueberlappende_anzahl integer;
BEGIN
  SELECT kapazitaet INTO kapazitaet_wert FROM zimmer WHERE id = NEW.zimmer_id FOR UPDATE;

  SELECT count(*) INTO ueberlappende_anzahl
  FROM belegung
  WHERE zimmer_id = NEW.zimmer_id
    AND id <> NEW.id
    AND daterange(einzug, auszug, '[)') && daterange(NEW.einzug, NEW.auszug, '[)');

  IF ueberlappende_anzahl >= kapazitaet_wert THEN
    RAISE EXCEPTION 'Zimmer % hat im gewaehlten Zeitraum keine freien Plaetze mehr (Kapazitaet %)', NEW.zimmer_id, kapazitaet_wert
      USING ERRCODE = 'ZA001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER belegung_kapazitaet_pruefen
  BEFORE INSERT OR UPDATE ON belegung
  FOR EACH ROW EXECUTE FUNCTION belegung_kapazitaet_pruefen();

-- belegung_klient_ohne_ueberlappung (0010) bleibt unveraendert: eine Person
-- kann weiterhin nicht gleichzeitig in zwei Zimmern gefuehrt werden, daran
-- aendert eine hoehere Zimmerkapazitaet nichts.

-- Vier-Augen-Prinzip fuer die Kapazitaet eines BESTEHENDEN Zimmers: wer sie
-- aendert, kann sie nicht selbst bestaetigen -- das muss die jeweils
-- ANDERE Leitungsrolle tun (Einrichtungsleitung aendert -> Bereichsleitung
-- bestaetigt, und umgekehrt). Anders als beim Kassenbuch-Storno-Antrag
-- (0031, wo sich eine Leitung beim eigenen Antrag selbst bewilligt) gibt es
-- hier bewusst KEINE Selbstbewilligung -- die Rollenpruefung sitzt im
-- Service (kapazitaetEntscheiden()), diese Tabelle haelt nur den Antrag
-- und die Entscheidung fest. Nummer und Etage bleiben von diesem
-- Vier-Augen-Prinzip unberuehrt und weiter sofort aenderbar.
CREATE TYPE zimmer_kapazitaet_status AS ENUM ('beantragt', 'bestaetigt', 'abgelehnt');

CREATE TABLE zimmer_kapazitaetsantrag (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  zimmer_id         uuid NOT NULL REFERENCES zimmer(id),
  alte_kapazitaet   integer NOT NULL,
  neue_kapazitaet   integer NOT NULL CHECK (neue_kapazitaet >= 1 AND neue_kapazitaet <= 12),
  status            zimmer_kapazitaet_status NOT NULL DEFAULT 'beantragt',
  beantragt_von     uuid NOT NULL REFERENCES benutzer(id),
  beantragt_am      timestamptz NOT NULL DEFAULT now(),
  ablehnung_grund   text,
  entschieden_von   uuid REFERENCES benutzer(id),
  entschieden_am    timestamptz,

  CHECK (status <> 'beantragt' OR (entschieden_von IS NULL AND entschieden_am IS NULL AND ablehnung_grund IS NULL)),
  CHECK (status <> 'bestaetigt' OR (entschieden_von IS NOT NULL AND entschieden_am IS NOT NULL)),
  CHECK (status <> 'abgelehnt' OR (ablehnung_grund IS NOT NULL AND entschieden_von IS NOT NULL AND entschieden_am IS NOT NULL))
);

-- Nur EIN offener Antrag je Zimmer gleichzeitig -- dasselbe Muster wie
-- kassenbuchung_stornoantrag_offen_je_buchung (0031).
CREATE UNIQUE INDEX zimmer_kapazitaetsantrag_offen_je_zimmer
  ON zimmer_kapazitaetsantrag (zimmer_id) WHERE status = 'beantragt';

CREATE INDEX zimmer_kapazitaetsantrag_zimmer_idx ON zimmer_kapazitaetsantrag (zimmer_id);

ALTER TABLE zimmer_kapazitaetsantrag ENABLE ROW LEVEL SECURITY;
ALTER TABLE zimmer_kapazitaetsantrag FORCE ROW LEVEL SECURITY;

CREATE POLICY zimmer_kapazitaetsantrag_isolation ON zimmer_kapazitaetsantrag
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Wie kassenbuchung_stornoantrag (0031): der Antrag selbst ist nach dem
-- Anlegen unveraenderlich, nur die Entscheidung darf einmal nachgetragen
-- werden. Der Service erzwingt zusaetzlich "WHERE status = 'beantragt'"
-- bei diesem UPDATE, damit ein bereits entschiedener Antrag nicht ein
-- zweites Mal umgebogen werden kann.
REVOKE UPDATE, DELETE ON zimmer_kapazitaetsantrag FROM zimmerakte_app;
GRANT UPDATE (status, ablehnung_grund, entschieden_von, entschieden_am) ON zimmer_kapazitaetsantrag TO zimmerakte_app;
