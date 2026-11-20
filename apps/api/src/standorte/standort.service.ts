import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  StandortAenderungDto,
  StandortAngabenDto,
  StandortAngebotsform,
  StandortFehlendeAngabe,
  StandortLeitungDto,
  StandortListenEintragDto,
  StandortSteckbriefDto,
} from "@zimmerakte/shared";
import { AuditService } from "../audit/audit.service";
import { isoWoche } from "../common/iso-woche";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, standortIstErlaubt } from "../common/standort-restriction";
import { RechteService } from "../rechte/rechte.service";

export interface StandortDto {
  id: string;
  name: string;
  adresse: string;
  aktiv: boolean;
  angebotsform: StandortAngebotsform | null;
}

const STANDORT_SPALTEN = "id, name, adresse, aktiv, angebotsform";

/**
 * Feld im DTO -> Spalte. Zugleich die Positivliste fuer das UPDATE: was hier
 * nicht steht, kann der PATCH nicht schreiben, egal was im Body steht. Die
 * Datenbank sichert dasselbe noch einmal spaltenscharf ab (Migration 0079).
 */
const ANGABEN_SPALTEN = {
  name: "name",
  angebotsform: "angebotsform",
  zielgruppe: "zielgruppe",
  betreuungsumfang: "betreuungsumfang",
  inBetriebSeit: "in_betrieb_seit",
  strasse: "strasse",
  plz: "plz",
  ort: "ort",
  telefon: "telefon",
  fax: "fax",
  email: "email",
  buerozeiten: "buerozeiten",
  bereitschaftTelefon: "bereitschaft_telefon",
  bereitschaftHinweis: "bereitschaft_hinweis",
  barrierefreiheit: "barrierefreiheit",
  barrierefreiheitHinweis: "barrierefreiheit_hinweis",
  oepnv: "oepnv",
  zugang: "zugang",
  kostenstelle: "kostenstelle",
  ikNummer: "ik_nummer",
  hinweise: "hinweise",
  aktiv: "aktiv",
} as const satisfies Record<keyof StandortAenderungDto, string>;

/**
 * Kostenstelle und IK-Nummer nur fuer wer standorte.bearbeiten hat (Nachtrag
 * 20.11.2026). Ohne das Recht fehlen die Felder im JSON ganz -- ein
 * "null" saehe aus wie "nicht eingetragen" und verriete beim Vergleich
 * zweier Antworten trotzdem, dass es das Feld gibt.
 */
function angabenAusZeile(r: any, mitVerwaltung: boolean): StandortAngabenDto {
  const angaben: StandortAngabenDto = {
    name: r.name,
    angebotsform: r.angebotsform,
    zielgruppe: r.zielgruppe,
    betreuungsumfang: r.betreuungsumfang,
    inBetriebSeit: r.in_betrieb_seit,
    strasse: r.strasse,
    plz: r.plz,
    ort: r.ort,
    telefon: r.telefon,
    fax: r.fax,
    email: r.email,
    buerozeiten: r.buerozeiten,
    bereitschaftTelefon: r.bereitschaft_telefon,
    bereitschaftHinweis: r.bereitschaft_hinweis,
    barrierefreiheit: r.barrierefreiheit,
    barrierefreiheitHinweis: r.barrierefreiheit_hinweis,
    oepnv: r.oepnv,
    zugang: r.zugang,
    hinweise: r.hinweise,
  };
  if (mitVerwaltung) {
    angaben.kostenstelle = r.kostenstelle;
    angaben.ikNummer = r.ik_nummer;
  }
  return angaben;
}

/**
 * Was fehlt, damit der Steckbrief nachts traegt. Bei inaktiven Standorten
 * nichts: dort ist Unvollstaendigkeit keine Aufgabe mehr (Konzept, Randfaelle).
 */
function fehlendeAngaben(r: any): StandortFehlendeAngabe[] {
  if (!r.aktiv) return [];
  const fehlt: StandortFehlendeAngabe[] = [];
  if (!r.angebotsform) fehlt.push("angebotsform");
  if (!r.plz || !r.ort) fehlt.push("anschrift");
  if (!r.telefon) fehlt.push("telefon");
  if (!r.bereitschaft_telefon) fehlt.push("bereitschaft");
  return fehlt;
}

const LETZTE_BUCHUNGEN_LIMIT = 10;

