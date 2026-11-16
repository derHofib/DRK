-- Lesezugriffe auf Klientenakten werden im bestehenden audit_log (0044)
-- protokolliert -- keine neue Tabelle, denn audit_log ist schon
-- mandantengetrennt (RLS + FORCE) und unveraenderlich (REVOKE UPDATE,
-- DELETE). Eine zweite Tabelle haette dieselben Garantien doppelt
-- durchsetzen muessen.
--
-- Warum ueberhaupt: Sozialdaten nach SGB X / Art. 9 DSGVO -- bei einer
-- Amtsnachfrage oder einem Verdacht auf unbefugte Einsicht muss
-- nachvollziehbar sein, WER eine Akte WANN geoeffnet hat, nicht nur, wer
-- sie geaendert hat.
--
-- Eintraege: modul='klienten', objekt_typ='klient', aktion
-- 'akte_geoeffnet' bzw. 'archiv_pdf_geladen'.

-- Die Auswertung fragt immer "nur Lesezugriffe, neueste zuerst" -- ohne
-- diesen Index muesste sie bei einem grossen audit_log alle
-- Strukturaenderungen mitdurchsuchen.
CREATE INDEX audit_log_klienten_zugriff_idx
  ON audit_log (mandant_id, erstellt_am DESC)
  WHERE modul = 'klienten' AND aktion IN ('akte_geoeffnet', 'archiv_pdf_geladen');

-- Neues, sensibles Recht klienten.zugriffsprotokoll (registry.ts). Bestehende
-- Mandanten haben die Registry-Zeile nicht, ein fehlendes Recht ist ein
-- impliziter Deny -- ohne diese Zeile kaeme ausser der Geschaeftsfuehrung
-- (Vollzugriff) niemand an die Auswertung. Vergeben wird es dort, wo schon
-- heute das Recht zum Anonymisieren liegt (Leitungsebene); wer es sonst
-- bekommen soll, entscheidet der Traeger in der Account-Typ-Verwaltung.
INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
SELECT mandant_id, account_typ_id, 'klienten', 'zugriffsprotokoll', scope, true
FROM account_typ_recht
WHERE modul = 'klienten' AND aktion = 'anonymisieren' AND erlaubt
ON CONFLICT (account_typ_id, modul, aktion) DO NOTHING;
