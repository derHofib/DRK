import { useEffect, useState } from "react";
import type { PdfExportAngebotDto, ProtokollKurzDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Modal } from "../../components/Modal";
import { IFehler, IHerunterladen } from "../../components/icons";
import { formatDatum } from "../../format";
import { zuordnungText } from "./zuordnung";

/**
 * Mehrere Dokumente als ein PDF (Konzept dokumentation-formulare, Bild 4).
 * Je Dokument waehlt man einen der Exporte, die sein Formular anbietet;
 * vorausgewaehlt ist der Standard.
 *
 * Exporte fuer Externe stehen hier bewusst nicht zur Wahl: sie brauchen
 * einen Empfaenger und gehen einzeln aus dem Dokument raus. Der Server lehnt
 * sie im Stapel ebenfalls ab -- die Oberflaeche zeigt es nur frueher.
 */
export function SammelPdf({
  dokumente,
  onClose,
}: {
  dokumente: ProtokollKurzDto[];
  onClose: () => void;
}) {
  const [angebote, setAngebote] = useState<Record<
    string,
    PdfExportAngebotDto[]
  > | null>(null);
  const [wahl, setWahl] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    let aktiv = true;
    // Je Formular nur einmal fragen: das Angebot haengt am Formular, nicht am Dokument.
    const jeFormular = new Map<string, string>();
    for (const d of dokumente)
      if (!jeFormular.has(d.formularId)) jeFormular.set(d.formularId, d.id);
    Promise.all(
      [...jeFormular].map(
        async ([formularId, protokollId]) =>
          [formularId, await api.protokollPdfExporte(protokollId)] as const,
      ),
    )
      .then((paare) => {
        if (!aktiv) return;
        const intern = Object.fromEntries(
          paare.map(([f, l]) => [
            f,
            l.filter((x) => x.zielgruppe === "intern"),
          ]),
        );
        setAngebote(intern);
        const start: Record<string, string> = {};
        for (const d of dokumente) {
          const l = intern[d.formularId] ?? [];
          const standard = l.find((x) => x.istStandard) ?? l[0];
          if (standard) start[d.id] = standard.id;
        }
        setWahl(start);
      })
      .catch((e: Error) => aktiv && setFehler(e.message));
    return () => {
      aktiv = false;
    };
  }, [dokumente]);

  const mitExport = dokumente.filter((d) => wahl[d.id]);
  const ohneExport = angebote
    ? dokumente.filter((d) => (angebote[d.formularId] ?? []).length === 0)
    : [];

  async function erzeugen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const blob = await api.sammelPdf(
        mitExport.map((d) => ({ protokollId: d.id, exportId: wahl[d.id] })),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Dokumentation ${mitExport.length} Dokumente.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setFehler((e as Error).message);
      setLaeuft(false);
    }
  }

  return (
    <Modal
      titel={`${dokumente.length} ${dokumente.length === 1 ? "Dokument" : "Dokumente"} als PDF`}
      onClose={onClose}
      breit
    >
      <div className="zv-pe-neu">
        <p className="zv-sub">
          Eine Datei, die Dokumente hintereinander, jedes in seinem eigenen
          Design. Exporte für Externe (mit Empfänger) erzeugen Sie einzeln aus
          dem Dokument.
        </p>
        {angebote === null && !fehler && <p className="zv-sub">Lädt…</p>}
        {angebote &&
          dokumente.map((d) => {
            const l = angebote[d.formularId] ?? [];
            return (
              <div key={d.id} className="zv-sammel-zeile">
                <span>
                  <strong>{d.formularName}</strong>
                  <span className="zv-sub">
                    {" "}
                    · {formatDatum(d.bezugsdatum)} · {zuordnungText(d)}
                  </span>
                </span>
                {l.length === 0 ? (
                  <span className="zv-sub">
                    Kein interner PDF-Export – wird ausgelassen
                  </span>
                ) : (
                  <span className="zv-field">
                    <select
                      aria-label={`PDF-Export für ${d.formularName} vom ${formatDatum(d.bezugsdatum)}`}
                      value={wahl[d.id] ?? ""}
                      onChange={(e) =>
                        setWahl((alt) => ({ ...alt, [d.id]: e.target.value }))
                      }
                    >
                      {l.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                          {x.istStandard ? " (Standard)" : ""}
                        </option>
                      ))}
                    </select>
                  </span>
                )}
              </div>
            );
          })}
        {ohneExport.length > 0 && (
          <p className="zv-sub">
            {ohneExport.length === 1
              ? "Ein Dokument hat"
              : `${ohneExport.length} Dokumente haben`}{" "}
            keinen internen PDF-Export und{" "}
            {ohneExport.length === 1 ? "fehlt" : "fehlen"} in der Datei.
          </p>
        )}
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-protokoll-leiste">
          <button
            type="button"
            className="zv-btn zv-btn-still"
            onClick={onClose}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="zv-btn"
            disabled={mitExport.length === 0 || laeuft}
            onClick={() => void erzeugen()}
          >
            <IHerunterladen />
            {laeuft
              ? "Wird erzeugt…"
              : `PDF mit ${mitExport.length} ${mitExport.length === 1 ? "Dokument" : "Dokumenten"} herunterladen`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
