import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, klientStandortBedingung } from "../common/standort-restriction";
import type { KlientArchivPdfEintrag } from "./klient-archiv.service";

// Ein anonymisierter Klient bleibt als Zeile (und damit als Ziel jeder
// Fremdschluessel-Kette aus Belegung/Kassenbuch/Rechnung) bestehen -- nur
// wer das darf, entscheidet ueber eine Aktion, die nicht rueckgaengig zu
// machen ist. Gleiches Rollenpaar wie bei Zimmer-/Standort-Stammdaten.
const ROLLEN_MIT_ANONYMISIERUNG = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

const ANONYM_PLATZHALTER = "Anonymisiert";

export interface KlientListEintrag {
  id: string;
  vorname: string;
  nachname: string;
  aktenzeichen: string;
  amt: string;
  hzlRhythmus: "monatlich" | "woechentlich";
  aktuellesZimmer: { id: string; nummer: string; standortName: string; belegungId: string } | null;
  anonymisiertAm: string | null;
  archiviertAm: string | null;
}

export interface KlientStammdaten {
  geburtsort: string | null;
  nationalitaet: string | null;
  sorgeberechtigt: string | null;
  bezugsbetreuerId: string | null;
  bezugsbetreuerName: string | null;
  betreuungsstunden: string | null;
  telefon: string | null;
  sprachen: string | null;
  anmerkungen: string | null;
  personaldokumente: string | null;
  bankkonto: string | null;
  iban: string | null;
  jugendamtAdresse: string | null;
  jugendamtSachbearbeiter: string | null;
  jugendamtStellenzeichen: string | null;
  jugendamtTelefon: string | null;
  jugendamtEmail: string | null;
  wjhName: string | null;
  wjhTelefon: string | null;
  wjhEmail: string | null;
  personensorgeberechtigte: string | null;
  besuchskontakte: string | null;
  krankenkasse: string | null;
  versichertennummer: string | null;
  medikamente: string | null;
  diagnosen: string | null;
  allergien: string | null;
  besonderheitenGesundheitlich: string | null;
  besonderheitenPsychisch: string | null;
  schule: string | null;
  klassenstufe: string | null;
  schulabschluesse: string | null;
  foerderbedarfe: string | null;
  vorherigeEinrichtungTraeger: string | null;
  vorherigeEinrichtungKontakt: string | null;
  vorherigeEinrichtungAnfrageAm: string | null;
  vorherigeEinrichtungEinzugAm: string | null;
  vorherigeEinrichtungAuszugAm: string | null;
  aktualisiertAm: string;
}

export interface KlientKontakt {
  id: string;
  beziehung: string | null;
  name: string;
  adresse: string | null;
  email: string | null;
  telefon: string | null;
}

export interface KlientDetail extends KlientListEintrag {
  geburtsdatum: string | null;
  aufnahmeAm: string | null;
  entlassenAm: string | null;
  stammdaten: KlientStammdaten | null;
  kontakte: KlientKontakt[];
  archiviertVonName: string | null;
  archivPdfs: KlientArchivPdfEintrag[];
}

