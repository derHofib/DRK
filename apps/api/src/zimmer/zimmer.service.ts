import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, klientIstArchiviert } from "../common/standort-restriction";
import { initialen } from "../common/anonymisierung";
import { isPgError } from "../common/pg-error";
import { RechteService } from "../rechte/rechte.service";

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (zimmer_standort_id_nummer_key,
// siehe migrations/0009_zimmer.sql), kein geratener String -- siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

/**
 * "zugeordnet" = kein Bewohner, "teilweise" = mindestens ein Platz frei,
 * aber nicht leer, "vergeben" = voll belegt. Bei Kapazitaet 1 (der
 * Standardfall) faellt "teilweise" nie an -- der dritte Wert existiert nur
 * fuer Mehrbettzimmer.
 */
export type Zimmerstatus = "vergeben" | "teilweise" | "zugeordnet";

export interface ZimmerBewohnerEintrag {
  id: string;
  name: string;
  einzug: string;
  auszug: string | null;
  belegungId: string;
}

export interface OffenerKapazitaetsantragEintrag {
  id: string;
  alteKapazitaet: number;
  neueKapazitaet: number;
  beantragtVonName: string;
  // Clientseitig nur fuer "ist das meine eigene Anfrage" -- die eigentliche
  // Selbstbestaetigungssperre prueft kapazitaetEntscheiden() serverseitig.
  beantragtVonId: string;
  beantragtAm: string;
}

export interface ZimmerWartelisteEintrag {
  id: string;
  klientId: string;
  klientName: string;
  eingetragenAm: string;
  eingetragenVonName: string | null;
}

export interface ZimmerListEintrag {
  id: string;
  nummer: string;
  etage: string;
  standortId: string;
  standortName: string;
  kapazitaet: number;
  status: Zimmerstatus;
  bewohner: ZimmerBewohnerEintrag[];
  warteliste: ZimmerWartelisteEintrag[];
  offenerKapazitaetsantrag: OffenerKapazitaetsantragEintrag | null;
}

export interface BelegungsverlaufEintrag {
  id: string;
  klientId: string | null; // null fuer anonymisierte Vergangenheit -- kein Nachschlagen ohne Berechtigung moeglich
  name: string;
  einzug: string;
  auszug: string | null;
  istAktuell: boolean;
  geplant: boolean;
}

// Custom-SQLSTATE aus dem Trigger belegung_kapazitaet_pruefen()
// (migrations/0032), kein Standard-Code -- siehe dort.
const KAPAZITAET_UEBERSCHRITTEN = "ZA001";

@Injectable()
export class ZimmerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async findeAlle(): Promise<ZimmerListEintrag[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant((client) => this.ladeZimmerListe(client, ctx.benutzerId));
  }

  /**
   * Gemeinsamer Kern von findeAlle() und den Antwortwerten der
   * Kapazitaets-Methoden (die nach einer Aenderung den aktuellen Stand
   * genau dieses einen Zimmers zurueckgeben, statt nur ein Teilergebnis).
   * "status" wird hier abgeleitet (nie gespeichert): "zugeordnet" ohne
   * Bewohner, "vergeben" bei erreichter Kapazitaet, sonst "teilweise".
   */
  private async ladeZimmerListe(
    client: PoolClient,
    benutzerId: string,
    nurZimmerId?: string
  ): Promise<ZimmerListEintrag[]> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);

    // Deaktivierte Zimmer verschwinden aus der Liste -- "deaktivieren" waere
    // sonst folgenlos. Ihre Belegungshistorie bleibt in der Datenbank
    // unangetastet, nur dieser eine Blick darauf zeigt sie nicht mehr.
    const bedingungen = ["z.aktiv"];
    const params: unknown[] = [];
    if (erlaubteStandorte) {
      params.push(erlaubteStandorte);
      bedingungen.push(`z.standort_id = ANY($${params.length})`);
    }
    if (nurZimmerId) {
      params.push(nurZimmerId);
      bedingungen.push(`z.id = $${params.length}`);
    }

    const { rows: zimmerRows } = await client.query(
      `
      SELECT
        z.id, z.nummer, z.etage, z.standort_id, s.name AS standort_name, z.kapazitaet,
        ka.id AS antrag_id, ka.alte_kapazitaet, ka.neue_kapazitaet, ka.beantragt_am, ka.beantragt_von,
        kab.name AS antrag_beantragt_von_name
      FROM zimmer z
      JOIN standort s ON s.id = z.standort_id
      LEFT JOIN zimmer_kapazitaetsantrag ka ON ka.zimmer_id = z.id AND ka.status = 'beantragt'
      LEFT JOIN benutzer kab ON kab.id = ka.beantragt_von
      WHERE ${bedingungen.join(" AND ")}
      ORDER BY s.name, z.etage, z.nummer
      `,
      params
    );

    const bewohnerNachZimmer = await this.ladeBewohner(
      client,
      zimmerRows.map((r) => r.id)
    );
    const wartelisteNachZimmer = await this.ladeWarteliste(
      client,
      zimmerRows.map((r) => r.id)
    );

    return zimmerRows.map((r) => {
      const bewohner = bewohnerNachZimmer.get(r.id) ?? [];
      const status: Zimmerstatus =
        bewohner.length === 0 ? "zugeordnet" : bewohner.length >= r.kapazitaet ? "vergeben" : "teilweise";
      return {
        id: r.id,
        nummer: r.nummer,
        etage: r.etage,
        standortId: r.standort_id,
        standortName: r.standort_name,
        kapazitaet: r.kapazitaet,
        status,
        bewohner,
        warteliste: wartelisteNachZimmer.get(r.id) ?? [],
        offenerKapazitaetsantrag: r.antrag_id
          ? {
              id: r.antrag_id,
              alteKapazitaet: r.alte_kapazitaet,
              neueKapazitaet: r.neue_kapazitaet,
              beantragtVonName: r.antrag_beantragt_von_name,
              beantragtVonId: r.beantragt_von,
              beantragtAm: r.beantragt_am,
            }
          : null,
      };
    });
  }

  private async ladeBewohner(client: PoolClient, zimmerIds: string[]): Promise<Map<string, ZimmerBewohnerEintrag[]>> {
    const map = new Map<string, ZimmerBewohnerEintrag[]>();
    if (zimmerIds.length === 0) return map;
    const { rows } = await client.query(
      `
      SELECT b.zimmer_id, b.id AS belegung_id, b.klient_id, b.einzug, b.auszug, k.vorname, k.nachname
      FROM belegung b
      JOIN klient k ON k.id = b.klient_id
      WHERE b.zimmer_id = ANY($1)
        AND b.einzug <= CURRENT_DATE AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
      ORDER BY b.einzug ASC
      `,
      [zimmerIds]
    );
    for (const r of rows) {
      const liste = map.get(r.zimmer_id) ?? [];
      liste.push({
        id: r.klient_id,
        name: `${r.vorname} ${r.nachname}`,
        einzug: r.einzug,
        auszug: r.auszug,
        belegungId: r.belegung_id,
      });
      map.set(r.zimmer_id, liste);
    }
    return map;
  }

  private async ladeWarteliste(client: PoolClient, zimmerIds: string[]): Promise<Map<string, ZimmerWartelisteEintrag[]>> {
    const map = new Map<string, ZimmerWartelisteEintrag[]>();
    if (zimmerIds.length === 0) return map;
    const { rows } = await client.query(
      `
      SELECT w.id, w.zimmer_id, w.klient_id, w.eingetragen_am, k.vorname, k.nachname, eb.name AS eingetragen_von_name
      FROM zimmer_warteliste w
      JOIN klient k ON k.id = w.klient_id
      LEFT JOIN benutzer eb ON eb.id = w.eingetragen_von
      WHERE w.zimmer_id = ANY($1)
      ORDER BY w.eingetragen_am ASC
      `,
      [zimmerIds]
    );
    for (const r of rows) {
      const liste = map.get(r.zimmer_id) ?? [];
      liste.push({
        id: r.id,
        klientId: r.klient_id,
        klientName: `${r.vorname} ${r.nachname}`,
        eingetragenAm: r.eingetragen_am,
        eingetragenVonName: r.eingetragen_von_name,
      });
      map.set(r.zimmer_id, liste);
    }
    return map;
  }

  private async findeEinzelnes(client: PoolClient, benutzerId: string, zimmerId: string): Promise<ZimmerListEintrag> {
    const liste = await this.ladeZimmerListe(client, benutzerId, zimmerId);
    if (liste.length === 0) throw new NotFoundException("Zimmer nicht gefunden.");
    return liste[0];
  }

  async anlegen(input: { standortId: string; nummer: string; etage?: string; kapazitaet?: number }) {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("zimmer", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Zimmer anlegen.");
    }
    try {
      return await this.db.withTenant(async (client) => {
        const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
        if (erlaubteStandorte && !erlaubteStandorte.includes(input.standortId)) {
          throw new NotFoundException("Standort nicht gefunden.");
        }
        const { rows } = await client.query(
          `INSERT INTO zimmer (mandant_id, standort_id, nummer, etage, kapazitaet)
           VALUES ($1, $2, $3, COALESCE($4, 'EG'), COALESCE($5, 1))
           RETURNING id, nummer, etage, standort_id, kapazitaet`,
          [ctx.mandantId, input.standortId, input.nummer, input.etage ?? null, input.kapazitaet ?? null]
        );
        return rows[0];
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Diese Zimmernummer gibt es in diesem Standort bereits.");
      }
      throw err;
    }
  }

  /**
   * Standort-Einschraenkung hier von Hand statt ueber
   * klientStandortBedingung(): ein Zimmer haengt direkt an standort_id, es
   * braucht keinen Umweg ueber eine aktuelle Belegung wie bei klient.
   */
  private async standortDesZimmersErlaubt(
    client: import("pg").PoolClient,
    benutzerId: string,
    zimmerId: string
  ): Promise<string | null> {
    const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
    const { rows } = await client.query<{ standort_id: string }>(
      "SELECT standort_id FROM zimmer WHERE id = $1",
      [zimmerId]
    );
    if (rows.length === 0) return null;
    if (erlaubteStandorte && !erlaubteStandorte.includes(rows[0].standort_id)) return null;
    return rows[0].standort_id;
  }

  async aktualisieren(id: string, input: { nummer: string; etage?: string }) {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("zimmer", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Zimmer bearbeiten.");
    }
    try {
      return await this.db.withTenant(async (client) => {
        if (!(await this.standortDesZimmersErlaubt(client, ctx.benutzerId, id))) {
          throw new NotFoundException("Zimmer nicht gefunden.");
        }
        const { rows } = await client.query(
          `UPDATE zimmer SET nummer = $1, etage = COALESCE($2, etage) WHERE id = $3
           RETURNING id, nummer, etage, standort_id`,
          [input.nummer, input.etage ?? null, id]
        );
        return rows[0];
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Diese Zimmernummer gibt es in diesem Standort bereits.");
      }
      throw err;
    }
  }

  /**
   * Stellt einen Antrag auf eine neue Kapazitaet -- wirkt NIE sofort,
   * anders als nummer/etage in aktualisieren(). Erst kapazitaetEntscheiden()
   * durch die jeweils andere Leitungsrolle setzt zimmer.kapazitaet.
   */
  async kapazitaetAendern(id: string, neueKapazitaet: number): Promise<ZimmerListEintrag> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("zimmer", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen die Kapazität ändern.");
    }
    return this.db.withTenant(async (client) => {
      if (!(await this.standortDesZimmersErlaubt(client, ctx.benutzerId, id))) {
        throw new NotFoundException("Zimmer nicht gefunden.");
      }
      const { rows: zRows } = await client.query<{ kapazitaet: number }>(
        "SELECT kapazitaet FROM zimmer WHERE id = $1",
        [id]
      );
      const alteKapazitaet = zRows[0].kapazitaet;
      if (neueKapazitaet === alteKapazitaet) {
        throw new BadRequestException("Die neue Kapazität entspricht der aktuellen -- keine Änderung nötig.");
      }

      if (neueKapazitaet < alteKapazitaet) {
        const anzahlBewohner = await this.zaehleAktuelleBewohner(client, id);
        if (anzahlBewohner > neueKapazitaet) {
          throw new ConflictException(
            `Dieses Zimmer hat aktuell ${anzahlBewohner} Bewohner:innen -- eine Reduzierung auf ${neueKapazitaet} ist erst nach ausreichend Auszügen möglich.`
          );
        }
      }

      try {
        await client.query(
          `INSERT INTO zimmer_kapazitaetsantrag (mandant_id, zimmer_id, alte_kapazitaet, neue_kapazitaet, beantragt_von)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.mandantId, id, alteKapazitaet, neueKapazitaet, ctx.benutzerId]
        );
      } catch (err) {
        if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
          throw new ConflictException("Für dieses Zimmer liegt bereits eine offene Kapazitätsänderung vor.");
        }
        throw err;
      }

      return this.findeEinzelnes(client, ctx.benutzerId, id);
    });
  }

  /**
   * Vier-Augen-Kern: die entscheidende Person braucht das eigene, frei
   * vergebbare Recht zimmer.kapazitaet-entscheiden (nicht nur
   * zimmer.bearbeiten) und darf nie die eigene Anfrage bestaetigen --
   * anders als beim Kassenbuch-Storno-Antrag (kassenbuchung.service.ts)
   * gibt es hier bewusst keine Selbstbewilligung. Welche konkrete(n)
   * Person(en)/Accounttypen das Recht bekommen, legt der Mandant ueber die
   * Account-Typ-Rechte selbst fest (frueher: feste "Gegenrolle").
   */
  async kapazitaetEntscheiden(
    antragId: string,
    entscheidung: "bestaetigt" | "abgelehnt",
    ablehnungGrund?: string
  ): Promise<ZimmerListEintrag> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("zimmer", "kapazitaet-entscheiden"))) {
      throw new ForbiddenException("Keine Berechtigung, über eine Kapazitätsänderung zu entscheiden.");
    }
    if (entscheidung === "abgelehnt" && !ablehnungGrund) {
      throw new BadRequestException("Für eine Ablehnung ist ein Grund erforderlich.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{
        zimmer_id: string;
        neue_kapazitaet: number;
        beantragt_von: string;
      }>(
        `SELECT ka.zimmer_id, ka.neue_kapazitaet, ka.beantragt_von
         FROM zimmer_kapazitaetsantrag ka
         WHERE ka.id = $1 AND ka.status = 'beantragt'`,
        [antragId]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Antrag nicht gefunden oder bereits entschieden.");
      }
      const { zimmer_id: zimmerId, neue_kapazitaet: neueKapazitaet, beantragt_von: antragstellerBenutzerId } = rows[0];

      if (ctx.benutzerId === antragstellerBenutzerId) {
        throw new ForbiddenException("Niemand darf die eigene Kapazitätsänderung bestätigen.");
      }

      // Unconditional statt nur fuer eine frueher feste "Einrichtungsleitung"
      // -- standortDesZimmersErlaubt() liefert fuer eine standortmaessig
      // unbeschraenkte Person ueber ermittleErlaubteStandortIds() ohnehin
      // "erlaubt".
      if (!(await this.standortDesZimmersErlaubt(client, ctx.benutzerId, zimmerId))) {
        throw new NotFoundException("Zimmer nicht gefunden.");
      }

      if (entscheidung === "bestaetigt") {
        // Erneute Pruefung: die Bewohnerzahl kann sich zwischen Antrag und
        // Bestaetigung veraendert haben (neuer Einzug in der Zwischenzeit).
        const anzahlBewohner = await this.zaehleAktuelleBewohner(client, zimmerId);
        if (anzahlBewohner > neueKapazitaet) {
          throw new ConflictException(
            "Die Bewohnerzahl ist inzwischen höher als die beantragte Kapazität -- diese Änderung kann so nicht bestätigt werden."
          );
        }
        await client.query("UPDATE zimmer SET kapazitaet = $1 WHERE id = $2", [neueKapazitaet, zimmerId]);
        const { rowCount } = await client.query(
          `UPDATE zimmer_kapazitaetsantrag SET status = 'bestaetigt', entschieden_von = $1, entschieden_am = now()
           WHERE id = $2 AND status = 'beantragt'`,
          [ctx.benutzerId, antragId]
        );
        if (rowCount === 0) throw new NotFoundException("Antrag nicht gefunden oder bereits entschieden.");
      } else {
        const { rowCount } = await client.query(
          `UPDATE zimmer_kapazitaetsantrag SET status = 'abgelehnt', ablehnung_grund = $1, entschieden_von = $2, entschieden_am = now()
           WHERE id = $3 AND status = 'beantragt'`,
          [ablehnungGrund, ctx.benutzerId, antragId]
        );
        if (rowCount === 0) throw new NotFoundException("Antrag nicht gefunden oder bereits entschieden.");
      }

      return this.findeEinzelnes(client, ctx.benutzerId, zimmerId);
    });
  }

  private async zaehleAktuelleBewohner(client: PoolClient, zimmerId: string): Promise<number> {
    const { rows } = await client.query<{ anzahl: string }>(
      "SELECT count(*) AS anzahl FROM belegung WHERE zimmer_id = $1 AND auszug IS NULL AND einzug <= CURRENT_DATE",
      [zimmerId]
    );
    return Number(rows[0].anzahl);
  }

  /**
   * Bewusst kein DELETE: belegung.zimmer_id verweist ohne ON DELETE CASCADE
   * auf zimmer (siehe migrations/0010), ein geloeschtes Zimmer risse damit
   * entweder die Belegungshistorie mit oder scheiterte an der
   * Fremdschluessel-Constraint -- beides falsch fuer Daten, die fuer
   * Amtsnachfragen erhalten bleiben muessen. "Entfernen" heisst hier
   * deshalb wie bei mandant/standort: aktiv = false, die Historie bleibt.
   */
  async deaktivieren(id: string) {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("zimmer", "bearbeiten"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Zimmer deaktivieren.");
    }
    return this.db.withTenant(async (client) => {
      const standortId = await this.standortDesZimmersErlaubt(client, ctx.benutzerId, id);
      if (!standortId) throw new NotFoundException("Zimmer nicht gefunden.");

      const { rows: offene } = await client.query(
        "SELECT 1 FROM belegung WHERE zimmer_id = $1 AND auszug IS NULL",
        [id]
      );
      if (offene.length > 0) {
        throw new ConflictException(
          "Dieses Zimmer ist aktuell belegt und kann nicht deaktiviert werden. Erst den Auszug eintragen."
        );
      }

      const { rows } = await client.query(
        "UPDATE zimmer SET aktiv = false WHERE id = $1 RETURNING id, nummer, standort_id",
        [id]
      );
      return rows[0];
    });
  }

  async belegungsverlauf(zimmerId: string): Promise<BelegungsverlaufEintrag[]> {
    const ctx = requireTenantContext();
    const vollerName = await this.rechte.hatRecht("zimmer", "voller-verlauf");

    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const bedingungen = ["b.zimmer_id = $1"];
      const params: unknown[] = [zimmerId];
      if (erlaubteStandorte) {
        params.push(erlaubteStandorte);
        bedingungen.push(`z.standort_id = ANY($${params.length})`);
      }

      const { rows } = await client.query(
        `
        SELECT b.id, b.klient_id, b.einzug, b.auszug, k.vorname, k.nachname
        FROM belegung b
        JOIN klient k ON k.id = b.klient_id
        JOIN zimmer z ON z.id = b.zimmer_id
        WHERE ${bedingungen.join(" AND ")}
        ORDER BY b.einzug DESC
        `,
        params
      );

      const heute = new Date().toISOString().slice(0, 10);
      return rows.map((r) => {
        // "istAktuell" bedeutet "wohnt gerade hier" -- nicht nur "kein
        // Auszug gesetzt". Ein schon eingetragener, aber erst kuenftig
        // faelliger Auszug darf die Person nicht sofort aus der aktuellen
        // Belegung werfen (siehe auch zimmer.service.ts: ladeBewohner()
        // und klient.service.ts: holeDetail(), gleiche Korrektur).
        const istAktuell = r.einzug <= heute && (r.auszug === null || r.auszug > heute);
        // Noch gar nicht begonnen -- fuer die "Geplant"-Kennzeichnung in der
        // Oberflaeche (vorausschauende Planung).
        const geplant = r.einzug > heute;
        // Namensanzeige bewusst UNVERAENDERT an istAktuell gekoppelt (nicht
        // zusaetzlich an geplant): "operativ vor der Tuer stehen" trifft auf
        // einen erst kuenftig geplanten Einzug nicht zu -- der aktuelle
        // Bewohner wird deshalb immer mit vollem Namen angezeigt,
        // unabhaengig vom zimmer.voller-verlauf-Recht.
        const zeigeVollenNamen = istAktuell || vollerName;
        return {
          id: r.id,
          klientId: zeigeVollenNamen ? r.klient_id : null,
          name: zeigeVollenNamen ? `${r.vorname} ${r.nachname}` : initialen(r.vorname, r.nachname),
          einzug: r.einzug,
          auszug: r.auszug,
          istAktuell,
          geplant,
        };
      });
    });
  }

  /**
   * Warteliste je Zimmer (siehe migrations/0038_zimmer_warteliste.sql):
   * fuer vorausschauendes Planen, wenn ein Zimmer voll ist, aber ein
   * konkreter Klient dort einziehen soll, sobald ein Platz frei wird --
   * oder ein bestehender Bewohner in ein anderes Zimmer wechseln moechte.
   * Offen fuer alle Rollen -- operatives Tagesgeschaeft wie einziehen()/
   * ausziehen() in belegung.service.ts, kein Zimmer-Stammdaten-Fall.
   */
  async wartelisteHinzufuegen(zimmerId: string, klientId: string): Promise<ZimmerListEintrag> {
    const { mandantId, benutzerId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        if (!(await this.standortDesZimmersErlaubt(client, benutzerId, zimmerId))) {
          throw new NotFoundException("Zimmer nicht gefunden.");
        }
        if (await klientIstArchiviert(client, klientId)) {
          throw new BadRequestException("Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden.");
        }

        await client.query(
          `INSERT INTO zimmer_warteliste (mandant_id, zimmer_id, klient_id, eingetragen_von)
           VALUES ($1, $2, $3, $4)`,
          [mandantId, zimmerId, klientId, benutzerId]
        );
        return this.findeEinzelnes(client, benutzerId, zimmerId);
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Dieser Klient steht bereits auf der Warteliste dieses Zimmers.");
      }
      throw err;
    }
  }

  async wartelisteEntfernen(zimmerId: string, eintragId: string): Promise<ZimmerListEintrag> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await this.standortDesZimmersErlaubt(client, benutzerId, zimmerId))) {
        throw new NotFoundException("Zimmer nicht gefunden.");
      }
      await client.query("DELETE FROM zimmer_warteliste WHERE id = $1 AND zimmer_id = $2", [eintragId, zimmerId]);
      return this.findeEinzelnes(client, benutzerId, zimmerId);
    });
  }
}
