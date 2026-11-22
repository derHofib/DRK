import { useState } from "react";
import { CHAT_SCHNELLREAKTIONEN, type ChatNachrichtDto, type ChatReaktionDto } from "@zimmerakte/shared";
import { Modal } from "../Modal";
import { IGruppe, IKopieren, INachrichtLoeschen, INeu } from "../icons";
import { SmileyAuswahl } from "./SmileyAuswahl";
import { smileyName } from "./smiley-liste";

/** So viele Zeichen stehen als Knopf unter der Nachricht, der Rest als "+N" (Konzept, Entwurf 2 B). */
const SICHTBARE_GRUPPEN = 3;

export function meineReaktion(n: ChatNachrichtDto): string | null {
  return n.reaktionen.find((r) => r.meine)?.zeichen ?? null;
}

function namensliste(r: ChatReaktionDto): string {
  const namen = r.personen.map((p, i) => (i === 0 && r.meine ? "Du" : p.name));
  if (namen.length <= 1) return namen[0] ?? "";
  return `${namen.slice(0, -1).join(", ")} und ${namen[namen.length - 1]}`;
}

/**
 * Die Knoepfe unter einer Nachricht. Klick = selbst so reagieren bzw. die
 * eigene Reaktion zuruecknehmen. Die Namen stehen im Tooltip und -- fuer
 * Screenreader -- in der Beschriftung.
 */
export function ReaktionsKnoepfe({
  n,
  onUmschalten,
  onAlleZeigen,
  beschaeftigt,
}: {
  n: ChatNachrichtDto;
  onUmschalten: (zeichen: string) => void;
  onAlleZeigen: () => void;
  beschaeftigt: boolean;
}) {
  if (n.reaktionen.length === 0) return null;
  const sichtbar = n.reaktionen.slice(0, SICHTBARE_GRUPPEN);
  const rest = n.reaktionen.length - sichtbar.length;
  return (
    <div className="zv-reaktionen" role="group" aria-label="Reaktionen">
      {sichtbar.map((r) => (
        <button
          key={r.zeichen}
          type="button"
          className={`zv-reaktion${r.meine ? " meine" : ""}`}
          onClick={() => onUmschalten(r.zeichen)}
          disabled={beschaeftigt}
          aria-pressed={r.meine}
          aria-label={`${smileyName(r.zeichen)}, ${r.anzahl}: ${namensliste(r)}. ${r.meine ? "Klicken zum Zurücknehmen" : "Klicken, um genauso zu reagieren"}`}
          title={namensliste(r)}
        >
          <span className="zv-reaktion-zeichen" aria-hidden="true">
            {r.zeichen}
          </span>
          <span aria-hidden="true">{r.anzahl}</span>
        </button>
      ))}
      {rest > 0 && (
        <button type="button" className="zv-reaktion zv-reaktion-mehr" onClick={onAlleZeigen} aria-label={`${rest} weitere Reaktionen ansehen`} title="Alle Reaktionen ansehen">
          +{rest}
        </button>
      )}
    </div>
  );
}

/** Die sechs Schnellreaktionen plus "Weitere" (und optional "Wer hat reagiert?"). */
export function ReaktionsLeiste({
  meine,
  onWahl,
  onMehr,
  onWer,
  className = "",
}: {
  meine: string | null;
  onWahl: (zeichen: string) => void;
  onMehr: () => void;
  onWer?: () => void;
  className?: string;
}) {
  return (
    <div className={`zv-reaktionsleiste ${className}`} role="toolbar" aria-label="Reagieren">
      {CHAT_SCHNELLREAKTIONEN.map((z) => (
        <button
          key={z}
          type="button"
          className={`zv-reaktionsleiste-zeichen${meine === z ? " gewaehlt" : ""}`}
          onClick={() => onWahl(z)}
          aria-pressed={meine === z}
          aria-label={meine === z ? `${smileyName(z)} zurücknehmen` : `Mit ${smileyName(z)} reagieren`}
          title={smileyName(z)}
        >
          {z}
        </button>
      ))}
      <span className="zv-reaktionsleiste-trenner" aria-hidden="true" />
      <button type="button" className="zv-reaktionsleiste-knopf" onClick={onMehr} aria-label="Anderen Smiley wählen" title="Anderen Smiley wählen">
        <INeu size={18} />
      </button>
      {onWer && (
        <button type="button" className="zv-reaktionsleiste-knopf" onClick={onWer} aria-label="Wer hat reagiert?" title="Wer hat reagiert?">
          <IGruppe size={18} />
        </button>
      )}
    </div>
  );
}

