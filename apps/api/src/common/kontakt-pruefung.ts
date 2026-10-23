import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { klientIstErlaubt } from "./standort-restriction";

export type KontaktEingabe = { benutzerId: string } | { klientId: string };

/**
 * Mitarbeitende duerfen aktive Kolleg:innen und Klient:innen mit aktivem
 * Zugang ansprechen (Termin-Einladung, Chat), die sie auch in der Klientenliste
 * sehen duerften. Alle Fehlschlaege klingen gleich: ob die Person gar nicht
 * existiert oder nur fuer einen unsichtbar ist, soll sich nicht erkennen lassen.
 */
export async function pruefeKontakt(client: PoolClient, benutzerId: string, kontakt: KontaktEingabe): Promise<void> {
  if ("benutzerId" in kontakt) {
    const { rows } = await client.query("SELECT 1 FROM benutzer WHERE id = $1 AND aktiv", [kontakt.benutzerId]);
    if (rows.length === 0) throw new BadRequestException("Mitarbeitende:r nicht gefunden oder nicht aktiv.");
    return;
  }
  const { rows } = await client.query(
    `SELECT 1 FROM klient k
     JOIN klient_zugang z ON z.klient_id = k.id
     WHERE k.id = $1 AND z.aktiv AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL`,
    [kontakt.klientId]
  );
  if (rows.length === 0 || !(await klientIstErlaubt(client, benutzerId, kontakt.klientId))) {
    throw new BadRequestException("Klient:in nicht gefunden oder ohne aktiven Zugang.");
  }
}
