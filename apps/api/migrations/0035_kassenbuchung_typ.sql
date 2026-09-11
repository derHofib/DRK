-- Kassenbuch-Typen werden frei durch die Leitung verwaltbar statt eines
-- festen ENUM mit drei Werten (hzl/einzahlung/sonstiges aus
-- 0011_kassenbuchung.sql). Ein ENUM laesst sich nicht "je Mandant"
-- erweitern -- deshalb hier der Umbau auf eine echte, mandantenscoped
-- Tabelle. Der alte ENUM-Typ wird zunaechst umbenannt (der Name wird
-- gleich von der neuen Tabelle gebraucht) und am Ende der Migration
-- verworfen.
ALTER TYPE kassenbuchung_typ RENAME TO kassenbuchung_typ_alt;

-- "kommentar_pflicht" steuert zwei Dinge zugleich in der Anwendungsschicht:
-- ob das Feld an einer Buchung Pflicht ist, UND ob es "Verwendungszweck"
-- (Pflicht) oder "Kommentar" (optional) heisst -- fachlich dieselbe Spalte
-- (kassenbuchung.verwendungszweck bleibt unveraendert), nur Beschriftung
-- und Validierung haengen am gewaehlten Typ.
--
-- "ist_hzl" markiert den einen Systemtyp je Mandant, an dem echte
-- Fachlogik haengt (Wochenuebersicht, Sperre gegen doppelte
-- HZL-Auszahlung je Klient/Kalenderwoche, siehe hzl_einmal_je_woche unten)
-- -- ueber die Verwaltungsseite (Einstellungen) weder umbenennbar noch
-- loeschbar, siehe ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN in
-- kassenbuchung-typ.service.ts. Der partielle Unique-Index stellt sicher,
-- dass nie versehentlich ein zweiter HZL-Systemtyp je Mandant entsteht.
CREATE TABLE kassenbuchung_typ (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id         uuid NOT NULL REFERENCES mandant(id),
  bezeichnung        text NOT NULL,
  kommentar_pflicht  boolean NOT NULL DEFAULT true,
  ist_hzl            boolean NOT NULL DEFAULT false,
  aktiv              boolean NOT NULL DEFAULT true,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (mandant_id, bezeichnung)
);

COMMENT ON TABLE kassenbuchung_typ IS
  'Frei durch die Leitung verwaltbare Kassenbuch-Typen je Mandant. "HZL" (ist_hzl=true) ist ein Systemtyp und ueber die Verwaltungsseite weder umbenennbar noch loeschbar.';

CREATE UNIQUE INDEX kassenbuchung_typ_ein_hzl_je_mandant
  ON kassenbuchung_typ (mandant_id)
  WHERE ist_hzl;

ALTER TABLE kassenbuchung_typ ENABLE ROW LEVEL SECURITY;
ALTER TABLE kassenbuchung_typ FORCE ROW LEVEL SECURITY;

CREATE POLICY kassenbuchung_typ_isolation ON kassenbuchung_typ
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Bestandsmandanten bekommen ihre bisherigen drei Typen als Startbestand --
-- HZL bleibt inhaltlich unveraendert (nur die Feldbeschriftung wechselt zu
-- "Kommentar", da hier bislang ohnehin kein Verwendungszweck im
-- eigentlichen Sinne noetig war), Einzahlung/Sonstiges sind ab sofort
-- normale, von der Leitung bearbeit- und deaktivierbare Eintraege.
INSERT INTO kassenbuchung_typ (mandant_id, bezeichnung, kommentar_pflicht, ist_hzl)
  SELECT id, 'HZL', false, true FROM mandant;
INSERT INTO kassenbuchung_typ (mandant_id, bezeichnung, kommentar_pflicht, ist_hzl)
  SELECT id, 'Einzahlung', true, false FROM mandant;
INSERT INTO kassenbuchung_typ (mandant_id, bezeichnung, kommentar_pflicht, ist_hzl)
  SELECT id, 'Sonstiges', true, false FROM mandant;

