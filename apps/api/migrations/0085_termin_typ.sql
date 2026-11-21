-- Eigene Termintypen je Traeger (Wunsch Dennis 21.11.2026, Konzept
-- termin-typen/konzept-termin-typen.md): "wie bei den Buchungstypen eigene
-- Typen festlegen ... damit wir immer nachtraeglich welche hinzufuegen
-- koennen". Ersetzt die feste Spalte termin.art aus 0074.
--
-- Warum das ohne Umbau der Kalenderlogik geht: die Art steuerte nur Farbe,
-- Filter und Legende. Ob ein Termin Betreuungszeit ist, haengt an den
-- Teilnehmenden (mindestens eine Klient:in) und am persoenlichen Haken
-- (0080) -- daran aendert sich nichts.
--
-- Farbe ist ein SCHLUESSEL aus einer festen Liste, kein Farbwert: das CSS
-- ordnet jedem Schluessel Farbton und Buntheit zu, die Helligkeit steht fest
-- je Theme (CLAUDE.md Regel 7). Ein frei gewaehlter Farbwert koennte den
-- gemessenen Kontrast der Termin-Marken brechen. Rot, Gelb, Hellblau und
-- Lila fehlen absichtlich: sie gehoeren krank, Urlaub, frei und Fortbildung,
-- und eine Abwesenheit darf im Jahreskalender nie wie ein Termin aussehen.
--
-- betreuungszeit regelt nur die VORBELEGUNG des Hakens "Als Betreuungszeit
-- erfassen" im Termin-Dialog. Gebucht wird weiter nur, wer selbst den Haken
-- setzt -- ein Typ bucht niemandem Stunden. Deshalb steht dazu nichts in der
-- Datenbank-Logik der Stunden.
--
-- leistungsart wird beim Anlegen (bzw. beim Wechsel des Typs) in
-- termin.stunden_leistungsart KOPIERT, nicht live gelesen: sonst wuerde eine
-- spaetere Aenderung am Typ bereits gebuchte Kalenderstunden vergangener
-- Termine automatisch stornieren und neu buchen (0080 gleicht ab, sobald
-- Soll und Buchung auseinanderlaufen).
CREATE TABLE termin_typ (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE wie org_unit (0040): eine Auswahlliste gehoert zum Traeger und
  -- hat ohne ihn keinen Sinn. Termine selbst kaskadieren NICHT -- wer einen
  -- Traeger mit Terminen loescht, scheitert weiter an termin.mandant_id.
  mandant_id     uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
  bezeichnung    text NOT NULL CHECK (length(btrim(bezeichnung)) BETWEEN 1 AND 60),
  farbe          text NOT NULL
    CHECK (farbe IN ('grau', 'gruen', 'petrol', 'blau', 'oliv', 'orange', 'rose', 'sand')),
  betreuungszeit text NOT NULL DEFAULT 'voreinstellung'
    CHECK (betreuungszeit IN ('vorbelegen', 'voreinstellung', 'nicht_vorbelegen')),
  leistungsart   text
    CHECK (leistungsart IS NULL OR leistungsart IN ('einzelbetreuung', 'gruppenangebot', 'begleitung', 'beratung', 'sonstiges')),
  reihenfolge    integer NOT NULL DEFAULT 0,
  aktiv          boolean NOT NULL DEFAULT true,
  -- Der eine Typ, auf den alles faellt, was keinen waehlt (Klient:innen,
  -- Chat, alte Clients). Wie HZL bei den Buchungstypen: umbenenn- und
  -- umfaerbbar, aber nie ausgeblendet oder geloescht -- sonst gaebe es
  -- Termine, die nicht angelegt werden koennen.
  ist_standard   boolean NOT NULL DEFAULT false,
  erstellt_am    timestamptz NOT NULL DEFAULT now(),

  CHECK (aktiv OR NOT ist_standard),
  UNIQUE (id, mandant_id)
);

-- Gross/klein egal: "Hausbesuch" und "hausbesuch" waeren im Filter zwei
-- gleich aussehende Eintraege.
CREATE UNIQUE INDEX termin_typ_bezeichnung_je_mandant ON termin_typ (mandant_id, lower(btrim(bezeichnung)));
CREATE UNIQUE INDEX termin_typ_ein_standard_je_mandant ON termin_typ (mandant_id) WHERE ist_standard;

ALTER TABLE termin_typ ENABLE ROW LEVEL SECURITY;
ALTER TABLE termin_typ FORCE ROW LEVEL SECURITY;

-- Bewusst nur der Traeger, kein Benutzer-Kontext verlangt: auch Klient:innen
-- sehen an ihren Terminen Typname und Farbe. Ein Typ ist keine
-- personenbezogene Information.
CREATE POLICY termin_typ_isolation ON termin_typ
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- ist_standard und mandant_id sind nach dem Anlegen fest (Regel 3).
REVOKE UPDATE ON termin_typ FROM zimmerakte_app;
GRANT UPDATE (bezeichnung, farbe, betreuungszeit, leistungsart, reihenfolge, aktiv) ON termin_typ TO zimmerakte_app;

