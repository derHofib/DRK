export function formatBetrag(cent: number): string {
  return (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// Reines Stringschieben statt `new Date(isoDatum)` -- date-Spalten kommen aus
// der API bereits als "YYYY-MM-DD"-String (siehe database.service.ts,
// Fallstrick pg+Zeitzone). Ueber ein Date-Objekt zu gehen wuerde genau das
// Risiko wieder einfuehren, das der eigene Parser vermeiden soll.
export function formatDatum(isoDatum: string): string {
  const [jahr, monat, tag] = isoDatum.split("-");
  return `${tag}.${monat}.${jahr}`;
}
