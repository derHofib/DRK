-- Storno eines Kassenbucheintrags wird zum Bewilligungsvorgang: bislang
-- durfte nur Bereichs-/Einrichtungsleitung sofort stornieren, ein Betreuer
-- gar nicht. Jetzt stellt JEDE Rolle einen Antrag; bei Bereichs- oder
-- Einrichtungsleitung wird er im selben Zug automatisch bewilligt (siehe
-- kassenbuchung.service.ts, stornoBeantragen()), bei einem Betreuer bleibt
-- er offen, bis eine Leitung entscheidet. Der eigentliche Storno (das
-- Setzen von kassenbuchung.storniert, siehe Migration 0011) passiert erst
-- bei der Bewilligung -- diese Tabelle haelt nur den Antrag/die Entscheidung
-- fest, nicht die Buchung selbst.
--
-- Bewusst KEINE eigene append-only Statuswechsel-Historie wie bei
-- rechnung_statuswechsel (0014): ein Storno-Antrag hat nur einen einzigen
-- Uebergang (beantragt -> genehmigt ODER beantragt -> abgelehnt), keine
-- Mehrfach-Stufen-Kette wie eine Rechnung (beantragt -> genehmigt ->
-- ausgezahlt). Dasselbe "ein Flag darf genau einmal in eine Richtung
-- kippen"-Muster wie kassenbuchung.storniert selbst reicht hier aus --
-- spaltenscharfes GRANT statt Trigger, siehe unten.
CREATE TYPE kassenbuchung_storno_status AS ENUM ('beantragt', 'genehmigt', 'abgelehnt');

CREATE TABLE kassenbuchung_stornoantrag (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  kassenbuchung_id  uuid NOT NULL REFERENCES kassenbuchung(id),
  grund             text NOT NULL,
  status            kassenbuchung_storno_status NOT NULL DEFAULT 'beantragt',
  beantragt_von     uuid NOT NULL REFERENCES benutzer(id),
  beantragt_am      timestamptz NOT NULL DEFAULT now(),
  ablehnung_grund   text,
  entschieden_von   uuid REFERENCES benutzer(id),
  entschieden_am    timestamptz,

  CHECK (status <> 'beantragt' OR (entschieden_von IS NULL AND entschieden_am IS NULL AND ablehnung_grund IS NULL)),
  CHECK (status <> 'genehmigt' OR (entschieden_von IS NOT NULL AND entschieden_am IS NOT NULL)),
  CHECK (status <> 'abgelehnt' OR (ablehnung_grund IS NOT NULL AND entschieden_von IS NOT NULL AND entschieden_am IS NOT NULL))
);

-- Nur EIN offener Antrag je Buchung gleichzeitig -- sonst koennten zwei
-- Antraege um dieselbe Buchung konkurrieren, und eine zweite Bewilligung
-- liefe entweder ins Leere (Buchung schon storniert) oder auf einen
-- laengst veralteten Antrag. Nach einer Ablehnung darf erneut beantragt
-- werden (der abgelehnte Antrag bleibt als Zeile stehen, ist aber nicht
-- mehr "beantragt" und faellt damit aus diesem Index).
CREATE UNIQUE INDEX kassenbuchung_stornoantrag_offen_je_buchung
  ON kassenbuchung_stornoantrag (kassenbuchung_id) WHERE status = 'beantragt';

CREATE INDEX kassenbuchung_stornoantrag_buchung_idx ON kassenbuchung_stornoantrag (kassenbuchung_id);

ALTER TABLE kassenbuchung_stornoantrag ENABLE ROW LEVEL SECURITY;
ALTER TABLE kassenbuchung_stornoantrag FORCE ROW LEVEL SECURITY;

CREATE POLICY kassenbuchung_stornoantrag_isolation ON kassenbuchung_stornoantrag
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Wie kassenbuchung.storniert (0011): der Antrag selbst (grund,
-- beantragt_von/-am) ist nach dem Anlegen unveraendrbar, nur die
-- Entscheidung darf EINMAL nachgetragen werden. Der Service erzwingt
-- zusaetzlich "WHERE status = 'beantragt'" bei diesem UPDATE, damit ein
-- bereits entschiedener Antrag nicht ein zweites Mal umgebogen werden kann.
REVOKE UPDATE, DELETE ON kassenbuchung_stornoantrag FROM zimmerakte_app;
GRANT UPDATE (status, ablehnung_grund, entschieden_von, entschieden_am) ON kassenbuchung_stornoantrag TO zimmerakte_app;
