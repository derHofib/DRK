-- Fest bestimmte, aber vom Traeger EINSTELLBARE Grundfarbe fuer den
-- dunklen Modus -- bisher lief der Hintergrund/die Flaechen im
-- Dunkelmodus ungewollt am Farbton der Akzentfarbe mit (tokens.css nutzte
-- --zv-accent-h auch fuer --zv-bg/--zv-surface/... im Dunkelmodus). Im
-- hellen Modus ist --zv-bg dagegen reines Weiss, unabhaengig vom Akzent --
-- diese Spalte stellt dieselbe Unabhaengigkeit fuer den dunklen Modus her.
--
-- Bewusst wieder EIN Hex-Wert, keine gespeicherte Tonleiter -- exakt
-- dieselbe Begruendung wie bei akzentfarbe (Migration 0019): die
-- Tonleiter (bg/surface/surface-2/surface-3/border/border-strong) wird im
-- Frontend aus Farbton und Buntheit dieses einen Wertes abgeleitet, siehe
-- apps/web/src/theme/farbe.ts::grundfarbeAbleiten().
--
-- #10131a ist bewusst gewaehlt: seine Helligkeit (L=0.187, nachgerechnet)
-- liegt fast exakt auf dem bisherigen fest verdrahteten Dunkelmodus-
-- Hintergrund (L=0.185). Der Umstieg auf "einstellbar" aendert damit fuer
-- alle bestehenden Mandanten (die diesen Default erben) so gut wie nichts
-- sichtbar -- ausser dass der Farbton jetzt fest und vom Akzent entkoppelt
-- ist, statt bei jeder Akzentaenderung mitzuwandern.
ALTER TABLE mandant
  ADD COLUMN dunkel_grundfarbe text NOT NULL DEFAULT '#10131a'
  CHECK (dunkel_grundfarbe ~ '^#[0-9a-f]{6}$');

COMMENT ON COLUMN mandant.dunkel_grundfarbe IS
  'Grundfarbe (Hintergrund/Flaechen) im dunklen Design als sRGB-Hex, immer kleingeschrieben (siehe CHECK). '
  'Kein Personenbezug -- reines Erscheinungsbild, gilt fuer alle Mitarbeitenden. Unabhaengig von akzentfarbe.';

-- REVOKE UPDATE ON mandant FROM zimmerakte_app galt bereits seit Migration
-- 0019 fuer die gesamte Tabelle -- hier kommt nur die neue Spalte zu den
-- bereits erlaubten (akzentfarbe) hinzu. Ein erneutes REVOKE waere sogar
-- falsch: es wuerde das bestehende GRANT UPDATE (akzentfarbe) ebenfalls
-- entziehen.
GRANT UPDATE (dunkel_grundfarbe) ON mandant TO zimmerakte_app;

-- Kein zusaetzliches WITH CHECK noetig: mandant_isolation (0003) hat nur
-- eine USING-Klausel, und die verwendet PostgreSQL bei UPDATE automatisch
-- auch als WITH CHECK.
