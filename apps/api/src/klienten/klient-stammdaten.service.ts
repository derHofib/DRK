import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { klientIstErlaubt } from "../common/standort-restriction";
import { KlientKontakt, KlientStammdaten, zuKontaktDto, zuStammdatenDto } from "./klient.service";

export interface KlientStammdatenInput {
  geburtsort?: string | null;
  nationalitaet?: string | null;
  sorgeberechtigt?: string | null;
  bezugsbetreuerId?: string | null;
  betreuungsstunden?: string | null;
  telefon?: string | null;
  sprachen?: string | null;
  anmerkungen?: string | null;
  personaldokumente?: string | null;
  bankkonto?: string | null;
  iban?: string | null;
  jugendamtAdresse?: string | null;
  jugendamtSachbearbeiter?: string | null;
  jugendamtStellenzeichen?: string | null;
  jugendamtTelefon?: string | null;
  jugendamtEmail?: string | null;
  wjhName?: string | null;
  wjhTelefon?: string | null;
  wjhEmail?: string | null;
  personensorgeberechtigte?: string | null;
  besuchskontakte?: string | null;
  krankenkasse?: string | null;
  versichertennummer?: string | null;
  medikamente?: string | null;
  diagnosen?: string | null;
  allergien?: string | null;
  besonderheitenGesundheitlich?: string | null;
  besonderheitenPsychisch?: string | null;
  schule?: string | null;
  klassenstufe?: string | null;
  schulabschluesse?: string | null;
  foerderbedarfe?: string | null;
  vorherigeEinrichtungTraeger?: string | null;
  vorherigeEinrichtungKontakt?: string | null;
  vorherigeEinrichtungAnfrageAm?: string | null;
  vorherigeEinrichtungEinzugAm?: string | null;
  vorherigeEinrichtungAuszugAm?: string | null;
}

export interface KlientKontaktInput {
  beziehung?: string | null;
  name?: string;
  adresse?: string | null;
  email?: string | null;
  telefon?: string | null;
}

