import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { isPgError } from "../common/pg-error";
import { istDelegierbar } from "../rechte/registry";
import { AuditService } from "../audit/audit.service";

// Custom-SQLSTATE aus delegation_vier_augen_pruefen() (migrations/0046) --
// kein Standard-Code, siehe dort. Greift in der Praxis nur als
// Gegenprobe/Fallback: der Normalfall (die im Antrag benannte Vertretung
// genehmigt) wird in genehmigen() schon vorher geprueft, damit es dort eine
// verstaendliche Meldung statt einen rohen DB-Fehler gibt.
const DELEGATION_VIER_AUGEN_VERLETZT = "ZA003";

export type DelegationStatus = "beantragt" | "genehmigt" | "widerrufen";
export type DelegationEffektiverStatus = "beantragt" | "genehmigt" | "aktiv" | "abgelaufen" | "widerrufen";

export interface DelegationDto {
  id: string;
  vertretenerBenutzerId: string;
  vertretenerName: string;
  vertreterBenutzerId: string;
  vertreterName: string;
  von: string;
  bis: string;
  umfang: "alle" | "auswahl";
  sensibleRechteEingeschlossen: boolean;
  status: DelegationStatus;
  effektiverStatus: DelegationEffektiverStatus;
}

/**
 * "status speichert nur beantragt/genehmigt/widerrufen -- aktiv/abgelaufen
 * ergeben sich beim Lesen aus genehmigt + von/bis vs. heute" (siehe
 * Kommentar auf der Tabelle, migrations/0043_delegation.sql) -- CLAUDE.md
 * Regel 4, Zustaende werden abgeleitet, nicht gespeichert. Datumsspalten
 * kommen ueber database.service.ts als reine "YYYY-MM-DD"-Strings zurueck,
 * ein lexikalischer Vergleich mit dem ebenso formatierten heutigen Datum
 * ist deshalb korrekt und zeitzonenunabhaengig.
 */
function effektiverStatus(status: DelegationStatus, von: string, bis: string): DelegationEffektiverStatus {
  if (status === "widerrufen") return "widerrufen";
  if (status === "beantragt") return "beantragt";
  const heute = new Date().toISOString().slice(0, 10);
  if (heute < von) return "genehmigt";
  if (heute > bis) return "abgelaufen";
  return "aktiv";
}

function zuDto(r: any): DelegationDto {
  return {
    id: r.id,
    vertretenerBenutzerId: r.vertretener_benutzer_id,
    vertretenerName: r.vertretener_name,
    vertreterBenutzerId: r.vertreter_benutzer_id,
    vertreterName: r.vertreter_name,
    von: r.von,
    bis: r.bis,
    umfang: r.umfang,
    sensibleRechteEingeschlossen: r.sensible_rechte_eingeschlossen,
    status: r.status,
    effektiverStatus: effektiverStatus(r.status, r.von, r.bis),
  };
}

export interface DelegationAnlegenInput {
  vertreterBenutzerId: string;
  von: string;
  bis: string;
  umfang: "alle" | "auswahl";
  sensibleRechteEingeschlossen?: boolean;
  rechte?: { modul: string; aktion: string }[];
}

