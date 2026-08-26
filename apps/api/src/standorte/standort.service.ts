import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";

export interface StandortDto {
  id: string;
  name: string;
  adresse: string;
  aktiv: boolean;
}

@Injectable()
export class StandortService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liefert bewusst auch deaktivierte Standorte mit -- die Verwaltungsseite
   * (Einstellungen) muss sie zeigen koennen, um sie wieder zu aktivieren.
   * Wer nur die aktiven fuer eine Auswahlliste braucht (z.B. beim
   * Zimmer-Anlegen), filtert das im Frontend auf "aktiv".
   */
  async findeAlle(): Promise<StandortDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<StandortDto>(
        "SELECT id, name, adresse, aktiv FROM standort ORDER BY name"
      );
      return rows;
    });
  }

  async anlegen(input: { name: string; adresse: string }): Promise<StandortDto> {
    const { mandantId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<StandortDto>(
        "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, $3) RETURNING id, name, adresse, aktiv",
        [mandantId, input.name, input.adresse]
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
}