@Injectable()
export class KlientService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * archiviert=false (Standard): nur aktive Klient:innen -- die allgemeine
   * Liste soll nicht mit Jahren an ausgezogenen/archivierten Akten
   * zuwachsen. archiviert=true: nur archivierte, fuer den Archiv-Reiter.
   * Dieser Filter ist zugleich der zentrale Hebel gegen versehentliche
   * Aktionen auf archivierten Klient:innen -- jede Klient-Auswahl im
   * Frontend, die von dieser Liste speist, schliesst sie damit automatisch
   * aus (siehe common/standort-restriction.ts::klientIstArchiviert() fuer
   * die serverseitige zweite Verteidigungslinie).
   */
  async findeAlle(archiviert = false): Promise<KlientListEintrag[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const params: unknown[] = [];
      const bedingungen = [
        klientStandortBedingung(erlaubteStandorte, "k", params),
        archiviert ? "k.archiviert_am IS NOT NULL" : "k.archiviert_am IS NULL",
      ];

      const { rows } = await client.query(
        `
        SELECT
          k.id, k.vorname, k.nachname, k.aktenzeichen, k.amt, k.hzl_rhythmus, k.anonymisiert_am, k.archiviert_am,
          z.id AS zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name, b.id AS belegung_id
        FROM klient k
        LEFT JOIN belegung b ON b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
        LEFT JOIN zimmer z ON z.id = b.zimmer_id
        LEFT JOIN standort s ON s.id = z.standort_id
        WHERE ${bedingungen.join(" AND ")}
        ORDER BY k.nachname, k.vorname
        `,
        params
      );
      return rows.map(zuListEintrag);
    });
  }

  async anlegen(input: {
    vorname: string;
    nachname: string;
    geburtsdatum: string;
    aktenzeichen: string;
    amt: string;
    hzlRhythmus: "monatlich" | "woechentlich";
  }) {
    const { mandantId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus`,
        [mandantId, input.vorname, input.nachname, input.geburtsdatum, input.aktenzeichen, input.amt, input.hzlRhythmus]
      );
      return {
        ...rows[0],
        hzlRhythmus: rows[0].hzl_rhythmus,
        aktuellesZimmer: null,
        anonymisiertAm: null,
        archiviertAm: null,
        aufnahmeAm: null,
        entlassenAm: null,
        stammdaten: null,
        kontakte: [],
        archiviertVonName: null,
        archivPdfs: [],
      };
    });
  }

  async findeEinen(id: string): Promise<KlientDetail> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const detail = await this.holeDetail(client, ctx.benutzerId, id);
      if (!detail) throw new NotFoundException("Klient nicht gefunden.");
      return detail;
    });
  }

  /**
   * Recht auf Loeschung (Art. 17 DSGVO) -- kein Hard-Delete, siehe Kommentar
   * in migrations/0027_klient_anonymisierung.sql: Kassenbuchungen und
   * Rechnungen haengen per klient_id an dieser Zeile und muessen als Belege
   * gegenueber dem Amt erhalten bleiben. Ueberschrieben werden nur die
   * identifizierenden Felder (Name, Geburtsdatum); Aktenzeichen und Amt
   * bleiben, weil Kassenbuch/Rechnungen weiterhin darauf verweisen und beide
   * fuer sich genommen keine Person identifizieren.
   */
  async anonymisieren(id: string): Promise<KlientDetail> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_ANONYMISIERUNG.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen einen Klienten anonymisieren.");
    }
    return this.db.withTenant(async (client) => {
      const { rows: aktualisiert } = await client.query(
        `UPDATE klient
         SET vorname = $2, nachname = $3, geburtsdatum = NULL,
             anonymisiert_am = now(), anonymisiert_von = $4
         WHERE id = $1 AND anonymisiert_am IS NULL
         RETURNING id`,
        [id, ANONYM_PLATZHALTER, ANONYM_PLATZHALTER, ctx.benutzerId]
      );
      if (aktualisiert.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM klient WHERE id = $1", [id]);
        if (vorhanden.length === 0) throw new NotFoundException("Klient nicht gefunden.");
        throw new ConflictException("Klient ist bereits anonymisiert.");
      }

      const detail = await this.holeDetail(client, ctx.benutzerId, id);
      if (!detail) throw new NotFoundException("Klient nicht gefunden.");
      return detail;
    });
  }

  private async holeDetail(client: import("pg").PoolClient, benutzerId: string, id: string): Promise<KlientDetail | null> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
    const params: unknown[] = [id];
    const bedingung = klientStandortBedingung(erlaubteStandorte, "k", params);

    const { rows } = await client.query(
      `
      SELECT
        k.id, k.vorname, k.nachname, k.geburtsdatum, k.aktenzeichen, k.amt, k.hzl_rhythmus, k.anonymisiert_am,
        k.archiviert_am, ab.name AS archiviert_von_name,
        z.id AS zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name, b.id AS belegung_id
      FROM klient k
      LEFT JOIN benutzer ab ON ab.id = k.archiviert_von
      LEFT JOIN belegung b ON b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
      LEFT JOIN zimmer z ON z.id = b.zimmer_id
      LEFT JOIN standort s ON s.id = z.standort_id
      WHERE k.id = $1 AND ${bedingung}
      `,
      params
    );
    if (rows.length === 0) return null;

    // Aufnahme-/Entlassungsdatum werden bewusst nicht gespeichert, sondern
    // aus den Belegungen abgeleitet (siehe migrations/0034_klient_stammdaten.sql):
    // Aufnahme = fruehester jemals erfasster Einzug, Entlassung = spaetester
    // Auszug, aber nur wenn AKTUELL kein offener Aufenthalt mehr besteht --
    // sonst wuerde ein fruehstes abgeschlossenes Intervall faelschlich als
    // "entlassen" angezeigt, obwohl der Klient laengst wieder da ist.
    const { rows: zeitraumRows } = await client.query(
      `
      SELECT
        MIN(einzug) AS aufnahme_am,
        CASE WHEN bool_or(auszug IS NULL AND einzug <= CURRENT_DATE) THEN NULL ELSE MAX(auszug) END AS entlassen_am
      FROM belegung
      WHERE klient_id = $1
      `,
      [id]
    );

    const { rows: stammdatenRows } = await client.query(
      `
      SELECT ks.*, b.name AS bezugsbetreuer_name
      FROM klient_stammdaten ks
      LEFT JOIN benutzer b ON b.id = ks.bezugsbetreuer_id
      WHERE ks.klient_id = $1
      `,
      [id]
    );

    const { rows: kontaktRows } = await client.query(
      `SELECT id, beziehung, name, adresse, email, telefon FROM klient_kontakt WHERE klient_id = $1 ORDER BY erstellt_am`,
      [id]
    );

    const { rows: archivRows } = await client.query(
      `SELECT a.id, a.erstellt_am, b.name AS erstellt_von_name
       FROM klient_archiv_pdf a
       LEFT JOIN benutzer b ON b.id = a.erstellt_von
       WHERE a.klient_id = $1
       ORDER BY a.erstellt_am DESC`,
      [id]
    );

    return {
      ...zuListEintrag(rows[0]),
      geburtsdatum: rows[0].geburtsdatum,
      aufnahmeAm: zeitraumRows[0].aufnahme_am,
      entlassenAm: zeitraumRows[0].entlassen_am,
      stammdaten: stammdatenRows.length > 0 ? zuStammdatenDto(stammdatenRows[0]) : null,
      kontakte: kontaktRows.map(zuKontaktDto),
      archiviertVonName: rows[0].archiviert_von_name,
      archivPdfs: archivRows.map((r) => ({ id: r.id, erstelltAm: r.erstellt_am, erstelltVonName: r.erstellt_von_name })),
    };
  }
}

function zuListEintrag(r: any): KlientListEintrag {
  return {
    id: r.id,
    vorname: r.vorname,
    nachname: r.nachname,
    aktenzeichen: r.aktenzeichen,
    amt: r.amt,
    hzlRhythmus: r.hzl_rhythmus,
    aktuellesZimmer: r.zimmer_id
      ? { id: r.zimmer_id, nummer: r.zimmer_nummer, standortName: r.standort_name, belegungId: r.belegung_id }
      : null,
    anonymisiertAm: r.anonymisiert_am,
    archiviertAm: r.archiviert_am,
  };
}

export function zuStammdatenDto(r: any): KlientStammdaten {
  return {
    geburtsort: r.geburtsort,
    nationalitaet: r.nationalitaet,
    sorgeberechtigt: r.sorgeberechtigt,
    bezugsbetreuerId: r.bezugsbetreuer_id,
    bezugsbetreuerName: r.bezugsbetreuer_name,
    betreuungsstunden: r.betreuungsstunden,
    telefon: r.telefon,
    sprachen: r.sprachen,
    anmerkungen: r.anmerkungen,
    personaldokumente: r.personaldokumente,
    bankkonto: r.bankkonto,
    iban: r.iban,
    jugendamtAdresse: r.jugendamt_adresse,
    jugendamtSachbearbeiter: r.jugendamt_sachbearbeiter,
    jugendamtStellenzeichen: r.jugendamt_stellenzeichen,
    jugendamtTelefon: r.jugendamt_telefon,
    jugendamtEmail: r.jugendamt_email,
    wjhName: r.wjh_name,
    wjhTelefon: r.wjh_telefon,
    wjhEmail: r.wjh_email,
    personensorgeberechtigte: r.personensorgeberechtigte,
    besuchskontakte: r.besuchskontakte,
    krankenkasse: r.krankenkasse,
    versichertennummer: r.versichertennummer,
    medikamente: r.medikamente,
    diagnosen: r.diagnosen,
    allergien: r.allergien,
    besonderheitenGesundheitlich: r.besonderheiten_gesundheitlich,
    besonderheitenPsychisch: r.besonderheiten_psychisch,
    schule: r.schule,
    klassenstufe: r.klassenstufe,
    schulabschluesse: r.schulabschluesse,
    foerderbedarfe: r.foerderbedarfe,
    vorherigeEinrichtungTraeger: r.vorherige_einrichtung_traeger,
    vorherigeEinrichtungKontakt: r.vorherige_einrichtung_kontakt,
    vorherigeEinrichtungAnfrageAm: r.vorherige_einrichtung_anfrage_am,
    vorherigeEinrichtungEinzugAm: r.vorherige_einrichtung_einzug_am,
    vorherigeEinrichtungAuszugAm: r.vorherige_einrichtung_auszug_am,
    aktualisiertAm: r.aktualisiert_am,
  };
}

export function zuKontaktDto(r: any): KlientKontakt {
  return {
    id: r.id,
    beziehung: r.beziehung,
    name: r.name,
    adresse: r.adresse,
    email: r.email,
    telefon: r.telefon,
  };
}
