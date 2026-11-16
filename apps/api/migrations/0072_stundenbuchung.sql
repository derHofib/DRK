-- Stundenbuchung (Bauplan Phase 4, Punkt 03): geleistete Betreuungszeit je
-- Klient:in als Bewegungstabelle. Der Stundensaldo ist KEIN Feld, sondern
-- eine Summe ueber diese Zeilen (CLAUDE.md Regel 4) -- jede Minute hat
-- Datum, Urheber und Zeitpunkt, und niemand kann spaeter "eine Stunde
-- abziehen", ohne dass es eine Zeile gibt.
--
-- Append-only wie das Kassenbuch (0011), aus demselben Grund: die Stunden
-- sind die Grundlage der Abrechnung gegenueber dem Amt (Leistungsnachweis).
-- Eine falsche Buchung wird storniert, nicht korrigiert. Aenderbar sind fuer
-- die App-Rolle ausschliesslich die vier Storno-Spalten; Minuten, Datum,
-- Klient:in und Leistungsart sind ab dem INSERT per REVOKE/GRANT gesperrt,
-- nicht per Codereview. Ein Tippfehler (90 statt 60 Minuten) heisst also:
-- stornieren und neu buchen -- beides bleibt als Zeile sichtbar.
--
-- minuten statt Dezimalstunden: ganze Zahl, nie Fliesskomma (Bauplan Punkt 04,
-- gleiche Begruendung wie betrag_cent). Eine Buchung hat hoechstens einen
-- Tag (1440 Minuten) -- mehr ist ein Tippfehler, kein Leistungsnachweis; wer
-- laenger betreut hat, bucht mehrere Zeilen.
--
-- "leistungsart" ist bewusst eine feste, kleine Liste (CHECK) und keine
-- Mandanten-Tabelle wie kassenbuchung_typ: solange nicht klar ist, welche
-- Gliederung die Aemter in den Leistungsnachweisen verlangen, waere eine frei
-- pflegbare Liste Vorratshaltung. Erweitern ist eine Migration (CHECK
-- austauschen), kein Umbau.
--
-- Loeschfrist: die automatische Anonymisierung einer archivierten Person (0070)
-- raeumt stundenbuchung NICHT ab, wie sie auch Kassenbuch, Rechnungen und
-- Tagesberichte stehen laesst -- die Aufbewahrung abrechnungsrelevanter
-- Nachweise ist eine offene fachliche Entscheidung des Traegers. Zu beachten
-- ist dabei das Freitextfeld "notiz": es kann Angaben ueber die Person
-- enthalten und bleibt nach der Anonymisierung der Klient:in stehen. Soll es
-- mit verschwinden, gehoert eine eigene Bereinigung in den Trigger
-- klient_daten_bei_anonymisierung() -- als neue Migration, nicht hier.
--
-- mitarbeiter_id (wer hat die Leistung erbracht) und gebucht_von (wer hat sie
-- eingetragen) sind getrennt, weil beides auseinanderfallen kann: die
-- Teamleitung traegt nachtraeglich fuer eine Kollegin ein. Ohne
-- Buchungsrecht fuer andere ist mitarbeiter_id immer gleich gebucht_von
-- (Service).
--
-- idempotenz_*: wie bei kassenbuchung (0062), damit die Stundenerfassung
-- unterwegs spaeter ueber dieselbe Warteschlange laufen kann. Je Mandant
-- eindeutig, nicht global, aus demselben Grund wie dort.
CREATE TABLE stundenbuchung (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id               uuid NOT NULL REFERENCES mandant(id),
  klient_id                uuid NOT NULL REFERENCES klient(id),
  mitarbeiter_id           uuid NOT NULL REFERENCES benutzer(id),
  datum                    date NOT NULL,
  minuten                  integer NOT NULL CHECK (minuten BETWEEN 1 AND 1440),
  leistungsart             text NOT NULL
    CHECK (leistungsart IN ('einzelbetreuung', 'gruppenangebot', 'begleitung', 'beratung', 'sonstiges')),
  notiz                    text,
  gebucht_von              uuid NOT NULL REFERENCES benutzer(id),
  erstellt_am              timestamptz NOT NULL DEFAULT now(),

  storniert                boolean NOT NULL DEFAULT false,
  storno_grund             text,
  storniert_von            uuid REFERENCES benutzer(id),
  storniert_am             timestamptz,

  idempotenz_schluessel    uuid,
  idempotenz_fingerabdruck text,

  CHECK (NOT storniert OR (storno_grund IS NOT NULL AND storniert_von IS NOT NULL AND storniert_am IS NOT NULL)),
  CHECK ((idempotenz_schluessel IS NULL) = (idempotenz_fingerabdruck IS NULL))
);

