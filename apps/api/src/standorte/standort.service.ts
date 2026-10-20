import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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

@Injectable()
export class StandortService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
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
        `SELECT id, name, adresse, aktiv FROM standort WHERE ${bedingung} ORDER BY name`,
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
  async anlegen(input: { name: string; adresse: string }): Promise<StandortDto> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("standorte", "anlegen"))) {
      throw new ForbiddenException("Nur die Bereichsleitung darf eine neue Einrichtung anlegen.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<StandortDto>(
        "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, $3) RETURNING id, name, adresse, aktiv",
        [ctx.mandantId, input.name, input.adresse]
      );
      return rows[0];
    });
  }

  /**
   * "aktiv" faellt bewusst nicht weg, wenn ein Standort noch belegte oder
   * zugeordnete Zimmer hat -- das Deaktivieren bedeutet nur "kein neues
   * Zimmer mehr hier anlegen", nicht "alles hier verschwindet". Bestehende
   * Zimmer und ihre Belegungen bleiben unangetastet sichtbar.
   */
  async aktualisieren(
    id: string,
    input: { name?: string; adresse?: string; aktiv?: boolean }
  ): Promise<StandortDto> {
    if (!(await this.rechte.hatRecht("standorte", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen eine Einrichtung bearbeiten.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<StandortDto>(
        `UPDATE standort
         SET name = COALESCE($1, name), adresse = COALESCE($2, adresse), aktiv = COALESCE($3, aktiv)
         WHERE id = $4
         RETURNING id, name, adresse, aktiv`,
        [input.name ?? null, input.adresse ?? null, input.aktiv ?? null, id]
      );
      if (rows.length === 0) throw new NotFoundException("Standort nicht gefunden.");
      return rows[0];
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
        "SELECT id, name, adresse, aktiv FROM standort WHERE id = $1",
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