-- Loeschen ist erlaubt (ein nie benutzter Tippfehler-Typ soll verschwinden
-- koennen); benutzte Typen schuetzt der Fremdschluessel von termin, den
-- Standardtyp dieser Trigger.
CREATE FUNCTION termin_typ_standard_bleibt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Ausnahme: der ganze Traeger wird geloescht (CASCADE oben). Dann ist die
  -- mandant-Zeile in diesem Statement schon weg.
  IF OLD.ist_standard AND EXISTS (SELECT 1 FROM mandant WHERE id = OLD.mandant_id) THEN
    RAISE EXCEPTION 'termin_typ: der Standardtyp kann nicht geloescht werden'
      USING ERRCODE = 'ZA004';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER termin_typ_standard_bleibt
  BEFORE DELETE ON termin_typ
  FOR EACH ROW EXECUTE FUNCTION termin_typ_standard_bleibt();

-- Startbestand = die drei bisherigen Arten, in denselben Farben wie bisher
-- (--zv-art-termin/-klient/-besprechung), damit sich fuer niemanden etwas
-- sichtbar aendert. "Klient:innentermin" bekommt bewusst NICHT
-- "vorbelegen": das waere eine stille Verhaltensaenderung gegenueber 0080.
-- Die Leitung kann das jetzt selbst umstellen.
INSERT INTO termin_typ (mandant_id, bezeichnung, farbe, reihenfolge, ist_standard)
  SELECT id, 'Termin', 'grau', 0, true FROM mandant;
INSERT INTO termin_typ (mandant_id, bezeichnung, farbe, reihenfolge)
  SELECT id, 'Klient:innentermin', 'gruen', 1 FROM mandant;
INSERT INTO termin_typ (mandant_id, bezeichnung, farbe, reihenfolge)
  SELECT id, 'Besprechung', 'petrol', 2 FROM mandant;

-- Gleicher Grund wie kassenbuchung_typ_standard_anlegen (0035): ein neuer
-- Mandant entsteht nur ueber die privilegierte Verbindung und haette sonst
-- keinen Standardtyp -- jeder Termin scheiterte dann am NOT NULL unten.
CREATE FUNCTION termin_typ_standard_anlegen() RETURNS trigger AS $$
BEGIN
  INSERT INTO termin_typ (mandant_id, bezeichnung, farbe, reihenfolge, ist_standard) VALUES
    (NEW.id, 'Termin', 'grau', 0, true),
    (NEW.id, 'Klient:innentermin', 'gruen', 1, false),
    (NEW.id, 'Besprechung', 'petrol', 2, false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mandant_termin_typ_standard
  AFTER INSERT ON mandant
  FOR EACH ROW EXECUTE FUNCTION termin_typ_standard_anlegen();

-- Termin: typ_id statt art. Zusammengesetzt (Regel 1), damit kein Termin
-- auf den Typ eines anderen Traegers zeigen kann.
ALTER TABLE termin ADD COLUMN typ_id uuid;

UPDATE termin t
SET typ_id = tt.id
FROM termin_typ tt
WHERE tt.mandant_id = t.mandant_id
  AND tt.bezeichnung = CASE t.art
        WHEN 'termin' THEN 'Termin'
        WHEN 'klient' THEN 'Klient:innentermin'
        WHEN 'besprechung' THEN 'Besprechung'
      END;

-- Wer keinen Typ angibt (Klient:innen, Termin aus dem Chat, aeltere App),
-- bekommt den Standardtyp des eigenen Traegers. Im Trigger statt im Service,
-- damit es keinen Schreibweg gibt, der es vergessen kann. Laeuft als
-- Aufrufer unter RLS -- sieht also nur den Standardtyp des Traegers, fuer
-- den die Zeile geschrieben wird.
CREATE FUNCTION termin_typ_standard_setzen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.typ_id IS NULL THEN
    SELECT id INTO NEW.typ_id FROM termin_typ WHERE mandant_id = NEW.mandant_id AND ist_standard;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER termin_typ_standard_setzen
  BEFORE INSERT ON termin
  FOR EACH ROW EXECUTE FUNCTION termin_typ_standard_setzen();

ALTER TABLE termin ALTER COLUMN typ_id SET NOT NULL;
ALTER TABLE termin ADD CONSTRAINT termin_typ_fk
  FOREIGN KEY (typ_id, mandant_id) REFERENCES termin_typ (id, mandant_id);
CREATE INDEX termin_typ_id_idx ON termin (typ_id);

-- 0053 hat UPDATE spaltenscharf vergeben; ohne diese Zeile liesse sich der
-- Typ eines Termins nicht aendern. Mit DROP COLUMN art verschwindet auch
-- das Spaltenrecht aus 0074.
GRANT UPDATE (typ_id) ON termin TO zimmerakte_app;
ALTER TABLE termin DROP COLUMN art;

-- Neues Recht kalender.typen-verwalten: ohne Zeile ein impliziter Deny.
-- Start wie bei den Buchungstypen -- wer die verwalten darf, darf auch
-- Termintypen verwalten. In der Rechtematrix danach frei aenderbar.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'kalender', 'typen-verwalten', r.scope, r.erlaubt
FROM account_typ_recht r
WHERE r.modul = 'kassenbuch' AND r.aktion = 'typen-verwalten'
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
