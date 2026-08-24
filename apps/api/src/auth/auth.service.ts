import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from "otplib";
import * as QRCode from "qrcode";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { entschluesseln, verschluesseln } from "../common/geheimnis";

// +-1 Zeitschritt (30s) Toleranz fuer Uhrendrift zwischen Server und
// Authenticator-App -- Standardempfehlung, kein beliebig gewaehlter Wert.
const ZEIT_TOLERANZ_SEKUNDEN: [number, number] = [30, 30];

// Die (Klassen-)TOTP aus "otplib" verlangt Crypto-/Base32-Plugins explizit
// -- anders als die generische OTP-Wrapperklasse oder die Funktions-API
// setzt sie keine Defaults, dafuer sind ihre Rueckgabetypen korrekt auf
// TOTP (mit timeStep) statt auf eine TOTP|HOTP-Union verengt.
const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

/**
 * Jede Operation bekommt ihre eigene TOTP-Instanz mit dem (entschluesselten)
 * Secret des jeweiligen Benutzers -- die Klasse ist dafuer gedacht, ein
 * Secret ueber Konstruktor-Optionen zu tragen, nicht ueber einen globalen
 * Zustand fuer wechselnde Benutzer.
 */
function totpFuer(secret?: string): TOTP {
  return new TOTP({ secret, crypto: cryptoPlugin, base32: base32Plugin });
}

interface LoginLookupRow {
  benutzer_id: string;
  mandant_id: string;
  mandant_aktiv: boolean;
  email: string;
  name: string;
  passwort_hash: string;
  rolle: BenutzerRolle;
  benutzer_aktiv: boolean;
  totp_aktiviert: boolean;
}

interface TotpLoginLookupRow {
  rolle: BenutzerRolle;
  mandant_aktiv: boolean;
  benutzer_aktiv: boolean;
  totp_secret: string | null;
  totp_aktiviert: boolean;
  totp_letzter_schritt: string | null; // bigint kommt als string aus pg
}

interface PendingPayload {
  typ: "totp_pending";
  benutzerId: string;
  mandantId: string;
}

