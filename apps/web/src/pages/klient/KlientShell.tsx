import { useCallback, useEffect, useState } from "react";
import type { ChatKontaktDto } from "@zimmerakte/shared";
import { api, clearToken, type KlientIchDto } from "../../api/client";
import { useChatEreignisse } from "../../components/chat/ereignisse";
import { IAbmelden, IKalender, INachrichten } from "../../components/icons";
import { MarkenIcon } from "../../components/MarkenZeichen";
import { ThemeToggle } from "../../components/ThemeToggle";
import { Kalender } from "../Kalender";
import { Nachrichten } from "../Nachrichten";

type Bereich = "nachrichten" | "termine";

/**
 * Klient:innen sehen genau zwei Bereiche -- Nachrichten und Termine --,
 * nichts aus der Akte. Bewusst keine Wiederverwendung der Shell der
 * Mitarbeitenden: die laedt Mandant, Standorte und Rechte per Endpunkten,
 * die Klient-Tokens mit 401 abweisen (und damit die Sitzung beenden).
 */
export function KlientShell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [bereich, setBereich] = useState<Bereich>("nachrichten");
  const [ich, setIch] = useState<KlientIchDto | null>(null);
  const { badge } = useChatEreignisse();

  useEffect(() => {
    api
      .klientIch()
      .then(setIch)
      .catch(() => {});
  }, []);

  // /chat/kontakte ist fuer Klient:innen absichtlich leer. Terminteilnehmende duerfen nur Personen
  // sein, mit denen man einen gemeinsamen Chat hat -- genau die stehen in den eigenen Chats.
  const kontakteLaden = useCallback(async (): Promise<ChatKontaktDto[]> => {
    const chats = await api.chatListe();
    const karte = new Map<string, ChatKontaktDto>();
    for (const c of chats) {
      for (const t of c.teilnehmer) {
        if (t.art === "benutzer" && !karte.has(t.id)) karte.set(t.id, { art: "benutzer", id: t.id, name: t.name, direktChatId: null });
      }
    }
    return [...karte.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, []);

  function abmelden() {
    clearToken();
    onLoggedOut();
  }

  const reiter: { wert: Bereich; label: string; icon: typeof INachrichten }[] = [
    { wert: "nachrichten", label: "Nachrichten", icon: INachrichten },
    { wert: "termine", label: "Termine", icon: IKalender },
  ];

  return (
    <div className="zv-klient">
      <header className="zv-klient-kopf">
        <div className="zv-klient-marke">
          <MarkenIcon groesse={24} />
          <div className="zv-klient-marke-text">
            <strong>hecaso</strong>
            {ich && <span>{ich.mandant.name}</span>}
          </div>
        </div>
        <div className="zv-klient-aktionen">
          {ich && <span className="zv-klient-gruss">Hallo, {ich.anzeigename}</span>}
          <ThemeToggle />
          <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={abmelden}>
            <IAbmelden />
            Abmelden
          </button>
        </div>
      </header>

      <main className="zv-klient-inhalt" data-bereich={bereich}>
        {bereich === "nachrichten" ? <Nachrichten klient /> : <Kalender titel="Meine Termine" kontakteLaden={kontakteLaden} />}
      </main>

      <nav className="zv-klient-nav" aria-label="Bereiche">
        {reiter.map(({ wert, label, icon: Icon }) => (
          <button key={wert} type="button" className={bereich === wert ? "active" : ""} onClick={() => setBereich(wert)} aria-current={bereich === wert ? "page" : undefined}>
            <Icon />
            {label}
            {wert === "nachrichten" && badge > 0 && (
              <span className="zv-nav-badge" aria-label={`${badge} ungelesen`}>
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
