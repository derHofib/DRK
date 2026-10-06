import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { istDelegierbar, istSensibel } from "./registry";

interface AktivePosition {
  id: string;
  orgUnitId: string;
  typ: "linie" | "stabsstelle";
  accountTypId: string;
  istVollzugriff: boolean;
}

/**
 * Ergebnis EINER Position fuer EIN (modul,aktion)-Paar, bereits in
 * Org-Unit-Mengen aufgeloest. "eigenerGrant" ist true, sobald die Position
 * ueberhaupt ein erlaubt=true liefert -- auch bei Scopes wie "own"/
 * "assigned", die keine Org-Unit-Menge erzeugen (siehe
 * ermittleErlaubteOrgUnitIds-Kommentar unten).
 */
interface PositionsErgebnis {
  erlaubteOrgUnitIds: Set<string>;
  verboteneOrgUnitIds: Set<string>;
  eigenerGrant: boolean;
}

function leeresErgebnis(): PositionsErgebnis {
  return { erlaubteOrgUnitIds: new Set(), verboteneOrgUnitIds: new Set(), eigenerGrant: false };
}

function vereinigen(a: PositionsErgebnis, b: PositionsErgebnis): PositionsErgebnis {
  return {
    erlaubteOrgUnitIds: new Set([...a.erlaubteOrgUnitIds, ...b.erlaubteOrgUnitIds]),
    verboteneOrgUnitIds: new Set([...a.verboteneOrgUnitIds, ...b.verboteneOrgUnitIds]),
    eigenerGrant: a.eigenerGrant || b.eigenerGrant,
  };
}

/**
 * Zentrale Rechte-Engine (siehe Organigramm-Plan, Abschnitt
 * "Rechte-Engine"). Noch nicht verdrahtet -- kein bestehender Service ruft
 * das hier auf, kein Guard haengt daran. Der Auflösungsalgorithmus ist
 * absichtlich als eigenstaendige, dokumentierte Schrittfolge geschrieben
 * (nicht als eine grosse SQL-Abfrage), weil die Deny-pro-Scope- und
 * Vertretungs-Logik sonst nicht nachvollziehbar waere.
 */
@Injectable()
export class RechteService {
  constructor(private readonly db: DatabaseService) {}

  /** Ja/Nein-Pruefung, unabhaengig vom Scope. */
  async hatRecht(modul: string, aktion: string): Promise<boolean> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (await this.istVollzugriff(client, ctx.benutzerId)) return true;

      const eigenes = await this.aufloesen(client, ctx.benutzerId, modul, aktion);
      if (eigenes.eigenerGrant) return true;

