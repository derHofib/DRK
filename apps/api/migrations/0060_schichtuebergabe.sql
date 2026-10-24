-- Schichtuebergabe als eigenes Objekt statt loser Chatnachricht: gehoert zu
-- einem Standort und einem Dienst, hat Verfasser:in und Zeitpunkt, besteht
-- aus Punkten (optional mit Klient:in oder Zimmer) und wird je Person als
-- gelesen bestaetigt.
--
-- Unveraenderlich nach dem Senden, wie kassenbuchung (0011): REVOKE UPDATE,
-- DELETE. Eine Uebergabe ist eine Aussage "das habe ich um 14:05 gemeldet" --
-- nachtraeglich umgeschrieben waere sie bei einem Vorfall wertlos. Ein
-- Nachtrag ist deshalb ein NEUER Punkt (nachtrag = true) mit eigenem
-- Zeitstempel. Einen Entwurf gibt es in der Datenbank nicht: er liegt bis zum
-- Senden nur im Browser, die Zeile entsteht erst mit dem Senden. Ein
-- Statusfeld "gesendet" waere ein zweiter Ort fuer dieselbe Wahrheit.
--
-- Die Standort-Beschraenkung (benutzer_standort) laeuft wie bei Zimmer und
-- Kassenbuch im Service, nicht in RLS -- "keine Zeile" und "auf nichts
-- beschraenkt" lassen sich in einer Policy nicht sauber trennen.

CREATE TYPE dienst AS ENUM ('frueh', 'spaet', 'nacht');

CREATE TABLE schichtuebergabe (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  standort_id  uuid NOT NULL REFERENCES standort(id),
  dienst       dienst NOT NULL,
  verfasst_von uuid NOT NULL REFERENCES benutzer(id),
  gesendet_am  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schichtuebergabe_standort_idx ON schichtuebergabe (standort_id, gesendet_am DESC);

CREATE TABLE schichtuebergabe_punkt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  uebergabe_id uuid NOT NULL REFERENCES schichtuebergabe(id),
  position     integer NOT NULL,
  text         text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  klient_id    uuid REFERENCES klient(id),
  zimmer_id    uuid REFERENCES zimmer(id),
  nachtrag     boolean NOT NULL DEFAULT false,
  erstellt_von uuid NOT NULL REFERENCES benutzer(id),
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uebergabe_id, position)
);

CREATE TABLE schichtuebergabe_gelesen (
  uebergabe_id uuid NOT NULL REFERENCES schichtuebergabe(id),
  benutzer_id  uuid NOT NULL REFERENCES benutzer(id),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  gelesen_am   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uebergabe_id, benutzer_id)
);

ALTER TABLE schichtuebergabe ENABLE ROW LEVEL SECURITY;
ALTER TABLE schichtuebergabe FORCE ROW LEVEL SECURITY;
CREATE POLICY schichtuebergabe_isolation ON schichtuebergabe
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

ALTER TABLE schichtuebergabe_punkt ENABLE ROW LEVEL SECURITY;
ALTER TABLE schichtuebergabe_punkt FORCE ROW LEVEL SECURITY;
CREATE POLICY schichtuebergabe_punkt_isolation ON schichtuebergabe_punkt
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

ALTER TABLE schichtuebergabe_gelesen ENABLE ROW LEVEL SECURITY;
ALTER TABLE schichtuebergabe_gelesen FORCE ROW LEVEL SECURITY;
CREATE POLICY schichtuebergabe_gelesen_lesen ON schichtuebergabe_gelesen FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
-- Bestaetigen darf jede Person nur fuer sich selbst -- niemand quittiert fuer andere.
CREATE POLICY schichtuebergabe_gelesen_anlegen ON schichtuebergabe_gelesen FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
  );

REVOKE UPDATE, DELETE ON schichtuebergabe FROM zimmerakte_app;
REVOKE UPDATE, DELETE ON schichtuebergabe_punkt FROM zimmerakte_app;
REVOKE UPDATE, DELETE ON schichtuebergabe_gelesen FROM zimmerakte_app;

-- Aufgabe aus einem Punkt: Klient:in und Herkunft bleiben an der Aufgabe
-- sichtbar. SET NULL, weil eine Aufgabe auch ohne ihre Herkunft eine Aufgabe
-- bleibt (und die Uebergabe selbst ohnehin nie geloescht wird).
ALTER TABLE aufgabe ADD COLUMN klient_id uuid REFERENCES klient(id);
ALTER TABLE aufgabe ADD COLUMN schichtuebergabe_punkt_id uuid REFERENCES schichtuebergabe_punkt(id) ON DELETE SET NULL;
CREATE INDEX aufgabe_uebergabe_punkt_idx ON aufgabe (schichtuebergabe_punkt_id) WHERE schichtuebergabe_punkt_id IS NOT NULL;
