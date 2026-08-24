import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle } from "../common/tenant-context";

interface LoginLookupRow {
  benutzer_id: string;
  mandant_id: string;
  mandant_aktiv: boolean;
  email: string;
  name: string;
  passwort_hash: string;
  rolle: BenutzerRolle;
  benutzer_aktiv: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService
  ) {}

  /**
   * Einzige Stelle in der Anwendung, die DatabaseService.withoutTenant()
   * benutzt -- weil hier per Definition noch kein Mandant bekannt ist. Die
   * eigentliche RLS-Umgehung passiert nicht hier, sondern in der
   * SECURITY DEFINER-Funktion login_lookup() in der Datenbank (siehe
   * migrations/0005_login_lookup.sql); dieser Code ruft nur eine ganz
   * normale, eng begrenzte Funktion auf.
   */
  async login(mandantSlug: string, email: string, passwort: string): Promise<{ accessToken: string }> {
    const row = await this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<LoginLookupRow>("SELECT * FROM login_lookup($1, $2)", [
        mandantSlug,
        email,
      ]);
      return rows[0] ?? null;
    });

    // Absichtlich dieselbe Fehlermeldung fuer "Mandant/E-Mail existiert
    // nicht" und "Passwort falsch" -- sonst laesst sich per Fehlermeldung
    // erraten, welche Logins existieren.
    if (!row || !row.mandant_aktiv || !row.benutzer_aktiv) {
      throw new UnauthorizedException("Anmeldedaten ungueltig.");
    }

    const passwortOk = await bcrypt.compare(passwort, row.passwort_hash);
    if (!passwortOk) {
      throw new UnauthorizedException("Anmeldedaten ungueltig.");
    }

    // TODO (Nachtrag zu Phase 0, vor Produktivbetrieb): TOTP-Challenge nach
    // erfolgreicher Passwortpruefung einbauen. Feld benutzer.totp_aktiviert
    // existiert bereits, die Erzwingung fehlt bewusst noch -- siehe README.

    const accessToken = this.jwt.sign({
      sub: row.benutzer_id,
      mandantId: row.mandant_id,
      rolle: row.rolle,
    });

    return { accessToken };
  }
}
