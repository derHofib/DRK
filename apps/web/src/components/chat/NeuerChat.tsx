import { FormEvent, useEffect, useState } from "react";
import type { ChatDto, ChatKontaktDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Modal } from "../Modal";
import { IFehler, IGruppe, INeuerChat } from "../icons";
import { KontaktAuswahl, kontaktEingabe, kontaktSchluessel } from "./KontaktAuswahl";

export function NeuerChat({ onClose, onChat }: { onClose: () => void; onChat: (chat: ChatDto) => void }) {
  const [modus, setModus] = useState<"direkt" | "gruppe">("direkt");
  const [kontakte, setKontakte] = useState<ChatKontaktDto[] | null>(null);
  const [auswahl, setAuswahl] = useState<Map<string, ChatKontaktDto>>(new Map());
  const [name, setName] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    api
      .chatKontakte()
      .then(setKontakte)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Kontakte konnten nicht geladen werden."));
  }, []);

  async function direktStarten(k: ChatKontaktDto) {
    setLaeuft(true);
    setFehler(null);
    try {
      onChat(await api.chatDirektAnlegen(kontaktEingabe(k)));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Chat konnte nicht gestartet werden.");
      setLaeuft(false);
    }
  }

  async function gruppeAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      onChat(await api.chatGruppeAnlegen(name.trim(), [...auswahl.values()].map(kontaktEingabe)));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Gruppe konnte nicht angelegt werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Neuer Chat" onClose={onClose}>
      <div className="zv-segmented" role="tablist" aria-label="Chat-Art" style={{ marginBottom: "var(--zv-space-3)" }}>
        <button type="button" role="tab" aria-selected={modus === "direkt"} className={modus === "direkt" ? "active" : ""} onClick={() => setModus("direkt")}>
          <INeuerChat size={14} /> Direktchat
        </button>
        <button type="button" role="tab" aria-selected={modus === "gruppe"} className={modus === "gruppe" ? "active" : ""} onClick={() => setModus("gruppe")}>
          <IGruppe size={14} /> Gruppe
        </button>
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {kontakte === null ? (
        !fehler && <p className="zv-sub">Kontakte werden geladen…</p>
      ) : modus === "direkt" ? (
        <KontaktAuswahl idPraefix="neuer-chat" kontakte={kontakte} einzeln onToggle={(k) => !laeuft && void direktStarten(k)} />
      ) : (
        <form onSubmit={gruppeAnlegen}>
          <div className="zv-field">
            <label htmlFor="gruppe-name">Gruppenname</label>
            <input id="gruppe-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          <KontaktAuswahl
            idPraefix="gruppe"
            kontakte={kontakte}
            ausgewaehlt={new Set(auswahl.keys())}
            onToggle={(k) =>
              setAuswahl((alt) => {
                const neu = new Map(alt);
                const s = kontaktSchluessel(k);
                if (neu.has(s)) neu.delete(s);
                else neu.set(s, k);
                return neu;
              })
            }
          />
          <button className="zv-btn zv-btn-block" type="submit" disabled={laeuft || !name.trim() || auswahl.size === 0} style={{ marginTop: "var(--zv-space-3)" }}>
            <IGruppe />
            {laeuft ? "Legt an…" : `Gruppe anlegen (${auswahl.size} ausgewählt)`}
          </button>
        </form>
      )}
    </Modal>
  );
}
