import type { ReactNode } from "react";
import { formatBelegnummer } from "@zimmerakte/shared";
import type { KassenbuchungDto } from "@zimmerakte/shared";
import { formatBetrag, formatDatum } from "../format";
import { ISOffen, ISStorniert } from "./icons";

/**
 * Laufender Saldo je Buchung: Stand NACH dieser Buchung, chronologisch
 * (Datum, dann Belegnummer) ueber ALLE uebergebenen Buchungen. Stornierte
 * Buchungen tragen keinen Saldo und fliessen nicht ein -- dieselbe Regel wie
 * beim Kassenstand (kassenbuchung.service.ts rechnet nur NOT storniert).
 * Bewusst ueber die UNGEFILTERTE Menge gerechnet und nur angezeigt, wo
 * gefiltert wird: ein Saldo, der sich mit dem Filter aendert, waere nicht
 * der Stand der Kasse.
 */
export function laufsalden(buchungen: KassenbuchungDto[]): Map<string, number> {
  const chronologisch = [...buchungen].sort((a, b) => a.datum.localeCompare(b.datum) || a.belegnummer - b.belegnummer);
  const salden = new Map<string, number>();
  let stand = 0;
  for (const b of chronologisch) {
    if (b.storniert) continue;
    stand += b.betragCent;
    salden.set(b.id, stand);
  }
  return salden;
}

export function neuesterZuerst(buchungen: KassenbuchungDto[]): KassenbuchungDto[] {
  return [...buchungen].sort((a, b) => b.datum.localeCompare(a.datum) || b.belegnummer - a.belegnummer);
}

/**
 * Journal als echte Tabelle. Der Scrollcontainer ist der UMSCHLIESSENDE
 * Wrapper, nicht die Tabelle: .zv-table ist display:block (damit breite
 * Tabellen selbst scrollen), und dann ist die Tabelle der Scrollcontainer,
 * wodurch `position: sticky` auf dem thead nicht mehr am sichtbaren Rahmen
 * haengt (siehe CLAUDE.md, Fallstricke). Hier bleibt die Tabelle normales
 * display:table, der Wrapper hat eine feste Maximalhoehe -- so klebt die
 * Kopfzeile beim Scrollen, und breite Inhalte scrollen im Wrapper statt
 * die Seite aufzureissen.
 */
export function KassenbuchJournal({
  buchungen,
  salden,
  bezugLabel,
  bezug,
  zusatz,
  aktionen,
  unterschrift,
}: {
  buchungen: KassenbuchungDto[];
  salden: Map<string, number>;
  bezugLabel: string;
  bezug: (b: KassenbuchungDto) => string | null;
  /** Zweite Zeile in der Zweck-Spalte (Typ, Mitarbeiter, Teilnehmer ...). */
  zusatz: (b: KassenbuchungDto) => string;
  aktionen: (b: KassenbuchungDto) => ReactNode;
  /** Bild der geoeffneten Unterschrift, falls fuer diese Buchung offen. */
  unterschrift: (b: KassenbuchungDto) => ReactNode;
}) {
  return (
    <div className="zv-journal-wrapper" role="region" aria-label="Journal" tabIndex={0}>
      <table className="zv-journal">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Beleg</th>
            <th>{bezugLabel}</th>
            <th>Zweck</th>
            <th className="zv-journal-zahl">Einnahme</th>
            <th className="zv-journal-zahl">Ausgabe</th>
            <th className="zv-journal-zahl">Saldo</th>
            <th>
              <span className="zv-sr-only">Aktionen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {buchungen.map((b) => {
            const saldo = salden.get(b.id);
            const einnahme = b.betragCent > 0 ? formatBetrag(b.betragCent) : "";
            const ausgabe = b.betragCent < 0 ? formatBetrag(-b.betragCent) : "";
            return (
              <tr key={b.id} className={b.storniert ? "zv-journal-storniert" : undefined}>
                <td className="zv-mono">{formatDatum(b.datum)}</td>
                <td className="zv-mono zv-journal-beleg">{formatBelegnummer(b.belegnummer)}</td>
                <td>{bezug(b) ?? "–"}</td>
                <td className="zv-journal-zweck">
                  <span className="zv-journal-text">{b.verwendungszweck}</span>
                  <span className="zv-todo-meta">{zusatz(b)}</span>
                  {b.storniert && (
                    <span className="zv-pill zv-pill-vergeben">
                      <ISStorniert />
                      Storniert
                    </span>
                  )}
                  {!b.storniert && b.offenerStornoantrag && (
                    <>
                      <span className="zv-pill zv-pill-achtung">
                        <ISOffen />
                        Storno beantragt
                      </span>
                      <span className="zv-todo-meta">
                        von {b.offenerStornoantrag.beantragtVonName}: {b.offenerStornoantrag.grund}
                      </span>
                    </>
                  )}
                  {unterschrift(b)}
                </td>
                <td className="zv-journal-zahl zv-mono">{einnahme}</td>
                <td className="zv-journal-zahl zv-mono">{ausgabe}</td>
                <td className="zv-journal-zahl zv-mono zv-journal-saldo">{saldo === undefined ? "–" : formatBetrag(saldo)}</td>
                <td className="zv-journal-aktionen">{aktionen(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
