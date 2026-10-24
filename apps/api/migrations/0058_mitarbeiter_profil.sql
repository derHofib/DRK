-- Mitarbeiter-Profil: dienstliche Kontaktangaben, die die Person selbst pflegt
-- und je Feld fuer Klient:innen freigeben kann -- getrennt fuer "zugeordnete"
-- (Bezugsbetreuung) und alle anderen, die die Person ueberhaupt sehen koennen.
-- Mitarbeitende sehen untereinander alles (Lesen = Mandant), Schreiben darf nur
-- die Person selbst.
--
-- Privat als Voreinstellung: jede Freigabe ist DEFAULT false. Ein neues oder nie
-- bearbeitetes Profil zeigt Klient:innen nichts -- wer etwas teilen will, muss es
-- ausdruecklich einschalten (Datenminimierung, Art. 25 DSGVO).
--
-- Die Sichtbarkeit fuer Klient:innen wird NICHT im Service gefiltert, sondern in
-- der Funktion mitarbeiter_profil_fuer_klient(): Klient-Sitzungen haben auf die
-- Tabelle selbst keinen Lesezugriff (Policy), die Funktion liefert pro Feld
-- entweder den Wert oder NULL. Ein Fehler im Service kann damit kein verstecktes
-- Feld herausgeben (CLAUDE.md: Regeln gehoeren in die Datenbank, nicht in den Code).

CREATE TABLE mitarbeiter_profil (
  benutzer_id           uuid PRIMARY KEY REFERENCES benutzer(id),
  mandant_id            uuid NOT NULL REFERENCES mandant(id),

  telefon               text CHECK (telefon IS NULL OR length(telefon) BETWEEN 1 AND 40),
  bevorzugte_kontaktart text CHECK (bevorzugte_kontaktart IN ('telefon', 'chat', 'email')),
  erreichbarkeit        text CHECK (erreichbarkeit IS NULL OR length(erreichbarkeit) BETWEEN 1 AND 200),
  email_dienstlich      text CHECK (email_dienstlich IS NULL OR length(email_dienstlich) BETWEEN 3 AND 200),
  ueber_mich            text CHECK (ueber_mich IS NULL OR length(ueber_mich) BETWEEN 1 AND 1000),

  -- Freigaben in vier Gruppen (Kontaktart und Erreichbarkeit gehoeren zusammen).
  telefon_zugeordnet    boolean NOT NULL DEFAULT false,
  telefon_andere        boolean NOT NULL DEFAULT false,
  kontakt_zugeordnet    boolean NOT NULL DEFAULT false,
  kontakt_andere        boolean NOT NULL DEFAULT false,
  email_zugeordnet      boolean NOT NULL DEFAULT false,
  email_andere          boolean NOT NULL DEFAULT false,
  ueber_zugeordnet      boolean NOT NULL DEFAULT false,
  ueber_andere          boolean NOT NULL DEFAULT false,

  geaendert_am          timestamptz NOT NULL DEFAULT now(),

  -- Was alle sehen duerfen, sehen die Zugeordneten erst recht -- alles andere
  -- waere ein Profil, das Fremden mehr zeigt als der eigenen Bezugsbetreuung
  -- und sich nicht sinnvoll erklaeren laesst.
  CHECK (NOT telefon_andere OR telefon_zugeordnet),
  CHECK (NOT kontakt_andere OR kontakt_zugeordnet),
  CHECK (NOT email_andere OR email_zugeordnet),
  CHECK (NOT ueber_andere OR ueber_zugeordnet)
);

COMMENT ON TABLE mitarbeiter_profil IS
  'Selbstgepflegtes Profil (Kontaktangaben) mit Freigabe je Feld fuer zugeordnete und uebrige Klient:innen. Voreinstellung: nichts freigegeben.';

ALTER TABLE mitarbeiter_profil ENABLE ROW LEVEL SECURITY;
ALTER TABLE mitarbeiter_profil FORCE ROW LEVEL SECURITY;

-- Lesen: nur Mitarbeitenden-Sitzungen (app.klient_id leer) im eigenen Mandanten.
-- Klient-Sitzungen gehen ausschliesslich ueber mitarbeiter_profil_fuer_klient().
CREATE POLICY mitarbeiter_profil_lesen ON mitarbeiter_profil FOR SELECT
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND NULLIF(current_setting('app.klient_id', true), '') IS NULL
  );

-- Schreiben: nur die eigene Zeile. Auch Vollzugriff aendert fremde Profile nicht.
CREATE POLICY mitarbeiter_profil_anlegen ON mitarbeiter_profil FOR INSERT
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
    AND NULLIF(current_setting('app.klient_id', true), '') IS NULL
  );

