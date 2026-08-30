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

/**
 * SQL-Bedingung, die einen Klienten (Tabellenalias klientAlias in der
 * jeweiligen Abfrage, z.B. "k") auf die erlaubten Standorte einschraenkt --
 * ueber dessen AKTUELL offene Belegung. Haengt den Array-Parameter selbst
 * an "params" an, damit sie sich in die bestehenden "bedingungen"-Arrays
 * der Services einreihen laesst (siehe z.B. zimmer.service.ts:findeAlle).
 *
 * Klienten OHNE aktuelle Belegung sind fuer standortbeschraenkte Benutzer
 * NICHT sichtbar -- fail closed: lieber nichts zeigen als zu viel. Ohne
 * Einschraenkung (erlaubteStandorte === null) immer "1=1" durchreichen.
 *
 * War bis zur Sicherheitspruefung dieser Session ausser in
 * zimmer.service.ts nirgends angewendet -- siehe CLAUDE.md-Historie.
 */
export function klientStandortBedingung(
  erlaubteStandorte: string[] | null,
  klientAlias: string,
  params: unknown[]
): string {
  if (!erlaubteStandorte) return "1=1";
  params.push(erlaubteStandorte);
  return `EXISTS (
    SELECT 1 FROM belegung sb
    JOIN zimmer sz ON sz.id = sb.zimmer_id
    WHERE sb.klient_id = ${klientAlias}.id
      AND sb.auszug IS NULL AND sb.einzug <= CURRENT_DATE
      AND sz.standort_id = ANY($${params.length})
  )`;
}

/**
 * Einzelfall-Variante von klientStandortBedingung fuer Schreib-/Detailpfade
 * mit einer einzelnen klientId (z.B. vor dem Anlegen einer Buchung, oder um
 * eine schon geladene klient_id gegenzupruefen) -- dort gibt es keine
 * Ergebnisliste, die sich per WHERE filtern liesse, nur ein Ja/Nein.
 */
export async function klientIstErlaubt(
  client: PoolClient,
  benutzerId: string,
  klientId: string
): Promise<boolean> {
  const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
  if (!erlaubteStandorte) return true;
  const { rows } = await client.query(
    `SELECT 1 FROM belegung b
     JOIN zimmer z ON z.id = b.zimmer_id
     WHERE b.klient_id = $1 AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
       AND z.standort_id = ANY($2)
     LIMIT 1`,
    [klientId, erlaubteStandorte]
  );
  return rows.length > 0;
}

/**
 * SQL-Bedingung fuer eine Zeile, die DIREKT eine standort_id traegt (z.B.
 * kassenbuchung.standort_id bei einer Standort-Buchung) -- anders als
 * klientStandortBedingung() gibt es hier keinen Umweg ueber eine offene
 * Belegung, die Spalte IST schon die Standort-Referenz.
 */
export function standortIdBedingung(
  erlaubteStandorte: string[] | null,
  standortIdAusdruck: string,
  params: unknown[]
): string {
  if (!erlaubteStandorte) return "1=1";
  params.push(erlaubteStandorte);
  return `${standortIdAusdruck} = ANY($${params.length})`;
}

/**
 * Einzelfall-Variante von standortIdBedingung fuer Schreibpfade (z.B. vor
 * dem Anlegen einer Standort-Buchung). Prueft zusaetzlich, dass der
 * Standort ueberhaupt existiert (und damit -- ueber RLS auf der
 * standort-Tabelle -- zum aktuellen Mandanten gehoert): anders als bei
 * klientIstErlaubt() oben wird das hier nicht als Sonderfall
 * "unrestricted = ungeprueft durchlassen" behandelt, weil eine falsche
 * standort_id sonst unbemerkt aus einem fremden Mandanten stammen koennte.
 */
export async function standortIstErlaubt(
  client: PoolClient,
  benutzerId: string,
  standortId: string
): Promise<boolean> {
  const { rows } = await client.query("SELECT 1 FROM standort WHERE id = $1", [standortId]);
  if (rows.length === 0) return false;
  const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
  if (!erlaubteStandorte) return true;
  return erlaubteStandorte.includes(standortId);
}
