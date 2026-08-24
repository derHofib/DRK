export function formatBetrag(cent: number): string {
  return (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}
