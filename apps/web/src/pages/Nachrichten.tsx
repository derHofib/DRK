import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAnfrageDto, ChatDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { AnfrageDialog } from "../components/chat/AnfrageDialog";
import { AnfragenBereich } from "../components/chat/AnfragenBereich";
import { ChatListe } from "../components/chat/ChatListe";
import { ChatVerlauf } from "../components/chat/ChatVerlauf";
import { useChatEreignisse } from "../components/chat/ereignisse";
import { GruppeVerwalten } from "../components/chat/GruppeVerwalten";
import { KlientAnfragen } from "../components/chat/KlientAnfragen";
import { NeuerChat } from "../components/chat/NeuerChat";
import { Leerzustand } from "../components/Leerzustand";
import { ILeerNachrichten, INeuerChat } from "../components/icons";

function nachAktivitaet(liste: ChatDto[]): ChatDto[] {
  return [...liste].sort((a, b) => b.letzteAktivitaetAm.localeCompare(a.letzteAktivitaetAm));
}

/**
 * `klient`: Ansicht fuer Klient:innen. Dieselben Chat-Bausteine, aber ohne
 * "Neuer Chat" (sie fragen Gespraeche an, siehe AnfrageDialog) und mit
 * ihren eigenen Anfragen statt der Annahme-Liste der Mitarbeitenden.
 */
export function Nachrichten({ klient = false }: { klient?: boolean }) {
  const { abonnieren } = useChatEreignisse();
  const [chats, setChats] = useState<ChatDto[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [neuerChatOffen, setNeuerChatOffen] = useState(false);
  const [gruppeOffen, setGruppeOffen] = useState(false);
  const [anfragen, setAnfragen] = useState<ChatAnfrageDto[]>([]);
  const [anfrageDialogOffen, setAnfrageDialogOffen] = useState(false);
  const timer = useRef<number | null>(null);
  const anfrageTimer = useRef<number | null>(null);

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

  const anfragenLaden = useCallback(() => {
    api
      .chatAnfragen()
      .then(setAnfragen)
      .catch(() => {});
  }, []);

  const anfragenAktualisieren = useCallback(() => {
    if (anfrageTimer.current !== null) return;
    anfrageTimer.current = window.setTimeout(() => {
      anfrageTimer.current = null;
      anfragenLaden();
    }, 200);
  }, [anfragenLaden]);

  useEffect(() => {
    laden();
    anfragenLaden();
    const abmelden = abonnieren((e) => {
      listeAktualisieren();
      if (e.art === "anfrage" || e.art === "resync") anfragenAktualisieren();
    });
    return () => {
      abmelden();
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (anfrageTimer.current !== null) window.clearTimeout(anfrageTimer.current);
    };
  }, [laden, anfragenLaden, abonnieren, listeAktualisieren, anfragenAktualisieren]);

  const aktiv = chats.find((c) => c.id === aktivId) ?? null;

  function chatUebernehmen(chat: ChatDto) {
    setChats((alt) => nachAktivitaet([chat, ...alt.filter((c) => c.id !== chat.id)]));
    setAktivId(chat.id);
    setNeuerChatOffen(false);
  }

  // Aus einer Anfrage heraus: der Chat ist ggf. noch nicht in der Liste (sie laedt erst per Ereignis nach).
  async function chatOeffnen(chatId: string) {
    try {
      chatUebernehmen(await api.chatEinzeln(chatId));
      setAnfrageDialogOffen(false);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das Gespräch konnte nicht geöffnet werden.");
    }
  }

  const anfragenBereich = klient ? (
    <KlientAnfragen anfragen={anfragen} onAktualisieren={anfragenLaden} onChatOeffnen={(id) => void chatOeffnen(id)} />
  ) : (
    <AnfragenBereich anfragen={anfragen} onAktualisieren={anfragenLaden} onChatOeffnen={(id) => void chatOeffnen(id)} />
  );

  return (
    <div className="zv-chat" data-ansicht={aktiv ? "verlauf" : "liste"}>
      <ChatListe
        chats={chats}
        aktivId={aktivId}
        geladen={geladen}
        fehler={fehler}
        onWaehlen={setAktivId}
        onNeuerChat={klient ? undefined : () => setNeuerChatOffen(true)}
        kopfAktion={
          klient ? (
            <button type="button" className="zv-btn zv-btn-klein" onClick={() => setAnfrageDialogOffen(true)}>
              <INeuerChat />
              Gespräch anfragen
            </button>
          ) : undefined
        }
        oben={anfragenBereich}
        leerText={klient ? "Du hast noch kein Gespräch. Frage mit „Gespräch anfragen“ eines an." : undefined}
      />
      {aktiv ? (
        <ChatVerlauf
          key={aktiv.id}
          chat={aktiv}
          onZurueck={() => setAktivId(null)}
          onGruppeVerwalten={() => setGruppeOffen(true)}
          onListeAktualisieren={listeAktualisieren}
          klient={klient}
        />
      ) : (
        <div className="zv-chat-leer">
          <Leerzustand icon={ILeerNachrichten}>
            {klient ? "Wähle links ein Gespräch aus." : "Wählen Sie links einen Chat aus oder starten Sie einen neuen."}
          </Leerzustand>
        </div>
      )}
      {anfrageDialogOffen && (
        <AnfrageDialog
          onClose={() => setAnfrageDialogOffen(false)}
          onGestellt={() => {
            setAnfrageDialogOffen(false);
            anfragenLaden();
          }}
          onChatOeffnen={(id) => void chatOeffnen(id)}
        />
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
