import type { PoolClient } from "pg";
import type {
  MitarbeiterZustaendigKurzDto,
  MitarbeiterZustaendigkeitDto,
  ZustaendigKlientenDto,
  ZustaendigVertretungDto,
} from "@zimmerakte/shared";
import { ermittleErlaubteStandortIds, klientIstErlaubt } from "../common/standort-restriction";

/**
 * Wofuer eine Person zustaendig ist (Rueckmeldung 29e0f19d): Bezugsklient:innen
 * und laufende/kommende Vertretungen. Konzept und Entscheidungen von Dennis
 * (22.11.2026): /mnt/project-files/mitarbeiter-detail/.
 *
 * Bewusst OHNE eigenes Recht: Die Mitarbeitendenliste ist fuer alle
 * Mitarbeitenden offen, und Dennis hat entschieden, dass alle, die sie sehen,
 * auch die Vertretungen anderer sehen. Was weitergegeben wurde (Umfang,
 * einzelne Rechte, sensible Rechte), bleibt dagegen bei den Beteiligten --
 * deshalb liest hier keine Abfrage delegation_recht oder den Umfang.
 *
 * Nur GENEHMIGTE Vertretungen, die heute laufen oder noch kommen: ein Antrag
 * ist noch keine Zustaendigkeit, eine abgelaufene keine mehr.
 */

const AKTIV = "k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL";
const VERTRETUNG_GILT = "d.status = 'genehmigt' AND d.bis >= CURRENT_DATE";

/** Zahlen und laufende Vertretungen je Person, fuer die Spalte „Zuständig für“. */
export async function ladeZustaendigKurz(
  client: PoolClient,
  benutzerIds: string[]
): Promise<Map<string, MitarbeiterZustaendigKurzDto>> {
  const ergebnis = new Map<string, MitarbeiterZustaendigKurzDto>();
  for (const id of benutzerIds) ergebnis.set(id, { bezugsklienten: 0, vertritt: [], wirdVertretenVon: [] });
  if (benutzerIds.length === 0) return ergebnis;

  // Die Zahl umfasst auch Klient:innen ausserhalb der eigenen Sicht (Frage 2
  // im Konzept): ohne sie wirkte jemand weniger ausgelastet, als er ist. Eine
  // Zahl verraet keine Person; Namen gibt es nur im Detail und nur gefiltert.
  const { rows: zahlen } = await client.query<{ benutzer_id: string; anzahl: string }>(
    `SELECT ks.bezugsbetreuer_id AS benutzer_id, count(*) AS anzahl
     FROM klient_stammdaten ks
     JOIN klient k ON k.id = ks.klient_id
     WHERE ks.bezugsbetreuer_id = ANY($1) AND ${AKTIV}
     GROUP BY ks.bezugsbetreuer_id`,
    [benutzerIds]
  );
  for (const z of zahlen) ergebnis.get(z.benutzer_id)!.bezugsklienten = Number(z.anzahl);

  const { rows: vertretungen } = await client.query<{
    vertreter_id: string;
    vertreter_name: string;
    vertretener_id: string;
    vertretener_name: string;
    bis: string;
  }>(
    `SELECT d.vertreter_benutzer_id AS vertreter_id, vr.name AS vertreter_name,
            d.vertretener_benutzer_id AS vertretener_id, vn.name AS vertretener_name, d.bis
     FROM delegation d
     JOIN benutzer vr ON vr.id = d.vertreter_benutzer_id
     JOIN benutzer vn ON vn.id = d.vertretener_benutzer_id
     WHERE ${VERTRETUNG_GILT} AND d.von <= CURRENT_DATE
       AND (d.vertreter_benutzer_id = ANY($1) OR d.vertretener_benutzer_id = ANY($1))
     ORDER BY d.bis, vn.name`,
    [benutzerIds]
  );
  for (const v of vertretungen) {
    ergebnis.get(v.vertreter_id)?.vertritt.push({ benutzerId: v.vertretener_id, name: v.vertretener_name, bis: v.bis });
    ergebnis.get(v.vertretener_id)?.wirdVertretenVon.push({ benutzerId: v.vertreter_id, name: v.vertreter_name, bis: v.bis });
  }
  return ergebnis;
}

/**
 * Bezugsklient:innen einer Person, so gefiltert, wie die betrachtende Person
 * Akten sehen darf. Die Entscheidung je Klient:in trifft klientIstErlaubt() --
 * dieselbe Funktion, die auch das Oeffnen der Akte schuetzt. Damit kann hier
 * nie ein Name stehen, dessen Akte sich dann nicht oeffnen laesst, und es gibt
 * keine zweite Nachbildung der Regel.
 */