/** "+" aus der Leiste: im Fenster, weil ein Aufklappfeld im Verlauf vom Scrollbereich abgeschnitten wuerde. */
export function SmileyFenster({ onWahl, onClose }: { onWahl: (zeichen: string) => void; onClose: () => void }) {
  return (
    <Modal titel="Reaktion wählen" onClose={onClose}>
      <SmileyAuswahl onWahl={onWahl} autoFokus={window.matchMedia("(hover: hover)").matches} />
    </Modal>
  );
}

/** Wer hat wie reagiert -- nach Zeichen filterbar, die eigene Zeile oben mit "Entfernen". */
export function ReaktionenFenster({
  n,
  onEntfernen,
  onClose,
  beschaeftigt,
}: {
  n: ChatNachrichtDto;
  onEntfernen: () => void;
  onClose: () => void;
  beschaeftigt: boolean;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const gesamt = n.reaktionen.reduce((s, r) => s + r.anzahl, 0);
  const zeilen = n.reaktionen
    .filter((r) => filter === null || r.zeichen === filter)
    .flatMap((r) => r.personen.map((p, i) => ({ r, p, ich: r.meine && i === 0 })))
    // Die eigene Zeile zuerst, auch in "Alle".
    .sort((a, b) => Number(b.ich) - Number(a.ich));

  return (
    <Modal titel="Reaktionen" onClose={onClose}>
      {gesamt === 0 ? (
        <p className="zv-smiley-leer">Noch keine Reaktionen.</p>
      ) : (
        <>
          <div className="zv-reaktionen-filter" role="tablist" aria-label="Nach Reaktion filtern">
            <button type="button" role="tab" aria-selected={filter === null} className={filter === null ? "aktiv" : undefined} onClick={() => setFilter(null)}>
              Alle {gesamt}
            </button>
            {n.reaktionen.map((r) => (
              <button
                key={r.zeichen}
                type="button"
                role="tab"
                aria-selected={filter === r.zeichen}
                aria-label={`${smileyName(r.zeichen)}, ${r.anzahl}`}
                className={filter === r.zeichen ? "aktiv" : undefined}
                onClick={() => setFilter(r.zeichen)}
              >
                <span className="zv-reaktion-zeichen">{r.zeichen}</span> {r.anzahl}
              </button>
            ))}
          </div>
          <ul className="zv-reaktionen-personen">
            {zeilen.map(({ r, p, ich }) => (
              <li key={`${r.zeichen}-${p.art}-${p.id}`} className={ich ? "ich" : undefined}>
                <span className="zv-reaktionen-name">
                  {ich ? "Du" : p.name}
                  {p.art === "klient" && !ich && <small>Klient:in</small>}
                </span>
                {ich && (
                  <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={onEntfernen} disabled={beschaeftigt}>
                    Entfernen
                  </button>
                )}
                <span className="zv-reaktion-zeichen zv-reaktionen-zeichen" aria-label={smileyName(r.zeichen)}>
                  {r.zeichen}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

/**
 * Am Handy nach langem Druecken: oben die Reaktionen, darunter die
 * Aktionen. Als Fenster statt als eigenes Overlay, damit Scrim, Escape und
 * Schliessen dieselben sind wie ueberall (Modal.tsx).
 */
export function NachrichtMenue({
  n,
  onWahl,
  onMehr,
  onWer,
  onLoeschen,
  onClose,
}: {
  n: ChatNachrichtDto;
  onWahl: (zeichen: string) => void;
  onMehr: () => void;
  onWer: () => void;
  onLoeschen: () => void;
  onClose: () => void;
}) {
  const [kopiert, setKopiert] = useState(false);
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(n.text ?? "");
      setKopiert(true);
      window.setTimeout(onClose, 600);
    } catch {
      setKopiert(false);
    }
  }
  return (
    <Modal titel={n.eigene ? "Deine Nachricht" : `Nachricht von ${n.absender?.name ?? "Unbekannt"}`} onClose={onClose}>
      {n.text && <p className="zv-nachricht-menue-vorschau">{n.text}</p>}
      <ReaktionsLeiste meine={meineReaktion(n)} onWahl={onWahl} onMehr={onMehr} className="zv-reaktionsleiste-fenster" />
      <div className="zv-nachricht-menue">
        {n.text && (
          <button type="button" onClick={() => void kopieren()}>
            <IKopieren /> {kopiert ? "Kopiert" : "Text kopieren"}
          </button>
        )}
        {n.reaktionen.length > 0 && (
          <button type="button" onClick={onWer}>
            <IGruppe /> Wer hat reagiert?
          </button>
        )}
        {n.eigene && (
          <button type="button" className="gefahr" onClick={onLoeschen}>
            <INachrichtLoeschen /> Nachricht löschen
          </button>
        )}
      </div>
    </Modal>
  );
}
