import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, klientStandortBedingung, standortIdBedingung } from "../common/standort-restriction";
import { isoWoche } from "../common/iso-woche";

/**
 * Schwellen fuer die beiden Hinweislisten -- Vorschlagswerte aus dem
 * Dashboard-Konzeptpapier, hier festgelegt statt (noch) einstellbar: fuer
 * den Anfang reicht ein sinnvoller fester Wert, eine Mandanteneinstellung
 * laesst sich jederzeit nachruesten, sobald sich in der Praxis zeigt, dass
 * er variieren muss.
 *
 * 30 Tage: genug Vorlauf, um vor Ablauf einer Kostenuebernahme noch beim
 * Amt nachzufragen, ohne die Liste mit laengst nicht dringenden
 * Zeitraeumen zu fuellen.
 */
const KOSTENUEBERNAHME_BALD_ENDEND_TAGE = 30;
/**
 * 7 Tage: aus dem woechentlichen HZL-Rhythmus abgeleitet -- ein Klient
 * ohne Tagesbericht seit einer vollen Woche ist ein Fuersorge-Hinweis,
 * kein Alltagsrauschen.
 */
const TAGESBERICHT_SCHWELLE_TAGE = 7;
const LISTEN_LIMIT = 10;

export interface DashboardDto {
  zimmer: { frei: number; gesamt: number; standorte: number };
  hzlWoche: { bezahlt: number; gesamt: number; isoJahr: number; isoWoche: number };
  offeneRechnungen: { anzahl: number; summeCent: number };
  offeneStornoantraege: { anzahl: number };
  mitarbeitende: { aktiv: number; gesamt: number; ausstehendeResets: number };
  kostenuebernahmenBaldEndend: {
    klientId: string;
    klientName: string;
    amt: string;
    bis: string;
    tageVerbleibend: number;
  }[];
  klientenOhneTagesbericht: {
    klientId: string;
    klientName: string;
    standortName: string;
    zimmerNummer: string;
    tageSeitLetztem: number | null;
  }[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async ermitteln(): Promise<DashboardDto> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      // Nacheinander statt Promise.all: alle Abfragen teilen sich denselben
      // PoolClient (eine Transaktion, siehe DatabaseService.withTenant), und
      // ein einzelner Client kann immer nur eine Abfrage gleichzeitig
      // ausfuehren -- gleichzeitig gestartet wuerden sie von pg nur intern
      // nacheinander abgearbeitet, aber mit einer Deprecation-Warnung (und ab
      // pg 9 einem Fehler) quittiert.
      const zimmer = await this.zimmerFrei(client, erlaubteStandorte);
      const hzlWoche = await this.hzlWoche(client, erlaubteStandorte);
      const offeneRechnungen = await this.offeneRechnungen(client, erlaubteStandorte);
      const offeneStornoantraege = await this.offeneStornoantraege(client, erlaubteStandorte);
      const mitarbeitende = await this.mitarbeitende(client, erlaubteStandorte);
      const kostenuebernahmenBaldEndend = await this.kostenuebernahmenBaldEndend(client, erlaubteStandorte);
      const klientenOhneTagesbericht = await this.klientenOhneTagesbericht(client, erlaubteStandorte);
      return {
        zimmer,
        hzlWoche,
        offeneRechnungen,
        offeneStornoantraege,
        mitarbeitende,
        kostenuebernahmenBaldEndend,
        klientenOhneTagesbericht,
      };
    });
  }

  /**
   * "frei" zaehlt seit Migration 0032 freie PLAETZE, nicht freie Zimmer --
   * ein Zimmer mit Kapazitaet 3 und 2 Bewohnern traegt einen freien Platz
   * bei, nicht null. Ein einfacher LEFT JOIN auf belegung wuerde bei
   * mehreren Bewohnern pro Zimmer mehrere Zeilen je Zimmer liefern (falsch
   * gezaehlte Kapazitaet) -- die LATERAL-Subquery zaehlt deshalb je Zimmer
   * separat, bevor summiert wird.
   */
  private async zimmerFrei(client: PoolClient, erlaubteStandorte: string[] | null) {
    const bedingungen = ["z.aktiv"];
    const params: unknown[] = [];
    if (erlaubteStandorte) {
      params.push(erlaubteStandorte);
      bedingungen.push(`z.standort_id = ANY($${params.length})`);
    }
    const { rows } = await client.query(
      `
      SELECT
        COALESCE(SUM(z.kapazitaet - belegte.anzahl), 0) AS frei,
        COALESCE(SUM(z.kapazitaet), 0) AS gesamt,
        count(DISTINCT z.standort_id) AS standorte
      FROM zimmer z
      LEFT JOIN LATERAL (
        SELECT count(*) AS anzahl FROM belegung b
        WHERE b.zimmer_id = z.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
      ) belegte ON true
      WHERE ${bedingungen.join(" AND ")}
      `,
      params
    );
    const r = rows[0];
    return { frei: Number(r.frei), gesamt: Number(r.gesamt), standorte: Number(r.standorte) };
  }

  private async hzlWoche(client: PoolClient, erlaubteStandorte: string[] | null) {
    const { jahr, woche } = isoWoche(new Date());
    const params: unknown[] = [jahr, woche];
    const standortBedingung = klientStandortBedingung(erlaubteStandorte, "k", params);
    const { rows } = await client.query(
      `
      SELECT
        count(*) FILTER (WHERE b.id IS NOT NULL) AS bezahlt,
        count(*) AS gesamt
      FROM klient k
      LEFT JOIN kassenbuchung b
        ON b.klient_id = k.id AND b.typ = 'hzl' AND b.iso_jahr = $1 AND b.iso_woche = $2 AND NOT b.storniert
      WHERE k.hzl_rhythmus = 'woechentlich' AND k.anonymisiert_am IS NULL AND ${standortBedingung}
      `,
      params
    );
    const r = rows[0];
    return { bezahlt: Number(r.bezahlt), gesamt: Number(r.gesamt), isoJahr: jahr, isoWoche: woche };
  }

  private async offeneRechnungen(client: PoolClient, erlaubteStandorte: string[] | null) {
    const params: unknown[] = [];
    const standortBedingung = klientStandortBedingung(erlaubteStandorte, "k", params);
    const { rows } = await client.query(
      `
      SELECT count(*) AS anzahl, COALESCE(sum(r.betrag_cent), 0) AS summe_cent
      FROM rechnung r
      JOIN klient k ON k.id = r.klient_id
      JOIN LATERAL (
        SELECT status FROM rechnung_statuswechsel WHERE rechnung_id = r.id ORDER BY lfd_nr DESC LIMIT 1
      ) sw ON true
      WHERE sw.status = 'beantragt' AND ${standortBedingung}
      `,
      params
    );
    const r = rows[0];
    return { anzahl: Number(r.anzahl), summeCent: Number(r.summe_cent) };
  }

  /**
   * Zaehlt Antraege auf Standort-Buchungen ODER Klienten-Buchungen -- eine
   * kassenbuchung hat immer genau eins von beiden (siehe Migration 0030),
   * dieselbe Bedingung wie in kassenbuchung.service.ts::findeAlle().
   */
  private async offeneStornoantraege(client: PoolClient, erlaubteStandorte: string[] | null) {
    const params: unknown[] = [];
    const klientBed = klientStandortBedingung(erlaubteStandorte, "k", params);
    const standortBed = standortIdBedingung(erlaubteStandorte, "b.standort_id", params);
    const { rows } = await client.query(
      `
      SELECT count(*) AS anzahl
      FROM kassenbuchung_stornoantrag sa
      JOIN kassenbuchung b ON b.id = sa.kassenbuchung_id
      LEFT JOIN klient k ON k.id = b.klient_id
      WHERE sa.status = 'beantragt'
        AND ((b.klient_id IS NOT NULL AND ${klientBed}) OR (b.standort_id IS NOT NULL AND ${standortBed}))
      `,
      params
    );
    return { anzahl: Number(rows[0].anzahl) };
  }

  /**
   * Mitarbeitende sind traegerweit angelegt, nicht ueber eine offene
   * Belegung an einen Standort gebunden wie Klient:innen -- die
   * Einschraenkung laeuft deshalb direkt ueber benutzer_standort, analog zu
   * standortDesZimmersErlaubt() in zimmer.service.ts.
   */
  private async mitarbeitende(client: PoolClient, erlaubteStandorte: string[] | null) {
    const bedingungen = ["true"];
    const params: unknown[] = [];
    if (erlaubteStandorte) {
      params.push(erlaubteStandorte);
      bedingungen.push(
        `EXISTS (SELECT 1 FROM benutzer_standort bs WHERE bs.benutzer_id = b.id AND bs.standort_id = ANY($${params.length}))`
      );
    }
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE b.aktiv) AS aktiv, count(*) AS gesamt FROM benutzer b WHERE ${bedingungen.join(" AND ")}`,
      params
    );
    const { rows: resetRows } = await client.query(
      "SELECT count(*) AS anzahl FROM benutzer_reset_token WHERE eingeloest_am IS NULL AND laeuft_ab_am > now()"
    );
    return {
      aktiv: Number(rows[0].aktiv),
      gesamt: Number(rows[0].gesamt),
      ausstehendeResets: Number(resetRows[0].anzahl),
    };
  }

  private async kostenuebernahmenBaldEndend(client: PoolClient, erlaubteStandorte: string[] | null) {
    const params: unknown[] = [KOSTENUEBERNAHME_BALD_ENDEND_TAGE];
    const standortBedingung = klientStandortBedingung(erlaubteStandorte, "k", params);
    const { rows } = await client.query(
      `
      SELECT k.id AS klient_id, k.vorname, k.nachname, ko.amt, ko.bis,
             (ko.bis - CURRENT_DATE) AS tage_verbleibend
      FROM kostenuebernahme ko
      JOIN klient k ON k.id = ko.klient_id
      WHERE ko.bis IS NOT NULL
        AND ko.bis BETWEEN CURRENT_DATE AND CURRENT_DATE + $1 * INTERVAL '1 day'
        AND k.anonymisiert_am IS NULL
        AND ${standortBedingung}
      ORDER BY ko.bis ASC
      LIMIT ${LISTEN_LIMIT}
      `,
      params
    );
    return rows.map((r) => ({
      klientId: r.klient_id,
      klientName: `${r.vorname} ${r.nachname}`,
      amt: r.amt,
      bis: r.bis,
      tageVerbleibend: Number(r.tage_verbleibend),
    }));
  }

  /**
   * Nur aktuell wohnhafte Klient:innen (offene Belegung) -- wer schon
   * ausgezogen ist, braucht keinen weiteren Tagesbericht mehr.
   */
  private async klientenOhneTagesbericht(client: PoolClient, erlaubteStandorte: string[] | null) {
    const params: unknown[] = [TAGESBERICHT_SCHWELLE_TAGE];
    const bedingungen = ["k.anonymisiert_am IS NULL"];
    if (erlaubteStandorte) {
      params.push(erlaubteStandorte);
      bedingungen.push(`z.standort_id = ANY($${params.length})`);
    }
    const { rows } = await client.query(
      `
      SELECT k.id AS klient_id, k.vorname, k.nachname, s.name AS standort_name, z.nummer,
             MAX(t.datum) AS letzter_bericht
      FROM klient k
      JOIN belegung bel ON bel.klient_id = k.id AND bel.auszug IS NULL AND bel.einzug <= CURRENT_DATE
      JOIN zimmer z ON z.id = bel.zimmer_id
      JOIN standort s ON s.id = z.standort_id
      LEFT JOIN tagesbericht t ON t.klient_id = k.id
      WHERE ${bedingungen.join(" AND ")}
      GROUP BY k.id, k.vorname, k.nachname, s.name, z.nummer
      HAVING MAX(t.datum) IS NULL OR MAX(t.datum) <= CURRENT_DATE - $1 * INTERVAL '1 day'
      ORDER BY letzter_bericht ASC NULLS FIRST
      LIMIT ${LISTEN_LIMIT}
      `,
      params
    );
    return rows.map((r) => ({
      klientId: r.klient_id,
      klientName: `${r.vorname} ${r.nachname}`,
      standortName: r.standort_name,
      zimmerNummer: r.nummer,
      tageSeitLetztem: r.letzter_bericht
        ? Math.floor((Date.now() - new Date(r.letzter_bericht).getTime()) / 86_400_000)
        : null,
    }));
  }
}
