import { Injectable } from "@nestjs/common";
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
}
