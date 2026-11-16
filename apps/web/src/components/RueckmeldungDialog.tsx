import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { RueckmeldungArt, RueckmeldungPrioritaet } from "@zimmerakte/shared";
import { api } from "../api/client";
import { sammleKontext } from "../rueckmeldung/kontext";
import type { MaskierterScreenshot } from "../rueckmeldung/screenshot";
import { IErfolg, IFehler } from "./icons";
import { Modal } from "./Modal";

const PRIORITAET_LABEL: Record<RueckmeldungPrioritaet, string> = {
  niedrig: "Niedrig",
  mittel: "Mittel",
  hoch: "Hoch",
  blockierend: "Blockiert meine Arbeit",
};

/**
 * Idee oder Fehler melden. Der Screenshot wurde VOR dem Öffnen aufgenommen
 * und ist bereits maskiert (rueckmeldung/maskierung.ts) -- dieser Dialog sieht
 * nie ein unmaskiertes Bild. Die Vorschau zeigt genau das, was gesendet wird;
 * wer das Bild nicht mitschicken will, nimmt den Haken heraus.
 */
export function RueckmeldungDialog({
  screenshot,
  seite,
  rolle,
  onClose,
}: {
  screenshot: MaskierterScreenshot | null;
  seite: string;
  rolle?: string;
  onClose: () => void;
}) {
  const [art, setArt] = useState<RueckmeldungArt>("idee");
  const [prioritaet, setPrioritaet] = useState<RueckmeldungPrioritaet>("mittel");
  const [mitBild, setMitBild] = useState(screenshot !== null);
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gesendet, setGesendet] = useState<{ ohneBild: boolean } | null>(null);
  // Der Kontext wird beim Oeffnen eingefroren: er beschreibt die Seite, von der
  // aus gemeldet wurde, nicht den Dialog.
  const kontext = useMemo(() => sammleKontext({ seite, rolle }), [seite, rolle]);
  // Die URL entsteht im Effekt, nicht in useMemo: der React-StrictMode fuehrt
  // Effekte doppelt aus (anlegen -> aufraeumen -> anlegen), und eine in
  // useMemo angelegte URL waere nach dem ersten Aufraeumen schon widerrufen.
  const [vorschauUrl, setVorschauUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!screenshot) return;
    const url = URL.createObjectURL(screenshot.blob);
    setVorschauUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setVorschauUrl(null);
    };
  }, [screenshot]);

  async function senden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sendet) return;
    // e.currentTarget ist nach dem ersten await null (siehe CLAUDE.md).
    const form = new FormData(e.currentTarget);
    const text = (n: string) => String(form.get(n) ?? "").trim();
    setSendet(true);
    setFehler(null);
    try {
      const { id } = await api.rueckmeldungMelden({
        art,
        titel: text("titel"),
        beschreibung: text("beschreibung"),
        erwartet: text("erwartet") || undefined,
        prioritaet: art === "idee" && prioritaet === "blockierend" ? "hoch" : prioritaet,
        kontext,
      });
      // Zwei Schritte: die Meldung ist gespeichert, auch wenn das Bild scheitert.
      let bildFehlt = false;
      if (mitBild && screenshot) {
        try {
          await api.rueckmeldungScreenshot(id, screenshot.blob);
        } catch {
          bildFehlt = true;
        }
      }
      setGesendet({ ohneBild: bildFehlt || !(mitBild && screenshot) });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Senden fehlgeschlagen.");
    } finally {
      setSendet(false);
    }
  }

  if (gesendet) {
    return (
      <Modal titel="Danke für Ihre Rückmeldung" onClose={onClose}>
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          Die Geschäftsführung sieht Ihre Meldung und entscheidet, ob sie weiterverfolgt wird.
          {gesendet.ohneBild && mitBild && " Der Screenshot konnte nicht mitgesendet werden."}
        </div>
        <button type="button" className="zv-btn" onClick={onClose}>
          Schließen
        </button>
      </Modal>
    );
  }

  return (
    <Modal titel="Rückmeldung geben" onClose={onClose}>
      <form onSubmit={senden}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}

        <div className="zv-field">
          <span id="rueckmeldung-art-label">Worum geht es?</span>
          <div className="zv-segmented" role="group" aria-labelledby="rueckmeldung-art-label">
            <button type="button" className={art === "idee" ? "active" : ""} aria-pressed={art === "idee"} onClick={() => setArt("idee")}>
              Idee oder Wunsch
            </button>
            <button type="button" className={art === "fehler" ? "active" : ""} aria-pressed={art === "fehler"} onClick={() => setArt("fehler")}>
              Fehler
            </button>
          </div>
        </div>

        <div className="zv-field">
          <label htmlFor="rueckmeldung-titel">Titel</label>
          <input id="rueckmeldung-titel" name="titel" required maxLength={200} autoFocus />
        </div>
        <div className="zv-field">
          <label htmlFor="rueckmeldung-beschreibung">{art === "idee" ? "Was soll sich ändern?" : "Was ist passiert?"}</label>
          <textarea id="rueckmeldung-beschreibung" name="beschreibung" required rows={4} maxLength={5000} />
        </div>
        <div className="zv-field">
          <label htmlFor="rueckmeldung-erwartet">{art === "idee" ? "Warum? Was bringt es? (optional)" : "Was hätte passieren sollen? (optional)"}</label>
          <textarea id="rueckmeldung-erwartet" name="erwartet" rows={2} maxLength={3000} />
        </div>
        <div className="zv-field">
          <label htmlFor="rueckmeldung-prioritaet">Wie wichtig ist es?</label>
          <select id="rueckmeldung-prioritaet" value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as RueckmeldungPrioritaet)}>
            {(Object.keys(PRIORITAET_LABEL) as RueckmeldungPrioritaet[])
              .filter((p) => art === "fehler" || p !== "blockierend")
              .map((p) => (
                <option key={p} value={p}>
                  {PRIORITAET_LABEL[p]}
                </option>
              ))}
          </select>
        </div>

        <div className="zv-hinweis zv-hinweis-info">
          Bitte keine Namen von Klient:innen in die Felder schreiben – die Geschäftsführung liest Ihre Meldung, und sie
          kann an den Hersteller der Software weitergegeben werden.
        </div>

        {screenshot && vorschauUrl ? (
          <div className="zv-field">
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={mitBild} onChange={(e) => setMitBild(e.target.checked)} />
              Screenshot mitsenden
            </label>
            {mitBild && (
              <>
                <img
                  src={vorschauUrl}
                  alt="Vorschau des Screenshots, alle Texte sind unkenntlich gemacht"
                  style={{ maxWidth: "100%", borderRadius: "var(--zv-radius-s)", border: "1px solid var(--zv-border)" }}
                />
                <span className="zv-sub-inline">
                  Alle Texte und Eingaben sind im Bild unkenntlich gemacht – nur das Layout ist zu sehen.
                </span>
              </>
            )}
          </div>
        ) : (
          <p className="zv-sub-inline">Von dieser Seite konnte kein Screenshot erstellt werden. Die Meldung geht ohne Bild.</p>
        )}

        <details className="zv-sub-inline">
          <summary>Was wird automatisch mitgeschickt?</summary>
          <ul>
            <li>Ansicht: {kontext.seite}</li>
            <li>Browser: {kontext.browser} ({kontext.betriebssystem}), Fenster {kontext.viewport}</li>
            <li>Darstellung: {kontext.theme}, Version {kontext.appVersion}</li>
            {kontext.rolle && <li>Ihre Rolle: {kontext.rolle}</li>}
          </ul>
        </details>

        <div className="zv-aktionszeile">
          <button type="button" className="zv-btn zv-btn-sekundaer" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="zv-btn" disabled={sendet}>
            {sendet ? "Wird gesendet…" : "Senden"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
