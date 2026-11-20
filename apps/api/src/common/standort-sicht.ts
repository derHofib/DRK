import type { PoolClient } from "pg";
import type { StandortSichtDto, StandortSichtEintrag, StandortSichtHerkunft } from "@zimmerakte/shared";

/**
 * Die Sicht mehrerer Personen mit Herkunft je Standort, in EINER Abfrage
 * ueber standort_sicht() (Migration 0084). Dieselbe Funktion steckt hinter
 * ermittleErlaubteStandortIds() -- was hier angezeigt wird, ist also genau
 * das, was die Schranke durchsetzt, nicht eine zweite Nachbildung.
 *
 * ausRang = null: die Traeger-Einstellung gilt (Normalfall). true/false:
 * die jeweilige Regel erzwingen (nur fuer die Vorschau).
 */
export async function ladeStandortSicht(
  client: PoolClient,
  benutzerIds: string[],
  ausRang: boolean | null = null
): Promise<Map<string, StandortSichtDto>> {
  const ergebnis = new Map<string, StandortSichtDto>();
  if (benutzerIds.length === 0) return ergebnis;
  const { rows } = await client.query<{
    benutzer_id: string;
    standort_id: string | null;
    herkunft: StandortSichtHerkunft | "alle";
    standort_name: string | null;
    bis: string | null;
    vertretener_name: string | null;
  }>(
    `SELECT b.id AS benutzer_id, s.standort_id, s.herkunft, st.name AS standort_name,
            d.bis, vb.name AS vertretener_name
     FROM benutzer b
     JOIN mandant m ON m.id = b.mandant_id
     CROSS JOIN LATERAL standort_sicht(b.id, COALESCE($2::boolean, m.standort_sicht_aus_rang)) s
     LEFT JOIN standort st ON st.id = s.standort_id
     LEFT JOIN delegation d ON d.id = s.delegation_id
     LEFT JOIN benutzer vb ON vb.id = d.vertretener_benutzer_id
     WHERE b.id = ANY($1)
     ORDER BY (s.herkunft = 'vertretung'), st.name`,
    [benutzerIds, ausRang]
  );
  for (const id of benutzerIds) ergebnis.set(id, { alle: false, eintraege: [] });
  for (const r of rows) {
    const sicht = ergebnis.get(r.benutzer_id)!;
    if (r.herkunft === "alle") {
      sicht.alle = true;
      sicht.eintraege = [];
      continue;
    }
    if (sicht.alle || r.standort_id === null) continue;
    // Ein Standort, der schon fest oder aus dem Rang sichtbar ist, wird durch
    // eine Vertretung nicht "geliehen" -- sonst verschwaende er in der Anzeige
    // scheinbar am Ende der Vertretung.
    if (sicht.eintraege.some((e) => e.standortId === r.standort_id)) continue;
    const eintrag: StandortSichtEintrag = {
      standortId: r.standort_id,
      standortName: r.standort_name ?? "Standort",
      herkunft: r.herkunft,
      bis: r.bis,
      vertretenerName: r.vertretener_name,
    };
    sicht.eintraege.push(eintrag);
  }
  return ergebnis;
}

/** Sieht "nachher" weniger als "vorher"? (Vertretungen zaehlen nicht mit: sie laufen ab.) */
export function siehtWeniger(vorher: StandortSichtDto, nachher: StandortSichtDto): boolean {
  if (nachher.alle) return false;
  if (vorher.alle) return true;
  const nachherIds = new Set(nachher.eintraege.map((e) => e.standortId));
  return vorher.eintraege.some((e) => e.herkunft !== "vertretung" && !nachherIds.has(e.standortId));
}
