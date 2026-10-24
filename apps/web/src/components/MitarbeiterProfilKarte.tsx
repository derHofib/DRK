import { KONTAKTART_LABEL, type MitarbeiterProfilInhaltDto } from "@zimmerakte/shared";

/**
 * Zeigt nur, was gefuellt ist -- ein Feld, das fehlt, steht fuer
 * Klient:innen nicht als leere Zeile da (nicht freigegeben und nie
 * ausgefuellt sehen dort gleich aus, siehe migrations/0058).
 */
export function MitarbeiterProfilKarte({ inhalt, leerText }: { inhalt: MitarbeiterProfilInhaltDto; leerText: string }) {
  const zeilen: { label: string; wert: React.ReactNode }[] = [];
  if (inhalt.telefon) {
    // tel: nimmt nur Ziffern und "+" -- Leerzeichen/Schraegstriche aus der Eingabe stoeren manche Waehl-Apps.
    zeilen.push({ label: "Telefon", wert: <a href={`tel:${inhalt.telefon.replace(/[^\d+]/g, "")}`}>{inhalt.telefon}</a> });
  }
  if (inhalt.bevorzugteKontaktart) {
    zeilen.push({ label: "Am liebsten per", wert: KONTAKTART_LABEL[inhalt.bevorzugteKontaktart] });
  }
  if (inhalt.erreichbarkeit) zeilen.push({ label: "Erreichbar", wert: inhalt.erreichbarkeit });
  if (inhalt.emailDienstlich) {
    zeilen.push({ label: "E-Mail", wert: <a href={`mailto:${inhalt.emailDienstlich}`}>{inhalt.emailDienstlich}</a> });
  }
  if (inhalt.ueberMich) {
    zeilen.push({ label: "Über mich", wert: <span style={{ whiteSpace: "pre-wrap" }}>{inhalt.ueberMich}</span> });
  }
  if (zeilen.length === 0) return <p className="zv-sub">{leerText}</p>;
  return (
    <dl className="zv-profil-liste">
      {zeilen.map((z) => (
        <div key={z.label} style={{ display: "contents" }}>
          <dt>{z.label}</dt>
          <dd>{z.wert}</dd>
        </div>
      ))}
    </dl>
  );
}
