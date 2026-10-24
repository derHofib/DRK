-- Laufende Belegnummer ("KB-00042") je Mandant, damit eine Buchung bei einer
-- Amtsnachfrage und in der Befehlspalette ueber etwas Sprechbares gefunden
-- wird statt ueber eine UUID.
--
-- Luckenlos, weil die Vergabe in derselben Transaktion wie der INSERT liegt:
-- der Zaehler wird per UPDATE ... RETURNING hochgezaehlt (Zeilensperre
-- serialisiert parallele Buchungen eines Mandanten), und ein Rollback der
-- Buchung nimmt den Zaehler mit zurueck. Eine Sequence koennte das nicht --
-- sie vergibt Nummern auch fuer abgebrochene Transaktionen.
--
-- Unveraenderlich wie der Rest der Buchung (0011): belegnummer steht nicht
-- in der Spalten-GRANT-Liste, und der Zaehler selbst ist fuer die App-Rolle
-- weder les- noch schreibbar -- nur die Trigger-Funktion (SECURITY DEFINER)
-- fasst ihn an. Dadurch kann auch ein Fehler im Anwendungscode keine
-- Nummer ueberspringen oder doppelt vergeben.

CREATE TABLE kassenbuch_nummernkreis (
  -- CASCADE: der Zaehler hat ohne seinen Mandanten keine Bedeutung (und blockiert
  -- sonst das Loeschen eines Mandanten, z.B. in den Testaufraeumungen).
  mandant_id uuid PRIMARY KEY REFERENCES mandant(id) ON DELETE CASCADE,
  letzte     integer NOT NULL DEFAULT 0
);

ALTER TABLE kassenbuch_nummernkreis ENABLE ROW LEVEL SECURITY;
ALTER TABLE kassenbuch_nummernkreis FORCE ROW LEVEL SECURITY;

CREATE POLICY kassenbuch_nummernkreis_isolation ON kassenbuch_nummernkreis
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE ALL ON kassenbuch_nummernkreis FROM zimmerakte_app;

ALTER TABLE kassenbuchung ADD COLUMN belegnummer integer;

-- Bestand: nach Erfassungszeitpunkt durchnummerieren (id als Tiebreaker,
-- damit das Ergebnis reproduzierbar ist), dann den Zaehler nachziehen.
WITH nummeriert AS (
  SELECT id, row_number() OVER (PARTITION BY mandant_id ORDER BY erstellt_am, id) AS nr
  FROM kassenbuchung
)
UPDATE kassenbuchung b SET belegnummer = n.nr FROM nummeriert n WHERE n.id = b.id;

INSERT INTO kassenbuch_nummernkreis (mandant_id, letzte)
SELECT mandant_id, max(belegnummer) FROM kassenbuchung GROUP BY mandant_id;

ALTER TABLE kassenbuchung ALTER COLUMN belegnummer SET NOT NULL;
CREATE UNIQUE INDEX kassenbuchung_belegnummer_eindeutig ON kassenbuchung (mandant_id, belegnummer);

CREATE FUNCTION kassenbuchung_belegnummer_vergeben() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nr integer;
BEGIN
  INSERT INTO kassenbuch_nummernkreis (mandant_id, letzte) VALUES (NEW.mandant_id, 1)
  ON CONFLICT (mandant_id) DO UPDATE SET letzte = kassenbuch_nummernkreis.letzte + 1
  RETURNING letzte INTO nr;
  -- Eine vom Aufrufer mitgegebene Nummer waere eine Luecke oder ein Duplikat.
  NEW.belegnummer := nr;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kassenbuchung_belegnummer
  BEFORE INSERT ON kassenbuchung
  FOR EACH ROW EXECUTE FUNCTION kassenbuchung_belegnummer_vergeben();

COMMENT ON COLUMN kassenbuchung.belegnummer IS
  'Laufende, lueckenlose Nummer je Mandant (Anzeige: KB-00042). Vom Trigger vergeben, nicht aenderbar.';