export interface StandortUebersichtDto {
  standort: StandortDto;
  zimmer: {
    anzahl: number;
    plaetzeGesamt: number;
    plaetzeBelegt: number;
    plaetzeFrei: number;
    liste: {
      id: string;
      nummer: string;
      etage: string;
      kapazitaet: number;
      bewohner: { klientId: string; name: string }[];
    }[];
  };
  klienten: {
    id: string;
    name: string;
    aktenzeichen: string | null;
    amt: string | null;
    zimmerNummer: string;
    einzug: string;
    hzlWoechentlich: boolean;
  }[];
  kassenbuch: {
    /** Haus-Kasse: Standort-Buchungen (Spassgeld, Veranstaltungen), ohne stornierte. */
    hausSaldoCent: number;
    /** Gelder der hier aktuell wohnenden Klient:innen, ohne stornierte. */
    klientenSaldoCent: number;
    hzl: { bezahlt: number; gesamt: number; isoJahr: number; isoWoche: number };
    offeneStornoantraege: number;
    letzteBuchungen: {
      id: string;
      datum: string;
      betragCent: number;
      verwendungszweck: string;
      typBezeichnung: string;
      /** null = Haus-Buchung. */
      klientName: string | null;
    }[];
  };
}

// Plaetze wie in uebersicht() und im Dashboard: gezaehlt werden Plaetze
// (zimmer.kapazitaet), nicht Zimmer; belegt = aktuell offene Belegungen.
const PLAETZE_SQL = `
  (SELECT COALESCE(sum(z.kapazitaet), 0) FROM zimmer z WHERE z.standort_id = s.id AND z.aktiv) AS plaetze_eingerichtet,
  (SELECT count(*) FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id JOIN klient k ON k.id = b.klient_id
    WHERE z.standort_id = s.id AND b.einzug <= CURRENT_DATE AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
      AND k.archiviert_am IS NULL) AS plaetze_belegt`;

// Das Team eines Standorts: aktive Konten, die ihm per benutzer_standort
// zugeordnet sind (dieselbe Zuordnung wie chat_anfrage_team_mitglied, nur
// ohne den Sonderfall "keine Einschraenkung = ueberall") ODER die eine
// heute gueltige Besetzung haben, deren Position bzw. Besetzung am
// Einrichtungsknoten dieses Standorts haengt (0047, 0066).
const TEAM_SQL = `
  WITH ou AS (SELECT id FROM org_unit WHERE standort_id = $1)
  SELECT count(DISTINCT b.id) AS anzahl
  FROM benutzer b
  WHERE b.aktiv AND (
    EXISTS (SELECT 1 FROM benutzer_standort bs WHERE bs.benutzer_id = b.id AND bs.standort_id = $1)
    OR EXISTS (
      SELECT 1 FROM org_position_besetzung pb
      JOIN org_position p ON p.id = pb.position_id AND p.aktiv
      WHERE pb.benutzer_id = b.id
        AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
        AND (
          (p.org_unit_id IN (SELECT id FROM ou) AND NOT p.ist_sammelrang)
          OR EXISTS (SELECT 1 FROM org_position_weitere_einheit we WHERE we.position_id = p.id AND we.org_unit_id IN (SELECT id FROM ou))
          OR EXISTS (SELECT 1 FROM org_position_besetzung_einheit be WHERE be.besetzung_id = pb.id AND be.org_unit_id IN (SELECT id FROM ou))
        )
    )
  )`;

/**
 * Leitung wird aus dem Organigramm ABGELEITET, nie eingetragen (sonst zwei
 * Wahrheiten: Organigramm sagt A, Steckbrief sagt B). Leitung heisst: eine
 * heute besetzte Linienposition am Einrichtungsknoten (oder ihm ueber
 * weitere_einheit zugeordnet), die dort ganz oben steht -- ihre
 * Vorgesetzte haengt an einer anderen Einheit. Dazu kommen Positionen am
 * Knoten, deren Titel "leitung" oder "stellv" enthaelt (Stellvertretung
 * steht im Organigramm meist eine Ebene darunter). Sammelraenge zaehlen
 * nicht: "Mitarbeiter" am Traeger ist keine Leitung.
 */
