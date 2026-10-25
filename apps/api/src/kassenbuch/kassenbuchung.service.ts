import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { dateiAusBase64 } from "../common/datei";
import {
  ermittleErlaubteStandortIds,
  klientIstArchiviert,
  klientIstErlaubt,
  klientStandortBedingung,
  standortIdBedingung,
  standortIstErlaubt,
} from "../common/standort-restriction";
import { isPgError } from "../common/pg-error";
import { RechteService } from "../rechte/rechte.service";
import { AuditService } from "../audit/audit.service";

// SQLSTATE-Codes, kein geratener String -- siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

// Custom-SQLSTATE aus kassenbuchung_stornoantrag_vier_augen_pruefen()
// (migrations/0045) -- kein Standard-Code, siehe dort. Greift in der Praxis
// vor allem als Gegenprobe/Fallback: der Normalfall (buchende Person stellt
// selbst den Antrag) wird in stornoBeantragen() schon vorher abgefangen,
// damit es dort eine verstaendliche Meldung statt einen rohen DB-Fehler gibt.
const STORNO_VIER_AUGEN_VERLETZT = "ZA002";

export interface KassenbuchungAnlegenEingabe {
  klientId?: string;
  standortId?: string;
  datum: string;
  betragCent: number;
  verwendungszweck?: string;
  typId: string;
  isoJahr?: number;
  isoWoche?: number;
  unterschriftBase64?: string;
  teilnehmerKlientIds?: string[];
  teilnehmerBenutzerIds?: string[];
}

/**
 * Inhalt der Anfrage als Hash, damit ein wiederverwendeter Idempotenzschluessel
 * mit ANDEREM Inhalt auffaellt (Migration 0061). Normalisiert wie anlegen()
 * selbst normalisiert -- getrimmter Zweck, Teilnehmer ohne Duplikate und
 * sortiert --, sonst wuerde ein Client, der beim zweiten Versuch die Liste
 * anders ordnet, faelschlich als Fehler abgewiesen. Die Unterschrift geht als
 * eigener Hash ein statt als Bild, damit der Fingerabdruck klein bleibt.
 */
export function fingerabdruck(input: KassenbuchungAnlegenEingabe): string {
  const sortiert = (ids?: string[]) => [...new Set(ids ?? [])].sort();
  const normalisiert = [
    input.klientId ?? null,
    input.standortId ?? null,
    input.datum,
    input.betragCent,
    input.verwendungszweck?.trim() ?? "",
    input.typId,
    input.isoJahr ?? null,
    input.isoWoche ?? null,
    input.unterschriftBase64 ? createHash("sha256").update(input.unterschriftBase64).digest("hex") : null,
    sortiert(input.teilnehmerKlientIds),
    sortiert(input.teilnehmerBenutzerIds),
  ];
  return createHash("sha256").update(JSON.stringify(normalisiert)).digest("hex");
}

export interface OffenerStornoantragDto {
  id: string;
  grund: string;
  beantragtVonName: string;
  beantragtAm: string;
}

export interface KassenbuchungTeilnehmerDto {
  klientId: string | null;
  benutzerId: string | null;
  name: string;
}

export interface KassenbuchungDto {
  id: string;
  belegnummer: number;
  klientId: string | null;
  klientName: string | null;
  standortId: string | null;
  standortName: string | null;
  datum: string;
  betragCent: number;
  verwendungszweck: string;
  typId: string;
  typBezeichnung: string;
  istHzl: boolean;
  isoJahr: number | null;
  isoWoche: number | null;
  storniert: boolean;
  stornoGrund: string | null;
  hatUnterschrift: boolean;
  gebuchtVonName: string | null;
  teilnehmer: KassenbuchungTeilnehmerDto[];
  // Genau der eine noch unentschiedene Antrag, falls vorhanden -- eine
  // Buchung kann laut kassenbuchung_stornoantrag_offen_je_buchung nie mehr
  // als einen gleichzeitig haben.
  offenerStornoantrag: OffenerStornoantragDto | null;
}

