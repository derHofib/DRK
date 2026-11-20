import type { ProtokollKurzDto } from "@zimmerakte/shared";

/** Wozu ein Dokument gehoert, als kurzer Text fuer Listen und den Kopf eines Protokolls. */
export function zuordnungText(p: Pick<ProtokollKurzDto, "klientName" | "standortName">): string {
  if (p.klientName) return p.klientName;
  if (p.standortName) return p.standortName;
  return "ohne Zuordnung";
}
