/**
 * Nimmt sowohl rohes Base64 als auch Data-URLs entgegen
 * ("data:image/png;base64,..." oder "data:application/pdf;base64,...") --
 * Aufrufer sollen sich nicht um das Prefix kuemmern muessen.
 */
export function dateiAusBase64(input: string): Buffer {
  const kommaIndex = input.indexOf(",");
  const reinesBase64 = input.startsWith("data:") && kommaIndex !== -1 ? input.slice(kommaIndex + 1) : input;
  return Buffer.from(reinesBase64, "base64");
}

/**
 * Allowlist statt freiem String: ein hochgeladenes Dokument (Rechnung,
 * Tagesbericht) landet unveraendert in der Antwort auf den jeweiligen
 * GET-.../dokument-Endpunkt, mit genau diesem Wert als Content-Type-Header.
 * Ohne Einschraenkung koennte jede Rolle ein Dokument mit MIME-Type
 * "text/html" und einem <script>-Inhalt anlegen -- oeffnet eine andere
 * Person dieses Dokument, fuehrt der Browser das Skript im Origin der
 * Anwendung aus und kann das JWT aus localStorage lesen. Live gegen die
 * echte API nachgewiesen (Rechnungsdokumente), kein theoretischer Fund --
 * deshalb dieselbe Allowlist fuer jeden weiteren Dokument-Upload-Pfad.
 * Passt zum accept="application/pdf,image/*" der Datei-Felder im Frontend.
 */
export const ERLAUBTE_DOKUMENT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

/**
 * Erkennt den Bildtyp an den ersten Bytes, nicht am erklaerten Content-Type:
 * ein Upload darf nur dann als Bild gespeichert werden, wenn Inhalt UND
 * Deklaration uebereinstimmen. Sonst lieferte der GET-Endpunkt spaeter
 * beliebige Bytes unter einem Bild-Content-Type aus (siehe
 * ERLAUBTE_DOKUMENT_MIME_TYPES oben fuer die Begruendung).
 */
export function erkenneBildTyp(daten: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (daten.length >= 3 && daten[0] === 0xff && daten[1] === 0xd8 && daten[2] === 0xff) return "image/jpeg";
  if (daten.length >= 8 && daten.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (daten.length >= 12 && daten.toString("ascii", 0, 4) === "RIFF" && daten.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}
