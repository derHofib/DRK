-- Offlinebetrieb (Bauplan Phase 4, Punkt 07): eine im Funkloch erfasste
-- Buchung liegt erst in einer Warteschlange auf dem Geraet und wird beim
-- Wiederverbinden gesendet -- unter Umstaenden mehrmals: die Antwort auf den
-- ersten Versuch kann verloren gehen, nachdem der Server laengst committet
-- hat, zwei Tabs koennen gleichzeitig senden, die Person tippt auf
-- "Jetzt uebertragen", waehrend der automatische Versuch noch laeuft. Fuer
-- den Server ist das jedes Mal derselbe POST.
--
-- Deshalb erzeugt der Client beim ERFASSEN einen Schluessel (UUID) und
-- schickt ihn bei jedem Versuch unveraendert mit (Header Idempotency-Key).
-- Der eindeutige Index unten ist die eigentliche Garantie: auch zwei
-- Versuche, die sich im Service ueberholen, koennen nicht beide eine Zeile
-- schreiben. Der Service liest bei einer Wiederholung die vorhandene Buchung
-- und gibt sie zurueck, statt eine zweite anzulegen.
--
-- Bei HZL kommt hzl_einmal_je_woche (0011) als zweite Sicherung hinzu --
-- die greift aber nur fuer HZL. Eine Barauszahlung "Sonstiges" hatte bisher
-- gar keinen Schutz gegen doppeltes Absenden.
--
-- Je Mandant eindeutig, nicht global: der Schluessel kommt vom Client, und
-- ein Mandant soll nicht erfahren koennen, ob ein Schluessel in einem
-- anderen Mandanten schon vergeben ist (ein globaler Index wuerde genau das
-- per Konflikt verraten).
--
-- idempotenz_fingerabdruck: sha256 ueber den Inhalt der Anfrage. Kommt
-- derselbe Schluessel mit anderem Inhalt, ist das kein Wiederholungsversuch,
-- sondern ein Fehler im Client -- dann antwortet der Server 409, statt still
-- die alte Buchung zurueckzugeben und die neue zu verschlucken.
--
-- Beide Spalten bleiben NULL fuer Buchungen ohne Schluessel (Bestand und
-- jeder Aufrufer, der keinen mitschickt). Aenderbar sind sie fuer die
-- App-Rolle nicht: die Spalten-GRANT-Liste aus 0011 nennt nur die
-- Storno-Spalten, neue Spalten fallen automatisch nicht darunter.
ALTER TABLE kassenbuchung
  ADD COLUMN idempotenz_schluessel uuid,
  ADD COLUMN idempotenz_fingerabdruck text,
  ADD CONSTRAINT kassenbuchung_idempotenz_vollstaendig
    CHECK ((idempotenz_schluessel IS NULL) = (idempotenz_fingerabdruck IS NULL));

CREATE UNIQUE INDEX kassenbuchung_idempotenz_eindeutig
  ON kassenbuchung (mandant_id, idempotenz_schluessel)
  WHERE idempotenz_schluessel IS NOT NULL;

COMMENT ON COLUMN kassenbuchung.idempotenz_schluessel IS
  'Vom Client beim Erfassen erzeugt (Header Idempotency-Key); derselbe Schluessel ergibt nie eine zweite Buchung.';
