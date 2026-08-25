import type { ReactNode } from "react";
import type { IconKomponente } from "./icons";

/**
 * Loest die bisher sieben Mal wiederholte graue Textzelle ab ("Noch keine
 * Zimmer angelegt.", "Kein Klient zugeordnet." ...). Das Icon ist rein
 * dekorativ -- die Aussage steht im Text, nicht im Bild.
 */
export function Leerzustand({
  icon: Icon,
  children,
  aktion,
}: {
  icon: IconKomponente;
  children: ReactNode;
  aktion?: ReactNode;
}) {
  return (
    <div className="zv-leer">
      <Icon />
      <p>{children}</p>
      {aktion}
    </div>
  );
}

/**
 * Dieselbe Darstellung innerhalb einer Tabelle. Getrennte Komponente, weil
 * ein <div> zwischen <tbody> und <tr> ungueltiges HTML waere und der
 * Browser es aus der Tabelle herausloest.
 */
export function LeerzustandZeile({
  icon,
  spalten,
  children,
}: {
  icon: IconKomponente;
  spalten: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={spalten} className="zv-leer-zelle">
        <Leerzustand icon={icon}>{children}</Leerzustand>
      </td>
    </tr>
  );
}
