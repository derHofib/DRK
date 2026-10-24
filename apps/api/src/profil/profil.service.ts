import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  KontaktArt,
  MitarbeiterProfilEigenDto,
  MitarbeiterProfilFuerKlientDto,
  MitarbeiterProfilKollegeDto,
  ProfilSichtbarkeitDto,
} from "@zimmerakte/shared";
import { aktuellerTeilnehmer, requireTenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";

interface ProfilZeile {
  telefon: string | null;
  bevorzugte_kontaktart: KontaktArt | null;
  erreichbarkeit: string | null;
  email_dienstlich: string | null;
  ueber_mich: string | null;
}

function inhalt(r: ProfilZeile) {
  return {
    telefon: r.telefon,
    bevorzugteKontaktart: r.bevorzugte_kontaktart,
    erreichbarkeit: r.erreichbarkeit,
    emailDienstlich: r.email_dienstlich,
    ueberMich: r.ueber_mich,
  };
}

const LEERES_PROFIL: ProfilZeile = {
  telefon: null,
  bevorzugte_kontaktart: null,
  erreichbarkeit: null,
  email_dienstlich: null,
  ueber_mich: null,
};


@Injectable()
export class ProfilService {
  constructor(private readonly db: DatabaseService) {}

  /** Eigenes Profil mit Freigaben. Ohne gespeicherte Zeile: leer und nichts freigegeben. */
  async eigenes(): Promise<MitarbeiterProfilEigenDto> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT telefon, bevorzugte_kontaktart, erreichbarkeit, email_dienstlich, ueber_mich,
                telefon_zugeordnet, telefon_andere, kontakt_zugeordnet, kontakt_andere,
                email_zugeordnet, email_andere, ueber_zugeordnet, ueber_andere
         FROM mitarbeiter_profil WHERE benutzer_id = $1`,
        [ctx.benutzerId]
      );
      const r = rows[0];
      const sichtbarkeit: ProfilSichtbarkeitDto = {
        telefon: { zugeordnet: r?.telefon_zugeordnet ?? false, andere: r?.telefon_andere ?? false },
        kontakt: { zugeordnet: r?.kontakt_zugeordnet ?? false, andere: r?.kontakt_andere ?? false },
        email: { zugeordnet: r?.email_zugeordnet ?? false, andere: r?.email_andere ?? false },
        ueberMich: { zugeordnet: r?.ueber_zugeordnet ?? false, andere: r?.ueber_andere ?? false },
      };
      return { ...inhalt(r ?? LEERES_PROFIL), sichtbarkeit };
    });
  }

  /** Nur die eigene Zeile -- die Policy laesst nichts anderes zu, hier steht bewusst keine fremde Benutzer-ID. */
  async eigenesSpeichern(eingabe: MitarbeiterProfilEigenDto): Promise<MitarbeiterProfilEigenDto> {
    const ctx = requireTenantContext();
    const s = eingabe.sichtbarkeit;
    await this.db.withTenant(async (client) => {
      await client.query(
        `INSERT INTO mitarbeiter_profil (
           benutzer_id, mandant_id, telefon, bevorzugte_kontaktart, erreichbarkeit, email_dienstlich, ueber_mich,
           telefon_zugeordnet, telefon_andere, kontakt_zugeordnet, kontakt_andere,
           email_zugeordnet, email_andere, ueber_zugeordnet, ueber_andere)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (benutzer_id) DO UPDATE SET
           telefon = EXCLUDED.telefon, bevorzugte_kontaktart = EXCLUDED.bevorzugte_kontaktart,
           erreichbarkeit = EXCLUDED.erreichbarkeit, email_dienstlich = EXCLUDED.email_dienstlich,
           ueber_mich = EXCLUDED.ueber_mich,
           telefon_zugeordnet = EXCLUDED.telefon_zugeordnet, telefon_andere = EXCLUDED.telefon_andere,
           kontakt_zugeordnet = EXCLUDED.kontakt_zugeordnet, kontakt_andere = EXCLUDED.kontakt_andere,
           email_zugeordnet = EXCLUDED.email_zugeordnet, email_andere = EXCLUDED.email_andere,
           ueber_zugeordnet = EXCLUDED.ueber_zugeordnet, ueber_andere = EXCLUDED.ueber_andere,
           geaendert_am = now()`,
        [
          ctx.benutzerId,
          ctx.mandantId,
          eingabe.telefon,
          eingabe.bevorzugteKontaktart,
          eingabe.erreichbarkeit,
          eingabe.emailDienstlich,
          eingabe.ueberMich,
          s.telefon.zugeordnet,
          s.telefon.andere,
          s.kontakt.zugeordnet,
          s.kontakt.andere,
          s.email.zugeordnet,
          s.email.andere,
          s.ueberMich.zugeordnet,
          s.ueberMich.andere,
        ]
      );
    });
    return this.eigenes();
  }

  /** Kolleg:innen sehen alles (Freigaben sind nur fuer Klient:innen relevant). Aktive Personen des eigenen Mandanten (RLS). */
  async vonKollege(benutzerId: string): Promise<MitarbeiterProfilKollegeDto> {
    this.nurMitarbeitende();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT b.id, b.name, p.telefon, p.bevorzugte_kontaktart, p.erreichbarkeit, p.email_dienstlich, p.ueber_mich
         FROM benutzer b LEFT JOIN mitarbeiter_profil p ON p.benutzer_id = b.id
         WHERE b.id = $1 AND b.aktiv`,
        [benutzerId]
      );
      if (rows.length === 0) throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
      return { benutzerId: rows[0].id, name: rows[0].name, ...inhalt(rows[0]) };
    });
  }

  /** Alle Profile auf einmal -- fuer die Mitarbeitenden-Liste. */
  async alleKollegen(): Promise<MitarbeiterProfilKollegeDto[]> {
    this.nurMitarbeitende();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT b.id, b.name, p.telefon, p.bevorzugte_kontaktart, p.erreichbarkeit, p.email_dienstlich, p.ueber_mich
         FROM benutzer b LEFT JOIN mitarbeiter_profil p ON p.benutzer_id = b.id
         WHERE b.aktiv ORDER BY b.name, b.id`
      );
      return rows.map((r) => ({ benutzerId: r.id, name: r.name, ...inhalt(r) }));
    });
  }

  /**
   * Klient-Sicht: die Filterung (welche Felder, fuer wen, und ob die Person
   * ueberhaupt im Sichtkreis der Klient:in liegt) macht die Datenbankfunktion
   * mitarbeiter_profil_fuer_klient() -- hier wird nur durchgereicht. Kein
   * Treffer klingt immer gleich, egal ob die Person fehlt oder nur nicht sichtbar ist.
   */
  async fuerKlient(benutzerId: string): Promise<MitarbeiterProfilFuerKlientDto> {
    const ich = aktuellerTeilnehmer();
    if (ich.art !== "klient") throw new ForbiddenException("Nur fuer Klient:innen.");
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM mitarbeiter_profil_fuer_klient($1::uuid)", [benutzerId]);
      if (rows.length === 0) throw new NotFoundException("Profil nicht gefunden.");
      const r = rows[0];
      return { benutzerId, name: r.name, zugeordnet: r.zugeordnet, ...inhalt(r) };
    });
  }

  private nurMitarbeitende(): void {
    if (aktuellerTeilnehmer().art !== "benutzer") throw new ForbiddenException("Nur fuer Mitarbeitende.");
  }
}
