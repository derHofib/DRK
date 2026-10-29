-- Zwei kleine Schemaschritte fuer "ein Rang je Person, Standorte an der
-- Besetzung" (Fortsetzung von 0066).
--
-- 1) org_position.ist_sammelrang: eine Position, die ein ganzer Rang fuer
-- viele Personen ist (z. B. "Mitarbeiter"). Ihre Heimat-Einheit (der
-- Traeger) ist nur ein Platzhalter im Baum und darf NICHT als Rechte-Anker
-- zaehlen: ein Scope wie "subtree" wuerde sonst vom Traeger aus den ganzen
-- Mandanten treffen, obwohl die Person nur an zwei Haeusern arbeitet. Bei
-- einer Sammelposition kommen die Anker deshalb ausschliesslich aus den
-- Einheiten der einzelnen Besetzung (org_position_besetzung_einheit). Hat
-- eine Besetzung keine, gilt kein einheitsbezogener Scope: fail closed
-- statt fail open.
ALTER TABLE org_position ADD COLUMN ist_sammelrang boolean NOT NULL DEFAULT false;

-- Positionen, die schon mit dem Stand aus 0066 am Traeger angelegt wurden und
-- ihre Standorte ausschliesslich ueber Besetzungs-Einheiten bekamen, sind
-- Sammelraenge. Alles andere (Geschaeftsfuehrung am Traeger ohne solche
-- Zeilen) bleibt unveraendert.
UPDATE org_position p SET ist_sammelrang = true
WHERE EXISTS (SELECT 1 FROM org_unit u WHERE u.id = p.org_unit_id AND u.typ = 'traeger')
  AND EXISTS (
    SELECT 1 FROM org_position_besetzung b
    JOIN org_position_besetzung_einheit e ON e.besetzung_id = b.id
    WHERE b.position_id = p.id
  );

-- 2) Sollzahl optional. Der Default 1 war fuer Einzelstellen richtig, fuer
-- einen Sammelrang mit beliebig vielen Personen aber ein Platzhalter, der
-- "Besetzt 3/1" haette suggerieren muessen. NULL = keine feste Sollzahl; der
-- Default 1 bleibt fuer Einzelstellen, die ohne Angabe angelegt werden.
ALTER TABLE org_position ALTER COLUMN soll_besetzung DROP NOT NULL;
