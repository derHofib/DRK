import { useState } from "react";
import type { ChatAnfrageDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { formatChatZeit } from "../../format";
import { IFehler, IZurueckziehen } from "../icons";

const ZUSTAND: Record<ChatAnfrageDto["zustand"], { text: string; pill: string }> = {
  offen: { text: "Wartet auf Antwort", pill: "zv-pill-offen" },
  angenommen: { text: "Angenommen", pill: "zv-pill-ok" },
  abgelehnt: { text: "Abgelehnt", pill: "zv-pill-danger" },
  zurueckgezogen: { text: "Zurückgezogen", pill: "zv-pill-vergeben" },
};

/** So viele beantwortete Anfragen bleiben sichtbar; die Liste der Offenen wird nie gekuerzt. */
const BEANTWORTET_SICHTBAR = 3;

/**
 * "Meine Anfragen" in der Klient-Ansicht: offene (zurueckziehbar), abgelehnte
 * mit Begruendung, angenommene mit Weg zum Gespraech.
 */
export function KlientAnfragen({
  anfragen,
  onAktualisieren,
  onChatOeffnen,
}: {
  anfragen: ChatAnfrageDto[];
  onAktualisieren: () => void;
  onChatOeffnen: (chatId: string) => void;
}) {
  const [alleBeantwortet, setAlleBeantwortet] = useState(false);
  const offen = anfragen.filter((a) => a.zustand === "offen");
  const beantwortet = anfragen.filter((a) => a.zustand !== "offen");
  const sichtbar = alleBeantwortet ? beantwortet : beantwortet.slice(0, BEANTWORTET_SICHTBAR);
  if (anfragen.length === 0) return null;

  return (
    <section className="zv-anfragen" aria-label="Meine Anfragen">
      <h3 className="zv-anfragen-kopf">Meine Anfragen</h3>
      <ul className="zv-anfragen-liste">
        {[...offen, ...sichtbar].map((a) => (
          <MeineAnfrage key={a.id} anfrage={a} onAktualisieren={onAktualisieren} onChatOeffnen={onChatOeffnen} />
        ))}
      </ul>
      {beantwortet.length > BEANTWORTET_SICHTBAR && (
        <button type="button" className="zv-btn zv-btn-still zv-btn-klein" style={{ margin: "0 var(--zv-space-3) var(--zv-space-3)" }} onClick={() => setAlleBeantwortet((v) => !v)}>
          {alleBeantwortet ? "Ältere ausblenden" : `Ältere anzeigen (${beantwortet.length - BEANTWORTET_SICHTBAR})`}
        </button>
      )}
    </section>
  );
}

function MeineAnfrage({ anfrage, onAktualisieren, onChatOeffnen }: { anfrage: ChatAnfrageDto; onAktualisieren: () => void; onChatOeffnen: (chatId: string) => void }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const z = ZUSTAND[anfrage.zustand];

  async function zurueckziehen() {
    setLaeuft(true);
    setFehler(null);
    try {
      await api.chatAnfrageZurueckziehen(anfrage.id);
      onAktualisieren();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Die Anfrage konnte nicht zurückgezogen werden.");
      // Wurde sie inzwischen beantwortet, zeigt die neu geladene Liste den echten Stand.
      onAktualisieren();
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <li className="zv-anfrage">
      <div className="zv-anfrage-kopf">
        <strong>{anfrage.ziel.name}</strong>
        <span className={`zv-pill ${z.pill}`}>{z.text}</span>
      </div>
      <span className="zv-chat-eintrag-zeit">{formatChatZeit(anfrage.erstelltAm)}</span>
      {anfrage.nachricht && <p className="zv-anfrage-text">{anfrage.nachricht}</p>}
      {anfrage.zustand === "abgelehnt" && (
        <p className="zv-anfrage-text">
          {anfrage.ablehnungsgrund ? `Begründung: ${anfrage.ablehnungsgrund}` : "Es wurde keine Begründung angegeben."}
        </p>
      )}
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {anfrage.zustand === "offen" && (
        <div className="zv-aktionszeile">
          <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => void zurueckziehen()} disabled={laeuft}>
            <IZurueckziehen />
            Zurückziehen
          </button>
        </div>
      )}
      {anfrage.zustand === "angenommen" && anfrage.chatId && (
        <div className="zv-aktionszeile">
          <button type="button" className="zv-btn zv-btn-klein" onClick={() => onChatOeffnen(anfrage.chatId!)}>
            Zum Gespräch
          </button>
        </div>
      )}
    </li>
  );
}
