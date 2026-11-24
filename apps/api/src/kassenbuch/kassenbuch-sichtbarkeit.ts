import { NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import {
  ermittleErlaubteStandortIds,
  klientStandortBedingung,
  standortIdBedingung,
  standortIstErlaubt,
} from "../common/standort-restriction";

export interface BuchungsFilter {
  klientId?: string;
  standortId?: string;
  von?: string;
  bis?: string;
}

/**
 * Sichtbarkeit einer Buchung fuer die angemeldete Person -- gemeinsam fuer
 * findeAlle() und salden(), damit Liste und Summen nie auseinanderlaufen
 * (eine Summe darf keine Buchung enthalten, die die Liste nicht zeigen
 * duerfte). Erwartet die Aliase b (kassenbuchung) und k (klient). Ein
 * fremder Standort ist ein 404, kein stilles "keine Treffer".
 */
export async function sichtbarkeitsBedingungen(
  client: PoolClient,
  benutzerId: string,
  filter: { klientId?: string; standortId?: string } | undefined,
  params: unknown[]
): Promise<string[]> {
  if (filter?.standortId && !(await standortIstErlaubt(client, benutzerId, filter.standortId))) {
    throw new NotFoundException("Standort nicht gefunden.");
  }
  const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
  // Eine Buchung ist sichtbar, wenn ENTWEDER ihr Klient ueber eine
  // offene Belegung in einem erlaubten Standort wohnt, ODER sie direkt
  // einem erlaubten Standort zugeordnet ist -- die beiden Faelle
  // schliessen sich per kassenbuchung_klient_xor_standort gegenseitig aus.
  const klientBed = klientStandortBedingung(erlaubteStandorte, "k", params);
  const standortBed = standortIdBedingung(erlaubteStandorte, "b.standort_id", params);
  const bedingungen = [`((b.klient_id IS NOT NULL AND ${klientBed}) OR (b.standort_id IS NOT NULL AND ${standortBed}))`];
  if (filter?.klientId) {
    params.push(filter.klientId);
    bedingungen.push(`b.klient_id = $${params.length}`);
  }
  if (filter?.standortId) {
    params.push(filter.standortId);
    const p = params.length;
    bedingungen.push(`(
      b.standort_id = $${p}
      OR (b.klient_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM belegung fb
        JOIN zimmer fz ON fz.id = fb.zimmer_id
        WHERE fb.klient_id = k.id AND fb.auszug IS NULL AND fb.einzug <= CURRENT_DATE
          AND fz.standort_id = $${p}
      ))
    )`);
  }
  return bedingungen;
}
