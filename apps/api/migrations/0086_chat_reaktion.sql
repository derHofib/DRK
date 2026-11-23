-- Reaktionen auf Chatnachrichten (Rueckmeldung 119c5897, Konzept in
-- chat-reaktionen/konzept-chat-reaktionen.md, freigegeben 22.11.2026).
--
-- Gespeichert wird nur der AKTUELLE Stand: wer, welches Zeichen, wann. Es gibt
-- keinen Verlauf "wer hat wann was angeklickt" -- Zuruecknehmen loescht die
-- Zeile wirklich, eine andere Reaktion ersetzt sie (DELETE + INSERT im
-- Service). Darum gibt es auch kein UPDATE-Recht: eine Reaktion ist so klein,
-- dass "aendern" und "neu" dasselbe sind, und ohne UPDATE gibt es keine
-- Spalte, die an der Policy vorbei wandern koennte.
--
-- Eine Reaktion pro Person und Nachricht (Entscheidung im Konzept, Frage 2):
-- durchgesetzt per Unique-Index, nicht per Pruefung im Service.
--
-- Reaktionen leben nie laenger als die Nachricht, auf die sie zeigen:
--   * Loeschfrist (0061) und Anonymisierung (0061 Teil B) loeschen
--     Nachrichten per DELETE -> ON DELETE CASCADE.
--   * Die Absender:in loescht ihre Nachricht weich (geloescht_am) und darf
--     fremde Reaktionen nach RLS nicht anfassen -> Trigger unten, SECURITY
--     DEFINER, in derselben Transaktion.
--   * Wer anonymisiert wird, verliert auch seine Reaktionen auf Nachrichten
--     ANDERER in Gruppen (die Nachrichten selbst bleiben dort, siehe 0061) --
--     Art. 17 DSGVO endet nicht an der Tabellengrenze.
--
-- Eine Reaktion zaehlt nicht als ungelesen und schiebt den Chat nicht nach
-- oben: das ergibt sich daraus, dass beides nur aus chat_nachricht abgeleitet
-- wird (Regel 4) -- diese Tabelle taucht dort bewusst nicht auf.

-- Zusammengesetzter FK (Regel 1): die Nachricht muss zum selben Traeger gehoeren.
ALTER TABLE chat_nachricht ADD CONSTRAINT chat_nachricht_id_mandant_uq UNIQUE (id, mandant_id);

CREATE TABLE chat_reaktion (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  nachricht_id uuid NOT NULL,
  benutzer_id  uuid,
  klient_id    uuid,
  -- Die eigentliche Pruefung "genau EIN Emoji" macht der Controller
  -- (Unicode-Eigenschaft RGI_Emoji, die Postgres nicht kennt). Hier steht die
  -- Rueckfallgrenze, die auch an der Anwendung vorbei gilt: kurz, ohne
  -- Buchstaben, Ziffern, Leerraum oder Spitzklammern -- ueber diesen Weg laesst
  -- sich kein freier Text in einen Chat schreiben. Ziffern schliessen die
  -- Tasten-Emojis (1️⃣) aus; das ist bewusst in Kauf genommen.
  zeichen      text NOT NULL CHECK (
    char_length(zeichen) BETWEEN 1 AND 16
    AND zeichen !~ '[[:alnum:][:space:]<>]'
  ),
  erstellt_am  timestamptz NOT NULL DEFAULT clock_timestamp(),

  FOREIGN KEY (nachricht_id, mandant_id) REFERENCES chat_nachricht (id, mandant_id) ON DELETE CASCADE,
  FOREIGN KEY (benutzer_id, mandant_id) REFERENCES benutzer (id, mandant_id),
  FOREIGN KEY (klient_id, mandant_id) REFERENCES klient (id, mandant_id),
  CHECK (num_nonnulls(benutzer_id, klient_id) = 1)
);

CREATE UNIQUE INDEX chat_reaktion_benutzer_uq ON chat_reaktion (nachricht_id, benutzer_id) WHERE benutzer_id IS NOT NULL;
CREATE UNIQUE INDEX chat_reaktion_klient_uq ON chat_reaktion (nachricht_id, klient_id) WHERE klient_id IS NOT NULL;
CREATE INDEX chat_reaktion_klient_idx ON chat_reaktion (klient_id) WHERE klient_id IS NOT NULL;

ALTER TABLE chat_reaktion ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reaktion FORCE ROW LEVEL SECURITY;

