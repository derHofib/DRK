-- Kostenübernahme-Zeiträume je Klient (welches Amt übernimmt die Kosten,
-- von wann bis wann). Wie bei belegung: "bis" wird offen angelegt und
-- genau einmal per Update geschlossen (siehe kostenuebernahme.service.ts,
-- beenden()) -- kein Statusfeld, der aktuelle Zeitraum wird abgeleitet
-- (bis IS NULL OR bis > heute).
CREATE TABLE kostenuebernahme (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  klient_id    uuid NOT NULL REFERENCES klient(id),
  amt          text NOT NULL,
  von          date NOT NULL,
  bis          date,
  erstellt_von uuid REFERENCES benutzer(id),
  erstellt_am  timestamptz NOT NULL DEFAULT now(),

  CHECK (bis IS NULL OR bis > von)
);

-- Ein Klient kann nicht zwei sich überlappende Kostenübernahme-Zeiträume
-- gleichzeitig haben -- sonst ist nicht eindeutig, welches Amt gerade
-- zuständig ist. Gleiches Muster wie belegung_klient_ohne_ueberlappung.
ALTER TABLE kostenuebernahme ADD CONSTRAINT kostenuebernahme_ohne_ueberlappung
  EXCLUDE USING gist (
    klient_id WITH =,
    daterange(von, bis, '[)') WITH &&
  );

CREATE INDEX kostenuebernahme_klient_idx ON kostenuebernahme (klient_id);

ALTER TABLE kostenuebernahme ENABLE ROW LEVEL SECURITY;
ALTER TABLE kostenuebernahme FORCE ROW LEVEL SECURITY;

CREATE POLICY kostenuebernahme_isolation ON kostenuebernahme
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
