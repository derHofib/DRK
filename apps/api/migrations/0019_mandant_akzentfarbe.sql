-- Corporate Branding je Traeger: eine einzige Akzentfarbe.
--
-- Bewusst EIN Hex-Wert und keine gespeicherte Palette: die vollstaendige
-- Tonleiter (hell/dunkel, Flaeche/Text/Softton) wird im Frontend aus
-- Farbton und Buntheit dieses einen Wertes abgeleitet -- siehe
-- apps/web/src/theme/farbe.ts. Eine mitgespeicherte Palette waere
-- redundant und koennte gegenueber den CSS-Tokens veralten.
--
-- Der CHECK laesst nur Kleinbuchstaben zu. Das ist keine Kosmetik: so gibt
-- es genau EINE Schreibweise pro Farbe in der Datenbank, und ein Vergleich
-- "ist das noch der Standardwert" braucht kein lower(). Der Controller
-- normalisiert deshalb per zod-transform, statt Grossschreibung abzulehnen
-- -- ein <input type="color"> liefert je nach Browser "#5EC4C0".
ALTER TABLE mandant
  ADD COLUMN akzentfarbe text NOT NULL DEFAULT '#5ec4c0'
  CHECK (akzentfarbe ~ '^#[0-9a-f]{6}$');

COMMENT ON COLUMN mandant.akzentfarbe IS
  'Akzentfarbe des Traegers als sRGB-Hex, immer kleingeschrieben (siehe CHECK). '
  'Kein Personenbezug -- reines Erscheinungsbild, gilt fuer alle Mitarbeitenden.';

-- Bis hierher durfte die App-Rolle ueber ALTER DEFAULT PRIVILEGES (0002)
-- JEDE Spalte von mandant aendern -- auch name, slug und aktiv. Fuer den
-- einen neuen Anwendungsfall "Akzentfarbe setzen" ist das viel zu viel:
-- ein Fehler im Service koennte einen Traeger umbenennen, ihn ueber aktiv
-- stilllegen oder ueber slug den Login-Pfad eines anderen Mandanten
-- kapern. Deshalb dasselbe spaltenscharfe Muster wie bei kassenbuchung
-- (0011): erst alles weg, dann genau die eine erlaubte Spalte zurueck.
REVOKE UPDATE ON mandant FROM zimmerakte_app;
GRANT  UPDATE (akzentfarbe) ON mandant TO zimmerakte_app;

-- Kein zusaetzliches WITH CHECK noetig: mandant_isolation (0003) hat nur
-- eine USING-Klausel, und die verwendet PostgreSQL bei UPDATE automatisch
-- auch als WITH CHECK. Ein Mandant kann damit weder eine fremde Zeile
-- aendern noch die eigene auf eine fremde id umschreiben.