-- Lesen: wer die Nachricht sieht (aktive:r Teilnehmer:in, 0055) -- auch die
-- Leitung sieht keine Reaktionen in fremden Chats.
CREATE POLICY chat_reaktion_lesen ON chat_reaktion FOR SELECT
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid AND chat_nachricht_sichtbar(nachricht_id));

-- Reagieren: nur als man selbst und nur auf eine sichtbare, nicht geloeschte
-- Nachricht, die keine Systemmeldung ist. Die Unterabfrage laeuft unter der
-- RLS von chat_nachricht und prueft damit die Teilnahme gleich mit.
CREATE POLICY chat_reaktion_setzen ON chat_reaktion FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND (
      benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
    AND EXISTS (
      SELECT 1 FROM chat_nachricht m
      WHERE m.id = chat_reaktion.nachricht_id AND m.geloescht_am IS NULL AND m.art <> 'system'
    )
  );

-- Zuruecknehmen: nur die eigene, und nur solange man noch im Chat ist. Wer
-- den Chat verlassen hat, dessen Reaktionen bleiben stehen wie seine
-- Nachrichten.
CREATE POLICY chat_reaktion_entfernen ON chat_reaktion FOR DELETE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND chat_nachricht_sichtbar(nachricht_id)
    AND (
      benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
      OR klient_id = NULLIF(current_setting('app.klient_id', true), '')::uuid
    )
  );

REVOKE UPDATE ON chat_reaktion FROM zimmerakte_app;

-- Weich geloeschte Nachricht -> Reaktionen weg. SECURITY DEFINER, weil die
-- Absender:in fremde Reaktionen nach RLS nicht loeschen darf; die Funktion
-- nimmt nur die ID der gerade geloeschten Zeile.
CREATE FUNCTION chat_reaktion_bei_nachricht_loeschen() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.geloescht_am IS NOT NULL AND OLD.geloescht_am IS NULL THEN
    DELETE FROM chat_reaktion WHERE nachricht_id = NEW.id AND mandant_id = NEW.mandant_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER chat_reaktion_bei_nachricht_loeschen
  AFTER UPDATE OF geloescht_am ON chat_nachricht
  FOR EACH ROW EXECUTE FUNCTION chat_reaktion_bei_nachricht_loeschen();

-- Anonymisierung: eigener Trigger statt Aenderung von chat_bei_anonymisierung()
-- (0061) -- Migrationen werden nie nachtraeglich geaendert, und so bleibt
-- jede Bereinigung an der Stelle, die ihre Tabelle einfuehrt.
CREATE FUNCTION chat_reaktion_bei_anonymisierung() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.anonymisiert_am IS NOT NULL AND OLD.anonymisiert_am IS NULL THEN
    DELETE FROM chat_reaktion WHERE klient_id = NEW.id AND mandant_id = NEW.mandant_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_reaktion_bei_anonymisierung
  AFTER UPDATE OF anonymisiert_am ON klient
  FOR EACH ROW EXECUTE FUNCTION chat_reaktion_bei_anonymisierung();

-- Echtzeit-Signal wie 0055: ohne Inhalt, nur "an Nachricht X in Chat Y hat
-- sich eine Reaktion geaendert". Der Client laedt danach genau diese
-- Nachricht per REST (unter RLS) -- auch wenn sie weiter oben im Verlauf
-- liegt als die zuletzt geladene Seite.
--
-- Den Chat schlaegt die Funktion an der Nachricht nach (SECURITY DEFINER,
-- nur ueber die ID der eigenen Zeile). Gibt es die Nachricht nicht mehr
-- (CASCADE aus Loeschfrist oder Anonymisierung), faellt das Signal weg --
-- das Loeschen selbst meldet sich dann bereits als Nachrichten-Ereignis bzw.
-- betrifft niemanden mehr.
CREATE FUNCTION chat_reaktion_melden() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  zeile chat_reaktion := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_chat uuid;
BEGIN
  SELECT m.chat_id INTO v_chat FROM chat_nachricht m WHERE m.id = zeile.nachricht_id AND m.mandant_id = zeile.mandant_id;
  IF v_chat IS NOT NULL THEN
    PERFORM pg_notify(
      'chat_ereignis',
      json_build_object('mandant_id', zeile.mandant_id, 'chat_id', v_chat, 'art', 'reaktion', 'nachricht_id', zeile.nachricht_id)::text
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER chat_reaktion_melden
  AFTER INSERT OR DELETE ON chat_reaktion
  FOR EACH ROW EXECUTE FUNCTION chat_reaktion_melden();

