-- Warteliste je Zimmer (Besprechung): ein Zimmer ist voll, aber ein
-- zugesagter neuer Klient oder ein bestehender Bewohner, der umziehen
-- moechte, soll schon vorgemerkt werden, sobald ein Platz frei wird.
-- Bewusst OHNE Datum -- die Warteliste druckt nur eine Reihenfolge/Absicht
-- aus ("sobald frei"), kein festes Versprechen. Das feste Datum entsteht
-- erst beim tatsaechlichen Einzug (belegung.einzug).
CREATE TABLE zimmer_warteliste (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  zimmer_id       uuid NOT NULL REFERENCES zimmer(id),
  klient_id       uuid NOT NULL REFERENCES klient(id),
  eingetragen_von uuid REFERENCES benutzer(id),
  eingetragen_am  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (zimmer_id, klient_id)
);

CREATE INDEX zimmer_warteliste_zimmer_idx ON zimmer_warteliste (zimmer_id);
CREATE INDEX zimmer_warteliste_klient_idx ON zimmer_warteliste (klient_id);

ALTER TABLE zimmer_warteliste ENABLE ROW LEVEL SECURITY;
ALTER TABLE zimmer_warteliste FORCE ROW LEVEL SECURITY;

CREATE POLICY zimmer_warteliste_isolation ON zimmer_warteliste
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Keine Spalte darf sich nachtraeglich aendern -- ein falscher Eintrag wird
-- entfernt und neu angelegt, nicht umgeschrieben (anders als bei belegung
-- gibt es hier keinen fachlichen Korrekturfall).
REVOKE UPDATE ON zimmer_warteliste FROM zimmerakte_app;

-- Sobald jemand WIRKLICH einzieht -- in irgendein Zimmer, nicht nur in
-- eines, fuer das er auf der Warteliste stand --, verliert jede Warteliste
-- ihren Sinn fuer diese Person: sie wohnt jetzt. Trigger statt Service-Code,
-- damit das garantiert unabhaengig vom Aufrufer passiert -- gleiches Prinzip
-- wie mandant_kassenbuchung_typ_standard (migrations/0035_kassenbuchung_typ.sql).
CREATE FUNCTION zimmer_warteliste_aufraeumen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM zimmer_warteliste WHERE klient_id = NEW.klient_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zimmer_warteliste_aufraeumen
  AFTER INSERT ON belegung
  FOR EACH ROW EXECUTE FUNCTION zimmer_warteliste_aufraeumen();
