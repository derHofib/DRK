-- Der Mandant ist die Wurzel der Trennung. Jede fachliche Tabelle ab hier
-- bekommt eine mandant_id-Spalte und eine RLS-Policy, die genau diese Spalte
-- gegen den Sitzungskontext prueft.
--
-- slug identifiziert den Mandanten vor dem Login (z.B. per Subdomain oder im
-- Login-Formular) -- an dem Punkt ist app.mandant_id noch nicht gesetzt,
-- die Aufloesung "welcher Mandant" muss also ohne RLS-Kontext moeglich sein.
-- Siehe auth/auth.service.ts fuer die einzige Stelle, die dafuer bewusst
-- die administrative Verbindung statt der App-Rolle nutzt.
CREATE TABLE mandant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  aktiv       boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mandant IS
  'Traeger (z.B. ein DRK-Kreisverband). Rechtlich der Verantwortliche im Sinne der DSGVO.';

ALTER TABLE mandant ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandant FORCE ROW LEVEL SECURITY;

-- Ein Mandant sieht nur seine eigene Zeile -- auch der Eigenname/die eigenen
-- Stammdaten sind kein globales Nachschlagewerk fuer die App-Rolle.
CREATE POLICY mandant_isolation ON mandant
  USING (id = current_setting('app.mandant_id', true)::uuid);
