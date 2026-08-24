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
