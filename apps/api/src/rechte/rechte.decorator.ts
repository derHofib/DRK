import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { RechteGuard } from "./rechte.guard";

export const RECHTE_METADATA_KEY = "rechte:anforderung";

export interface RechteAnforderung {
  modul: string;
  aktion: string;
}

/**
 * Deklarative Rechtepruefung fuer einen Endpunkt, analog zu @Authenticated()
 * (common/authenticated.decorator.ts). Muss HINTER @Authenticated() auf
 * demselben Handler stehen (@Authenticated() zuerst, @ErfordertRecht()
 * danach) -- @Authenticated() bringt AuthGuard, der request.benutzer setzt,
 * das dieser Guard braucht.
 *
 * Fuer einfache Ja/Nein-Endpunkte reicht dieser Decorator. Fuer
 * Listen-/Scope-Filterung (z.B. "zeige alle Klienten in den erlaubten
 * Einrichtungen") ruft der jeweilige Service stattdessen direkt
 * RechteService.ermittleErlaubteOrgUnitIds() auf -- exakt das heutige
 * Muster von ermittleErlaubteStandortIds() in
 * common/standort-restriction.ts, nur die Quelle wechselt (siehe
 * Organigramm-Plan).
 *
 * Noch nicht an einem echten Endpunkt im Einsatz (Lieferreihenfolge
 * Schritt 2 baut nur die Engine) -- Beispiel fuer die spaetere
 * Verwendung:
 *   @Authenticated()
 *   @ErfordertRecht("klienten", "lesen-akte")
 *   @Get(":id")
 *   ...
 */
export function ErfordertRecht(modul: string, aktion: string) {
  return applyDecorators(SetMetadata(RECHTE_METADATA_KEY, { modul, aktion } satisfies RechteAnforderung), UseGuards(RechteGuard));
}
