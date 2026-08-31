import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";
import { initialen } from "../common/anonymisierung";
import { isPgError } from "../common/pg-error";

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
  belegungId: string;
}

export interface OffenerKapazitaetsantragEintrag {
  id: string;
  alteKapazitaet: number;
  neueKapazitaet: number;
  beantragtVonName: string;
  beantragtVonRolle: BenutzerRolle;
  beantragtAm: string;
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
  offenerKapazitaetsantrag: OffenerKapazitaetsantragEintrag | null;
}

export interface BelegungsverlaufEintrag {
  id: string;
  klientId: string | null; // null fuer anonymisierte Vergangenheit -- kein Nachschlagen ohne Berechtigung moeglich
  name: string;
  einzug: string;
  auszug: string | null;
  istAktuell: boolean;
}

// Wer den vollen Namen ehemaliger Bewohner:innen sehen darf (z.B. für
// Amtsnachfragen), statt nur der Initialen -- siehe Bauplan Punkt 03: "die
// API entscheidet anhand der Rolle". Der aktuelle Bewohner wird immer mit
// vollem Namen angezeigt, unabhängig von der Rolle -- operativ braucht das
// jede Mitarbeiterin, die vor der Tür steht.
const ROLLEN_MIT_VOLLEM_VERLAUF = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

// Zimmer-/Standort-Stammdaten sind eine strukturelle Entscheidung über die
// Einrichtung, kein operatives Tagesgeschäft -- Klient zuweisen/Auszug
// eintragen (belegung.service.ts) bleibt bewusst für alle Rollen offen,
// das hier nicht. Gleiches Rollenmuster wie ROLLEN_MIT_STORNO in
// kassenbuchung.service.ts.
const ROLLEN_MIT_ZIMMER_STAMMDATEN = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

// Custom-SQLSTATE aus dem Trigger belegung_kapazitaet_pruefen()
// (migrations/0032), kein Standard-Code -- siehe dort.
const KAPAZITAET_UEBERSCHRITTEN = "ZA001";

// Vier-Augen: wer eine Kapazitaet aendern darf, entscheidet ROLLEN_MIT_
// ZIMMER_STAMMDATEN wie ueberall sonst bei Zimmer-Stammdaten. Wer sie
// BESTAETIGEN darf, ist keine feste Rollenmenge, sondern haengt vom
// Antragsteller ab -- siehe kapazitaetEntscheiden().
function gegenrolle(rolle: BenutzerRolle): BenutzerRolle {
  return rolle === "bereichsleitung" ? "einrichtungsleitung" : "bereichsleitung";
}

@Injectable()
export class ZimmerService {
  constructor(private readonly db: DatabaseService) {}

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
        ka.id AS antrag_id, ka.alte_kapazitaet, ka.neue_kapazitaet, ka.beantragt_am,
        kab.name AS antrag_beantragt_von_name, kab.rolle AS antrag_beantragt_von_rolle
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
        offenerKapazitaetsantrag: r.antrag_id
          ? {
              id: r.antrag_id,
              alteKapazitaet: r.alte_kapazitaet,
              neueKapazitaet: r.neue_kapazitaet,
              beantragtVonName: r.antrag_beantragt_von_name,
              beantragtVonRolle: r.antrag_beantragt_von_rolle,
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
      SELECT b.zimmer_id, b.id AS belegung_id, b.klient_id, b.einzug, k.vorname, k.nachname
      FROM belegung b
      JOIN klient k ON k.id = b.klient_id
      WHERE b.zimmer_id = ANY($1) AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
      ORDER BY b.einzug ASC
      `,
      [zimmerIds]
    );
    for (const r of rows) {
      const liste = map.get(r.zimmer_id) ?? [];
      liste.push({ id: r.klient_id, name: `${r.vorname} ${r.nachname}`, einzug: r.einzug, belegungId: r.belegung_id });
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
    if (!ROLLEN_MIT_ZIMMER_STAMMDATEN.has(ctx.rolle)) {
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
    if (!ROLLEN_MIT_ZIMMER_STAMMDATEN.has(ctx.rolle)) {
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
    if (!ROLLEN_MIT_ZIMMER_STAMMDATEN.has(ctx.rolle)) {
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
   * Vier-Augen-Kern: die entscheidende Person muss die jeweils ANDERE
   * Leitungsrolle haben als die antragstellende -- nie dieselbe, nie
   * dieselbe Person. Anders als beim Kassenbuch-Storno-Antrag
   * (kassenbuchung.service.ts) gibt es hier bewusst keine Selbstbewilligung.
   * Bereichsleitung entscheidet standortuebergreifend, Einrichtungsleitung
   * nur fuer Zimmer des eigenen Standorts (dieselbe Pruefung wie bei jeder
   * anderen Zimmer-Stammdatenaenderung).
   */
  async kapazitaetEntscheiden(
    antragId: string,
    entscheidung: "bestaetigt" | "abgelehnt",
    ablehnungGrund?: string
  ): Promise<ZimmerListEintrag> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_ZIMMER_STAMMDATEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen über eine Kapazitätsänderung entscheiden.");
    }
    if (entscheidung === "abgelehnt" && !ablehnungGrund) {
      throw new BadRequestException("Für eine Ablehnung ist ein Grund erforderlich.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{
        zimmer_id: string;
        neue_kapazitaet: number;
        beantragt_von_rolle: BenutzerRolle;
      }>(
        `SELECT ka.zimmer_id, ka.neue_kapazitaet, b.rolle AS beantragt_von_rolle
         FROM zimmer_kapazitaetsantrag ka
         JOIN benutzer b ON b.id = ka.beantragt_von
         WHERE ka.id = $1 AND ka.status = 'beantragt'`,
        [antragId]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Antrag nicht gefunden oder bereits entschieden.");
      }
      const { zimmer_id: zimmerId, neue_kapazitaet: neueKapazitaet, beantragt_von_rolle: antragstellerRolle } = rows[0];

      if (ctx.rolle !== gegenrolle(antragstellerRolle)) {
        throw new ForbiddenException(
          antragstellerRolle === "bereichsleitung"
            ? "Diese Änderung wurde von der Bereichsleitung gestellt und muss von einer Einrichtungsleitung bestätigt werden."
            : "Diese Änderung wurde von einer Einrichtungsleitung gestellt und muss von der Bereichsleitung bestätigt werden."
        );
      }

      // Einrichtungsleitung nur fuer den eigenen Standort -- Bereichsleitung
      // (ctx.rolle hier immer die Gegenrolle des Antragstellers) hat per
      // ermittleErlaubteStandortIds() ohnehin keine Standort-Zuordnung.
      if (ctx.rolle === "einrichtungsleitung") {
        if (!(await this.standortDesZimmersErlaubt(client, ctx.benutzerId, zimmerId))) {
          throw new NotFoundException("Zimmer nicht gefunden.");
        }
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
    if (!ROLLEN_MIT_ZIMMER_STAMMDATEN.has(ctx.rolle)) {
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
    const vollerName = ROLLEN_MIT_VOLLEM_VERLAUF.has(ctx.rolle);

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

      return rows.map((r) => {
        const istAktuell = r.auszug === null;
        const zeigeVollenNamen = istAktuell || vollerName;
        return {
          id: r.id,
          klientId: zeigeVollenNamen ? r.klient_id : null,
          name: zeigeVollenNamen ? `${r.vorname} ${r.nachname}` : initialen(r.vorname, r.nachname),
          einzug: r.einzug,
          auszug: r.auszug,
          istAktuell,
        };
      });
    });
  }
}