CREATE POLICY mitarbeiter_profil_aendern ON mitarbeiter_profil FOR UPDATE
  USING (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
    AND NULLIF(current_setting('app.klient_id', true), '') IS NULL
  )
  WITH CHECK (
    mandant_id = current_setting('app.mandant_id', true)::uuid
    AND benutzer_id = NULLIF(current_setting('app.benutzer_id', true), '')::uuid
  );

-- Spaltenscharf (CLAUDE.md Regel 3): benutzer_id und mandant_id bleiben fest.
-- Kein DELETE -- Inhalte leert man, die Zeile bleibt.
REVOKE UPDATE, DELETE ON mitarbeiter_profil FROM zimmerakte_app;
GRANT UPDATE (
  telefon, bevorzugte_kontaktart, erreichbarkeit, email_dienstlich, ueber_mich,
  telefon_zugeordnet, telefon_andere, kontakt_zugeordnet, kontakt_andere,
  email_zugeordnet, email_andere, ueber_zugeordnet, ueber_andere, geaendert_am
) ON mitarbeiter_profil TO zimmerakte_app;

-- Das Profil, wie eine Klient-Sitzung es sehen darf. Liefert nur etwas, wenn
--  (1) die Sitzung zu einer aktiven Klient:in dieses Mandanten gehoert,
--  (2) die Mitarbeiter:in aktiv ist und
--  (3) die Klient:in sie ohnehin sehen kann: als Ziel einer Chat-Anfrage
--      (Bezugsbetreuung, Team des aktuellen Standorts) oder als Teilnehmer:in
--      eines gemeinsamen Chats. Das Profil schafft so keinen neuen Personenkreis.
-- "zugeordnet" heisst: die Mitarbeiter:in ist Bezugsbetreuung dieser Klient:in.
-- Nicht freigegebene Felder kommen als NULL -- ohne Unterschied zu "nie ausgefuellt".
CREATE FUNCTION mitarbeiter_profil_fuer_klient(p_benutzer_id uuid)
RETURNS TABLE (
  name                  text,
  zugeordnet            boolean,
  telefon               text,
  bevorzugte_kontaktart text,
  erreichbarkeit        text,
  email_dienstlich      text,
  ueber_mich            text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH k AS (
    SELECT kl.id
    FROM klient kl
    JOIN klient_zugang kz ON kz.klient_id = kl.id AND kz.aktiv
    WHERE kl.id = NULLIF(current_setting('app.klient_id', true), '')::uuid
      AND kl.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
      AND kl.archiviert_am IS NULL AND kl.anonymisiert_am IS NULL
  ),
  im_kreis AS (
    SELECT 1 FROM k JOIN chat_anfrage_ziele(k.id) z ON z.benutzer_id = p_benutzer_id
    UNION ALL
    SELECT 1
    FROM k
    JOIN chat_teilnehmer ck ON ck.klient_id = k.id AND ck.verlassen_am IS NULL
    JOIN chat_teilnehmer cb ON cb.chat_id = ck.chat_id AND cb.benutzer_id = p_benutzer_id AND cb.verlassen_am IS NULL
  ),
  zu AS (
    SELECT EXISTS (
      SELECT 1 FROM k JOIN klient_stammdaten ks ON ks.klient_id = k.id
      WHERE ks.bezugsbetreuer_id = p_benutzer_id
    ) AS ist_zugeordnet
  )
  SELECT
    b.name,
    zu.ist_zugeordnet,
    CASE WHEN CASE WHEN zu.ist_zugeordnet THEN p.telefon_zugeordnet ELSE p.telefon_andere END THEN p.telefon END,
    CASE WHEN CASE WHEN zu.ist_zugeordnet THEN p.kontakt_zugeordnet ELSE p.kontakt_andere END THEN p.bevorzugte_kontaktart END,
    CASE WHEN CASE WHEN zu.ist_zugeordnet THEN p.kontakt_zugeordnet ELSE p.kontakt_andere END THEN p.erreichbarkeit END,
    CASE WHEN CASE WHEN zu.ist_zugeordnet THEN p.email_zugeordnet ELSE p.email_andere END THEN p.email_dienstlich END,
    CASE WHEN CASE WHEN zu.ist_zugeordnet THEN p.ueber_zugeordnet ELSE p.ueber_andere END THEN p.ueber_mich END
  FROM benutzer b
  CROSS JOIN zu
  LEFT JOIN mitarbeiter_profil p ON p.benutzer_id = b.id
  WHERE b.id = p_benutzer_id
    AND b.aktiv
    AND b.mandant_id = NULLIF(current_setting('app.mandant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM im_kreis);
$$;

REVOKE ALL ON FUNCTION mitarbeiter_profil_fuer_klient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mitarbeiter_profil_fuer_klient(uuid) TO zimmerakte_app;
