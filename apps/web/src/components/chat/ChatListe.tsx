import type { ReactNode } from "react";
import type { ChatDto } from "@zimmerakte/shared";
import { formatChatZeit } from "../../format";
import { Leerzustand } from "../Leerzustand";
import { IGruppe, ILeerNachrichten, INeuerChat } from "../icons";

function vorschauText(c: ChatDto): string {
  const v = c.letzteNachricht;
  if (!v) return "Noch keine Nachrichten";
  const praefix = v.eigene ? "Du: " : c.art === "gruppe" && v.absender ? `${v.absender.name}: ` : "";
  return `${praefix}${v.vorschau}`;
}

export function ChatListe({
  chats,
  aktivId,
  geladen,
  fehler,
  onWaehlen,
  onNeuerChat,
  kopfAktion,
  oben,
  leerText,
}: {
  chats: ChatDto[];
  aktivId: string | null;
  geladen: boolean;
  fehler: string | null;
  onWaehlen: (id: string) => void;
  onNeuerChat?: () => void;
  /** Ersetzt den Knopf "Neuer Chat" (Klient:innen duerfen keine Chats anlegen, sondern nur anfragen). */
  kopfAktion?: ReactNode;
  /** Bereich ueber der Chatliste, z. B. offene Anfragen. */
  oben?: ReactNode;
  leerText?: string;
}) {
  return (
    <aside className="zv-chat-liste" aria-label="Chats">
      <div className="zv-chat-liste-kopf">
        <h2>Nachrichten</h2>
        {kopfAktion ??
          (onNeuerChat && (
            <button type="button" className="zv-btn zv-btn-klein" onClick={onNeuerChat}>
              <INeuerChat />
              Neuer Chat
            </button>
          ))}
      </div>
      <div className="zv-chat-liste-inhalt">
        {oben}
        {fehler && <div className="zv-hinweis zv-hinweis-fehler">{fehler}</div>}
        {geladen && chats.length === 0 && !fehler && (
          <Leerzustand icon={ILeerNachrichten}>{leerText ?? "Noch keine Chats. Starten Sie einen Chat mit „Neuer Chat“."}</Leerzustand>
        )}
        <ul>
          {chats.map((c) => (
            <li key={c.id}>
              <button type="button" className={`zv-chat-eintrag${c.id === aktivId ? " aktiv" : ""}`} onClick={() => onWaehlen(c.id)} aria-current={c.id === aktivId ? "true" : undefined}>
                <span className="zv-chat-eintrag-kopf">
                  <strong className="zv-chat-eintrag-name">
                    {c.art === "gruppe" && <IGruppe size={14} />}
                    <span>{c.anzeigename}</span>
                  </strong>
                  <span className="zv-chat-eintrag-zeit">{formatChatZeit(c.letzteAktivitaetAm)}</span>
                </span>
                <span className="zv-chat-eintrag-fuss">
                  <span className={`zv-chat-vorschau${c.ungelesen > 0 ? " ungelesen" : ""}`}>{vorschauText(c)}</span>
                  {c.ungelesen > 0 && (
                    <span className="zv-nav-badge zv-nav-badge-inline" aria-label={`${c.ungelesen} ungelesen`}>
                      {c.ungelesen > 99 ? "99+" : c.ungelesen}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
