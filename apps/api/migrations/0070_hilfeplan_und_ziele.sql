-- Hilfeplan und Ziele je Klient.
--
-- Ein Hilfeplan ist der vom Amt verlangte Rahmen der Betreuung (Zeitraum,
-- naechstes Hilfeplangespraech); darunter haengen die Ziele, an denen die
-- Betreuung gemessen wird. Das sind Sozialdaten (Art. 9 DSGVO) und liegen
-- unter denselben Schutzmassnahmen wie tagesbericht: RLS mit FORCE,
-- Datentraegerverschluesselung.
--
-- Der Fortschritt eines Ziels ist KEINE Spalte am Ziel. Er ergibt sich aus dem
-- juengsten Eintrag in hilfeplan_ziel_verlauf (Zustaende werden abgeleitet,
-- nicht gespeichert). Der Verlauf ist append-only (REVOKE UPDATE, DELETE):
-- gegenueber dem Amt muss belegbar sein, wann welcher Stand gemeldet wurde,
-- und ein ueberschriebener Fortschritt waere dafuer wertlos. Ein Verlaufs-
-- eintrag kann auf einen Tagesbericht verweisen, der den Stand belegt.
--
-- Dass Ziel, Verlaufseintrag und Tagesbericht zum SELBEN Klienten gehoeren,
-- erzwingen zusammengesetzte Fremdschluessel -- nicht der Anwendungscode.
-- Dafuer braucht tagesbericht einen UNIQUE (id, klient_id); er aendert nichts
-- an dessen Verhalten, id ist ohnehin schon eindeutig.

ALTER TABLE tagesbericht ADD CONSTRAINT tagesbericht_id_klient_uq UNIQUE (id, klient_id);

-- Mandantenfester Fremdschluessel auf den Klienten: ein FK-Check laeuft an RLS
-- vorbei, ein einfaches REFERENCES klient(id) wuerde also eine Zeile erlauben,
-- die mit dem eigenen mandant_id auf einen Klienten eines FREMDEN Traegers
-- zeigt (im Test zunaechst genau so aufgetreten). (klient_id, mandant_id)
-- macht daraus einen Fehler der Datenbank.
ALTER TABLE klient ADD CONSTRAINT klient_id_mandant_uq UNIQUE (id, mandant_id);

CREATE TABLE hilfeplan (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       uuid NOT NULL REFERENCES mandant(id),
  klient_id        uuid NOT NULL,
  von              date NOT NULL,
  bis              date,
  -- Termin des naechsten Hilfeplangespraechs mit dem Amt (Erinnerungs-
  -- grundlage, siehe Dashboard/Kalender); optional, weil er oft noch offen ist.
  naechstes_gespraech date,
  bemerkung        text,
  erstellt_von     uuid REFERENCES benutzer(id),
  erstellt_am      timestamptz NOT NULL DEFAULT now(),
  CHECK (bis IS NULL OR bis > von),
  UNIQUE (id, klient_id),
  FOREIGN KEY (klient_id, mandant_id) REFERENCES klient (id, mandant_id)
);

CREATE INDEX hilfeplan_klient_idx ON hilfeplan (klient_id, von DESC);

CREATE TABLE hilfeplan_ziel (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    uuid NOT NULL REFERENCES mandant(id),
  klient_id     uuid NOT NULL,
  hilfeplan_id  uuid NOT NULL,
  titel         text NOT NULL CHECK (length(btrim(titel)) > 0),
  beschreibung  text,
  faellig_am    date,
  -- Ein verworfenes Ziel bleibt stehen (Nachvollziehbarkeit), zaehlt aber
  -- weder als offen noch als ueberfaellig.
  verworfen_am  timestamptz,
  erstellt_von  uuid REFERENCES benutzer(id),
  erstellt_am   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, klient_id),
  FOREIGN KEY (klient_id, mandant_id) REFERENCES klient (id, mandant_id),
  FOREIGN KEY (hilfeplan_id, klient_id) REFERENCES hilfeplan (id, klient_id)
);

CREATE INDEX hilfeplan_ziel_plan_idx ON hilfeplan_ziel (hilfeplan_id);

CREATE TABLE hilfeplan_ziel_verlauf (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  klient_id       uuid NOT NULL,
  ziel_id         uuid NOT NULL,
  fortschritt     smallint NOT NULL CHECK (fortschritt BETWEEN 0 AND 100),
  notiz           text,
  tagesbericht_id uuid,
  erstellt_von    uuid REFERENCES benutzer(id),
  erstellt_am     timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (klient_id, mandant_id) REFERENCES klient (id, mandant_id),
  FOREIGN KEY (ziel_id, klient_id) REFERENCES hilfeplan_ziel (id, klient_id),
  -- MATCH SIMPLE: bei tagesbericht_id IS NULL wird nicht geprueft.
  FOREIGN KEY (tagesbericht_id, klient_id) REFERENCES tagesbericht (id, klient_id)
);

CREATE INDEX hilfeplan_ziel_verlauf_ziel_idx ON hilfeplan_ziel_verlauf (ziel_id, erstellt_am DESC);
CREATE INDEX hilfeplan_ziel_verlauf_bericht_idx ON hilfeplan_ziel_verlauf (tagesbericht_id)
  WHERE tagesbericht_id IS NOT NULL;

ALTER TABLE hilfeplan ENABLE ROW LEVEL SECURITY;
ALTER TABLE hilfeplan FORCE ROW LEVEL SECURITY;
CREATE POLICY hilfeplan_isolation ON hilfeplan
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

ALTER TABLE hilfeplan_ziel ENABLE ROW LEVEL SECURITY;
ALTER TABLE hilfeplan_ziel FORCE ROW LEVEL SECURITY;
CREATE POLICY hilfeplan_ziel_isolation ON hilfeplan_ziel
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

ALTER TABLE hilfeplan_ziel_verlauf ENABLE ROW LEVEL SECURITY;
ALTER TABLE hilfeplan_ziel_verlauf FORCE ROW LEVEL SECURITY;
CREATE POLICY hilfeplan_ziel_verlauf_isolation ON hilfeplan_ziel_verlauf
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Spaltenscharf: Klient, Mandant, Plan und Autor eines Eintrags bleiben fest.
REVOKE UPDATE ON hilfeplan FROM zimmerakte_app;
GRANT UPDATE (von, bis, naechstes_gespraech, bemerkung) ON hilfeplan TO zimmerakte_app;

REVOKE UPDATE ON hilfeplan_ziel FROM zimmerakte_app;
GRANT UPDATE (titel, beschreibung, faellig_am, verworfen_am) ON hilfeplan_ziel TO zimmerakte_app;

REVOKE UPDATE, DELETE ON hilfeplan_ziel_verlauf FROM zimmerakte_app;

-- Geloescht wird hier nichts: ein Hilfeplan ist Nachweis gegenueber dem Amt,
-- ein hinfaellig gewordenes Ziel wird verworfen (verworfen_am), nicht entfernt.
REVOKE DELETE ON hilfeplan FROM zimmerakte_app;
REVOKE DELETE ON hilfeplan_ziel FROM zimmerakte_app;
