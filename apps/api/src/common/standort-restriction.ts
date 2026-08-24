import { PoolClient } from "pg";

/**
 * null  = keine Einschraenkung (Standardfall, z.B. Leitung) -- der Benutzer
 *         sieht alle Standorte seines Mandanten.
 * uuid[] = genau diese Standorte, nicht mehr.
 *
 * Der Unterschied "keine Zeile in benutzer_standort" vs. "auf nichts
 * eingeschraenkt" ist in RLS allein nicht sauber abbildbar (eine leere
 * IN-Liste ist nicht dasselbe wie "keine Bedingung") -- deshalb wird das
 * hier einmal zentral aufgeloest und von jedem Service benutzt, der
 * standortbezogene Daten filtert (siehe zimmer.service.ts, klient.service.ts).
 */
export async function ermittleErlaubteStandortIds(
  client: PoolClient,
  benutzerId: string
): Promise<string[] | null> {
  const { rows } = await client.query<{ standort_id: string }>(
    "SELECT standort_id FROM benutzer_standort WHERE benutzer_id = $1",
    [benutzerId]
  );
  return rows.length === 0 ? null : rows.map((r) => r.standort_id);
}