-- Es gibt bewusst keinen oeffentlichen Registrierungs-Endpunkt (siehe
-- README, "Einen ersten Mandanten anlegen") -- ein neuer Mandant entsteht
-- immer per INSERT INTO mandant, sei es von Hand oder ueber
-- scripts/account-anlegen.sh. Ohne diesen Trigger haette ein frisch
-- angelegter Mandant ZERO Kassenbuch-Typen und koennte damit ueberhaupt
-- keine Kassenbuchung anlegen ("Kassenbuch-Typ nicht gefunden"), bis
-- jemand von Hand welche in den Einstellungen anlegt -- allen voran fehlte
-- ihm der HZL-Systemtyp, an dem echte Fachlogik haengt. Der Trigger laeuft
-- als Ausfuehrende(r) des INSERT (kein SECURITY DEFINER noetig): mandant
-- wird ohnehin nur ueber die privilegierte Migrations-/Admin-Verbindung
-- angelegt, nie ueber die App-Rolle.
CREATE FUNCTION kassenbuchung_typ_standard_anlegen() RETURNS trigger AS $$
BEGIN
  INSERT INTO kassenbuchung_typ (mandant_id, bezeichnung, kommentar_pflicht, ist_hzl) VALUES
    (NEW.id, 'HZL', false, true),
    (NEW.id, 'Einzahlung', true, false),
    (NEW.id, 'Sonstiges', true, false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mandant_kassenbuchung_typ_standard
  AFTER INSERT ON mandant
  FOR EACH ROW EXECUTE FUNCTION kassenbuchung_typ_standard_anlegen();

-- "ist_hzl" wird zusaetzlich zu typ_id auf der Buchung selbst gespiegelt:
-- eine WHERE-Klausel eines partiellen Index darf keine Subquery/keinen Join
-- auf eine andere Tabelle enthalten, haette hzl_einmal_je_woche also nicht
-- mehr direkt gegen kassenbuchung_typ.ist_hzl geprueft werden koennen. Die
-- Spalte wird einmalig beim Anlegen aus dem gewaehlten Typ uebernommen
-- (siehe kassenbuchung.service.ts::anlegen()) und ist danach so unveraenderlich
-- wie jede andere fachliche Spalte dieser Append-only-Tabelle.
ALTER TABLE kassenbuchung ADD COLUMN typ_id uuid REFERENCES kassenbuchung_typ(id);
ALTER TABLE kassenbuchung ADD COLUMN ist_hzl boolean NOT NULL DEFAULT false;

UPDATE kassenbuchung b
SET typ_id = t.id,
    ist_hzl = t.ist_hzl
FROM kassenbuchung_typ t
WHERE t.mandant_id = b.mandant_id
  AND t.bezeichnung = CASE b.typ
        WHEN 'hzl' THEN 'HZL'
        WHEN 'einzahlung' THEN 'Einzahlung'
        WHEN 'sonstiges' THEN 'Sonstiges'
      END;

ALTER TABLE kassenbuchung ALTER COLUMN typ_id SET NOT NULL;
CREATE INDEX kassenbuchung_typ_id_idx ON kassenbuchung (typ_id);

DROP INDEX hzl_einmal_je_woche;
CREATE UNIQUE INDEX hzl_einmal_je_woche
  ON kassenbuchung (klient_id, iso_jahr, iso_woche)
  WHERE ist_hzl AND NOT storniert;

-- "DROP COLUMN typ" wuerde die CHECK-Constraint kassenbuchung_hzl_nur_klient
-- aus Migration 0030 (referenzierte "typ <> 'hzl' OR klient_id IS NOT NULL")
-- automatisch mit entfernen, ohne Warnung -- deshalb hier zuerst durch das
-- Aequivalent auf der neuen Spalte ersetzen, sonst waere die Zusicherung
-- "eine HZL-Buchung braucht einen Klienten" nach dieser Migration nur noch
-- eine Anwendungsregel (kassenbuchung.service.ts), keine Datenbankgarantie
-- mehr.
ALTER TABLE kassenbuchung DROP CONSTRAINT kassenbuchung_hzl_nur_klient;
ALTER TABLE kassenbuchung ADD CONSTRAINT kassenbuchung_hzl_nur_klient CHECK (
  NOT ist_hzl OR klient_id IS NOT NULL
);

ALTER TABLE kassenbuchung DROP COLUMN typ;
DROP TYPE kassenbuchung_typ_alt;

-- Keine zusaetzliche GRANT-Zeile fuer typ_id/ist_hzl noetig: 0011 hat
-- UPDATE/DELETE auf kassenbuchung bereits komplett entzogen und nur fuer
-- die Storno-Spalten wieder freigegeben. Neue Spalten erben KEINE
-- Update-Rechte automatisch -- exakt das gewuenschte Verhalten, der Typ
-- einer Buchung ist ab dem Anlegen genauso unveraenderlich wie Betrag oder
-- Verwendungszweck. Fuer INSERT reicht das bestehende Tabellenrecht.