export interface WochenuebersichtEintrag {
  klientId: string;
  klientName: string;
  vorname: string;
  nachname: string;
  bezahlt: boolean;
  buchungId: string | null;
  betragCent: number | null;
  datum: string | null;
  letzterHzlBetragCent: number | null;
  saldoCent: number;
}

// Wiederkehrender Teil der SELECT-Liste/JOINs fuer eine Buchung -- klient_id
// UND standort_id sind seit Migration 0030 beide nullable (siehe
// kassenbuchung_klient_xor_standort), daher LEFT statt INNER JOIN.
const BUCHUNG_SELECT = `
  SELECT b.id, b.belegnummer, b.klient_id, k.vorname, k.nachname, b.standort_id, s.name AS standort_name,
         b.datum, b.betrag_cent, b.verwendungszweck, b.typ_id, t.bezeichnung AS typ_bezeichnung,
         b.ist_hzl, b.iso_jahr, b.iso_woche,
         b.storniert, b.storno_grund,
         (u.id IS NOT NULL) AS hat_unterschrift, mb.name AS gebucht_von_name,
         sa.id AS storno_antrag_id, sa.grund AS storno_antrag_grund,
         sab.name AS storno_beantragt_von_name, sa.beantragt_am AS storno_beantragt_am
  FROM kassenbuchung b
  LEFT JOIN klient k ON k.id = b.klient_id
  LEFT JOIN standort s ON s.id = b.standort_id
  JOIN kassenbuchung_typ t ON t.id = b.typ_id
  LEFT JOIN unterschrift u ON u.kassenbuchung_id = b.id
  LEFT JOIN benutzer mb ON mb.id = b.gebucht_von
  LEFT JOIN kassenbuchung_stornoantrag sa ON sa.kassenbuchung_id = b.id AND sa.status = 'beantragt'
  LEFT JOIN benutzer sab ON sab.id = sa.beantragt_von
`;

