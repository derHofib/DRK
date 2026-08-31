import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";

export interface StandortDto {
  id: string;
  name: string;
  adresse: string;
  aktiv: boolean;
}

// Eine neue Einrichtung zu eroeffnen ist eine traegerweite Entscheidung
// (mehr Personal, mehr Budget) -- deshalb nur Bereichsleitung, anders als
// beim Bearbeiten einer bestehenden Einrichtung (siehe unten).
const ROLLEN_MIT_STANDORT_ANLEGEN = new Set<BenutzerRolle>(["bereichsleitung"]);

// Eine bestehende Einrichtung pflegen (Name/Adresse korrigieren, aktivieren/
// deaktivieren) darf zusaetzlich die Einrichtungsleitung -- gleiches Muster
// wie ROLLEN_MIT_ZIMMER_STAMMDATEN in zimmer.service.ts.
const ROLLEN_MIT_STANDORT_BEARBEITEN = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

@Injectable()
export class StandortService {
  constructor(private readonly db: DatabaseService) {}

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

  async anlegen(input: { name: string; adresse: string }): Promise<StandortDto> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_STANDORT_ANLEGEN.has(ctx.rolle)) {
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
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_STANDORT_BEARBEITEN.has(ctx.rolle)) {
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
}
