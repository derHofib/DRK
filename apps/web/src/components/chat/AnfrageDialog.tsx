import { FormEvent, useEffect, useState } from "react";
import type { ChatAnfrageDto, ChatAnfrageZielDto } from "@zimmerakte/shared";
import { ApiFehler, api } from "../../api/client";
import { Leerzustand } from "../Leerzustand";
import { MitarbeiterProfilKlient } from "../MitarbeiterProfilKlient";
import { Modal } from "../Modal";
import { IFehler, ILeerKontakte, INeuerChat } from "../icons";

const zielSchluessel = (z: ChatAnfrageZielDto) => (z.art === "team" ? `team:${z.standortId}` : `benutzer:${z.benutzerId}`);

/**
 * "Gespraech anfragen": Klient:innen legen keine Chats an, sie fragen bei
 * einer Person oder dem Team ihres Standorts an. Gibt es mit einer Person
 * schon ein Gespraech, wird stattdessen dorthin verwiesen -- eine zweite
 * Anfrage waere sinnlos.
 */
export function AnfrageDialog({
  onClose,
  onGestellt,
  onChatOeffnen,
}: {
  onClose: () => void;
  onGestellt: (a: ChatAnfrageDto) => void;
  onChatOeffnen: (chatId: string) => void;
}) {
  const [ziele, setZiele] = useState<ChatAnfrageZielDto[] | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    api
      .chatAnfrageZiele()
      .then(setZiele)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Die Auswahl konnte nicht geladen werden."));
  }, []);

  const gewaehlt = ziele?.find((z) => zielSchluessel(z) === auswahl) ?? null;
  const bezugsbetreuung = ziele?.filter((z) => z.art === "benutzer" && z.istBezugsbetreuer) ?? [];
  const team = ziele?.filter((z) => z.art === "team") ?? [];
  const personen = ziele?.filter((z) => z.art === "benutzer" && !z.istBezugsbetreuer) ?? [];

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!gewaehlt || (gewaehlt.art === "benutzer" && gewaehlt.direktChatId)) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const nachricht = text.trim() || null;
      const anfrage = await api.chatAnfrageStellen(
        gewaehlt.art === "team" ? { standortId: gewaehlt.standortId, nachricht } : { benutzerId: gewaehlt.benutzerId, nachricht }
      );
      onGestellt(anfrage);
    } catch (err) {
      // 409: schon eine offene Anfrage an dieses Ziel oder das Hoechstmass erreicht -- der Servertext erklaert es auf Deutsch.
      setFehler(err instanceof ApiFehler && err.status === 409 ? err.message : err instanceof Error ? err.message : "Die Anfrage konnte nicht gesendet werden.");
      setLaeuft(false);
    }
  }

  function zeile(z: ChatAnfrageZielDto) {
    const aktiv = zielSchluessel(z) === auswahl;
    return (
      <li key={zielSchluessel(z)}>
        <button type="button" className={`zv-kontakt-zeile zv-ziel${aktiv ? " aktiv" : ""}`} onClick={() => setAuswahl(zielSchluessel(z))} aria-pressed={aktiv}>
          <span className="zv-kontakt-name">{z.name}</span>
          {z.art === "team" && <span className="zv-pill zv-pill-vergeben">Ganzes Team</span>}
        </button>
      </li>
    );
  }

  return (
    <Modal titel="Gespräch anfragen" onClose={onClose}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {ziele === null ? (
        !fehler && <p className="zv-sub">Wird geladen…</p>
      ) : ziele.length === 0 ? (
        <Leerzustand icon={ILeerKontakte}>Im Moment kannst du niemanden anfragen.</Leerzustand>
      ) : (
        <form onSubmit={absenden}>
          <p style={{ marginTop: 0 }}>Mit wem möchtest du sprechen? Die Person oder das Team bekommt deine Anfrage und kann sie annehmen.</p>
          {[
            { titel: "Deine Bezugsbetreuung", liste: bezugsbetreuung },
            { titel: "Team", liste: team },
            { titel: "Weitere Personen", liste: personen },
          ]
            .filter((g) => g.liste.length > 0)
            .map((g) => (
              <div key={g.titel} style={{ marginBottom: "var(--zv-space-3)" }}>
                <h3 className="zv-etagen-kopf">{g.titel}</h3>
                <ul className="zv-kontaktliste">{g.liste.map(zeile)}</ul>
              </div>
            ))}

          {gewaehlt?.art === "benutzer" && (
            <div style={{ marginTop: "var(--zv-space-3)" }}>
              <MitarbeiterProfilKlient benutzerId={gewaehlt.benutzerId} />
            </div>
          )}

          {gewaehlt?.art === "benutzer" && gewaehlt.direktChatId ? (
            <div style={{ marginTop: "var(--zv-space-3)" }}>
              <div className="zv-hinweis zv-hinweis-info">Mit {gewaehlt.name} hast du schon ein Gespräch. Du musst nicht noch einmal anfragen.</div>
              <button type="button" className="zv-btn zv-btn-block" onClick={() => onChatOeffnen(gewaehlt.direktChatId!)}>
                <INeuerChat />
                Zum bestehenden Gespräch
              </button>
            </div>
          ) : (
            <>
              <div className="zv-field">
                <label htmlFor="anfrage-text">Nachricht (freiwillig)</label>
                <textarea id="anfrage-text" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Worum geht es?" />
              </div>
              <button className="zv-btn zv-btn-block" type="submit" disabled={laeuft || !gewaehlt}>
                <INeuerChat />
                {laeuft ? "Sendet…" : "Anfrage senden"}
              </button>
            </>
          )}
        </form>
      )}
    </Modal>
  );
}
