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