async function leitungJeStandort(client: PoolClient, standortIds: string[]): Promise<Map<string, StandortLeitungDto[]>> {
  const ergebnis = new Map<string, StandortLeitungDto[]>();
  if (standortIds.length === 0) return ergebnis;
  const { rows } = await client.query(
    `WITH anker AS (
       SELECT p.id AS position_id, ou.id AS unit_id, ou.standort_id
       FROM org_position p JOIN org_unit ou ON ou.id = p.org_unit_id
       WHERE ou.standort_id = ANY($1)
       UNION
       SELECT we.position_id, ou.id, ou.standort_id
       FROM org_position_weitere_einheit we JOIN org_unit ou ON ou.id = we.org_unit_id
       WHERE ou.standort_id = ANY($1)
     )
     SELECT DISTINCT ON (a.standort_id, b.id, p.id)
            a.standort_id, b.id AS benutzer_id, b.name, p.titel,
            (eltern.id IS NULL OR eltern.org_unit_id <> a.unit_id) AS ist_oben,
            p.reihenfolge
     FROM anker a
     JOIN org_position p ON p.id = a.position_id
     LEFT JOIN org_position eltern ON eltern.id = p.parent_position_id
     JOIN org_position_besetzung pb ON pb.position_id = p.id
       AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
     JOIN benutzer b ON b.id = pb.benutzer_id AND b.aktiv
     WHERE p.aktiv AND p.typ = 'linie' AND NOT p.ist_sammelrang AND NOT p.ist_geplant
       AND (eltern.id IS NULL OR eltern.org_unit_id <> a.unit_id OR p.titel ~* '(leitung|stellv)')`,
    [standortIds]
  );
  rows.sort(
    (x, y) =>
      Number(y.ist_oben) - Number(x.ist_oben) ||
      (x.reihenfolge ?? 2147483647) - (y.reihenfolge ?? 2147483647) ||
      String(x.name).localeCompare(String(y.name), "de")
  );
  for (const r of rows) {
    const liste = ergebnis.get(r.standort_id) ?? [];
    liste.push({ benutzerId: r.benutzer_id, name: r.name, positionTitel: r.titel });
    ergebnis.set(r.standort_id, liste);
  }
  return ergebnis;
}

