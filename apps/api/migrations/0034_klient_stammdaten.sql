-- Erweiterte Klienten-Stammdaten (aus dem Aufnahme-Datenblatt) und
-- Kontakte. Wie klient selbst: besondere Kategorie personenbezogener
-- Daten (Art. 9 DSGVO) -- Gesundheitsangaben (Medikamente, Diagnosen,
-- Allergien, Besonderheiten) sind hier sogar nochmal eine Stufe
-- sensibler, bleiben aber bewusst genauso lesbar wie der Rest der
-- Übersicht (siehe Projektentscheidung: keine gesonderte Rollensperre --
-- wer den Klienten sehen darf, sieht auch diese Felder, weil Betreuer:innen
-- sie im Alltag brauchen).
--
-- "Zuständiges Jugendamt (Name)" aus dem Datenblatt ist inhaltlich
-- dasselbe wie das bereits bestehende klient.amt (siehe 0008_klient.sql)
-- -- hier stehen deshalb nur die zusätzlichen Detailfelder (Adresse,
-- Sachbearbeiter*in, Stellenzeichen, Telefon, E-Mail), kein zweites
-- Namensfeld.
--
-- 1:1 zu klient (UNIQUE auf klient_id), eigene Tabelle statt weiterer
-- Spalten auf klient: klient selbst bleibt die schlanke, streng
-- geschützte Kern-Identität (siehe die spaltenscharfen GRANTs in
-- 0027_klient_anonymisierung.sql), diese Tabelle ist das frei
-- bearbeitbare erweiterte Profil.
CREATE TABLE klient_stammdaten (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id                          uuid NOT NULL REFERENCES mandant(id),
  klient_id                           uuid NOT NULL UNIQUE REFERENCES klient(id),

  -- Schnelle Informationen
  geburtsort                          text,
  nationalitaet                       text,
  sorgeberechtigt                     text,
  bezugsbetreuer_id                   uuid REFERENCES benutzer(id),
  betreuungsstunden                   text,
  telefon                             text,
  sprachen                            text,
  anmerkungen                         text,

  -- Weitere Informationen
  personaldokumente                   text,
  bankkonto                           text,
  iban                                text,

  -- Kontakt / Betreuung
  jugendamt_adresse                   text,
  jugendamt_sachbearbeiter            text,
  jugendamt_stellenzeichen            text,
  jugendamt_telefon                   text,
  jugendamt_email                     text,
  wjh_name                            text,
  wjh_telefon                         text,
  wjh_email                           text,
  personensorgeberechtigte            text,
  besuchskontakte                     text,

  -- Gesundheit
  krankenkasse                        text,
  versichertennummer                  text,
  medikamente                         text,
  diagnosen                           text,
  allergien                           text,
  besonderheiten_gesundheitlich       text,
  besonderheiten_psychisch            text,

  -- Bildung / Ausbildung
  schule                              text,
  klassenstufe                        text,
  schulabschluesse                    text,
  foerderbedarfe                      text,

  -- Vorherige Einrichtung / Unterbringung
  vorherige_einrichtung_traeger       text,
  vorherige_einrichtung_kontakt       text,
  vorherige_einrichtung_anfrage_am    date,
  vorherige_einrichtung_einzug_am     date,
  vorherige_einrichtung_auszug_am     date,

  aktualisiert_am                     timestamptz NOT NULL DEFAULT now(),
  aktualisiert_von                    uuid REFERENCES benutzer(id)
);

COMMENT ON TABLE klient_stammdaten IS
  'Erweitertes Klientenprofil aus dem Aufnahme-Datenblatt, 1:1 zu klient. Besondere Kategorie personenbezogener Daten (Art. 9 DSGVO).';

ALTER TABLE klient_stammdaten ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_stammdaten FORCE ROW LEVEL SECURITY;

CREATE POLICY klient_stammdaten_isolation ON klient_stammdaten
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);

-- Aufnahmedatum/Entlassungsdatum aus dem Datenblatt werden bewusst NICHT
-- gespeichert -- sie ergeben sich aus den bestehenden Belegungen
-- (frühester Einzug / spätester Auszug), gleiches Prinzip wie beim
-- Zimmerstatus (siehe CLAUDE.md, "Zustände werden abgeleitet, nicht
-- gespeichert").

-- Kontakte: bewusst 1:n, beliebig viele Datensätze je Klient (Eltern,
-- Anwalt, Pflegefamilie, ...) -- im Datenblatt vier identische, leere
-- Blöcke ohne Beschriftung, hier deshalb ein zusätzliches freies Feld
-- "beziehung", damit erkennbar bleibt, wer das ist.
CREATE TABLE klient_kontakt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   uuid NOT NULL REFERENCES mandant(id),
  klient_id    uuid NOT NULL REFERENCES klient(id),
  beziehung    text,
  name         text NOT NULL,
  adresse      text,
  email        text,
  telefon      text,
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  erstellt_von uuid REFERENCES benutzer(id)
);

COMMENT ON TABLE klient_kontakt IS
  'Kontaktpersonen eines Klienten (Eltern, Anwalt, Pflegefamilie, ...), 1:n. Besondere Kategorie personenbezogener Daten (Art. 9 DSGVO) -- betrifft auch personenbezogene Daten Dritter.';

CREATE INDEX klient_kontakt_klient_idx ON klient_kontakt (klient_id);

ALTER TABLE klient_kontakt ENABLE ROW LEVEL SECURITY;
ALTER TABLE klient_kontakt FORCE ROW LEVEL SECURITY;

CREATE POLICY klient_kontakt_isolation ON klient_kontakt
  USING (mandant_id = current_setting('app.mandant_id', true)::uuid);
