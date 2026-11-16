import { useState } from "react";
import { csvHerunterladen, pdfHerunterladen, type ListenExport } from "../export/listenExport";
import { AktionsMenue } from "./AktionsMenue";
import { IDokument, IFehler, IHerunterladen } from "./icons";

/**
 * "Exportieren"-Knopf neben der Filterleiste. `erzeuge` wird erst beim Klick
 * aufgerufen: die Liste kann tausende Zeilen haben und soll nicht bei jedem
 * Rendern in Textform gebaut werden, nur damit ein Menue daneben steht.
 */
export function ExportMenue({ erzeuge }: { erzeuge: () => ListenExport }) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function los(format: "csv" | "pdf") {
    setFehler(null);
    const liste = erzeuge();
    if (liste.zeilen.length === 0) {
      setFehler("Keine Einträge zum Exportieren – die Liste ist für diese Auswahl leer.");
      return;
    }
    setLaeuft(true);
    try {
      if (format === "csv") csvHerunterladen(liste);
      else await pdfHerunterladen(liste);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Export fehlgeschlagen.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <>
      <AktionsMenue
        label="Aktuelle Liste exportieren"
        variante="pille"
        beschriftung={laeuft ? "Exportiere…" : "Exportieren"}
        icon={<IHerunterladen />}
      >
        <button type="button" role="menuitem" onClick={() => los("csv")}>
          <IDokument /> Als CSV (Excel)
        </button>
        <button type="button" role="menuitem" onClick={() => los("pdf")}>
          <IDokument /> Als PDF
        </button>
      </AktionsMenue>
      {fehler && (
        <span className="zv-sub-inline" role="alert" style={{ display: "inline-flex", alignItems: "center", gap: "var(--zv-space-1)" }}>
          <IFehler /> {fehler}
        </span>
      )}
    </>
  );
}