@Injectable()
export class StandortService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
  ) {}

  /**
   * Liefert bewusst auch deaktivierte Standorte mit -- die Verwaltungsseite
   * (Einstellungen) muss sie zeigen koennen, um sie wieder zu aktivieren.
   * Wer nur die aktiven fuer eine Auswahlliste braucht (z.B. beim
   * Zimmer-Anlegen), filtert das im Frontend auf "aktiv".
   *
   * Wie ueberall sonst (siehe common/standort-restriction.ts) rein
   * datengetrieben ueber benutzer_standort, nicht rollenbasiert: eine
   * Bereichsleitung sieht "alle Standorte" nur, weil ihr faktisch nie eine
   * Zuordnung gegeben wird, nicht weil ihre Rolle hier gesondert behandelt
   * wuerde. Ein Betreuer mit Standort-Zuordnung sieht ab hier nur noch
   * seine eigenen -- vorher wurde diese Liste ueberhaupt nicht gefiltert.
   */
  async findeAlle(): Promise<StandortDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const bedingung = erlaubteStandorte ? "id = ANY($1)" : "true";
      const params = erlaubteStandorte ? [erlaubteStandorte] : [];
      const { rows } = await client.query<StandortDto>(
        `SELECT ${STANDORT_SPALTEN} FROM standort WHERE ${bedingung} ORDER BY name`,
        params
      );
      return rows;
    });
  }

  // Eine neue Einrichtung zu eroeffnen ist eine traegerweite Entscheidung
  // (mehr Personal, mehr Budget) -- deshalb nur ueber standorte.anlegen, das
  // in der Rollen-Migration bewusst NUR bereichsleitung bekommt (siehe
  // rollen-mapping.ts), anders als beim Bearbeiten einer bestehenden
  // Einrichtung (siehe unten).
  async anlegen(input: {
    name: string;
    angebotsform?: StandortAngebotsform | null;
    strasse: string;
    plz?: string | null;
    ort?: string | null;
  }): Promise<StandortDto> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("standorte", "anlegen"))) {
      throw new ForbiddenException("Nur die Bereichsleitung darf eine neue Einrichtung anlegen.");
    }
    return this.db.withTenant(async (client) => {
      // adresse setzt der Trigger aus strasse/plz/ort (Migration 0079).
      const { rows } = await client.query<StandortDto>(
        `INSERT INTO standort (mandant_id, name, angebotsform, strasse, plz, ort)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${STANDORT_SPALTEN}`,
        [ctx.mandantId, input.name, input.angebotsform ?? null, input.strasse, input.plz ?? null, input.ort ?? null]
      );
      await this.audit.protokollieren(client, {
        modul: "standorte",
        aktion: "anlegen",
        objektTyp: "standort",
        objektId: rows[0].id,
        nachher: input,
      });
      return rows[0];
    });
  }

  /**
   * "aktiv" faellt bewusst nicht weg, wenn ein Standort noch belegte oder
   * zugeordnete Zimmer hat -- das Deaktivieren bedeutet nur "kein neues
   * Zimmer mehr hier anlegen", nicht "alles hier verschwindet". Bestehende
   * Zimmer und ihre Belegungen bleiben unangetastet sichtbar.
   *
   * Das Recht "standorte.bearbeiten" allein reicht nicht: eine auf Haus A
   * beschraenkte Leitung hat es auch, darf aber Haus B weder umbenennen noch
   * deaktivieren. Deshalb dieselbe Schranke wie in uebersicht() -- 404 statt
   * 403, damit ein nicht zugeordneter Standort nicht von einem fremden zu
   * unterscheiden ist.
   *
   * Jede Aenderung landet mit vorher/nachher im audit_log (nur die
   * geaenderten Felder): Angaben wie IK-Nummer und Angebotsform sind
   * gegenueber Kostentraegern nachweisrelevant.
   */
  async aktualisieren(id: string, input: StandortAenderungDto): Promise<StandortDto> {
    if (!(await this.rechte.hatRecht("standorte", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen eine Einrichtung bearbeiten.");
    }
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await standortIstErlaubt(client, benutzerId, id))) {
        throw new NotFoundException("Standort nicht gefunden.");
      }
      const felder = (Object.keys(input) as (keyof StandortAenderungDto)[]).filter(
        (k) => input[k] !== undefined && k in ANGABEN_SPALTEN
      );
      const { rows: vorherRows } = await client.query("SELECT * FROM standort WHERE id = $1 FOR UPDATE", [id]);
      if (vorherRows.length === 0) throw new NotFoundException("Standort nicht gefunden.");
      const alt = vorherRows[0];

      if (felder.length > 0) {
        const werte: unknown[] = [];
        const setzen = felder.map((k) => {
          werte.push(input[k]);
          return `${ANGABEN_SPALTEN[k]} = $${werte.length}`;
        });
        werte.push(id);
        await client.query(`UPDATE standort SET ${setzen.join(", ")} WHERE id = $${werte.length}`, werte);

        const vorher: Record<string, unknown> = {};
        const nachher: Record<string, unknown> = {};
        for (const k of felder) {
          const altWert = alt[ANGABEN_SPALTEN[k]];
          if (altWert === input[k]) continue;
          vorher[k] = altWert;
          nachher[k] = input[k];
        }
        if (Object.keys(nachher).length > 0) {
          await this.audit.protokollieren(client, {
            modul: "standorte",
            aktion: "bearbeiten",
            objektTyp: "standort",
            objektId: id,
            vorher,
            nachher,
          });
        }
      }

      const { rows } = await client.query<StandortDto>(`SELECT ${STANDORT_SPALTEN} FROM standort WHERE id = $1`, [id]);
      return rows[0];
    });
  }

  /**
   * Die Liste unter Organisatorisch > Standorte, mit allem, was dort
   * abgeleitet angezeigt wird (Plaetze, Leitung, fehlende Angaben). Bewusst
   * getrennt von findeAlle(): die fuettert Seitenleiste, Filter und
   * Auswahllisten und soll schlank bleiben. Verwaltungsfelder kommen hier
   * gar nicht vor, daher kein Rechte-Unterschied.
   */
  async verwaltungsliste(): Promise<StandortListenEintragDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const bedingung = erlaubteStandorte ? "s.id = ANY($1)" : "true";
      const params = erlaubteStandorte ? [erlaubteStandorte] : [];
      const { rows } = await client.query(
        `SELECT s.*, ${PLAETZE_SQL}
         FROM standort s
         WHERE ${bedingung}
         ORDER BY s.aktiv DESC, s.name`,
        params
      );
      const leitung = await leitungJeStandort(client, rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        adresse: r.adresse,
        aktiv: r.aktiv,
        angebotsform: r.angebotsform,
        telefon: r.telefon,
        plaetzeEingerichtet: Number(r.plaetze_eingerichtet),
        plaetzeBelegt: Number(r.plaetze_belegt),
        leitung: leitung.get(r.id) ?? [],
        fehlendeAngaben: fehlendeAngaben(r),
      }));
    });
  }

  /**
   * Der Steckbrief eines Standorts. Sichtbar fuer alle, die den Standort
   * sehen duerfen (dieselbe Schranke wie uebersicht(): fremd oder nicht
   * zugeordnet = 404). Kostenstelle und IK-Nummer nur mit
   * standorte.bearbeiten -- geprueft hier, neben dem SQL, nicht in der
   * Oberflaeche.
   */
  async steckbrief(id: string): Promise<StandortSteckbriefDto> {
    const { benutzerId } = requireTenantContext();
    const darfBearbeiten = await this.rechte.hatRecht("standorte", "bearbeiten");
    return this.db.withTenant(async (client) => {
      if (!(await standortIstErlaubt(client, benutzerId, id))) {
        throw new NotFoundException("Standort nicht gefunden.");
      }
      const { rows } = await client.query(
        `SELECT s.*, ${PLAETZE_SQL},
                (SELECT count(*) FROM zimmer z WHERE z.standort_id = s.id AND z.aktiv) AS zimmer_anzahl,
                (SELECT ou.id FROM org_unit ou WHERE ou.standort_id = s.id) AS org_unit_id
         FROM standort s WHERE s.id = $1`,
        [id]
      );
      const r = rows[0];
      const leitung = await leitungJeStandort(client, [id]);
      const { rows: teamRows } = await client.query(TEAM_SQL, [id]);
      const eingerichtet = Number(r.plaetze_eingerichtet);
      const belegt = Number(r.plaetze_belegt);
      return {
        id: r.id,
        aktiv: r.aktiv,
        adresse: r.adresse,
        angaben: angabenAusZeile(r, darfBearbeiten),
        darfBearbeiten,
        orgUnitId: r.org_unit_id,
        plaetze: { eingerichtet, belegt, frei: Math.max(0, eingerichtet - belegt), zimmer: Number(r.zimmer_anzahl) },
        leitung: leitung.get(id) ?? [],
        team: { anzahl: Number(teamRows[0].anzahl) },
        fehlendeAngaben: fehlendeAngaben(r),
      };
    });
  }

  /**
   * Alles zu EINEM Standort in einer Antwort (Menuepunkt "Standorte"). Die
   * Standort-Schranke ist dieselbe wie ueberall (standortIstErlaubt): ein
   * fremder, nicht zugeordneter oder nicht existierender Standort liefert
   * 404, nie Teildaten. Bewusst KEIN "WHERE mandant_id" -- RLS erledigt das.
   *
   * Klient:innen und Kassenbuch haengen hier am Standort ueber die AKTUELL
   * offene Belegung (wie klientStandortBedingung()), Haus-Buchungen direkt
   * ueber kassenbuchung.standort_id. Nacheinander statt Promise.all: alle
   * Abfragen teilen sich einen PoolClient (siehe DashboardService).
   */
  async uebersicht(id: string): Promise<StandortUebersichtDto> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await standortIstErlaubt(client, benutzerId, id))) {
        throw new NotFoundException("Standort nicht gefunden.");
      }
      const { rows: standortRows } = await client.query<StandortDto>(
        `SELECT ${STANDORT_SPALTEN} FROM standort WHERE id = $1`,
        [id]
      );

      // Wie im Dashboard: gezaehlt werden Plaetze, nicht Zimmer.
      const { rows: zimmerRows } = await client.query(
        `SELECT z.id, z.nummer, z.etage, z.kapazitaet
         FROM zimmer z WHERE z.standort_id = $1 AND z.aktiv
         ORDER BY z.etage, z.nummer`,
        [id]
      );
      const { rows: belegRows } = await client.query(
        `SELECT b.zimmer_id, b.einzug, k.id AS klient_id, k.vorname, k.nachname, k.aktenzeichen, k.amt,
                k.hzl_rhythmus, z.nummer AS zimmer_nummer
         FROM belegung b
         JOIN zimmer z ON z.id = b.zimmer_id
         JOIN klient k ON k.id = b.klient_id
         WHERE z.standort_id = $1 AND b.einzug <= CURRENT_DATE AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
           AND k.archiviert_am IS NULL
         ORDER BY k.nachname, k.vorname`,
        [id]
      );
      const bewohnerJeZimmer = new Map<string, { klientId: string; name: string }[]>();
      for (const r of belegRows) {
        const liste = bewohnerJeZimmer.get(r.zimmer_id) ?? [];
        liste.push({ klientId: r.klient_id, name: `${r.vorname} ${r.nachname}` });
        bewohnerJeZimmer.set(r.zimmer_id, liste);
      }
      const zimmerListe = zimmerRows.map((z) => ({
        id: z.id as string,
        nummer: z.nummer as string,
        etage: z.etage as string,
        kapazitaet: Number(z.kapazitaet),
        bewohner: bewohnerJeZimmer.get(z.id) ?? [],
      }));
      const plaetzeGesamt = zimmerListe.reduce((a, z) => a + z.kapazitaet, 0);
      const plaetzeBelegt = zimmerListe.reduce((a, z) => a + z.bewohner.length, 0);

      const { jahr, woche } = isoWoche(new Date());
      const klientIds = belegRows.map((r) => r.klient_id);

      const { rows: hausRows } = await client.query(
        "SELECT COALESCE(sum(betrag_cent), 0) AS saldo FROM kassenbuchung WHERE standort_id = $1 AND NOT storniert",
        [id]
      );
      const { rows: klientenSaldoRows } = await client.query(
        "SELECT COALESCE(sum(betrag_cent), 0) AS saldo FROM kassenbuchung WHERE klient_id = ANY($1) AND NOT storniert",
        [klientIds]
      );
      const { rows: hzlRows } = await client.query(
        `SELECT count(*) FILTER (WHERE b.id IS NOT NULL) AS bezahlt, count(*) AS gesamt
         FROM klient k
         LEFT JOIN kassenbuchung b
           ON b.klient_id = k.id AND b.ist_hzl AND b.iso_jahr = $2 AND b.iso_woche = $3 AND NOT b.storniert
         WHERE k.id = ANY($1) AND k.hzl_rhythmus = 'woechentlich'`,
        [klientIds, jahr, woche]
      );
      const { rows: stornoRows } = await client.query(
        `SELECT count(*) AS anzahl
         FROM kassenbuchung_stornoantrag sa
         JOIN kassenbuchung b ON b.id = sa.kassenbuchung_id
         WHERE sa.status = 'beantragt' AND (b.standort_id = $1 OR b.klient_id = ANY($2))`,
        [id, klientIds]
      );
      const { rows: buchungRows } = await client.query(
        `SELECT b.id, b.datum, b.betrag_cent, b.verwendungszweck, t.bezeichnung AS typ_bezeichnung,
                k.vorname, k.nachname
         FROM kassenbuchung b
         JOIN kassenbuchung_typ t ON t.id = b.typ_id
         LEFT JOIN klient k ON k.id = b.klient_id
         WHERE (b.standort_id = $1 OR b.klient_id = ANY($2)) AND NOT b.storniert
         ORDER BY b.datum DESC, b.erstellt_am DESC
         LIMIT ${LETZTE_BUCHUNGEN_LIMIT}`,
        [id, klientIds]
      );

      return {
        standort: standortRows[0],
        zimmer: {
          anzahl: zimmerListe.length,
          plaetzeGesamt,
          plaetzeBelegt,
          plaetzeFrei: plaetzeGesamt - plaetzeBelegt,
          liste: zimmerListe,
        },
        klienten: belegRows.map((r) => ({
          id: r.klient_id,
          name: `${r.vorname} ${r.nachname}`,
          aktenzeichen: r.aktenzeichen,
          amt: r.amt,
          zimmerNummer: r.zimmer_nummer,
          einzug: r.einzug,
          hzlWoechentlich: r.hzl_rhythmus === "woechentlich",
        })),
        kassenbuch: {
          hausSaldoCent: Number(hausRows[0].saldo),
          klientenSaldoCent: Number(klientenSaldoRows[0].saldo),
          hzl: { bezahlt: Number(hzlRows[0].bezahlt), gesamt: Number(hzlRows[0].gesamt), isoJahr: jahr, isoWoche: woche },
          offeneStornoantraege: Number(stornoRows[0].anzahl),
          letzteBuchungen: buchungRows.map((r) => ({
            id: r.id,
            datum: r.datum,
            betragCent: Number(r.betrag_cent),
            verwendungszweck: r.verwendungszweck,
            typBezeichnung: r.typ_bezeichnung,
            klientName: r.vorname ? `${r.vorname} ${r.nachname}` : null,
          })),
        },
      };
    });
  }
}
