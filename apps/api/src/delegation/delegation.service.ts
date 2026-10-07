import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";

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

@Injectable()
export class DelegationService {
  constructor(private readonly db: DatabaseService) {}

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
}
