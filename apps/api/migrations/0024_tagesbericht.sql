-- Tagesberichte je Klient, mit optionalen Tags (frei vergeben, ueber den
-- Mandanten hinweg wiederverwendbar -- siehe tag-Tabelle). Ein Tag kann
-- sowohl beim Anlegen als auch nachtraeglich hinzugefuegt/entfernt werden
-- (tagesbericht_tag), deshalb eigenstaendige Zuordnungstabelle statt eines
-- Arrays auf tagesbericht selbst.
CREATE TABLE tagesbericht (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  klient_id    uuid NOT NULL REFERENCES klient(id),
  autor_id     uuid REFERENCES benutzer(id),
  datum        date NOT NULL,
  text         text NOT NULL,
  erstellt_am  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tagesbericht_klient_idx ON tagesbericht (klient_id);
CREATE INDEX tagesbericht_mandant_datum_idx ON tagesbericht (mandant_id, datum DESC);

ALTER TABLE tagesbericht ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagesbericht FORCE ROW LEVEL SECURITY;

CREATE POLICY tagesbericht_isolation ON tagesbericht
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Ein Tagesbericht wird nie geaendert oder geloescht, wie ein
-- Kassenbucheintrag -- er ist Teil der fachlichen Dokumentation und muss
-- fuer Amtsnachfragen unveraendert nachvollziehbar bleiben. Tags sind
-- davon ausdruecklich ausgenommen (siehe tagesbericht_tag): die sollen
-- sich jederzeit anpassen lassen, ohne den eigentlichen Berichtstext
-- anzutasten.
REVOKE UPDATE, DELETE ON tagesbericht FROM zimmerakte_app;

-- Namen sind eindeutig je Mandant (citext: Gross-/Kleinschreibung ist
-- keine neue Kategorie) und werden beim Tippen wiederverwendet, sobald es
-- sie schon gibt -- kein separates "Tags verwalten", das waere fuer eine
-- Handvoll Stichworte pro Traeger mehr Verwaltung als sie wert sind.
CREATE TABLE tag (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  name        citext NOT NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),

  UNIQUE (mandant_id, name)
);

ALTER TABLE tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag FORCE ROW LEVEL SECURITY;

CREATE POLICY tag_isolation ON tag
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

CREATE TABLE tagesbericht_tag (
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  tagesbericht_id uuid NOT NULL REFERENCES tagesbericht(id),
  tag_id          uuid NOT NULL REFERENCES tag(id),

  PRIMARY KEY (tagesbericht_id, tag_id)
);

ALTER TABLE tagesbericht_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagesbericht_tag FORCE ROW LEVEL SECURITY;

CREATE POLICY tagesbericht_tag_isolation ON tagesbericht_tag
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- "Nachtraeglich hinzufuegen/entfernen" heisst: DELETE ist hier explizit
-- erlaubt (anders als bei tagesbericht selbst) -- nur die Zuordnung
-- aendert sich, nicht der dokumentierte Berichtstext.
