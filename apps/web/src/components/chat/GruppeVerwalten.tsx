import { FormEvent, useEffect, useState } from "react";
import type { ChatDto, ChatKontaktDto } from "@zimmerakte/shared";
import { api, istKlientToken, tokenBenutzerId } from "../../api/client";
import { Modal } from "../Modal";
import { IAbbrechen, IAbmelden, IFehler, ISpeichern } from "../icons";
import { KontaktAuswahl, kontaktEingabe } from "./KontaktAuswahl";

export function GruppeVerwalten({
  chat,
  onClose,
  onGeaendert,
  onVerlassen,
}: {
  chat: ChatDto;
  onClose: () => void;
  onGeaendert: (chat: ChatDto) => void;
  onVerlassen: () => void;
}) {
  const [name, setName] = useState(chat.name ?? chat.anzeigename);
  const [kontakte, setKontakte] = useState<ChatKontaktDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [verlassenFrage, setVerlassenFrage] = useState(false);
  const ichId = tokenBenutzerId();
  // Bei Klient-Sitzungen ist `sub` die Klient-ID.
  const istKlient = istKlientToken();
  const ich = chat.teilnehmer.find((t) => t.art === (istKlient ? "klient" : "benutzer") && t.id === ichId);

  useEffect(() => {
    if (!chat.binAdmin) return;
    api.chatKontakte().then(setKontakte).catch(() => {});
  }, [chat.binAdmin]);

  async function aktion<T>(fn: () => Promise<T>, fallback: string): Promise<T | null> {
    setLaeuft(true);
    setFehler(null);
    try {
      return await fn();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : fallback);
      return null;
    } finally {
      setLaeuft(false);
    }
  }

  async function umbenennen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const neu = await aktion(() => api.chatUmbenennen(chat.id, name.trim()), "Umbenennen fehlgeschlagen.");
    if (neu) onGeaendert(neu);
  }

  async function hinzufuegen(k: ChatKontaktDto) {
    const neu = await aktion(() => api.chatTeilnehmerHinzufuegen(chat.id, kontaktEingabe(k)), "Person konnte nicht hinzugefügt werden.");
    if (neu) onGeaendert(neu);
  }

  async function entfernen(teilnehmerId: string) {
    const ok = await aktion(() => api.chatTeilnahmeBeenden(chat.id, teilnehmerId), "Person konnte nicht entfernt werden.");
    if (ok) onGeaendert(await api.chatEinzeln(chat.id));
  }

  async function verlassen() {
    if (!ich) return;
    const ok = await aktion(() => api.chatTeilnahmeBeenden(chat.id, ich.teilnehmerId), "Gruppe konnte nicht verlassen werden.");
    if (ok) onVerlassen();
  }

  const imChat = new Set(chat.teilnehmer.map((t) => `${t.art}:${t.id}`));
  const hinzufuegbar = kontakte.filter((k) => !imChat.has(`${k.art}:${k.id}`));

  return (
    <Modal titel="Gruppe verwalten" onClose={onClose}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {chat.binAdmin ? (
        <form onSubmit={umbenennen} className="zv-inline-zeile">
          <div className="zv-field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="gruppe-umbenennen">Gruppenname</label>
            <input id="gruppe-umbenennen" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </div>
          <button className="zv-btn" type="submit" disabled={laeuft || !name.trim() || name.trim() === chat.name}>
            <ISpeichern />
            Umbenennen
          </button>
        </form>
      ) : (
        <p className="zv-sub" style={{ marginTop: 0 }}>
          {istKlient ? "Hier siehst du, wer in der Gruppe ist." : "Nur Gruppen-Admins können Namen und Teilnehmende ändern."}
        </p>
      )}

      <h3 className="zv-etagen-kopf">Teilnehmende ({chat.teilnehmer.length})</h3>
      <ul className="zv-kontaktliste">
        {chat.teilnehmer.map((t) => (
          <li key={t.teilnehmerId} className="zv-kontakt-zeile">
            <span className="zv-kontakt-name">
              {t.name}
              {t.teilnehmerId === ich?.teilnehmerId ? " (ich)" : ""}
            </span>
            {t.istAdmin && <span className="zv-pill">Admin</span>}
            {chat.binAdmin && t.teilnehmerId !== ich?.teilnehmerId && (
              <button type="button" className="zv-icon-btn" onClick={() => void entfernen(t.teilnehmerId)} disabled={laeuft} aria-label={`${t.name} entfernen`}>
                <IAbbrechen />
              </button>
            )}
          </li>
        ))}
      </ul>

      {chat.binAdmin && (
        <>
          <h3 className="zv-etagen-kopf">Person hinzufügen</h3>
          <KontaktAuswahl idPraefix="gruppe-hinzu" kontakte={hinzufuegbar} einzeln onToggle={(k) => !laeuft && void hinzufuegen(k)} />
        </>
      )}

      <div style={{ marginTop: "var(--zv-space-4)" }}>
        {verlassenFrage ? (
          <div className="zv-aktionszeile">
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => void verlassen()} disabled={laeuft}>
              <IAbmelden />
              Ja, Gruppe verlassen
            </button>
            <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setVerlassenFrage(false)}>
              Abbrechen
            </button>
          </div>
        ) : (
          <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => setVerlassenFrage(true)} disabled={!ich}>
            <IAbmelden />
            Gruppe verlassen
          </button>
        )}
      </div>
    </Modal>
  );
}