@Injectable()
export class DelegationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  /**
   * Beide Richtungen (vertreten UND vertreter) -- "meine" Delegationen
   * heisst hier "ich bin an dieser Zeile beteiligt", nicht nur "ich bin
   * aktuell bevollmaechtigt". Kein besonderes Recht noetig (nur
   * @Authenticated() am Controller): die eigene Delegation zu sehen ist
   * analog zu "nur eigene Aufgaben sehen" kein Rechte-Engine-Fall.
   */
  async meineDelegationen(): Promise<DelegationDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT d.id, d.vertretener_benutzer_id, vb.name AS vertretener_name,
                d.vertreter_benutzer_id, vr.name AS vertreter_name,
                d.von, d.bis, d.umfang, d.sensible_rechte_eingeschlossen, d.status
         FROM delegation d
         JOIN benutzer vb ON vb.id = d.vertretener_benutzer_id
         JOIN benutzer vr ON vr.id = d.vertreter_benutzer_id
         WHERE d.vertretener_benutzer_id = $1 OR d.vertreter_benutzer_id = $1
         ORDER BY d.von DESC`,
        [benutzerId]
      );
      return rows.map(zuDto);
    });
  }

  /**
   * Nur die vertretene Person selbst kann eine Delegation anlegen -- man
   * verleiht nur die EIGENEN Rechte, man beantragt sie nicht fuer jemand
   * anderen (deshalb vertretener_benutzer_id = erstellt_von =
   * requireTenantContext().benutzerId, vertreterBenutzerId kommt aus dem
   * Body). Kein besonderes Recht noetig (nur @Authenticated()), analog zu
   * meineDelegationen().
   */
  async anlegen(input: DelegationAnlegenInput): Promise<DelegationDto> {
    const ctx = requireTenantContext();

    if (input.vertreterBenutzerId === ctx.benutzerId) {
      throw new BadRequestException("Man kann nicht sich selbst vertreten.");
    }

    if (input.umfang === "auswahl") {
      if (!input.rechte || input.rechte.length === 0) {
        throw new BadRequestException('Bei umfang="auswahl" muss mindestens ein Recht angegeben werden.');
      }
      for (const r of input.rechte) {
        // manage-permissions ist in der Registry nieDelegierbar:true gesetzt
        // und damit strukturell schon ausgeschlossen -- der Trigger
        // delegation_recht_pruefen() (migrations/0043) wuerde einen
        // rohen INSERT ohnehin ablehnen. Diese Pruefung hier ist die
        // verstaendliche 400-Meldung VOR jedem DB-Insert, nicht die letzte
        // Instanz.
        if (!istDelegierbar(r.modul, r.aktion)) {
          throw new BadRequestException(`${r.modul}.${r.aktion} ist nicht delegierbar.`);
        }
      }
    } else if (input.rechte && input.rechte.length > 0) {
      // Bewusste Entscheidung (Aufgabenstellung laesst beides zu): eine bei
      // umfang="alle" mitgeschickte rechte-Liste wird mit 400 abgelehnt statt
      // sie stillschweigend zu ignorieren -- ein Aufrufer, der "nur diese
      // Rechte" meinte, soll das sofort merken statt versehentlich alle
      // eigenen Rechte zu delegieren.
      throw new BadRequestException('rechte ist nur bei umfang="auswahl" sinnvoll.');
    }

    return this.db.withTenant(async (client) => {
      await this.pruefeBenutzerErlaubt(client, input.vertreterBenutzerId);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO delegation (mandant_id, vertretener_benutzer_id, vertreter_benutzer_id, von, bis, umfang, sensible_rechte_eingeschlossen, status, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'beantragt', $2)
         RETURNING id`,
        [
          ctx.mandantId,
          ctx.benutzerId,
          input.vertreterBenutzerId,
          input.von,
          input.bis,
          input.umfang,
          input.sensibleRechteEingeschlossen ?? false,
        ]
      );
      const delegationId = rows[0].id;

      if (input.umfang === "auswahl") {
        for (const r of input.rechte!) {
          await client.query(
            `INSERT INTO delegation_recht (mandant_id, delegation_id, modul, aktion) VALUES ($1, $2, $3, $4)`,
            [ctx.mandantId, delegationId, r.modul, r.aktion]
          );
        }
      }

      await this.audit.protokollieren(client, {
        modul: "delegation",
        aktion: "anlegen",
        objektTyp: "delegation",
        objektId: delegationId,
        nachher: {
          vertreterBenutzerId: input.vertreterBenutzerId,
          von: input.von,
          bis: input.bis,
          umfang: input.umfang,
          sensibleRechteEingeschlossen: input.sensibleRechteEingeschlossen ?? false,
          rechte: input.umfang === "auswahl" ? input.rechte : undefined,
        },
      });

      return this.findeEineIntern(client, delegationId);
    });
  }

  /**
   * Vier-Augen-Entscheidungsmuster von kassenbuchung.service.ts::
   * stornoEntscheiden(): wer die Anfrage stellt (hier: immer die vertretene
   * Person, siehe anlegen()), darf nicht auch selbst entscheiden. Die
   * "andere Person" ist hier aber nicht ueber eine separate Rechtepruefung
   * bestimmt, sondern bereits durch die Delegation selbst festgelegt --
   * genau die im Antrag benannte vertreter_benutzer_id darf genehmigen,
   * sonst niemand (auch keine Leitung mit "alle Rechte").
   */
  async genehmigen(id: string): Promise<DelegationDto> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ vertreter_benutzer_id: string }>(
        `SELECT vertreter_benutzer_id FROM delegation WHERE id = $1 AND status = 'beantragt'`,
        [id]
      );
      if (rows.length === 0) {
        throw new NotFoundException("Delegation nicht gefunden oder bereits entschieden.");
      }
      if (rows[0].vertreter_benutzer_id !== ctx.benutzerId) {
        throw new ForbiddenException("Nur die im Antrag benannte Vertretung darf diese Delegation genehmigen.");
      }

      let rowCount: number;
      try {
        const res = await client.query(
          `UPDATE delegation SET status = 'genehmigt', genehmigt_von = $1, genehmigt_am = now() WHERE id = $2 AND status = 'beantragt'`,
          [ctx.benutzerId, id]
        );
        rowCount = res.rowCount ?? 0;
      } catch (err) {
        // Normalfall faengt schon die Pruefung oben ab (dort bleibt die
        // Delegation einfach auf status='beantragt' statt automatisch
        // genehmigt zu werden) -- dieser Fall greift nur, wenn jemand
        // trotzdem ueber diesen Pfad versucht, ueber die eigene Delegation
        // zu entscheiden. delegation_vier_augen_pruefen() (Migration 0046)
        // kennt dabei keine Ausnahme -- die Regel ist strukturell, nicht
        // nur Konvention.
        if (isPgError(err) && err.code === DELEGATION_VIER_AUGEN_VERLETZT) {
          throw new ForbiddenException("Nur die im Antrag benannte Vertretung darf diese Delegation genehmigen.");
        }
        throw err;
      }
      if (rowCount === 0) {
        throw new NotFoundException("Delegation nicht gefunden oder bereits entschieden.");
      }

      await this.audit.protokollieren(client, {
        modul: "delegation",
        aktion: "genehmigen",
        objektTyp: "delegation",
        objektId: id,
      });

      return this.findeEineIntern(client, id);
    });
  }

  /**
   * Beide Seiten (Vertretener ODER Vertreter) duerfen widerrufen -- Widerruf
   * ist die "sichere Richtung" (Zugriff entziehen statt gewaehren), braucht
   * deshalb kein Vier-Augen-Prinzip. Eine unbeteiligte dritte Person
   * bekommt bewusst dasselbe 403 wie beim Genehmigen (nicht 404) -- die
   * Aufgabenstellung laesst hier "403/404" offen, diese Entscheidung haelt
   * das Verhalten zwischen genehmigen() und widerrufen() konsistent.
   */
  async widerrufen(id: string): Promise<DelegationDto> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{
        vertretener_benutzer_id: string;
        vertreter_benutzer_id: string;
        status: DelegationStatus;
      }>(`SELECT vertretener_benutzer_id, vertreter_benutzer_id, status FROM delegation WHERE id = $1`, [id]);
      if (rows.length === 0) {
        throw new NotFoundException("Delegation nicht gefunden.");
      }
      const { vertretener_benutzer_id, vertreter_benutzer_id, status } = rows[0];
      if (ctx.benutzerId !== vertretener_benutzer_id && ctx.benutzerId !== vertreter_benutzer_id) {
        throw new ForbiddenException("Nur die vertretene Person oder die Vertretung selbst dürfen diese Delegation widerrufen.");
      }
      if (status === "widerrufen") {
        throw new ConflictException("Diese Delegation ist bereits widerrufen.");
      }

      const { rowCount } = await client.query(
        `UPDATE delegation SET status = 'widerrufen', widerrufen_von = $1, widerrufen_am = now() WHERE id = $2 AND status <> 'widerrufen'`,
        [ctx.benutzerId, id]
      );
      if (rowCount === 0) {
        throw new ConflictException("Diese Delegation ist bereits widerrufen.");
      }

      await this.audit.protokollieren(client, {
        modul: "delegation",
        aktion: "widerrufen",
        objektTyp: "delegation",
        objektId: id,
      });

      return this.findeEineIntern(client, id);
    });
  }

  /**
   * Analog zu aufgabe.service.ts::pruefeBenutzerErlaubt() -- RLS filtert
   * benutzer schon auf den eigenen Mandanten (0004_benutzer.sql), ein
   * Treffer bedeutet also nicht nur "existiert", sondern "gehoert zu diesem
   * Mandanten". Eine klare 404-Meldung statt einem rohen FK-Fehler beim
   * folgenden INSERT.
   */
  private async pruefeBenutzerErlaubt(client: PoolClient, benutzerId: string): Promise<void> {
    const { rows } = await client.query("SELECT 1 FROM benutzer WHERE id = $1", [benutzerId]);
    if (rows.length === 0) throw new NotFoundException("Vertretung nicht gefunden.");
  }

  private async findeEineIntern(client: PoolClient, id: string): Promise<DelegationDto> {
    const { rows } = await client.query(
      `SELECT d.id, d.vertretener_benutzer_id, vb.name AS vertretener_name,
              d.vertreter_benutzer_id, vr.name AS vertreter_name,
              d.von, d.bis, d.umfang, d.sensible_rechte_eingeschlossen, d.status
       FROM delegation d
       JOIN benutzer vb ON vb.id = d.vertretener_benutzer_id
       JOIN benutzer vr ON vr.id = d.vertreter_benutzer_id
       WHERE d.id = $1`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundException("Delegation nicht gefunden.");
    return zuDto(rows[0]);
  }
}
