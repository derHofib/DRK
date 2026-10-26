import { useEffect, useState } from "react";
import { formatBetrag, formatDatum } from "../format";
import { entfernen, uebertragen, useAutomatischUebertragen, useWarteschlange, type WarteschlangenEintrag } from "../offline/warteschlange";
import { IFehler, IOffline, IUebertragen } from "./icons";

/**
 * Leiste ueber jedem Bereich der Shell, solange Buchungen dieser Person auf
 * dem Geraet liegen. Bewusst nicht nur im Kassenbuch: wer im Treppenhaus
 * bucht, ist danach oft schon im Dashboard oder in einer Akte -- und muss
 * trotzdem sehen, dass noch etwas nicht angekommen ist, bevor das Geraet
 * weitergegeben oder die App geschlossen wird.
 *
 * Gleichzeitig der Ort, der das automatische Senden anstoesst
 * (useAutomatischUebertragen), weil die Shell nach jeder Anmeldung montiert.
 */
export function WarteschlangeLeiste() {
  const eintraege = useWarteschlange();
  useAutomatischUebertragen(eintraege);

  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener("online", an);
    window.addEventListener("offline", aus);
    return () => {
      window.removeEventListener("online", an);
      window.removeEventListener("offline", aus);
    };
  }, []);

  const [laeuft, setLaeuft] = useState(false);
  async function jetzt() {
    setLaeuft(true);
    try {
      await uebertragen();
    } finally {
      setLaeuft(false);
    }
  }

  const wartend = eintraege.filter((e) => e.status === "wartet");
  const abgelehnt = eintraege.filter((e) => e.status === "abgelehnt");
  if (eintraege.length === 0) return null;

  return (
    <div className="zv-warteschlange" data-testid="warteschlange">
      {wartend.length > 0 && (
        <div className="zv-hinweis zv-hinweis-info zv-warteschlange-kopf" role="status">
          <IOffline />
          <div className="zv-warteschlange-text">
            <strong>
              {wartend.length === 1 ? "1 Buchung" : `${wartend.length} Buchungen`} noch nicht übertragen.
            </strong>{" "}
            {online
              ? "Wird automatisch erneut versucht."
              : "Keine Verbindung – sie liegen sicher auf diesem Gerät und werden übertragen, sobald wieder Netz da ist."}
            <ul className="zv-warteschlange-liste">
              {wartend.map((e) => (
                <li key={e.schluessel}>{beschreibung(e)}</li>
              ))}
            </ul>
          </div>
          <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => void jetzt()} disabled={laeuft}>
            <IUebertragen />
            {laeuft ? "Überträgt…" : "Jetzt übertragen"}
          </button>
        </div>
      )}
      {abgelehnt.map((e) => (
        <AbgelehnterEintrag key={e.schluessel} eintrag={e} />
      ))}
    </div>
  );
}

function beschreibung(e: WarteschlangenEintrag): string {
  const art = e.payload.betragCent < 0 ? "Auszahlung" : "Einzahlung";
  const zweck = e.payload.verwendungszweck?.trim();
  return `${art} ${formatBetrag(Math.abs(e.payload.betragCent))} vom ${formatDatum(e.payload.datum)}${zweck ? ` – ${zweck}` : ""}`;
}

/**
 * Verwerfen nur mit zweitem Tippen: das Geld ist ausgegeben, und ohne den
 * Eintrag gibt es nirgends mehr einen Hinweis darauf. Die Meldung des Servers
 * steht daneben, damit klar ist, was im Kassenbuch nachzutragen ist.
 */
function AbgelehnterEintrag({ eintrag }: { eintrag: WarteschlangenEintrag }) {
  const [sicher, setSicher] = useState(false);
  return (
    <div className="zv-hinweis zv-hinweis-fehler zv-warteschlange-kopf" role="alert">
      <IFehler />
      <div className="zv-warteschlange-text">
        <strong>{beschreibung(eintrag)} wurde nicht gebucht:</strong> {eintrag.fehler ?? "vom Server abgelehnt."} Bitte im Kassenbuch
        klären und den Eintrag danach verwerfen.
      </div>
      <button
        type="button"
        className="zv-btn zv-btn-sekundaer zv-btn-klein"
        onClick={() => (sicher ? entfernen(eintrag.schluessel) : setSicher(true))}
      >
        {sicher ? "Wirklich verwerfen" : "Verwerfen"}
      </button>
    </div>
  );
}
