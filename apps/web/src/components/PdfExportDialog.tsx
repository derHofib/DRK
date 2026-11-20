import { useEffect, useState } from "react";
import type { PdfExportAngebotDto, ProtokollDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { IFehler, IHerunterladen } from "./icons";

/**
 * Protokoll als PDF exportieren (Konzept „formular-pdf“, Bild 5). Angeboten
 * werden die nicht stillgelegten Exporte dieses Formulars, externe nur mit
 * dem Recht „PDF für Externe“ -- die Liste filtert schon der Server. Jede
 * Erzeugung wird dort mit Pruefsumme und Empfaenger protokolliert.
 */
export function PdfExportDialog({ p, onClose }: { p: ProtokollDto; onClose: () => void }) {
  const [angebot, setAngebot] = useState<PdfExportAngebotDto[] | null>(null);
  const [wahl, setWahl] = useState<string>("");
  const [empfaenger, setEmpfaenger] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    api
      .protokollPdfExporte(p.id)
      .then((l) => {
        setAngebot(l);
        const standard = l.find((x) => x.istStandard) ?? l[0];
        if (standard) setWahl(standard.id);
        const vorschlag = l.find((x) => x.empfaengerVorschlag)?.empfaengerVorschlag;
        if (vorschlag) setEmpfaenger(vorschlag);
      })
      .catch((e: Error) => setFehler(e.message));
  }, [p.id]);

  const gewaehlt = angebot?.find((x) => x.id === wahl);

  async function erzeugen() {
    if (!gewaehlt) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const blob = await api.protokollPdf(p.id, gewaehlt.id, gewaehlt.mitAnschriftfeld ? empfaenger.trim() || null : null);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${p.formularName} ${p.bezugsdatum} ${gewaehlt.name}.pdf`.replace(/[\\/:*?"<>|]+/g, "");
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
    <Modal titel={`${p.formularName} als PDF exportieren`} onClose={onClose}>
      <div className="zv-pe-neu">
        <p className="zv-sub">Angeboten werden die PDF-Exporte dieses Formulars, die Sie nutzen dürfen.</p>
        {angebot?.length === 0 && <p className="zv-sub">Für dieses Formular gibt es keinen PDF-Export, den Sie nutzen dürfen.</p>}
        {angebot?.map((x) => (
          <label key={x.id} className={`zv-pe-wahl${wahl === x.id ? " active" : ""}`}>
            <input type="radio" name="zv-pdf-export" checked={wahl === x.id} onChange={() => setWahl(x.id)} />
            <span>
              <strong>
                {x.name} <span className={x.zielgruppe === "extern" ? "zv-pill zv-pill-frist" : "zv-pill"}>{x.zielgruppe}</span>
                {x.istStandard && <span className="zv-pill zv-pill-ok">Standard</span>}
              </strong>
              <span className="zv-sub">{x.mitAnschriftfeld ? "Brief mit Anschriftfeld" : "ohne Anschriftfeld"}</span>
            </span>
          </label>
        ))}
        {gewaehlt?.mitAnschriftfeld && (
          <div className="zv-field">
            <label htmlFor="pdf-empfaenger">Empfänger (steht im Anschriftfeld)</label>
            <textarea id="pdf-empfaenger" rows={4} value={empfaenger} maxLength={1000} onChange={(e) => setEmpfaenger(e.target.value)} />
            <span className="zv-sub-inline">
              {gewaehlt.empfaengerVorschlag ? "Vorschlag aus der Kostenübernahme (Amt). " : ""}Wird mit dem PDF protokolliert.
            </span>
          </div>
        )}
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-protokoll-leiste">
          <button type="button" className="zv-btn zv-btn-still" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="zv-btn" disabled={!gewaehlt || laeuft} onClick={erzeugen}>
            <IHerunterladen />
            {laeuft ? "Wird erzeugt…" : "PDF erzeugen und herunterladen"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
