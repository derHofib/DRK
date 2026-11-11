import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DatabaseService } from "../database/database.service";
import { neuerResetToken, resetTokenHash } from "../common/reset-token";
import { requireTenantContext } from "../common/tenant-context";

// Kurz, weil der QR-Code auf einem Bildschirm steht, den andere sehen koennten.
const KOPPLUNG_GUELTIG_MINUTEN = 5;

// Laenger als die 8 Stunden der Web-Sitzung: das Handy soll nicht jeden Tag
// neu gekoppelt werden muessen. Das Risiko faengt die Sperre je Geraet ab
// (der Guard prueft sie bei jeder Anfrage), nicht die Laufzeit.
const GERAETE_SITZUNG = "30d";

export interface GeraetZeile {
  id: string;
  name: string;
  plattform: string;
  erstelltAm: string;
  zuletztGesehenAm: string;
  gesperrtAm: string | null;
  pushAktiv: boolean;
}

@Injectable()
export class GeraeteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService
  ) {}

  async kopplungErstellen(): Promise<{ token: string; mandantSlug: string; laeuftAbAm: string }> {
    const ctx = requireTenantContext();
    const token = neuerResetToken();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ laeuft_ab_am: Date }>(
        `INSERT INTO geraet_kopplung (mandant_id, benutzer_id, token_hash, laeuft_ab_am)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))
         RETURNING laeuft_ab_am`,
        [ctx.mandantId, ctx.benutzerId, resetTokenHash(token), KOPPLUNG_GUELTIG_MINUTEN]
      );
      // Der Slug gehoert in den QR-Code: die App braucht ihn fuer spaetere
      // Anmeldungen und kennt vorher nichts ausser dem Code.
      const { rows: mandant } = await client.query<{ slug: string }>("SELECT slug FROM mandant WHERE id = $1", [ctx.mandantId]);
      return { token, mandantSlug: mandant[0].slug, laeuftAbAm: new Date(rows[0].laeuft_ab_am).toISOString() };
    });
  }

  /**
   * Laeuft ohne Tenant-Kontext (die App hat noch keine Sitzung). Alles
   * Entscheidende steckt atomar in geraet_koppeln() (Migration 0070); ein
   * leeres Ergebnis heisst abgelaufen, benutzt, unbekannt oder Konto
   * deaktiviert -- bewusst nicht unterscheidbar.
   */
  async kopplungEinloesen(token: string, geraeteName: string, plattform: "ios"): Promise<{ accessToken: string }> {
    const zeile = await this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<{ geraet_id: string; benutzer_id: string; mandant_id: string }>(
        "SELECT * FROM geraet_koppeln($1, $2, $3)",
        [resetTokenHash(token), geraeteName, plattform]
      );
      return rows[0] ?? null;
    });
    if (!zeile) throw new UnauthorizedException("Kopplungscode ungültig oder abgelaufen.");

    const accessToken = this.jwt.sign(
      { typ: "access", sub: zeile.benutzer_id, mandantId: zeile.mandant_id, geraetId: zeile.geraet_id },
      { expiresIn: GERAETE_SITZUNG }
    );
    return { accessToken };
  }

  async eigeneGeraete(): Promise<GeraetZeile[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, plattform, erstellt_am, zuletzt_gesehen_am, gesperrt_am, apns_token IS NOT NULL AS push_aktiv
         FROM geraet WHERE benutzer_id = $1 ORDER BY erstellt_am DESC`,
        [ctx.benutzerId]
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        plattform: r.plattform,
        erstelltAm: new Date(r.erstellt_am).toISOString(),
        zuletztGesehenAm: new Date(r.zuletzt_gesehen_am).toISOString(),
        gesperrtAm: r.gesperrt_am ? new Date(r.gesperrt_am).toISOString() : null,
        pushAktiv: r.push_aktiv,
      }));
    });
  }

  /** Nur eigene Geraete: fremde sind fuer diese Person ein 404, kein 403. */
  async sperren(geraetId: string): Promise<void> {
    const ctx = requireTenantContext();
    const betroffen = await this.db.withTenant(async (client) => {
      const { rowCount } = await client.query(
        // apns_token mit leeren: ein gesperrtes Geraet soll auch keinen Push mehr bekommen.
        "UPDATE geraet SET gesperrt_am = now(), apns_token = NULL WHERE id = $1 AND benutzer_id = $2 AND gesperrt_am IS NULL",
        [geraetId, ctx.benutzerId]
      );
      return rowCount ?? 0;
    });
    if (betroffen === 0) throw new NotFoundException("Gerät nicht gefunden.");
  }

  async pushTokenSetzen(geraetId: string | undefined, apnsToken: string): Promise<void> {
    if (!geraetId) {
      throw new BadRequestException("Push gibt es nur für gekoppelte Geräte, nicht für die Weboberfläche.");
    }
    const ctx = requireTenantContext();
    const betroffen = await this.db.withTenant(async (client) => {
      const { rowCount } = await client.query(
        "UPDATE geraet SET apns_token = $1, zuletzt_gesehen_am = now() WHERE id = $2 AND benutzer_id = $3 AND gesperrt_am IS NULL",
        [apnsToken, geraetId, ctx.benutzerId]
      );
      return rowCount ?? 0;
    });
    if (betroffen === 0) throw new NotFoundException("Gerät nicht gefunden.");
  }
}