@Injectable()
export class KassenbuchungService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
  ) {}

  /**
   * Die Unterschriftspflicht fuer Auszahlungen ist eine
   * Mehrzeilen-Transaktions-Invariante (Buchung + Unterschrift zusammen
   * oder gar nicht) -- das laesst sich nicht als Constraint auf einer
   * einzelnen Tabelle ausdruecken, deshalb hier im Service, nicht in der
   * Datenbank. Alles, was sich als Ein-Tabellen-Constraint ausdruecken
   * liess (Ueberlappung, Eindeutigkeit, Aenderungsschutz), sitzt bewusst
   * in der Migration, nicht hier.
   *
   * Genau EINS von klientId/standortId muss gesetzt sein -- eine
   * Standort-Buchung (Spassgeld/Freizeitveranstaltung) gehoert dem ganzen
   * Haus, nicht einem einzelnen Klienten (siehe Migration 0030). Die
   * optionalen Teilnehmer (Klienten UND Mitarbeitende) sind rein
   * dokumentarisch -- wer teilgenommen hat, aendert nichts am Betrag.
   */
  async anlegen(input: KassenbuchungAnlegenEingabe): Promise<KassenbuchungDto> {
    return (await this.anlegenIdempotent(input)).buchung;
  }

  /**
   * anlegen() mit optionalem Idempotenzschluessel (Migration 0061): kommt
   * derselbe Schluessel von derselben Person mit demselben Inhalt noch einmal,
   * entsteht keine zweite Buchung -- die vorhandene wird zurueckgegeben,
   * wiederholt = true.
   */
  async anlegenIdempotent(
    input: KassenbuchungAnlegenEingabe,
    idempotenzSchluessel?: string
  ): Promise<{ buchung: KassenbuchungDto; wiederholt: boolean }> {
    const { mandantId, benutzerId } = requireTenantContext();
    // Das Recht stand in der Registry, wurde aber nirgends erzwungen: wer
    // eingeloggt war, konnte buchen. Die Vorab-Pruefung des Uebergabemodus
    // (darfBuchen) ist nur ehrlich, wenn dieselbe Frage hier verbindlich ist.
    if (!(await this.rechte.hatRecht("kassenbuch", "buchen"))) {
      throw new ForbiddenException("Für Kassenbuchungen fehlt die Berechtigung.");
    }
    const istAuszahlung = input.betragCent < 0;
    const verwendungszweck = input.verwendungszweck?.trim() ?? "";

    if (istAuszahlung && !input.unterschriftBase64) {
      throw new BadRequestException("Auszahlungen müssen mit einer Unterschrift bestätigt werden.");
    }
    if (Boolean(input.klientId) === Boolean(input.standortId)) {
      throw new BadRequestException("Entweder klientId oder standortId angeben, nicht beides und nicht keins.");
    }

    const teilnehmerKlientIds = [...new Set(input.teilnehmerKlientIds ?? [])];
    const teilnehmerBenutzerIds = [...new Set(input.teilnehmerBenutzerIds ?? [])];
    const abdruck = idempotenzSchluessel ? fingerabdruck(input) : null;

    try {
      return await this.db.withTenant(async (client) => {
        // Vor allen fachlichen Pruefungen: ist die Buchung schon angekommen,
        // gilt sie -- auch wenn der Klient inzwischen archiviert oder der Typ
        // deaktiviert wurde. Die Warteschlange auf dem Geraet soll eine
        // laengst gebuchte Auszahlung nicht als "abgelehnt" anzeigen.
        if (idempotenzSchluessel) {
          const vorhanden = await this.wiederholung(client, idempotenzSchluessel, abdruck!, benutzerId);
          if (vorhanden) return { buchung: vorhanden, wiederholt: true };
        }

        // Ob "Verwendungszweck" Pflicht ist (und wie das Feld heisst) haengt
        // seit Migration 0035 am gewaehlten Typ, nicht mehr an einer festen
        // Zod-Regel -- deshalb hier statt im Controller geprueft. RLS
        // sorgt nebenbei dafuer, dass eine typId aus einem fremden
        // Mandanten hier schlicht nicht gefunden wird.
        const { rows: typRows } = await client.query<{
          kommentar_pflicht: boolean;
          ist_hzl: boolean;
          aktiv: boolean;
        }>("SELECT kommentar_pflicht, ist_hzl, aktiv FROM kassenbuchung_typ WHERE id = $1", [input.typId]);
        if (typRows.length === 0) {
          throw new NotFoundException("Kassenbuch-Typ nicht gefunden.");
        }
        const typ = typRows[0];
        if (!typ.aktiv) {
          throw new BadRequestException("Dieser Kassenbuch-Typ ist deaktiviert.");
        }
        if (typ.kommentar_pflicht && !verwendungszweck) {
          throw new BadRequestException("Verwendungszweck darf nicht leer sein.");
        }
        if (typ.ist_hzl && !input.klientId) {
          throw new BadRequestException("HZL ist ausschließlich für einen einzelnen Klienten möglich.");
        }

        if (input.klientId) {
          if (!(await klientIstErlaubt(client, benutzerId, input.klientId))) {
            throw new NotFoundException("Klient nicht gefunden.");
          }
          if (await klientIstArchiviert(client, input.klientId)) {
            throw new BadRequestException("Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden.");
          }
        } else {
          if (!(await standortIstErlaubt(client, benutzerId, input.standortId!))) {
            throw new NotFoundException("Standort nicht gefunden.");
          }
        }

        if (teilnehmerKlientIds.length > 0) {
          const { rows } = await client.query("SELECT id FROM klient WHERE id = ANY($1)", [teilnehmerKlientIds]);
          if (rows.length !== teilnehmerKlientIds.length) {
            throw new NotFoundException("Mindestens ein ausgewählter Teilnehmer (Klient) wurde nicht gefunden.");
          }
        }
        if (teilnehmerBenutzerIds.length > 0) {
          const { rows } = await client.query("SELECT id FROM benutzer WHERE id = ANY($1)", [teilnehmerBenutzerIds]);
          if (rows.length !== teilnehmerBenutzerIds.length) {
            throw new NotFoundException("Mindestens ein ausgewählter Teilnehmer (Mitarbeiter) wurde nicht gefunden.");
          }
        }

        const { rows } = await client.query(
          `INSERT INTO kassenbuchung (mandant_id, klient_id, standort_id, datum, betrag_cent, verwendungszweck, typ_id, ist_hzl, iso_jahr, iso_woche, gebucht_von,
                                      idempotenz_schluessel, idempotenz_fingerabdruck)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            mandantId,
            input.klientId ?? null,
            input.standortId ?? null,
            input.datum,
            input.betragCent,
            verwendungszweck,
            input.typId,
            typ.ist_hzl,
            input.isoJahr ?? null,
            input.isoWoche ?? null,
            benutzerId,
            idempotenzSchluessel ?? null,
            abdruck,
          ]
        );
        const buchungId = rows[0].id;

        for (const teilnehmerKlientId of teilnehmerKlientIds) {
          await client.query(
            "INSERT INTO kassenbuchung_teilnehmer (mandant_id, kassenbuchung_id, klient_id) VALUES ($1, $2, $3)",
            [mandantId, buchungId, teilnehmerKlientId]
          );
        }
        for (const teilnehmerBenutzerId of teilnehmerBenutzerIds) {
          await client.query(
            "INSERT INTO kassenbuchung_teilnehmer (mandant_id, kassenbuchung_id, benutzer_id) VALUES ($1, $2, $3)",
            [mandantId, buchungId, teilnehmerBenutzerId]
          );
        }

        if (input.unterschriftBase64) {
          const bild = dateiAusBase64(input.unterschriftBase64);
          const bildHash = createHash("sha256").update(bild).digest("hex");
          await client.query(
            "INSERT INTO unterschrift (mandant_id, kassenbuchung_id, bild, bild_hash) VALUES ($1, $2, $3, $4)",
            [mandantId, buchungId, bild, bildHash]
          );
        }

        return { buchung: await this.findeEineIntern(client, buchungId), wiederholt: false };
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        // Zwei Versuche mit demselben Schluessel gleichzeitig: beide haben
        // oben nichts gefunden, der zweite wartet am Index, bis der erste
        // committet, und scheitert dann. Welcher Index dabei zuerst anschlaegt
        // (Idempotenz oder HZL-Woche), legt Postgres fest, nicht wir --
        // deshalb hier nicht am Constraint-Namen unterscheiden, sondern
        // nachsehen, ob unter dem Schluessel inzwischen eine Buchung steht.
        if (idempotenzSchluessel) {
          const vorhanden = await this.db.withTenant((client) =>
            this.wiederholung(client, idempotenzSchluessel, abdruck!, benutzerId)
          );
          if (vorhanden) return { buchung: vorhanden, wiederholt: true };
        }
        throw new ConflictException("Für diese Kalenderwoche wurde für diesen Klienten bereits eine HZL-Zahlung erfasst.");
      }
      throw err;
    }
  }

  /**
   * Die Buchung, die unter diesem Schluessel schon angelegt wurde -- oder null.
   * Nur fuer dieselbe Person und denselben Inhalt: sonst ist es kein
   * Wiederholungsversuch, und die Antwort wuerde einer anderen Person eine
   * Buchung zeigen, die sie vielleicht gar nicht sehen darf (Standort).
   */
  private async wiederholung(
    client: PoolClient,
    schluessel: string,
    abdruck: string,
    benutzerId: string
  ): Promise<KassenbuchungDto | null> {
    const { rows } = await client.query<{ id: string; idempotenz_fingerabdruck: string; gebucht_von: string | null }>(
      "SELECT id, idempotenz_fingerabdruck, gebucht_von FROM kassenbuchung WHERE idempotenz_schluessel = $1",
      [schluessel]
    );
    if (rows.length === 0) return null;
    if (rows[0].gebucht_von !== benutzerId || rows[0].idempotenz_fingerabdruck !== abdruck) {
      throw new ConflictException(
        "Dieser Idempotenzschlüssel wurde bereits für eine andere Buchung verwendet."
      );
    }
    return this.findeEineIntern(client, rows[0].id);
  }

  /**
   * Stellt einen Storno-Antrag. Jede Rolle darf das (auch ein Betreuer, der
   * die Buchung nicht mehr selbst rueckgaengig machen kann) -- ob er sofort
   * wirksam wird, haengt von ZWEI Bedingungen ab: die antragstellende
   * Person braucht das Recht kassenbuch.storno-entscheiden, UND sie darf
   * nicht selbst die buchende Person sein (Vier-Augen-Prinzip, siehe
   * Migration 0045 -- dort als Trigger hart erzwungen, auch fuer
   * Geschaeftsfuehrung, hier zusaetzlich mit einer verstaendlichen Meldung
   * vorab abgefangen). Ist beides erfuellt, wird im selben Zug bewilligt
   * (kein Sinn, auf die eigene Bewilligung zu warten); sonst bleibt der
   * Antrag offen, bis eine ANDERE berechtigte Person ueber stornoEntscheiden()
   * entscheidet -- das gilt jetzt auch fuer eine Leitung, die ihre eigene
   * Buchung stornieren will.
   */
  async stornoBeantragen(kassenbuchungId: string, grund: string): Promise<KassenbuchungDto> {
    const ctx = requireTenantContext();
    const { benutzerId } = ctx;
    return this.db.withTenant(async (client) => {
      const { rows: buchungRows } = await client.query(
        "SELECT klient_id, standort_id, storniert, gebucht_von FROM kassenbuchung WHERE id = $1",
        [kassenbuchungId]
      );
      if (buchungRows.length === 0) {
        throw new NotFoundException("Buchung nicht gefunden.");
      }
      const { klient_id, standort_id, storniert, gebucht_von } = buchungRows[0];
      if (storniert) {
        throw new ConflictException("Diese Buchung ist bereits storniert.");
      }
      const erlaubt = klient_id
        ? await klientIstErlaubt(client, benutzerId, klient_id)
        : await standortIstErlaubt(client, benutzerId, standort_id);
      if (!erlaubt) {
        throw new NotFoundException("Buchung nicht gefunden.");
      }
      if (klient_id && (await klientIstArchiviert(client, klient_id))) {
        throw new BadRequestException("Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden.");
      }

      let antragQuery;
      try {
        antragQuery = await client.query<{ id: string }>(
          `INSERT INTO kassenbuchung_stornoantrag (mandant_id, kassenbuchung_id, grund, beantragt_von)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [ctx.mandantId, kassenbuchungId, grund, benutzerId]
        );
      } catch (err) {
        if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
          throw new ConflictException("Für diese Buchung liegt bereits ein offener Storno-Antrag vor.");
        }
        throw err;
      }

      const istBuchendePerson = gebucht_von === benutzerId;
      if (!istBuchendePerson && (await this.rechte.hatRecht("kassenbuch", "storno-entscheiden"))) {
        await this.bewilligeAntrag(client, antragQuery.rows[0].id, kassenbuchungId, grund, benutzerId);
      }
      return this.findeEineIntern(client, kassenbuchungId);
    });
  }

  /**
   * Bewilligt oder lehnt einen fremden (typischerweise: von einem Betreuer
   * gestellten) Storno-Antrag ab. Die Standort-Sichtbarkeitspruefung ist
   * dieselbe wie beim frueheren Direkt-Storno: eine Einrichtungsleitung
   * darf nur ueber Antraege ihres eigenen Standorts entscheiden, die
   * Bereichsleitung standortuebergreifend (weil ermittleErlaubteStandortIds
   * fuer sie null liefert, siehe common/standort-restriction.ts).
   */
  async stornoEntscheiden(antragId: string, entscheidung: "genehmigt" | "abgelehnt", ablehnungGrund?: string): Promise<KassenbuchungDto> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("kassenbuch", "storno-entscheiden"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen über Storno-Anträge entscheiden.");
    }
    if (entscheidung === "abgelehnt" && !ablehnungGrund) {
      throw new BadRequestException("Für eine Ablehnung ist ein Grund erforderlich.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT sa.grund, b.id AS kassenbuchung_id, b.klient_id, b.standort_id
         FROM kassenbuchung_stornoantrag sa
         JOIN kassenbuchung b ON b.id = sa.kassenbuchung_id
         WHERE sa.id = $1 AND sa.status = 'beantragt'`,
        [antragId]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Storno-Antrag nicht gefunden oder bereits entschieden.");
      }
      const { grund, kassenbuchung_id, klient_id, standort_id } = rows[0];
      const erlaubt = klient_id
        ? await klientIstErlaubt(client, ctx.benutzerId, klient_id)
        : await standortIstErlaubt(client, ctx.benutzerId, standort_id);
      if (!erlaubt) {
        throw new NotFoundException("Storno-Antrag nicht gefunden oder bereits entschieden.");
      }

      try {
        if (entscheidung === "genehmigt") {
          await this.bewilligeAntrag(client, antragId, kassenbuchung_id, grund, ctx.benutzerId);
        } else {
          const { rowCount } = await client.query(
            `UPDATE kassenbuchung_stornoantrag
             SET status = 'abgelehnt', ablehnung_grund = $1, entschieden_von = $2, entschieden_am = now()
             WHERE id = $3 AND status = 'beantragt'`,
            [ablehnungGrund, ctx.benutzerId, antragId]
          );
          if (rowCount === 0) {
            throw new NotFoundException("Storno-Antrag nicht gefunden oder bereits entschieden.");
          }
        }
      } catch (err) {
        // Normalfall faengt schon stornoBeantragen() ab (dort bleibt der
        // Antrag einfach offen statt automatisch bewilligt zu werden) --
        // dieser Fall greift nur, wenn jemand trotzdem ueber diesen Pfad
        // (z.B. unter geliehenem Recht per Delegation) ueber den eigenen
        // Antrag zu entscheiden versucht. Der Trigger
        // kassenbuchung_stornoantrag_vier_augen_pruefen() (Migration 0045)
        // kennt dabei keine Ausnahme fuer den Rechte-Herkunftsweg -- die
        // Regel ist strukturell, nicht nur Konvention.
        if (isPgError(err) && err.code === STORNO_VIER_AUGEN_VERLETZT) {
          throw new ForbiddenException("Wer eine Buchung selbst gebucht hat, darf nicht über deren Storno entscheiden.");
        }
        throw err;
      }
      return this.findeEineIntern(client, kassenbuchung_id);
    });
  }

  /**
   * Gemeinsamer Kern von Sofort-Bewilligung (stornoBeantragen() bei
   * Leitung) und Fremd-Bewilligung (stornoEntscheiden()): markiert den
   * Antrag als genehmigt und fuehrt den eigentlichen Storno aus (dieselbe
   * Spalten-UPDATE wie das frueheren Direkt-Storno). "WHERE status =
   * 'beantragt'"/"WHERE NOT storniert" schuetzen beide gegen ein doppeltes
   * Ausfuehren, falls zwei Anfragen sich ueberschneiden.
   */
  private async bewilligeAntrag(
    client: PoolClient,
    antragId: string,
    kassenbuchungId: string,
    grund: string,
    entschiedenVon: string
  ): Promise<void> {
    await client.query(
      `UPDATE kassenbuchung_stornoantrag
       SET status = 'genehmigt', entschieden_von = $1, entschieden_am = now()
       WHERE id = $2 AND status = 'beantragt'`,
      [entschiedenVon, antragId]
    );
    await client.query(
      `UPDATE kassenbuchung
       SET storniert = true, storno_grund = $1, storniert_von = $2, storniert_am = now()
       WHERE id = $3 AND NOT storniert`,
      [grund, entschiedenVon, kassenbuchungId]
    );
  }

  /**
   * `standortId` filtert auf einen Standort: Standort-Buchungen dieses
   * Standorts PLUS Buchungen von Klient:innen, die aktuell dort wohnen. Die
   * Sichtbarkeitsregel unten bleibt unabhaengig davon bestehen (AND) -- und
   * ein Standort ausserhalb der eigenen Zuordnung ist ein 404 (wie beim
   * Buchen auf einen fremden Standort), kein stilles "keine Treffer".
   */
  async findeAlle(filter?: { klientId?: string; standortId?: string }): Promise<KassenbuchungDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (filter?.standortId && !(await standortIstErlaubt(client, benutzerId, filter.standortId))) {
        throw new NotFoundException("Standort nicht gefunden.");
      }
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [];
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
      const { rows } = await client.query(
        `${BUCHUNG_SELECT}
         WHERE ${bedingungen.join(" AND ")}
         ORDER BY b.datum DESC, b.erstellt_am DESC`,
        params
      );
      const teilnehmerNachBuchung = await holeTeilnehmer(client, rows.map((r) => r.id));
      return rows.map((r) => zuDto(r, teilnehmerNachBuchung.get(r.id) ?? []));
    });
  }

  /**
   * `standortId` schraenkt auf Klient:innen ein, die aktuell an diesem
   * Standort wohnen -- gleiche Regel und gleiches Verhalten wie bei
   * findeAlle() (fremder Standort = 404, Zuordnungs-Einschraenkung gilt
   * zusaetzlich).
   */
  async wochenuebersicht(isoJahr: number, isoWoche: number, standortId?: string): Promise<WochenuebersichtEintrag[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (standortId && !(await standortIstErlaubt(client, benutzerId, standortId))) {
        throw new NotFoundException("Standort nicht gefunden.");
      }
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [isoJahr, isoWoche];
      let standortBedingung = klientStandortBedingung(erlaubteStandorte, "k", params);
      if (standortId) {
        standortBedingung += ` AND ${klientStandortBedingung([standortId], "k", params)}`;
      }

      const { rows } = await client.query(
        `
        SELECT k.id AS klient_id, k.vorname, k.nachname,
               b.id AS buchung_id, b.betrag_cent, b.datum,
               (SELECT abs(h.betrag_cent) FROM kassenbuchung h
                 WHERE h.klient_id = k.id AND h.ist_hzl AND NOT h.storniert
                 ORDER BY h.datum DESC, h.erstellt_am DESC LIMIT 1) AS letzter_hzl_betrag_cent,
               (SELECT COALESCE(SUM(s.betrag_cent), 0) FROM kassenbuchung s
                 WHERE s.klient_id = k.id AND NOT s.storniert) AS saldo_cent
        FROM klient k
        LEFT JOIN kassenbuchung b
          ON b.klient_id = k.id AND b.ist_hzl AND b.iso_jahr = $1 AND b.iso_woche = $2 AND NOT b.storniert
        WHERE k.hzl_rhythmus = 'woechentlich' AND ${standortBedingung}
        ORDER BY k.nachname, k.vorname
        `,
        params
      );
      return rows.map((r) => ({
        klientId: r.klient_id,
        klientName: `${r.vorname} ${r.nachname}`,
        vorname: r.vorname,
        nachname: r.nachname,
        bezahlt: r.buchung_id !== null,
        buchungId: r.buchung_id,
        betragCent: r.betrag_cent,
        datum: r.datum,
        // SUM liefert bigint, pg gibt das als String zurueck.
        letzterHzlBetragCent: r.letzter_hzl_betrag_cent === null ? null : Number(r.letzter_hzl_betrag_cent),
        saldoCent: Number(r.saldo_cent),
      }));
    });
  }

  /**
   * Vorab-Pruefung fuer den Uebergabemodus: ob die Person ueberhaupt buchen
   * darf, soll sich zeigen, BEVOR das Geraet an die Klient:in geht -- sonst
   * faellt ein 403 erst nach der Unterschrift auf. Die eigentliche Pruefung
   * beim Buchen (anlegen) bleibt unveraendert die Autoritaet.
   */
  async darfBuchen(): Promise<{ darf: boolean }> {
    return { darf: await this.rechte.hatRecht("kassenbuch", "buchen") };
  }

  /**
   * Entsperren des HZL-Uebergabemodus: die Mitarbeiter:in bestaetigt mit dem
   * Passwort IHRES eigenen Kontos. Das Passwort wird vor der Klient:in
   * getippt -- der Preis dafuer, dass kein zweites Geheimnis verwaltet werden
   * muss. Jeder Versuch geht ins Audit-Log, auch ein fehlgeschlagener: wird
   * das Geraet in der Uebergabe durchprobiert, soll das nachvollziehbar sein.
   * Falsches Passwort ist bewusst 403 und nicht 401: der Web-Client beendet
   * bei einem 401 mit Token die Sitzung (api/client.ts).
   */
  async hzlUebergabeEntsperren(passwort: string): Promise<void> {
    const { benutzerId } = requireTenantContext();
    const ok = await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ passwort_hash: string }>("SELECT passwort_hash FROM benutzer WHERE id = $1", [benutzerId]);
      const richtig = rows.length > 0 && (await bcrypt.compare(passwort, rows[0].passwort_hash));
      await this.audit.protokollieren(client, {
        modul: "kassenbuch",
        aktion: richtig ? "hzl-uebergabe.entsperrt" : "hzl-uebergabe.entsperren-fehlgeschlagen",
        objektTyp: "benutzer",
        objektId: benutzerId,
      });
      return richtig;
    });
    if (!ok) throw new ForbiddenException("Das Passwort ist falsch.");
  }

  async unterschriftBild(kassenbuchungId: string): Promise<{ bild: Buffer; hash: string } | null> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ bild: Buffer; bild_hash: string; klient_id: string | null; standort_id: string | null }>(
        `SELECT u.bild, u.bild_hash, b.klient_id, b.standort_id
         FROM unterschrift u
         JOIN kassenbuchung b ON b.id = u.kassenbuchung_id
         WHERE u.kassenbuchung_id = $1`,
        [kassenbuchungId]
      );
      if (rows.length === 0) return null;
      const { klient_id, standort_id } = rows[0];
      const erlaubt = klient_id
        ? await klientIstErlaubt(client, benutzerId, klient_id)
        : await standortIstErlaubt(client, benutzerId, standort_id!);
      if (!erlaubt) return null;
      return { bild: rows[0].bild, hash: rows[0].bild_hash };
    });
  }

  private async findeEineIntern(client: PoolClient, id: string): Promise<KassenbuchungDto> {
    const { rows } = await client.query(`${BUCHUNG_SELECT} WHERE b.id = $1`, [id]);
    const teilnehmer = await holeTeilnehmer(client, [id]);
    return zuDto(rows[0], teilnehmer.get(id) ?? []);
  }
}

async function holeTeilnehmer(client: PoolClient, buchungIds: string[]): Promise<Map<string, KassenbuchungTeilnehmerDto[]>> {
  const map = new Map<string, KassenbuchungTeilnehmerDto[]>();
  if (buchungIds.length === 0) return map;
  const { rows } = await client.query(
    `SELECT t.kassenbuchung_id, t.klient_id, t.benutzer_id,
            COALESCE(k.vorname || ' ' || k.nachname, mb.name) AS name
     FROM kassenbuchung_teilnehmer t
     LEFT JOIN klient k ON k.id = t.klient_id
     LEFT JOIN benutzer mb ON mb.id = t.benutzer_id
     WHERE t.kassenbuchung_id = ANY($1)
     ORDER BY name`,
    [buchungIds]
  );
  for (const r of rows) {
    const liste = map.get(r.kassenbuchung_id) ?? [];
    liste.push({ klientId: r.klient_id, benutzerId: r.benutzer_id, name: r.name });
    map.set(r.kassenbuchung_id, liste);
  }
  return map;
}

function zuDto(r: any, teilnehmer: KassenbuchungTeilnehmerDto[]): KassenbuchungDto {
  return {
    id: r.id,
    belegnummer: r.belegnummer,
    klientId: r.klient_id,
    klientName: r.klient_id ? `${r.vorname} ${r.nachname}` : null,
    standortId: r.standort_id,
    standortName: r.standort_name,
    datum: r.datum,
    betragCent: r.betrag_cent,
    verwendungszweck: r.verwendungszweck,
    typId: r.typ_id,
    typBezeichnung: r.typ_bezeichnung,
    istHzl: r.ist_hzl,
    isoJahr: r.iso_jahr,
    isoWoche: r.iso_woche,
    storniert: r.storniert,
    stornoGrund: r.storno_grund,
    hatUnterschrift: r.hat_unterschrift,
    gebuchtVonName: r.gebucht_von_name,
    teilnehmer,
    offenerStornoantrag: r.storno_antrag_id
      ? {
          id: r.storno_antrag_id,
          grund: r.storno_antrag_grund,
          beantragtVonName: r.storno_beantragt_von_name,
          beantragtAm: r.storno_beantragt_am,
        }
      : null,
  };
}
