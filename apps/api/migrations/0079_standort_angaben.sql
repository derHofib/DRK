-- Standort-Steckbrief, Phase 1 (Rueckmeldung "Standort daten", Konzept
-- standort-daten, Abschnitt 3.2 und Nachtrag vom 20.11.2026).
--
-- Bewusst als Spalten an standort statt einer 1:1-Tabelle: alles ist genau
-- einmal je Standort vorhanden. Plaetze, Leitung und Team werden NICHT
-- gespeichert, sie werden aus zimmer/belegung bzw. dem Organigramm
-- abgeleitet (Regel 4) -- eine eingetragene Platzzahl liefe beim naechsten
-- neuen Zimmer auseinander, eine eingetragene Leitung beim naechsten
-- Wechsel im Organigramm.
--
-- Zugangs-, Tuer-, Tresor- oder Alarmcodes bewusst NICHT: den Steckbrief
-- sieht jede:r mit Zugriff auf den Standort, auch am Handy. "zugang"
-- beschreibt nur, WO der Schluessel ist (Konzept 3.5).
--
-- Angebotsform als feste Liste (von Dennis bestaetigt): neue Werte kommen
-- per Migration, nicht als Freitext, damit Filter und Auswertungen
-- verlaesslich bleiben. Die Beschriftungen stehen in packages/shared.
ALTER TABLE standort
  ADD COLUMN angebotsform text CHECK (angebotsform IN (
    'besondere_wohnform', 'ambulant_wg', 'einzelwohnen', 'jugendhilfe_34', 'hilfe_67', 'sonstiges')),
  ADD COLUMN zielgruppe               text,
  ADD COLUMN betreuungsumfang         text CHECK (betreuungsumfang IN ('rund_um_die_uhr', 'tagsueber', 'stundenweise')),
  ADD COLUMN in_betrieb_seit          date,
  ADD COLUMN strasse                  text,
  ADD COLUMN plz                      text CHECK (plz ~ '^[0-9]{5}$'),
  ADD COLUMN ort                      text,
  ADD COLUMN telefon                  text,
  ADD COLUMN fax                      text,
  ADD COLUMN email                    text,
  ADD COLUMN buerozeiten              text,
  ADD COLUMN bereitschaft_telefon     text,
  ADD COLUMN bereitschaft_hinweis     text,
  ADD COLUMN barrierefreiheit         text CHECK (barrierefreiheit IN ('barrierefrei', 'teilweise', 'nicht')),
  ADD COLUMN barrierefreiheit_hinweis text,
  ADD COLUMN oepnv                    text,
  ADD COLUMN zugang                   text,
  -- Kostenstelle und IK-Nummer sieht nur, wer standorte.bearbeiten hat.
  -- Durchgesetzt im Service beim Lesen (Feld fehlt im JSON), nicht in der
  -- Oberflaeche -- eine Spalten-Policy kennt PostgreSQL nicht.
  ADD COLUMN kostenstelle             text,
  ADD COLUMN ik_nummer                text CHECK (ik_nummer ~ '^[0-9]{9}$'),
  ADD COLUMN hinweise                 text;

-- Anschrift aufteilen. Vorhandene Werte im Muster "Strasse Nr., 12345 Ort"
-- werden zerlegt; alles andere landet unveraendert in strasse, und der
-- Steckbrief zeigt "Anschrift unvollstaendig".
UPDATE standort SET
  strasse = COALESCE(substring(adresse FROM '^(.+?),\s*[0-9]{5}\s+.+$'), adresse),
  plz     = substring(adresse FROM ',\s*([0-9]{5})\s+.+$'),
  ort     = substring(adresse FROM ',\s*[0-9]{5}\s+(.+)$');
ALTER TABLE standort ALTER COLUMN strasse SET NOT NULL;

-- adresse bleibt fuer alle Leser (Listen, Dashboard, Exporte, PDFs) als
-- Spalte erhalten, ist ab jetzt aber ABGELEITET -- ein zweiter gepflegter Ort
-- fuer dieselbe Anschrift liefe auseinander.
--
-- Bewusst per Trigger statt GENERATED ALWAYS AS: eine generierte Spalte
-- laesst kein INSERT mit adresse mehr zu, und das tun heute 38 Testdateien
-- und jeder parallel entstehende Zweig. Der Trigger nimmt ein solches INSERT
-- weiter an, zerlegt adresse wie oben und schreibt sie danach aus den Teilen
-- neu. Weil die App-Rolle adresse nicht mehr aendern darf (REVOKE unten) und
-- der Trigger sie bei jedem Schreiben ueberschreibt, kann sie nicht von
-- strasse/plz/ort abweichen.
CREATE FUNCTION standort_adresse_ableiten() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.strasse IS NULL AND NEW.adresse IS NOT NULL THEN
    NEW.strasse := COALESCE(substring(NEW.adresse FROM '^(.+?),\s*[0-9]{5}\s+.+$'), NEW.adresse);
    NEW.plz     := COALESCE(NEW.plz, substring(NEW.adresse FROM ',\s*([0-9]{5})\s+.+$'));
    NEW.ort     := COALESCE(NEW.ort, substring(NEW.adresse FROM ',\s*[0-9]{5}\s+(.+)$'));
  END IF;
  NEW.adresse := NEW.strasse
    || CASE WHEN NEW.plz IS NULL OR NEW.ort IS NULL THEN '' ELSE ', ' || NEW.plz || ' ' || NEW.ort END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standort_adresse_ableiten
  BEFORE INSERT OR UPDATE ON standort
  FOR EACH ROW EXECUTE FUNCTION standort_adresse_ableiten();

-- Spaltenscharf wie 0022: adresse ist ab jetzt nicht mehr direkt aenderbar,
-- die neuen Spalten muessen ausdruecklich freigegeben werden. mandant_id, id
-- und erstellt_am bleiben unaenderbar.
REVOKE UPDATE (adresse) ON standort FROM zimmerakte_app;
GRANT UPDATE (angebotsform, zielgruppe, betreuungsumfang, in_betrieb_seit,
              strasse, plz, ort, telefon, fax, email, buerozeiten,
              bereitschaft_telefon, bereitschaft_hinweis, barrierefreiheit,
              barrierefreiheit_hinweis, oepnv, zugang, kostenstelle, ik_nummer, hinweise)
  ON standort TO zimmerakte_app;

-- Einzelwohnen (Nachtrag 20.11.2026): Der Standort ist dort das Team bzw.
-- Buero, die Klient:innen wohnen verstreut. Jede Wohnung wird wie bisher
-- als Zimmer angelegt und bekommt eine optionale eigene Anschrift. So
-- funktionieren Belegung, Plaetze und Raumplan unveraendert weiter. Leer =
-- die Anschrift des Standorts gilt.
ALTER TABLE zimmer ADD COLUMN anschrift text;
GRANT UPDATE (anschrift) ON zimmer TO zimmerakte_app;
