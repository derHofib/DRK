import { useState } from "react";
import type { ProtokollDto, ProtokollUnterschriftDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatDatum } from "../format";
import { Modal } from "./Modal";
import { ProtokollAnsicht } from "./ProtokollFormular";
import { SignaturePad } from "./SignaturePad";
import { IAbbrechen, IUnterschrift } from "./icons";

const ORT_SCHLUESSEL = "zv-unterschrift-ort";

/**
 * Der Ort aendert sich fuer eine Person selten; ihn jedes Mal zu tippen waere
 * laestig. Nur eine Bequemlichkeit auf diesem Geraet -- kein Datum der Akte --,
 * daher localStorage, und still, wenn der Speicher gesperrt ist.
 */
function gemerkterOrt(): string {
  try {
    return localStorage.getItem(ORT_SCHLUESSEL) ?? "";
  } catch {
    return "";
  }
}
function ortMerken(ort: string) {
  try {
    localStorage.setItem(ORT_SCHLUESSEL, ort);
  } catch {
    /* privates Fenster o. ae.: dann eben beim naechsten Mal neu tippen */
  }
}

/**
 * Unterschreiben eines Platzes. Der Inhalt laesst sich davor aufklappen: wer
 * unterschreibt -- besonders die Leitung aus "Heute" heraus --, soll sehen
 * koennen, WAS sie unterschreibt, ohne erst in die Akte zu wechseln.
 */
export function UnterschriftDialog({
  protokoll,
  platz,
  onFertig,
  onClose,
}: {
  protokoll: ProtokollDto;
  platz: ProtokollUnterschriftDto;
  onFertig: (neu: ProtokollDto) => void;
  onClose: () => void;
}) {
  const [bild, setBild] = useState<string | null>(null);
  const [ort, setOrt] = useState(gemerkterOrt);
  const [name, setName] = useState("");
  const [inhaltOffen, setInhaltOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const eigene = platz.rolle === "eigene";

  async function speichern() {
    if (!bild) return;
    if (eigene && !name.trim()) {
      setFehler("Bitte den Namen der Person eintragen, die unterschreibt.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    try {
      const neu = await api.protokollUnterschreiben(protokoll.id, {
        baustein: platz.baustein,
        platz: platz.platz,
        bild,
        ort: ort.trim() || null,
        name: eigene ? name.trim() : null,
      });
      if (ort.trim()) ortMerken(ort.trim());
      onFertig(neu);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Die Unterschrift konnte nicht gespeichert werden.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Modal titel={`Unterschrift: ${platz.beschriftung}`} onClose={onClose} breit={inhaltOffen}>
      <div className="zv-us-dialog">
        <p>
          {protokoll.formularName}, {formatDatum(protokoll.bezugsdatum)}
          {protokoll.klientName ? ` · ${protokoll.klientName}` : ""}
        </p>
        <p className="zv-protokoll-hilfe">
          {platz.fuerAndere
            ? `Bitte das Gerät an ${platz.name ?? "die unterschreibende Person"} geben. Unterschrieben wird der abgeschlossene Inhalt; eine spätere Korrektur wird bei der Unterschrift vermerkt.`
            : `Sie unterschreiben als ${platz.beschriftung}${platz.name ? ` (${platz.name})` : ""} den abgeschlossenen Inhalt. Eine spätere Korrektur wird bei der Unterschrift vermerkt.`}
        </p>

        <button type="button" className="zv-link-btn" aria-expanded={inhaltOffen} onClick={() => setInhaltOffen((o) => !o)}>
          {inhaltOffen ? "Inhalt ausblenden" : "Inhalt zeigen"}
        </button>
        {inhaltOffen && (
          <div className="zv-us-dialog-inhalt">
            <ProtokollAnsicht
              definition={protokoll.definition}
              werte={protokoll.werte}
              anzeige={protokoll.anzeige}
              quellen={protokoll.quellen}
              personen={protokoll.personen}
              unterschriften={protokoll.unterschriften}
            />
          </div>
        )}

        {eigene && (
          <div className="zv-field">
            <label htmlFor="zv-us-name">Name der Person *</label>
            <input id="zv-us-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="z. B. Petra Schmidt" />
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="zv-us-ort">Ort</label>
          <input id="zv-us-ort" value={ort} maxLength={80} onChange={(e) => setOrt(e.target.value)} placeholder="z. B. Hamburg" />
        </div>
        <div className="zv-field">
          <span className="zv-us-dialog-label">Unterschrift</span>
          <SignaturePad onChange={setBild} />
        </div>

        {fehler && (
          <p className="zv-fehlertext" role="alert">
            {fehler}
          </p>
        )}
        <div className="zv-vorschau-zeile">
          <button type="button" className="zv-btn" disabled={!bild || laeuft} onClick={speichern}>
            <IUnterschrift />
            {laeuft ? "Wird gespeichert…" : "Unterschreiben"}
          </button>
          <button type="button" className="zv-btn zv-btn-still" onClick={onClose}>
            <IAbbrechen />
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  );
}