async function ladeBezugsklienten(
  client: PoolClient,
  betrachterId: string,
  bezugsbetreuerId: string,
  erlaubteStandorte: string[] | null
): Promise<ZustaendigKlientenDto> {
  const { rows } = await client.query<{
    id: string;
    vorname: string;
    nachname: string;
    standort_name: string | null;
    zimmer_nummer: string | null;
  }>(
    `SELECT k.id, k.vorname, k.nachname, s.name AS standort_name, z.nummer AS zimmer_nummer
     FROM klient_stammdaten ks
     JOIN klient k ON k.id = ks.klient_id
     LEFT JOIN belegung b ON b.klient_id = k.id
       AND b.einzug <= CURRENT_DATE AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
     LEFT JOIN zimmer z ON z.id = b.zimmer_id
     LEFT JOIN standort s ON s.id = z.standort_id
     WHERE ks.bezugsbetreuer_id = $1 AND ${AKTIV}
     ORDER BY k.nachname, k.vorname`,
    [bezugsbetreuerId]
  );
  const ergebnis: ZustaendigKlientenDto = { sichtbar: [], verborgen: 0 };
  for (const r of rows) {
    const darf = erlaubteStandorte === null || (await klientIstErlaubt(client, betrachterId, r.id));
    if (!darf) {
      ergebnis.verborgen++;
      continue;
    }
    ergebnis.sichtbar.push({
      klientId: r.id,
      name: `${r.vorname} ${r.nachname}`,
      standortName: r.standort_name,
      zimmerNummer: r.zimmer_nummer,
    });
  }
  return ergebnis;
}

/** null = keine Person dieses Traegers (RLS) mit dieser ID. */
export async function ladeZustaendigkeit(
  client: PoolClient,
  betrachterId: string,
  benutzerId: string
): Promise<MitarbeiterZustaendigkeitDto | null> {
  const { rows: person } = await client.query<{ id: string; name: string; aktiv: boolean }>(
    "SELECT id, name, aktiv FROM benutzer WHERE id = $1",
    [benutzerId]
  );
  if (person.length === 0) return null;

  const erlaubteStandorte = await ermittleErlaubteStandortIds(client, betrachterId);
  const { rows: vertretungen } = await client.query<{
    id: string;
    vertreter_id: string;
    vertreter_name: string;
    vertretener_id: string;
    vertretener_name: string;
    von: string;
    bis: string;
    laeuft: boolean;
    standorte: string[];
  }>(
    `SELECT d.id, d.vertreter_benutzer_id AS vertreter_id, vr.name AS vertreter_name,
            d.vertretener_benutzer_id AS vertretener_id, vn.name AS vertretener_name,
            d.von, d.bis, d.von <= CURRENT_DATE AS laeuft,
            COALESCE(array_agg(s.name ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '{}') AS standorte
     FROM delegation d
     JOIN benutzer vr ON vr.id = d.vertreter_benutzer_id
     JOIN benutzer vn ON vn.id = d.vertretener_benutzer_id
     LEFT JOIN delegation_standort ds ON ds.delegation_id = d.id
     LEFT JOIN standort s ON s.id = ds.standort_id
     WHERE ${VERTRETUNG_GILT} AND (d.vertreter_benutzer_id = $1 OR d.vertretener_benutzer_id = $1)
     GROUP BY d.id, vr.name, vn.name
     ORDER BY d.von, d.bis`,
    [benutzerId]
  );

  const vertritt: ZustaendigVertretungDto[] = [];
  const wirdVertretenVon: ZustaendigVertretungDto[] = [];
  for (const v of vertretungen) {
    if (v.vertreter_id === benutzerId) {
      vertritt.push({
        delegationId: v.id,
        benutzerId: v.vertretener_id,
        name: v.vertretener_name,
        von: v.von,
        bis: v.bis,
        laeuft: v.laeuft,
        standorte: v.standorte,
        // Wer jemanden vertritt, ist in dieser Zeit fuer dessen
        // Bezugsklient:innen mit zustaendig -- das ist der eigentliche Wunsch
        // hinter „man soll sehen, wenn er als Vertretung eingetragen wurde“.
        klienten: await ladeBezugsklienten(client, betrachterId, v.vertretener_id, erlaubteStandorte),
      });
    } else {
      wirdVertretenVon.push({
        delegationId: v.id,
        benutzerId: v.vertreter_id,
        name: v.vertreter_name,
        von: v.von,
        bis: v.bis,
        laeuft: v.laeuft,
        standorte: v.standorte,
        klienten: null,
      });
    }
  }

  return {
    benutzerId: person[0].id,
    name: person[0].name,
    aktiv: person[0].aktiv,
    bezug: await ladeBezugsklienten(client, betrachterId, benutzerId, erlaubteStandorte),
    vertritt,
    wirdVertretenVon,
  };
}