export type LoginErgebnis = { accessToken: string } | { totpErforderlich: true; pendingToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService
  ) {}

  /**
   * Einzige Stelle in der Anwendung (neben totpVerifizieren()), die
   * DatabaseService.withoutTenant() benutzt -- weil hier per Definition
   * noch kein Mandant bekannt ist. Die eigentliche RLS-Umgehung passiert
   * nicht hier, sondern in der SECURITY DEFINER-Funktion login_lookup() in
   * der Datenbank (siehe migrations/0005_login_lookup.sql); dieser Code
   * ruft nur eine ganz normale, eng begrenzte Funktion auf.
   */
  async login(mandantSlug: string, email: string, passwort: string): Promise<LoginErgebnis> {
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
      throw new UnauthorizedException("Anmeldedaten ungültig.");
    }

    const passwortOk = await bcrypt.compare(passwort, row.passwort_hash);
    if (!passwortOk) {
      throw new UnauthorizedException("Anmeldedaten ungültig.");
    }

    if (row.totp_aktiviert) {
      const pendingPayload: PendingPayload = { typ: "totp_pending", benutzerId: row.benutzer_id, mandantId: row.mandant_id };
      const pendingToken = this.jwt.sign(pendingPayload, { expiresIn: "5m" });
      return { totpErforderlich: true, pendingToken };
    }

    const accessToken = this.jwt.sign({
      typ: "access",
      sub: row.benutzer_id,
      mandantId: row.mandant_id,
      rolle: row.rolle,
    });
    return { accessToken };
  }

  /**
   * Zweiter Schritt eines 2FA-Logins: tauscht ein kurzlebiges
   * "pending"-Token (aus login(), 5 Minuten gueltig) plus einen gueltigen
   * TOTP-Code gegen ein echtes Zugriffstoken. Laeuft bewusst nicht hinter
   * AuthGuard/Authenticated() -- das pending-Token ist kein Zugriffstoken
   * (siehe typ-Pruefung in auth.guard.ts) und braucht seinen eigenen,
   * schmalen Verifikationspfad.
   */
  async totpVerifizieren(pendingToken: string, code: string): Promise<{ accessToken: string }> {
    let payload: PendingPayload;
    try {
      payload = this.jwt.verify<PendingPayload>(pendingToken);
    } catch {
      throw new UnauthorizedException("Anmeldevorgang abgelaufen, bitte erneut anmelden.");
    }
    if (payload.typ !== "totp_pending") {
      throw new UnauthorizedException("Ungültiges Token für diesen Schritt.");
    }

    const row = await this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<TotpLoginLookupRow>("SELECT * FROM totp_login_lookup($1, $2)", [
        payload.benutzerId,
        payload.mandantId,
      ]);
      return rows[0] ?? null;
    });

    if (!row || !row.mandant_aktiv || !row.benutzer_aktiv || !row.totp_aktiviert || !row.totp_secret) {
      throw new UnauthorizedException("Anmeldedaten ungültig.");
    }

    const secret = entschluesseln(row.totp_secret);
    const ergebnis = await totpFuer(secret).verify(code, {
      epochTolerance: ZEIT_TOLERANZ_SEKUNDEN,
      afterTimeStep: row.totp_letzter_schritt ? Number(row.totp_letzter_schritt) : undefined,
    });

    if (!ergebnis.valid) {
      throw new UnauthorizedException("Code ungültig oder abgelaufen.");
    }

    await this.db.withoutTenant(async (client) => {
      await client.query("SELECT totp_letzten_schritt_setzen($1, $2, $3)", [
        payload.benutzerId,
        payload.mandantId,
        ergebnis.timeStep,
      ]);
    });

    const accessToken = this.jwt.sign({
      typ: "access",
      sub: payload.benutzerId,
      mandantId: payload.mandantId,
      rolle: row.rolle,
    });
    return { accessToken };
  }

  /**
   * Erzeugt ein neues, noch NICHT aktives Secret fuer den aktuell
   * eingeloggten Benutzer (requireTenantContext() -- niemand kann 2FA fuer
   * ein fremdes Konto einrichten, die ID kommt nie aus dem Request-Body).
   * Aktiv wird es erst nach einem bestaetigten Code in aktivieren(), damit
   * ein Tippfehler beim Einscannen niemand aussperrt.
   */
  async status(): Promise<{ aktiviert: boolean }> {
    const { benutzerId } = requireTenantContext();
    const aktiviert = await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ totp_aktiviert: boolean }>(
        "SELECT totp_aktiviert FROM benutzer WHERE id = $1",
        [benutzerId]
      );
      return rows[0]?.totp_aktiviert ?? false;
    });
    return { aktiviert };
  }

  async einrichten(): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const { benutzerId } = requireTenantContext();
    const secret = totpFuer().generateSecret();

    const { email, mandantSlug } = await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ email: string; slug: string }>(
        "SELECT b.email, m.slug FROM benutzer b JOIN mandant m ON m.id = b.mandant_id WHERE b.id = $1",
        [benutzerId]
      );
      await client.query(
        "UPDATE benutzer SET totp_secret = $1, totp_aktiviert = false, totp_letzter_schritt = NULL WHERE id = $2",
        [verschluesseln(secret), benutzerId]
      );
      return { email: rows[0].email, mandantSlug: rows[0].slug };
    });

    const otpauthUrl = totpFuer(secret).toURI({ issuer: "Zimmerakte", label: `${mandantSlug}:${email}` });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async aktivieren(code: string): Promise<void> {
    const { benutzerId } = requireTenantContext();
    const row = await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ totp_secret: string | null; totp_aktiviert: boolean }>(
        "SELECT totp_secret, totp_aktiviert FROM benutzer WHERE id = $1",
        [benutzerId]
      );
      return rows[0] ?? null;
    });

    if (!row?.totp_secret) {
      throw new BadRequestException("Kein 2FA-Setup gestartet. Zuerst /auth/totp/einrichten aufrufen.");
    }
    if (row.totp_aktiviert) {
      throw new BadRequestException("2FA ist bereits aktiviert.");
    }

    const secret = entschluesseln(row.totp_secret);
    const ergebnis = await totpFuer(secret).verify(code, { epochTolerance: ZEIT_TOLERANZ_SEKUNDEN });
    if (!ergebnis.valid) {
      throw new BadRequestException("Code ungültig.");
    }

    await this.db.withTenant(async (client) => {
      await client.query("UPDATE benutzer SET totp_aktiviert = true, totp_letzter_schritt = $1 WHERE id = $2", [
        ergebnis.timeStep,
        benutzerId,
      ]);
    });
  }

  /**
   * Verlangt einen gueltigen Code, um 2FA abzuschalten -- ein gestohlenes
   * Zugriffstoken allein (das laeuft ohnehin durch eine bereits bestandene
   * TOTP-Pruefung) soll nicht automatisch reichen, um den Schutz fuer die
   * Zukunft zu deaktivieren.
   */
  async deaktivieren(code: string): Promise<void> {
    const { benutzerId } = requireTenantContext();
    const row = await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ totp_secret: string | null; totp_aktiviert: boolean }>(
        "SELECT totp_secret, totp_aktiviert FROM benutzer WHERE id = $1",
        [benutzerId]
      );
      return rows[0] ?? null;
    });

    if (!row?.totp_aktiviert || !row.totp_secret) {
      throw new BadRequestException("2FA ist nicht aktiviert.");
    }

    const secret = entschluesseln(row.totp_secret);
    const ergebnis = await totpFuer(secret).verify(code, { epochTolerance: ZEIT_TOLERANZ_SEKUNDEN });
    if (!ergebnis.valid) {
      throw new BadRequestException("Code ungültig.");
    }

    await this.db.withTenant(async (client) => {
      await client.query(
        "UPDATE benutzer SET totp_aktiviert = false, totp_secret = NULL, totp_letzter_schritt = NULL WHERE id = $1",
        [benutzerId]
      );
    });
  }
}
