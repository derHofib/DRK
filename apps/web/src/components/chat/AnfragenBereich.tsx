import { FormEvent, useState } from "react";
import type { ChatAnfrageDto } from "@zimmerakte/shared";
import { ApiFehler, api } from "../../api/client";
import { formatChatZeit } from "../../format";
import { IAblehnen, IFehler, IGenehmigen, IInfo } from "../icons";

const ANFRAGE_VORBEI = "Diese Anfrage wurde bereits von jemand anderem beantwortet oder zurückgezogen.";

/**
 * Offene Chat-Anfragen von Klient:innen (Mitarbeitenden-Seite). Wer zuerst
 * annimmt, bekommt die Anfrage -- das entscheidet der Server atomar; hier
 * wird nur ein verlorenes Rennen (409/404) verstaendlich gemeldet und die
 * Liste neu geladen.
 */
export function AnfragenBereich({
  anfragen,
  onAktualisieren,
  onChatOeffnen,
}: {
  anfragen: ChatAnfrageDto[];
  onAktualisieren: () => void;
  onChatOeffnen: (chatId: string) => void;
}) {
  const [meldung, setMeldung] = useState<string | null>(null);

  if (anfragen.length === 0 && !meldung) return null;
  return (
    <section className="zv-anfragen" aria-label="Anfragen von Klient:innen">
      <h3 className="zv-anfragen-kopf">
        Anfragen
        {anfragen.length > 0 && (
          <span className="zv-nav-badge zv-nav-badge-inline" aria-label={`${anfragen.length} offen`}>
            {anfragen.length}
          </span>
        )}
      </h3>
      {meldung && (
        <div className="zv-hinweis zv-hinweis-info" role="status">
          <IInfo />
          {meldung}
        </div>
      )}
      <ul className="zv-anfragen-liste">
        {anfragen.map((a) => (
          <AnfrageZeile
            key={a.id}
            anfrage={a}
            onVorbei={() => {
              setMeldung(ANFRAGE_VORBEI);
              onAktualisieren();
            }}
            onErledigt={() => {
              setMeldung(null);
              onAktualisieren();
            }}
            onChatOeffnen={onChatOeffnen}
          />
        ))}
      </ul>
    </section>
  );
}

function AnfrageZeile({
  anfrage,
  onVorbei,
  onErledigt,
  onChatOeffnen,
}: {
  anfrage: ChatAnfrageDto;
  onVorbei: () => void;
  onErledigt: () => void;
  onChatOeffnen: (chatId: string) => void;
}) {
  const [ablehnenOffen, setAblehnenOffen] = useState(false);
  const [begruendung, setBegruendung] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  function fehlerBehandeln(err: unknown, fallback: string) {
    if (err instanceof ApiFehler && (err.status === 409 || err.status === 404)) return onVorbei();
    setFehler(err instanceof Error ? err.message : fallback);
  }

  async function annehmen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const { chatId } = await api.chatAnfrageAnnehmen(anfrage.id);
      onErledigt();
      onChatOeffnen(chatId);
    } catch (err) {
      fehlerBehandeln(err, "Die Anfrage konnte nicht angenommen werden.");
    } finally {
      setLaeuft(false);
    }
  }

  async function ablehnen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      await api.chatAnfrageAblehnen(anfrage.id, begruendung.trim() || undefined);
      onErledigt();
    } catch (err) {
      fehlerBehandeln(err, "Die Anfrage konnte nicht abgelehnt werden.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <li className="zv-anfrage">
      <div className="zv-anfrage-kopf">
        <strong>{anfrage.klient.name}</strong>
        <span className="zv-chat-eintrag-zeit">{formatChatZeit(anfrage.erstelltAm)}</span>
      </div>
      <span className="zv-anfrage-ziel">{anfrage.ziel.art === "team" ? `An: ${anfrage.ziel.name}` : "Persönlich an Sie"}</span>
      {anfrage.nachricht && <p className="zv-anfrage-text">{anfrage.nachricht}</p>}
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {ablehnenOffen ? (
        <form onSubmit={ablehnen}>
          <div className="zv-field">
            <label htmlFor={`ablehnen-${anfrage.id}`}>Begründung (optional, sieht die Klient:in)</label>
            <textarea id={`ablehnen-${anfrage.id}`} rows={2} maxLength={500} value={begruendung} onChange={(e) => setBegruendung(e.target.value)} />
          </div>
          <div className="zv-aktionszeile">
            <button type="submit" className="zv-btn zv-btn-gefahr zv-btn-klein" disabled={laeuft}>
              <IAblehnen />
              Ablehnen
            </button>
            <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => setAblehnenOffen(false)} disabled={laeuft}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <div className="zv-aktionszeile">
          <button type="button" className="zv-btn zv-btn-klein" onClick={() => void annehmen()} disabled={laeuft}>
            <IGenehmigen />
            Annehmen
          </button>
          <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => setAblehnenOffen(true)} disabled={laeuft}>
            <IAblehnen />
            Ablehnen
          </button>
        </div>
      )}
    </li>
  );
}
