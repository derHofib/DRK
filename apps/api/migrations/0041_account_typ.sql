-- Account-Typen sind die Rechte-Vorlagen, auf die Positionen verweisen
-- (naechster Schritt). Pro Mandant frei definierbar -- "Systemvorlagen"
-- heisst hier nur "beim Anlegen vorbefuellt + vor Loeschen/Umbenennen
-- geschuetzt" (ist_system), nicht "nicht editierbar": nur ein Typ mit
-- ist_vollzugriff=true (Geschaeftsfuehrung-Charakter) ist in seiner Matrix
-- nicht reduzierbar, weil er gar keine Matrix-Zeilen hat (siehe unten).
--
-- Bewusst KEIN automatischer Seed-Trigger beim Anlegen eines Mandanten in
-- DIESER Migration (anders als kassenbuchung_typ/org_unit) -- welche
-- Account-Typen ein neuer Mandant bekommt und welche Rechte-Matrix sie
-- genau haben, haengt am Abgleich mit den heutigen ROLLEN_MIT_*-Mengen,
-- der im naechsten Planungsschritt (Rollen-Migration) passiert. Diese
-- Migration legt nur die Struktur an, ohne diese fachliche Entscheidung
-- vorwegzunehmen.
CREATE TYPE account_typ_kategorie AS ENUM ('intern', 'extern');

CREATE TABLE account_typ (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id      uuid NOT NULL REFERENCES mandant(id),
  name            text NOT NULL,
  kategorie       account_typ_kategorie NOT NULL DEFAULT 'intern',
  ist_system      boolean NOT NULL DEFAULT false,
  ist_vollzugriff boolean NOT NULL DEFAULT false,
  erstellt_am     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (mandant_id, name),
  -- Vollzugriff ist ein interner Wildcard-Charakter -- externe Parteien
  -- (siehe unten) duerfen ihn nie bekommen, auch nicht versehentlich.
  CHECK (NOT ist_vollzugriff OR kategorie = 'intern')
);

COMMENT ON TABLE account_typ IS
  'Rechte-Vorlagen je Mandant. ist_vollzugriff=true ist der Geschaeftsfuehrung-Wildcard (alle Module/Aktionen, Scope tenant, kurzgeschlossen in der Rechte-Engine) -- fuer solche Typen werden bewusst KEINE account_typ_recht-Zeilen angelegt.';

ALTER TABLE account_typ ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_typ FORCE ROW LEVEL SECURITY;

CREATE POLICY account_typ_isolation ON account_typ
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Modul x Aktion ist eine Code-Registry (apps/api/src/rechte/registry.ts,
-- naechster Schritt), nicht diese Tabelle -- "neue Module erscheinen
-- automatisch in der Matrix" heisst: die UI rendert die volle Matrix aus
-- der Registry und zeigt eine fehlende Zeile hier als impliziten Deny,
-- ohne dass jemand eine DB-Zeile nachpflegen muss.
CREATE TABLE account_typ_recht (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     uuid NOT NULL REFERENCES mandant(id),
  account_typ_id uuid NOT NULL REFERENCES account_typ(id),
  modul          text NOT NULL,
  aktion         text NOT NULL,
  scope          text NOT NULL,
  erlaubt        boolean NOT NULL DEFAULT true,

  UNIQUE (account_typ_id, modul, aktion)
);

ALTER TABLE account_typ_recht ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_typ_recht FORCE ROW LEVEL SECURITY;

CREATE POLICY account_typ_recht_isolation ON account_typ_recht
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Zwei Invarianten, die ein CHECK nicht abbilden kann (CHECK darf nicht
-- auf eine andere Tabelle schauen): (1) ein ist_vollzugriff-Typ bekommt
-- nie einzelne Rechte-Zeilen -- sein Zugriff wird in der Rechte-Engine
-- komplett kurzgeschlossen, Zeilen hier waeren eine zweite, potenziell
-- widerspruechliche Quelle derselben Wahrheit. (2) ein extern-Typ darf
-- laut Fachkonzept nur objektbezogenen Scope (assigned) bekommen, nie
-- traegerweiten oder sonstigen Zugriff -- auch das muss hier technisch
-- erzwungen sein, nicht nur Konvention bleiben (siehe Organigramm-Plan,
-- "Externe Parteien").
CREATE FUNCTION account_typ_recht_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  typ account_typ%ROWTYPE;
BEGIN
  SELECT * INTO typ FROM account_typ WHERE id = NEW.account_typ_id;

  IF typ.ist_vollzugriff THEN
    RAISE EXCEPTION 'Ein Account-Typ mit Vollzugriff bekommt keine einzelnen Rechte-Zeilen -- der Zugriff wird in der Rechte-Engine als Wildcard kurzgeschlossen.';
  END IF;
  IF typ.kategorie = 'extern' AND NEW.erlaubt AND NEW.scope <> 'assigned' THEN
    RAISE EXCEPTION 'Externe Account-Typen duerfen nur objektbezogenen Scope (assigned) erhalten.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_typ_recht_pruefen
  BEFORE INSERT OR UPDATE ON account_typ_recht
  FOR EACH ROW EXECUTE FUNCTION account_typ_recht_pruefen();