CREATE INDEX stundenbuchung_klient_datum_idx ON stundenbuchung (klient_id, datum);
CREATE INDEX stundenbuchung_mitarbeiter_datum_idx ON stundenbuchung (mitarbeiter_id, datum);

CREATE UNIQUE INDEX stundenbuchung_idempotenz_eindeutig
  ON stundenbuchung (mandant_id, idempotenz_schluessel)
  WHERE idempotenz_schluessel IS NOT NULL;

ALTER TABLE stundenbuchung ENABLE ROW LEVEL SECURITY;
ALTER TABLE stundenbuchung FORCE ROW LEVEL SECURITY;

CREATE POLICY stundenbuchung_isolation ON stundenbuchung
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- ALTER DEFAULT PRIVILEGES (0002) gibt der App-Rolle UPDATE/DELETE auf jede
-- neue Tabelle -- hier wieder entzogen, nur das Storno bleibt (CLAUDE.md
-- Regel 3 und 5).
REVOKE UPDATE, DELETE ON stundenbuchung FROM zimmerakte_app;
GRANT UPDATE (storniert, storno_grund, storniert_von, storniert_am) ON stundenbuchung TO zimmerakte_app;

-- Ein Storno ist endgueltig: eine stornierte Buchung wieder "aktiv" zu setzen
-- waere eine stille Korrektur, genau das soll die Tabelle verhindern. Der
-- CHECK oben sichert nur, dass ein Storno vollstaendig begruendet ist, nicht,
-- dass er nicht zurueckgenommen wird -- das kann nur ein Trigger, weil er
-- OLD und NEW vergleicht. Auch Grund, Urheber und Zeitpunkt eines
-- bestehenden Stornos bleiben damit unveraenderlich.
CREATE FUNCTION stundenbuchung_storno_endgueltig() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storniert THEN
    RAISE EXCEPTION 'stundenbuchung: eine stornierte Buchung kann nicht mehr geaendert werden'
      USING ERRCODE = 'ZA003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stundenbuchung_storno_endgueltig
  BEFORE UPDATE ON stundenbuchung
  FOR EACH ROW EXECUTE FUNCTION stundenbuchung_storno_endgueltig();

-- Neue Rechte der Registry (apps/api/src/rechte/registry.ts) sind ohne
-- Zeile ein impliziter Deny -- ohne diese Migration koennte nach dem Ausrollen
-- niemand ausser Vollzugriffs-Konten Stunden buchen, bis jemand die Matrix
-- pflegt. Deshalb bekommt jeder Account-Typ, der heute Tagesberichte sehen
-- bzw. anlegen darf, dasselbe fuer Stunden (gleiche Faehigkeit "ueber die
-- eigene Klientel dokumentieren", gleicher Scope), und wer Storno-Antraege im
-- Kassenbuch entscheiden darf (Leitungsebene), darf auch fremde Stundenbuchungen
-- stornieren und fuer andere Mitarbeitende buchen.
-- Die eigene Buchung stornieren darf die buchende Person immer (Service).
-- Mandanten koennen das danach in der Matrix frei aendern; ON CONFLICT
-- macht die Migration wiederholbar.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT r.mandant_id, r.account_typ_id, 'stunden', neu.aktion, r.scope, r.erlaubt
FROM account_typ_recht r
JOIN LATERAL (
  SELECT 'ansehen' AS aktion WHERE r.modul = 'tagesberichte' AND r.aktion = 'ansehen'
  UNION ALL SELECT 'buchen' WHERE r.modul = 'tagesberichte' AND r.aktion = 'anlegen'
  UNION ALL SELECT 'stornieren' WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
  UNION ALL SELECT 'fuer-andere-buchen' WHERE r.modul = 'kassenbuch' AND r.aktion = 'storno-entscheiden'
) neu ON true
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
