-- Raumplan je Standort: Gemeinschaftsraeume (Kueche, Aufenthaltsraum, ...),
-- ein optionales Grundriss-Bild je Etage und die Position der Karten darauf.
--
-- Gemeinschaftsraeume sind BEWUSST eine eigene Tabelle und kein Zimmer mit
-- Art-Spalte: zimmer.kapazitaet fliesst in Dashboard, Platzzaehlung, Belegung
-- und Warteliste ein (Regel 4: Zustaende werden abgeleitet). Ein Raum ohne
-- Bewohner duerfte dort nie als "freier Platz" auftauchen -- bei einer
-- getrennten Tabelle ist das konstruktiv ausgeschlossen, statt in jeder
-- Abfrage per Filter nachgezogen werden zu muessen.
CREATE TABLE standort_raum (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  standort_id uuid NOT NULL REFERENCES standort(id),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  etage       text NOT NULL DEFAULT 'EG',
  aktiv       boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX standort_raum_standort_idx ON standort_raum (standort_id);

ALTER TABLE standort_raum ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort_raum FORCE ROW LEVEL SECURITY;
CREATE POLICY standort_raum_isolation ON standort_raum
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Wie zimmer (0022/0023): nur diese Spalten sind aenderbar, standort_id nicht.
-- Kein DELETE -- "Entfernen" ist Deaktivieren, die Historie bleibt.
REVOKE UPDATE, DELETE ON standort_raum FROM zimmerakte_app;
GRANT  UPDATE (name, etage, aktiv) ON standort_raum TO zimmerakte_app;

-- Grundriss-Bild je Standort UND Etage (ein Haus hat mehrere Stockwerke).
-- bytea wie bei unterschrift (0012) und rechnung_dokument (0015). Ersetzen
-- heisst loeschen + neu anlegen, deshalb kein UPDATE-Recht, aber DELETE.
CREATE TABLE standort_grundriss (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  standort_id     uuid NOT NULL REFERENCES standort(id),
  etage           text NOT NULL,
  dateiname       text NOT NULL,
  mime_type       text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  inhalt          bytea NOT NULL,
  inhalt_hash     text NOT NULL, -- sha256, hex-kodiert
  hochgeladen_von uuid REFERENCES benutzer(id),
  erstellt_am     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (standort_id, etage)
);

ALTER TABLE standort_grundriss ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort_grundriss FORCE ROW LEVEL SECURITY;
CREATE POLICY standort_grundriss_isolation ON standort_grundriss
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

REVOKE UPDATE ON standort_grundriss FROM zimmerakte_app;

-- Position einer Karte auf dem Grundriss, in PROZENT der Bildbreite/-hoehe
-- (nicht Pixel): so bleibt sie bei jeder Anzeigegroesse an derselben Stelle
-- des Plans. Genau eins von zimmer_id/raum_id -- zwei nullable FKs statt
-- einer polymorphen id, damit die referenzielle Integritaet erhalten bleibt
-- (gleiches Muster wie kassenbuchung_teilnehmer, 0030).
--
-- etage steht mit in der Zeile: aendert sich die Etage eines Zimmers
-- nachtraeglich, passt die gespeicherte Position nicht mehr zum Plan -- sie
-- gilt dann nur, solange die Etage uebereinstimmt, und wird ohne Eingriff in
-- zimmer.service ignoriert.
CREATE TABLE standort_plan_position (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  uuid NOT NULL REFERENCES mandant(id),
  standort_id uuid NOT NULL REFERENCES standort(id),
  etage       text NOT NULL,
  zimmer_id   uuid REFERENCES zimmer(id),
  raum_id     uuid REFERENCES standort_raum(id),
  x_prozent   numeric(5, 2) NOT NULL CHECK (x_prozent BETWEEN 0 AND 100),
  y_prozent   numeric(5, 2) NOT NULL CHECK (y_prozent BETWEEN 0 AND 100),

  CHECK ((zimmer_id IS NOT NULL AND raum_id IS NULL) OR (zimmer_id IS NULL AND raum_id IS NOT NULL))
);

CREATE UNIQUE INDEX standort_plan_position_zimmer_eindeutig
  ON standort_plan_position (zimmer_id) WHERE zimmer_id IS NOT NULL;
CREATE UNIQUE INDEX standort_plan_position_raum_eindeutig
  ON standort_plan_position (raum_id) WHERE raum_id IS NOT NULL;
CREATE INDEX standort_plan_position_standort_idx ON standort_plan_position (standort_id, etage);

ALTER TABLE standort_plan_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE standort_plan_position FORCE ROW LEVEL SECURITY;
CREATE POLICY standort_plan_position_isolation ON standort_plan_position
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Das Anordnen speichert den ganzen Plan einer Etage neu (loeschen + einfuegen
-- in einer Transaktion) -- UPDATE wird nicht gebraucht und bleibt entzogen.
REVOKE UPDATE ON standort_plan_position FROM zimmerakte_app;
