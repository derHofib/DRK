import { Controller, Get } from "@nestjs/common";
import { Authenticated } from "../common/authenticated.decorator";
import { ErfordertRecht } from "../rechte/rechte.decorator";
import { OrganigrammService } from "./organigramm.service";

/**
 * Nur lesende Endpunkte (Organigramm-Plan, Lieferreihenfolge Schritt 6).
 * Reparenting, Account-Typ-Matrix bearbeiten und Delegation
 * anlegen/genehmigen/widerrufen folgen in einem spaeteren Schritt.
 *
 * Alle drei Endpunkte gated mit organigramm.ansehen -- die feinere
 * Personendaten-Redaktion (organigramm.personendaten-sehen) sitzt dagegen
 * im Service, nicht hier (siehe organigramm.service.ts, findePositionen()).
 *
 * Heutiger Zwischenstand: rollen-mapping.ts (Schritt 3, noch aussstehend)
 * kennt organigramm.* noch nicht fuer die Rollen einrichtungsleitung/
 * mitarbeiter -- nur ein Account-Typ mit ist_vollzugriff=true (Wildcard)
 * sieht diese Endpunkte heute ueberhaupt. Kein Bug, siehe Testdatei-Kopf.
 */
@Controller("organigramm")
@Authenticated()
export class OrganigrammController {
  constructor(private readonly organigramm: OrganigrammService) {}

  @Get("org-units")
  @ErfordertRecht("organigramm", "ansehen")
  async orgUnits() {
    return this.organigramm.findeOrgUnits();
  }

  @Get("positions")
  @ErfordertRecht("organigramm", "ansehen")
  async positions() {
    return this.organigramm.findePositionen();
  }

  @Get("account-typen")
  @ErfordertRecht("organigramm", "ansehen")
  async accountTypen() {
    return this.organigramm.findeAccountTypen();
  }
}