@Injectable()
export class KlientStammdatenService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Ein Feld, das im Body fehlt (undefined), bleibt unveraendert -- ein
   * Feld, das als leerer String geschickt wird, wird geleert. Dadurch kann
   * das Frontend pro Datenblatt-Abschnitt (Schnelle Informationen,
   * Gesundheit, Bildung, ...) unabhaengig speichern, ohne die anderen
   * Abschnitte jedes Mal mitzuschicken. Technisch per
   * "INSERT ... ON CONFLICT (klient_id) DO UPDATE SET spalte =
   * COALESCE(EXCLUDED.spalte, klient_stammdaten.spalte)" -- beim allerersten
   * Speichern (kein Konflikt) greift die COALESCE-Klausel gar nicht, dort
   * werden fehlende Felder einfach NULL, was fuer eine neue Zeile richtig ist.
   */
  async setzen(klientId: string, input: KlientStammdatenInput): Promise<KlientStammdaten> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      if (input.bezugsbetreuerId) {
        const { rows } = await client.query("SELECT 1 FROM benutzer WHERE id = $1", [input.bezugsbetreuerId]);
        if (rows.length === 0) throw new NotFoundException("Bezugsbetreuer:in nicht gefunden.");
      }

      const felder: [string, unknown][] = [
        ["geburtsort", input.geburtsort],
        ["nationalitaet", input.nationalitaet],
        ["sorgeberechtigt", input.sorgeberechtigt],
        ["bezugsbetreuer_id", input.bezugsbetreuerId],
        ["betreuungsstunden", input.betreuungsstunden],
        ["telefon", input.telefon],
        ["sprachen", input.sprachen],
        ["anmerkungen", input.anmerkungen],
        ["personaldokumente", input.personaldokumente],
        ["bankkonto", input.bankkonto],
        ["iban", input.iban],
        ["jugendamt_adresse", input.jugendamtAdresse],
        ["jugendamt_sachbearbeiter", input.jugendamtSachbearbeiter],
        ["jugendamt_stellenzeichen", input.jugendamtStellenzeichen],
        ["jugendamt_telefon", input.jugendamtTelefon],
        ["jugendamt_email", input.jugendamtEmail],
        ["wjh_name", input.wjhName],
        ["wjh_telefon", input.wjhTelefon],
        ["wjh_email", input.wjhEmail],
        ["personensorgeberechtigte", input.personensorgeberechtigte],
        ["besuchskontakte", input.besuchskontakte],
        ["krankenkasse", input.krankenkasse],
        ["versichertennummer", input.versichertennummer],
        ["medikamente", input.medikamente],
        ["diagnosen", input.diagnosen],
        ["allergien", input.allergien],
        ["besonderheiten_gesundheitlich", input.besonderheitenGesundheitlich],
        ["besonderheiten_psychisch", input.besonderheitenPsychisch],
        ["schule", input.schule],
        ["klassenstufe", input.klassenstufe],
        ["schulabschluesse", input.schulabschluesse],
        ["foerderbedarfe", input.foerderbedarfe],
        ["vorherige_einrichtung_traeger", input.vorherigeEinrichtungTraeger],
        ["vorherige_einrichtung_kontakt", input.vorherigeEinrichtungKontakt],
        ["vorherige_einrichtung_anfrage_am", input.vorherigeEinrichtungAnfrageAm],
        ["vorherige_einrichtung_einzug_am", input.vorherigeEinrichtungEinzugAm],
        ["vorherige_einrichtung_auszug_am", input.vorherigeEinrichtungAuszugAm],
      ];

      const spalten = ["mandant_id", "klient_id", ...felder.map(([spalte]) => spalte), "aktualisiert_von"];
      const werte = [mandantId, klientId, ...felder.map(([, wert]) => wert ?? null), benutzerId];
      const platzhalter = werte.map((_, i) => `$${i + 1}`);
      const updateKlausel = felder
        .map(([spalte]) => `${spalte} = COALESCE(EXCLUDED.${spalte}, klient_stammdaten.${spalte})`)
        .join(",\n          ");

      const { rows } = await client.query(
        `
        INSERT INTO klient_stammdaten (${spalten.join(", ")})
        VALUES (${platzhalter.join(", ")})
        ON CONFLICT (klient_id) DO UPDATE SET
          ${updateKlausel},
          aktualisiert_am = now(),
          aktualisiert_von = EXCLUDED.aktualisiert_von
        RETURNING *
        `,
        werte
      );

      const bezugsbetreuerId = rows[0].bezugsbetreuer_id;
      const { rows: benutzerRows } = bezugsbetreuerId
        ? await client.query("SELECT name FROM benutzer WHERE id = $1", [bezugsbetreuerId])
        : { rows: [] as { name: string }[] };

      return zuStammdatenDto({ ...rows[0], bezugsbetreuer_name: benutzerRows[0]?.name ?? null });
    });
  }

  async kontaktHinzufuegen(klientId: string, input: { beziehung?: string; name: string; adresse?: string; email?: string; telefon?: string }): Promise<KlientKontakt> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rows } = await client.query(
        `INSERT INTO klient_kontakt (mandant_id, klient_id, beziehung, name, adresse, email, telefon, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, beziehung, name, adresse, email, telefon`,
        [
          mandantId,
          klientId,
          input.beziehung ?? null,
          input.name,
          input.adresse ?? null,
          input.email ?? null,
          input.telefon ?? null,
          benutzerId,
        ]
      );
      return zuKontaktDto(rows[0]);
    });
  }

  async kontaktAktualisieren(klientId: string, kontaktId: string, input: KlientKontaktInput): Promise<KlientKontakt> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rows } = await client.query(
        `UPDATE klient_kontakt
         SET beziehung = COALESCE($1, beziehung), name = COALESCE($2, name), adresse = COALESCE($3, adresse),
             email = COALESCE($4, email), telefon = COALESCE($5, telefon)
         WHERE id = $6 AND klient_id = $7
         RETURNING id, beziehung, name, adresse, email, telefon`,
        [
          input.beziehung ?? null,
          input.name ?? null,
          input.adresse ?? null,
          input.email ?? null,
          input.telefon ?? null,
          kontaktId,
          klientId,
        ]
      );
      if (rows.length === 0) throw new NotFoundException("Kontakt nicht gefunden.");
      return zuKontaktDto(rows[0]);
    });
  }

  async kontaktLoeschen(klientId: string, kontaktId: string): Promise<void> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rowCount } = await client.query("DELETE FROM klient_kontakt WHERE id = $1 AND klient_id = $2", [
        kontaktId,
        klientId,
      ]);
      if (rowCount === 0) throw new NotFoundException("Kontakt nicht gefunden.");
    });
  }
}
