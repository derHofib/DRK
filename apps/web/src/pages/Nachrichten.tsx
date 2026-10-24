import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { ChatListe } from "../components/chat/ChatListe";
import { ChatVerlauf } from "../components/chat/ChatVerlauf";
import { useChatEreignisse } from "../components/chat/ereignisse";
import { GruppeVerwalten } from "../components/chat/GruppeVerwalten";
import { NeuerChat } from "../components/chat/NeuerChat";
import { Leerzustand } from "../components/Leerzustand";
import { ILeerNachrichten } from "../components/icons";

function nachAktivitaet(liste: ChatDto[]): ChatDto[] {
  return [...liste].sort((a, b) => b.letzteAktivitaetAm.localeCompare(a.letzteAktivitaetAm));
}

export function Nachrichten() {
  const { abonnieren } = useChatEreignisse();
  const [chats, setChats] = useState<ChatDto[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [neuerChatOffen, setNeuerChatOffen] = useState(false);
  const [gruppeOffen, setGruppeOffen] = useState(false);
  const timer = useRef<number | null>(null);

  const laden = useCallback(() => {
    api
      .chatListe()
      .then((liste) => {
        setChats(nachAktivitaet(liste));
        setFehler(null);
        // Aus dem Chat entfernt oder ihn verlassen: Verlauf nicht mit einer Geisteransicht stehen lassen.
        setAktivId((id) => (id && !liste.some((c) => c.id === id) ? null : id));
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Chats konnten nicht geladen werden."))
      .finally(() => setGeladen(true));
  }, []);

  // Gebuendelt: ein Schwung Ereignisse laedt die Liste einmal neu.
  const listeAktualisieren = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      laden();
    }, 200);
  }, [laden]);

  useEffect(() => {
    laden();
    const abmelden = abonnieren(() => listeAktualisieren());
    return () => {
      abmelden();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [laden, abonnieren, listeAktualisieren]);

  const aktiv = chats.find((c) => c.id === aktivId) ?? null;

  function chatUebernehmen(chat: ChatDto) {
    setChats((alt) => nachAktivitaet([chat, ...alt.filter((c) => c.id !== chat.id)]));
    setAktivId(chat.id);
    setNeuerChatOffen(false);
  }

  return (
    <div className="zv-chat" data-ansicht={aktiv ? "verlauf" : "liste"}>
      <ChatListe chats={chats} aktivId={aktivId} geladen={geladen} fehler={fehler} onWaehlen={setAktivId} onNeuerChat={() => setNeuerChatOffen(true)} />
      {aktiv ? (
        <ChatVerlauf
          key={aktiv.id}
          chat={aktiv}
          onZurueck={() => setAktivId(null)}
          onGruppeVerwalten={() => setGruppeOffen(true)}
          onListeAktualisieren={listeAktualisieren}
        />
      ) : (
        <div className="zv-chat-leer">
          <Leerzustand icon={ILeerNachrichten}>Wählen Sie links einen Chat aus oder starten Sie einen neuen.</Leerzustand>
        </div>
      )}
      {neuerChatOffen && <NeuerChat onClose={() => setNeuerChatOffen(false)} onChat={chatUebernehmen} />}
      {gruppeOffen && aktiv && (
        <GruppeVerwalten
          chat={aktiv}
          onClose={() => setGruppeOffen(false)}
          onGeaendert={(c) => setChats((alt) => nachAktivitaet(alt.map((x) => (x.id === c.id ? c : x))))}
          onVerlassen={() => {
            setGruppeOffen(false);
            setAktivId(null);
            laden();
          }}
        />
      )}
    </div>
  );
}
