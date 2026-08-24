-- Rechnungen (Kostenübernahme-Anträge): "beantragt", ob wir das Geld
-- bekommen mit einem Status beantragt/genehmigt/ausgezahlt. Wie bei zimmer
-- und kassenbuchung wird der Status nie als Feld gespeichert, sondern aus
-- der letzten Zeile in rechnung_statuswechsel abgeleitet -- das gibt uns
-- den vollen Verlauf umsonst, statt ihn separat protokollieren zu muessen.
CREATE TABLE rechnung (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  klient_id      uuid NOT NULL REFERENCES klient(id),
  betrag_cent    integer NOT NULL CHECK (betrag_cent > 0),
  beschreibung   text NOT NULL,
  erstellt_von   uuid REFERENCES benutzer(id),
  erstellt_am    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rechnung_klient_idx ON rechnung (klient_id);

ALTER TABLE rechnung ENABLE ROW LEVEL SECURITY;
ALTER TABLE rechnung FORCE ROW LEVEL SECURITY;

CREATE POLICY rechnung_isolation ON rechnung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Eine Rechnung selbst ist unveraenderlich -- ein Korrekturbedarf laeuft
-- ueber den Statusverlauf (ablehnen, neue Rechnung anlegen), nicht ueber
-- ein nachtraegliches Aendern von Betrag oder Beschreibung. Gleiches Muster
-- wie kassenbuchung in 0011.
REVOKE UPDATE, DELETE ON rechnung FROM zimmerakte_app;

CREATE TYPE rechnung_status AS ENUM ('beantragt', 'genehmigt', 'ausgezahlt', 'abgelehnt');

-- Append-only Protokoll der Statuswechsel. Der aktuelle Status einer
-- Rechnung ist immer die zuletzt eingefuegte Zeile fuer diese rechnung_id.
CREATE TABLE rechnung_statuswechsel (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  rechnung_id   uuid NOT NULL REFERENCES rechnung(id),
  status        rechnung_status NOT NULL,
  grund         text,
  geaendert_von uuid REFERENCES benutzer(id),
  -- Eigene, monoton steigende Spalte fuer die Sortierung des Verlaufs.
  -- geaendert_am (timestamptz) allein waere fuer zwei Statuswechsel
  -- innerhalb derselben Transaktion nicht zuverlaessig sortierbar.
  lfd_nr        bigserial,
  geaendert_am  timestamptz NOT NULL DEFAULT now(),

  CHECK (status <> 'abgelehnt' OR grund IS NOT NULL)
);

CREATE INDEX rechnung_statuswechsel_rechnung_idx ON rechnung_statuswechsel (rechnung_id, lfd_nr);

ALTER TABLE rechnung_statuswechsel ENABLE ROW LEVEL SECURITY;
ALTER TABLE rechnung_statuswechsel FORCE ROW LEVEL SECURITY;

CREATE POLICY rechnung_statuswechsel_isolation ON rechnung_statuswechsel
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE, DELETE ON rechnung_statuswechsel FROM zimmerakte_app;

-- Der eigentliche Workflow: erste Zeile muss "beantragt" sein, danach nur
-- beantragt->genehmigt, beantragt->abgelehnt, genehmigt->ausgezahlt.
-- ausgezahlt/abgelehnt sind Endzustaende. Das ist eine Prüfung innerhalb
-- einer einzelnen Tabelle (gegen die vorherige Zeile derselben
-- rechnung_id) und gehoert deshalb hierher, nicht in den Service --
-- gleiches Prinzip wie der benutzer_standort-Trigger in 0007.
CREATE FUNCTION rechnung_statuswechsel_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_aktueller_status rechnung_status;
BEGIN
  SELECT status INTO v_aktueller_status
  FROM rechnung_statuswechsel
  WHERE rechnung_id = NEW.rechnung_id
  ORDER BY lfd_nr DESC
  LIMIT 1;

  IF v_aktueller_status IS NULL THEN
    IF NEW.status <> 'beantragt' THEN
      RAISE EXCEPTION 'rechnung_statuswechsel: erste Statuszeile einer Rechnung muss "beantragt" sein, nicht "%"', NEW.status;
    END IF;
  ELSIF v_aktueller_status = 'beantragt' THEN
    IF NEW.status NOT IN ('genehmigt', 'abgelehnt') THEN
      RAISE EXCEPTION 'rechnung_statuswechsel: ungueltiger Wechsel von "beantragt" zu "%"', NEW.status;
    END IF;
  ELSIF v_aktueller_status = 'genehmigt' THEN
    IF NEW.status <> 'ausgezahlt' THEN
      RAISE EXCEPTION 'rechnung_statuswechsel: ungueltiger Wechsel von "genehmigt" zu "%"', NEW.status;
    END IF;
  ELSE
    RAISE EXCEPTION 'rechnung_statuswechsel: Rechnung mit Status "%" ist abgeschlossen', v_aktueller_status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rechnung_statuswechsel_pruefen
  BEFORE INSERT ON rechnung_statuswechsel
  FOR EACH ROW EXECUTE FUNCTION rechnung_statuswechsel_pruefen();
