-- Unterschriften in Formularen (Rückmeldung d8e84954, Konzept
-- unterschriftenfeld, Entscheidungen von Dennis am 22.11.2026):
--
--   * Der Formular-Baustein "unterschriften" legt nur Plätze mit Rollen fest
--     (Teil der Formular-Definition, keine eigene Tabelle). Leere Plätze
--     werden im PDF als Linie zum Unterschreiben auf Papier gedruckt.
--   * Wer in der App unterschreibt, landet HIER: eine Zeile je Platz.
--   * Unterschrieben wird erst NACH dem Abschließen -- die Unterschrift
--     gehört zu einem festen Inhalt. inhalt_hash hält fest, welcher Stand
--     das war; eine spätere Korrektur (protokoll_aenderung) macht die
--     Unterschrift nicht ungültig, wird aber beim Lesen als "vor der
--     Änderung geleistet" angezeigt (abgeleitet, nicht gespeichert).
--   * Leitungsplätze unterschreibt nur die Leitung selbst, in der eigenen
--     Anmeldung. WER Leitung eines Standorts ist, steht im Organigramm und
--     wird im Service geprüft; die Datenbank sichert das, was sie ohne
--     Organigramm-Logik sichern kann: wer bei einer Selbst-Rolle
--     unterschreibt, ist auch die Person, die angemeldet war
--     (benutzer_id = erfasst_von), und die Rolle stimmt mit der Rolle des
--     Platzes in der Definition des Protokolls überein (Trigger unten).
--
-- Gleicher bewusster bytea-Kompromiss wie unterschrift (0012): die Bilder
-- sind wenige KB groß.
--
-- Nicht mitgelöscht bei der Anonymisierung einer Klient:in -- wie die
-- Unterschriften im Kassenbuch und die Werte der Protokolle selbst bleiben
-- sie als Nachweis Teil der Akte. Soll das anders sein, gehört eine eigene
-- Bereinigung in klient_daten_bei_anonymisierung() (0070), als neue Migration.
CREATE TABLE protokoll_unterschrift (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        uuid NOT NULL REFERENCES mandant(id),
  protokoll_id      uuid NOT NULL,
  -- Schlüssel des Unterschriften-Bausteins und Kennung des Platzes darin.
  baustein          text NOT NULL,
  platz             text NOT NULL,
  rolle             text NOT NULL
    CHECK (rolle IN ('klient', 'mitarbeiter', 'einrichtungsleitung', 'bereichsleitung', 'eigene')),
  -- Wer selbst unterschrieben hat (Mitarbeiter:in, Leitung). NULL bei
  -- Klient:in und eigener Rolle: die unterschreiben auf dem Gerät der
  -- Mitarbeiter:in, ohne eigenes Konto.
  benutzer_id       uuid REFERENCES benutzer(id),
  -- Wessen Anmeldung die Unterschrift aufgenommen hat.
  erfasst_von       uuid NOT NULL REFERENCES benutzer(id),
  -- Nur eigene Rolle: Name der unterschreibenden Person, wie eingetragen
  -- (z. B. gesetzliche Betreuung). Es gibt kein Konto, aus dem er sich
  -- beim Lesen ergeben könnte.
  name_frei         text CHECK (name_frei IS NULL OR length(name_frei) BETWEEN 1 AND 120),
  ort               text CHECK (ort IS NULL OR length(ort) BETWEEN 1 AND 80),
  bild              bytea NOT NULL CHECK (octet_length(bild) BETWEEN 1 AND 300000),
  bild_hash         text NOT NULL,   -- sha256, hex
  inhalt_hash       text NOT NULL,   -- sha256 der Werte beim Unterschreiben, hex
  unterschrieben_am timestamptz NOT NULL DEFAULT now(),

  UNIQUE (protokoll_id, baustein, platz),
  FOREIGN KEY (protokoll_id, mandant_id) REFERENCES protokoll (id, mandant_id),
  CHECK ((rolle IN ('klient', 'eigene')) = (benutzer_id IS NULL)),
  CHECK (benutzer_id IS NULL OR benutzer_id = erfasst_von),
  CHECK (name_frei IS NULL OR rolle = 'eigene')
);

CREATE INDEX protokoll_unterschrift_benutzer_idx ON protokoll_unterschrift (benutzer_id) WHERE benutzer_id IS NOT NULL;

ALTER TABLE protokoll_unterschrift ENABLE ROW LEVEL SECURITY;
ALTER TABLE protokoll_unterschrift FORCE ROW LEVEL SECURITY;
CREATE POLICY protokoll_unterschrift_isolation ON protokoll_unterschrift
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Einmal geleistet, nie geändert oder gelöscht (Regel 5). Eine falsche
-- Unterschrift lässt sich nicht "austauschen"; der Platz bleibt belegt.
REVOKE UPDATE, DELETE ON protokoll_unterschrift FROM zimmerakte_app;

-- Nur in ein abgeschlossenes Protokoll, und nur auf einen Platz, den es in
-- der Version dieses Protokolls mit genau dieser Rolle gibt. Ohne die
-- Rollenprüfung könnte ein Aufrufer einen Leitungsplatz als "klient"
-- einreichen und damit die Selbst-Unterschrift (CHECK oben) umgehen.
CREATE FUNCTION protokoll_unterschrift_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  def jsonb;
  abgeschlossen timestamptz;
BEGIN
  SELECT v.definition, p.abgeschlossen_am INTO def, abgeschlossen
  FROM protokoll p JOIN formular_version v ON v.id = p.formular_version_id
  WHERE p.id = NEW.protokoll_id;
  IF abgeschlossen IS NULL THEN
    RAISE EXCEPTION 'Unterschrieben wird erst nach dem Abschließen.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT jsonb_path_exists(
       def,
       'lax $.** ? (@.typ == "unterschriften" && @.schluessel == $b).plaetze[*] ? (@.id == $p && @.rolle == $r)',
       jsonb_build_object('b', NEW.baustein, 'p', NEW.platz, 'r', NEW.rolle)
     ) THEN
    RAISE EXCEPTION 'Diesen Unterschriftsplatz gibt es in diesem Formular nicht.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protokoll_unterschrift_pruefen
  BEFORE INSERT ON protokoll_unterschrift
  FOR EACH ROW EXECUTE FUNCTION protokoll_unterschrift_pruefen();
