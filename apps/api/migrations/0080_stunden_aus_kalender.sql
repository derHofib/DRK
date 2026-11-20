-- Stunden aus Kalenderterminen (Rueckmeldung "Stunden", Konzept
-- stunden-kalender/konzept-stunden-aus-kalender.md, Entscheidungen von Dennis
-- vom 20.11.2026: nur Betreuungszeit, jede Person bucht nur ihre eigene Zeit,
-- nachtraegliche Aenderungen werden automatisch storniert und neu gebucht).
--
-- Nummer 0080 statt 0079: 0079 ist parallel fuer die Standortdaten vorgesehen.
-- Der Migrationslauf wendet jede noch fehlende Datei an, eine Luecke schadet nicht.
--
-- Die Vormerkung haengt an der EIGENEN Teilnahmezeile, nicht am Termin: jede
-- Person entscheidet selbst, ob IHRE Zeit gebucht wird -- eine Einladung darf
-- niemandem Stunden buchen (das waere "fuer andere buchen" ohne das Recht und
-- ohne Wissen der Person). Gebucht wird erst nach Terminende als normale,
-- unveraenderliche stundenbuchung mit Verweis auf den Termin; bis dahin ist
-- der Termin die einzige Wahrheit (CLAUDE.md Regel 4). Eine Buchung VOR dem
-- Ende waere eine Buchung in der Zukunft, und jede Verschiebung erzwaenge
-- Storno plus Neubuchung.
--
-- Bewusst KEIN Hintergrundlauf: gebucht wird im Tenant-Kontext der Person
-- selbst, sobald sie die App nach Terminende benutzt (Service
-- StundenKalenderService.nachziehen). Ein Job ohne anfragende Person braeuchte
-- eine weitere SECURITY-DEFINER-Ausnahme von Regel 1 und muesste die
-- Rechtepruefung (Account-Typ, Positionen, Delegation) in SQL nachbauen.

ALTER TABLE termin_teilnehmer ADD COLUMN stunden_erfassen boolean NOT NULL DEFAULT false;
-- 0053 vergibt UPDATE spaltenscharf; die Policy termin_teilnehmer_antworten
-- laesst ohnehin nur die eigene Zeile zu -- auch die Ersteller:in kann damit
-- niemand anderem eine Vormerkung setzen.
GRANT UPDATE (stunden_erfassen) ON termin_teilnehmer TO zimmerakte_app;

-- NULL = automatisch: eine Klient:in Einzelbetreuung, mehrere Gruppenangebot.
-- Abgeleitet beim Buchen statt beim Anlegen gespeichert, weil sich die
-- Teilnehmenden bis zum Ende noch aendern koennen (Absage einer Klient:in).
ALTER TABLE termin ADD COLUMN stunden_leistungsart text
  CHECK (stunden_leistungsart IS NULL OR stunden_leistungsart IN
         ('einzelbetreuung', 'gruppenangebot', 'begleitung', 'beratung', 'sonstiges'));
GRANT UPDATE (stunden_leistungsart) ON termin TO zimmerakte_app;

-- Zusammengesetzter FK (Regel 1): der Termin muss zum selben Traeger gehoeren
-- wie die Buchung. Ein FK nur auf termin(id) liefe an RLS vorbei und liesse
-- einen Verweis auf den Termin eines fremden Traegers zu.
ALTER TABLE termin ADD CONSTRAINT termin_id_mandant_uq UNIQUE (id, mandant_id);

-- termin_id wird nur beim INSERT gesetzt: 0072 hat UPDATE auf stundenbuchung
-- entzogen und nur die Storno-Spalten freigegeben -- der Verweis ist damit
-- ohne weiteres unveraenderlich.
ALTER TABLE stundenbuchung ADD COLUMN termin_id uuid;
ALTER TABLE stundenbuchung ADD CONSTRAINT stundenbuchung_termin_fk
  FOREIGN KEY (termin_id, mandant_id) REFERENCES termin (id, mandant_id);

-- Unterscheidet "die Anwendung hat storniert, weil sich der Termin geaendert
-- hat" von "ein Mensch hat storniert, weil der Termin nicht stattfand". Nur
-- die erste Art darf neu gebucht werden; eine von Hand stornierte
-- Kalenderbuchung lebt sonst beim naechsten Seitenaufruf wieder auf. Als
-- eigene Spalte statt aus dem Wortlaut des Grundes geraten -- und je
-- Klient:in, nicht je Termin: wer bei einem Gruppenangebot eine Person
-- storniert, soll die Buchungen der anderen behalten. Teil des Stornos und
-- damit wie die uebrigen Storno-Spalten nach dem Storno eingefroren
-- (Trigger stundenbuchung_storno_endgueltig).
ALTER TABLE stundenbuchung ADD COLUMN storno_automatisch boolean NOT NULL DEFAULT false;
ALTER TABLE stundenbuchung ADD CHECK (NOT storno_automatisch OR storniert);
GRANT UPDATE (storno_automatisch) ON stundenbuchung TO zimmerakte_app;

-- Hoechstens eine GUELTIGE Buchung je Termin, Person und Klient:in: zwei
-- gleichzeitige Seitenaufrufe buchen nicht doppelt, und nach einem
-- automatischen Storno ist die neue Zeile erlaubt.
CREATE UNIQUE INDEX stundenbuchung_termin_eindeutig
  ON stundenbuchung (termin_id, mitarbeiter_id, klient_id)
  WHERE termin_id IS NOT NULL AND NOT storniert;

-- Traeger: Funktion an/aus und Voreinstellung fuer Konten, die selbst nichts
-- gewaehlt haben. Standard an -- so war der Wunsch formuliert.
ALTER TABLE mandant ADD COLUMN termin_stunden_erlaubt boolean NOT NULL DEFAULT true;
ALTER TABLE mandant ADD COLUMN termin_stunden_vorauswahl boolean NOT NULL DEFAULT true;
GRANT UPDATE (termin_stunden_erlaubt, termin_stunden_vorauswahl) ON mandant TO zimmerakte_app;

-- Je Person, serverseitig (gilt auf allen Geraeten -- "Darstellung" liegt nur
-- im Geraet). NULL = folgt dem Traeger statt eines kopierten true: so wirkt
-- eine spaetere Aenderung der Traeger-Voreinstellung auch fuer alle, die nie
-- selbst gewaehlt haben (Regel 4). In mitarbeiter_profil, weil die Tabelle
-- ohnehin selbstgepflegt ist und RLS nur die eigene Zeile schreiben laesst.
ALTER TABLE mitarbeiter_profil ADD COLUMN termin_stunden_vorauswahl boolean;
ALTER TABLE mitarbeiter_profil ADD COLUMN termin_stunden_vorauswahl_zusage boolean;
GRANT UPDATE (termin_stunden_vorauswahl, termin_stunden_vorauswahl_zusage) ON mitarbeiter_profil TO zimmerakte_app;

-- Neues Recht fuer den Traeger-Schalter (registry.ts). Ohne Zeile waere es ein
-- impliziter Deny und nur Vollzugriff koennte die Funktion abschalten. Wer
-- fremde Stunden stornieren darf, ist die Leitungsebene der Stundenerfassung
-- (0072) -- dieselbe Ebene entscheidet, ob Termine dort einfliessen.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'stunden', 'einstellungen-verwalten', r.scope, r.erlaubt
FROM account_typ_recht r
WHERE r.modul = 'stunden' AND r.aktion = 'stornieren'
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