      const delegiertes = await this.delegierteAufloesung(client, ctx.benutzerId, modul, aktion);
      return delegiertes?.eigenerGrant ?? false;
    });
  }

  /**
   * Liefert entweder das Sentinel "alle" (Geschaeftsfuehrung-Wildcard,
   * kurzgeschlossen -- siehe istVollzugriff) oder die konkrete Liste
   * erlaubter org_unit-Ids. Eine Position mit Scope "tenant" wird NICHT
   * zum Sentinel, sondern zur konkreten Liste aller org_unit-Ids des
   * Mandanten aufgeloest -- nur so kann ein Deny einer anderen Position
   * sie noch einschraenken ("Deny gewinnt pro Org-Unit", nicht pro
   * Mitarbeiter). Das Sentinel ist ausschliesslich fuer den echten
   * Wildcard-Kurzschluss reserviert, der per Definition von keinem Deny
   * eingeschraenkt wird (siehe Organigramm-Plan, "Geschaeftsfuehrung").
   *
   * Scopes "own" und "assigned" erzeugen keine Org-Unit-Menge (das sind
   * objekt- bzw. personenbezogene Scopes, keine Organisationseinheiten) --
   * ein Aufrufer, der nach einem dieser Scopes filtern will, muss das
   * gesondert behandeln (z.B. "nur eigene Aufgaben" bleibt eine
   * eigenstaendige WHERE-Bedingung im jeweiligen Service, kein Org-Unit-Filter).
   */
  async ermittleErlaubteOrgUnitIds(modul: string, aktion: string): Promise<string[] | "alle"> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (await this.istVollzugriff(client, ctx.benutzerId)) return "alle";

      const eigenes = await this.aufloesen(client, ctx.benutzerId, modul, aktion);
      const delegiertes = await this.delegierteAufloesung(client, ctx.benutzerId, modul, aktion);
      const vereint = delegiertes ? vereinigen(eigenes, delegiertes) : eigenes;

      // Deny gewinnt: das eigene Verbot zieht IMMER ab, auch wenn eine
      // Delegation dort erlauben wuerde (die Delegation fuegt Rechte
      // hinzu, hebt aber kein eigenes Verbot auf).
      const ergebnis = new Set(vereint.erlaubteOrgUnitIds);
      for (const id of eigenes.verboteneOrgUnitIds) ergebnis.delete(id);
      if (delegiertes) for (const id of delegiertes.verboteneOrgUnitIds) ergebnis.delete(id);

      return [...ergebnis];
    });
  }

  private async istVollzugriff(client: import("pg").PoolClient, benutzerId: string): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1
       FROM org_position_besetzung b
       JOIN org_position p ON p.id = b.position_id
       JOIN account_typ a ON a.id = p.account_typ_id
       WHERE b.benutzer_id = $1 AND p.aktiv AND a.ist_vollzugriff
         AND b.gueltig_ab <= CURRENT_DATE
         AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE)
       LIMIT 1`,
      [benutzerId]
    );
    return rows.length > 0;
  }

  private async aktivePositionen(client: import("pg").PoolClient, benutzerId: string): Promise<AktivePosition[]> {
    const { rows } = await client.query(
      `SELECT p.id, p.org_unit_id, p.typ, p.account_typ_id, a.ist_vollzugriff
       FROM org_position_besetzung b
       JOIN org_position p ON p.id = b.position_id
       JOIN account_typ a ON a.id = p.account_typ_id
       WHERE b.benutzer_id = $1 AND p.aktiv
         AND b.gueltig_ab <= CURRENT_DATE
         AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE)`,
      [benutzerId]
    );
    return rows.map((r) => ({
      id: r.id,
      orgUnitId: r.org_unit_id,
      typ: r.typ,
      accountTypId: r.account_typ_id,
      istVollzugriff: r.ist_vollzugriff,
    }));
  }

  /**
   * Eigene (nicht delegierte) Rechte eines Benutzers fuer (modul,aktion),
   * ueber alle seine aktiven Positionen vereinigt. Setzt NICHT voraus,
   * dass der Benutzer der aktuelle Request-Benutzer ist -- wird auch
   * benutzt, um die Rechte des Vertretenen bei einer Delegation
   * aufzuloesen (siehe delegierteAufloesung).
   */
  private async aufloesen(
    client: import("pg").PoolClient,
    benutzerId: string,
    modul: string,
    aktion: string
  ): Promise<PositionsErgebnis> {
    const positionen = await this.aktivePositionen(client, benutzerId);
    let ergebnis = leeresErgebnis();
    for (const position of positionen) {
      const grant = await this.positionsGrant(client, position, modul, aktion);
      if (!grant) continue;
      ergebnis = vereinigen(ergebnis, grant);
    }
    return ergebnis;
  }

  /**
   * Account-Typ-Default fuer (modul,aktion), von einem Positions-Override
   * komplett ersetzt, falls vorhanden (nicht additiv -- ein Override
   * ersetzt erlaubt UND scope, siehe Organigramm-Plan). Liefert null, wenn
   * weder ein Default noch ein Override existiert (impliziter Deny --
   * traegt bewusst NICHT zur Verbotsmenge bei, siehe PositionsErgebnis-Kommentar
   * oben: das ist Abwesenheit einer Erlaubnis, kein aktives Verbot).
   */
  private async positionsGrant(
    client: import("pg").PoolClient,
    position: AktivePosition,
    modul: string,
    aktion: string
  ): Promise<PositionsErgebnis | null> {
    const { rows: overrideRows } = await client.query(
      `SELECT erlaubt, scope FROM org_position_recht_override
       WHERE position_id = $1 AND modul = $2 AND aktion = $3`,
      [position.id, modul, aktion]
    );
    let erlaubt: boolean;
    let scope: string;
    if (overrideRows.length > 0) {
      erlaubt = overrideRows[0].erlaubt;
      scope = overrideRows[0].scope;
    } else {
      const { rows: defaultRows } = await client.query(
        `SELECT erlaubt, scope FROM account_typ_recht
         WHERE account_typ_id = $1 AND modul = $2 AND aktion = $3`,
        [position.accountTypId, modul, aktion]
      );
      if (defaultRows.length === 0) return null;
      erlaubt = defaultRows[0].erlaubt;
      scope = defaultRows[0].scope;
    }

    const orgUnitIds = await this.orgUnitIdsFuerScope(client, position, scope);
    const ergebnis = leeresErgebnis();
    ergebnis.eigenerGrant = erlaubt;
    if (orgUnitIds !== null) {
      if (erlaubt) orgUnitIds.forEach((id) => ergebnis.erlaubteOrgUnitIds.add(id));
      else orgUnitIds.forEach((id) => ergebnis.verboteneOrgUnitIds.add(id));
    }
    return ergebnis;
  }

  /**
   * Loest einen Scope-Wert zu einer Menge von org_unit-Ids auf.
   * null = kein Org-Unit-bezogener Scope (own/assigned).
   *
   * Stabsstellen (typ=stabsstelle) ignorieren den gespeicherten Scope-Wert
   * komplett -- ihr Zugriff kommt immer aus org_position_stabsstelle_scope,
   * nie aus der hierarchischen Scope-Vokabular, die nur fuer Linienpositionen
   * sinnvoll ist (siehe Organigramm-Plan: "Stabsstellen erben keinen
   * Subtree-Scope... haben explizit konfigurierte Scopes").
   */
  private async orgUnitIdsFuerScope(
    client: import("pg").PoolClient,
    position: AktivePosition,
    scope: string
  ): Promise<string[] | null> {
    if (position.typ === "stabsstelle") {
      const { rows } = await client.query(
        `SELECT DISTINCT c.descendant_id
         FROM org_position_stabsstelle_scope s
         JOIN org_unit_closure c ON c.ancestor_id = s.org_unit_id
         WHERE s.position_id = $1`,
        [position.id]
      );
      return rows.map((r) => r.descendant_id);
    }

    switch (scope) {
      case "own":
      case "assigned":
        return null;
      case "team":
      case "wohngruppe":
        return [position.orgUnitId];
      case "subtree": {
        const { rows } = await client.query(
          `SELECT descendant_id FROM org_unit_closure WHERE ancestor_id = $1`,
          [position.orgUnitId]
        );
        return rows.map((r) => r.descendant_id);
      }
      case "einrichtung":
      case "bereich": {
        const { rows } = await client.query(
          `SELECT ou.id
           FROM org_unit_closure c
           JOIN org_unit ou ON ou.id = c.ancestor_id
           WHERE c.descendant_id = $1 AND ou.typ = $2
           ORDER BY c.depth ASC
           LIMIT 1`,
          [position.orgUnitId, scope]
        );
        return rows.map((r) => r.id);
      }
      case "tenant": {
        const ctx = requireTenantContext();
        const { rows } = await client.query(`SELECT id FROM org_unit WHERE mandant_id = $1`, [ctx.mandantId]);
        return rows.map((r) => r.id);
      }
      default:
        return null;
    }
  }

  /**
   * Vertretung: nie rekursiv (loest die Rechte des Vertretenen IMMER ueber
   * aufloesen() -- also ausschliesslich aus dessen eigenen Positionen --
   * auf, nie ueber eine zweite eingehende Delegation). Das schliesst
   * Kettenvertretung strukturell aus, nicht nur per Regel.
   *
   * Ergebnis wird spaeter MIT den eigenen Rechten des Vertreters vereinigt
   * (siehe hatRecht/ermittleErlaubteOrgUnitIds) -- "Vertreter behaelt seine
   * eigenen Rechte, die Delegation wird addiert".
   */
  private async delegierteAufloesung(
    client: import("pg").PoolClient,
    vertreterBenutzerId: string,
    modul: string,
    aktion: string
  ): Promise<PositionsErgebnis | null> {
    if (!istDelegierbar(modul, aktion)) return null;

    const { rows } = await client.query(
      `SELECT id, vertretener_benutzer_id, umfang, sensible_rechte_eingeschlossen
       FROM delegation
       WHERE vertreter_benutzer_id = $1 AND status <> 'widerrufen'
         AND von <= CURRENT_DATE AND bis >= CURRENT_DATE`,
      [vertreterBenutzerId]
    );
    if (rows.length === 0) return null;

    let ergebnis = leeresErgebnis();
    for (const delegation of rows) {
      if (istSensibel(modul, aktion) && !delegation.sensible_rechte_eingeschlossen) continue;
      if (delegation.umfang === "auswahl") {
        const { rows: rechtRows } = await client.query(
          `SELECT 1 FROM delegation_recht WHERE delegation_id = $1 AND modul = $2 AND aktion = $3`,
          [delegation.id, modul, aktion]
        );
        if (rechtRows.length === 0) continue;
      }
      const vertretenerErgebnis = await this.aufloesen(client, delegation.vertretener_benutzer_id, modul, aktion);
      ergebnis = vereinigen(ergebnis, vertretenerErgebnis);
    }
    return ergebnis;
  }
}
