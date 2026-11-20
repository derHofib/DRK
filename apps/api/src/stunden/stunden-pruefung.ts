import type { PoolClient } from "pg";
import { STUNDENBUCHUNG_MINUTEN_MAX } from "@zimmerakte/shared";
import { klientIstArchiviert, klientIstErlaubt } from "../common/standort-restriction";

/**
 * Die fachlichen Pruefungen vor jedem INSERT in stundenbuchung -- gemeinsam
 * fuer die Buchung von Hand und die aus dem Kalender (stunden-kalender.service.ts),
 * damit beide Wege dieselben Regeln haben. Liefert den Fehler statt ihn zu
 * werfen: das Nachziehen aus dem Kalender soll bei einer Klient:in scheitern
 * duerfen, ohne die uebrigen Buchungen mitzureissen.
 */
export async function buchbarkeitsFehler(
  client: PoolClient,
  benutzerId: string,
  mitarbeiterId: string,
  klientId: string,
  datum: string,
  minuten: number
): Promise<{ status: 400 | 404; meldung: string } | null> {
  // klientIstErlaubt() sagt fuer Personen OHNE Standort-Einschraenkung
  // immer "ja", auch zu einer ID, die es im Mandanten nicht gibt. Der
  // Fremdschluessel allein schuetzt nicht: seine Pruefung laeuft an RLS
  // vorbei, ein Mandant koennte so auf die Klient:in eines anderen
  // verweisen. Erst die Abfrage hier -- durch RLS gefiltert -- stellt
  // fest, dass die Klient:in zu DIESEM Mandanten gehoert.
  const { rows: klient } = await client.query("SELECT 1 FROM klient WHERE id = $1", [klientId]);
  if (klient.length === 0 || !(await klientIstErlaubt(client, benutzerId, klientId))) {
    return { status: 404, meldung: "Klient nicht gefunden." };
  }
  if (await klientIstArchiviert(client, klientId)) {
    return { status: 400, meldung: "Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden." };
  }
  // RLS blendet Mitarbeitende fremder Traeger aus; deaktivierte Konten
  // leisten nichts mehr.
  const { rows: mitarbeiter } = await client.query("SELECT aktiv FROM benutzer WHERE id = $1", [mitarbeiterId]);
  if (mitarbeiter.length === 0) return { status: 404, meldung: "Mitarbeiter:in nicht gefunden." };
  if (!mitarbeiter[0].aktiv) return { status: 400, meldung: "Dieses Konto ist deaktiviert." };

  // Niemand leistet mehr als 24 Stunden am Tag. Die Summe haengt an der
  // Person, nicht an der Klientin: zwei Klient:innen zur selben Zeit
  // sind fachlich moeglich (Gruppenangebot), 25 Stunden an einem Tag nicht.
  const { rows: summe } = await client.query(
    "SELECT COALESCE(sum(minuten), 0)::int AS minuten FROM stundenbuchung WHERE mitarbeiter_id = $1 AND datum = $2 AND NOT storniert",
    [mitarbeiterId, datum]
  );
  if (summe[0].minuten + minuten > STUNDENBUCHUNG_MINUTEN_MAX) {
    return { status: 400, meldung: "An diesem Tag wären für diese Person mehr als 24 Stunden gebucht." };
  }
  return null;
}
