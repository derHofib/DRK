import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { abonniereChatEreignisse, api, type ChatEreignis } from "../../api/client";

type Hoerer = (e: ChatEreignis) => void;

interface ChatEreignisKontext {
  /** Ungelesene Nachrichten plus (falls vom Server geliefert) offene Anfragen -- fuer das Menue-Badge. */
  badge: number;
  /** Zaehler neu vom Server holen, z. B. nachdem ein Chat als gelesen markiert wurde. */
  badgeNeuLaden: () => void;
  /** Rueckgabe: Abmelden-Funktion. */
  abonnieren: (hoerer: Hoerer) => () => void;
}

const Kontext = createContext<ChatEreignisKontext>({ badge: 0, badgeNeuLaden: () => {}, abonnieren: () => () => {} });

export function useChatEreignisse(): ChatEreignisKontext {
  return useContext(Kontext);
}

/**
 * EINE Stream-Verbindung fuer die ganze angemeldete Sitzung: Menue-Badge und
 * geoeffnete Chatansicht haengen sich hier an, statt je eine eigene
 * Verbindung zu oeffnen (der Server haelt pro Verbindung eine Registrierung).
 */
export function ChatEreignisProvider({ children }: { children: ReactNode }) {
  const [badge, setBadge] = useState(0);
  const hoerer = useRef(new Set<Hoerer>());
  const timer = useRef<number | null>(null);

  const badgeNeuLaden = useCallback(() => {
    // Gebuendelt: ein Schwung Ereignisse (z. B. Resync) soll genau eine Abfrage ausloesen.
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      api
        .chatUngelesen()
        .then((z) => setBadge(z.ungelesen + (z.offeneAnfragen ?? 0)))
        .catch(() => {});
    }, 150);
  }, []);

  useEffect(() => {
    badgeNeuLaden();
    const beenden = abonniereChatEreignisse((e) => {
      badgeNeuLaden();
      hoerer.current.forEach((h) => h(e));
    });
    return () => {
      beenden();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [badgeNeuLaden]);

  const abonnieren = useCallback((h: Hoerer) => {
    hoerer.current.add(h);
    return () => void hoerer.current.delete(h);
  }, []);

  const wert = useMemo(() => ({ badge, badgeNeuLaden, abonnieren }), [badge, badgeNeuLaden, abonnieren]);
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}
