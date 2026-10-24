import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatDto, ChatNachrichtDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { formatTagTrenner, lokalesDatum } from "../../format";
import { Leerzustand } from "../Leerzustand";
import { MitarbeiterProfilKlient } from "../MitarbeiterProfilKlient";
import { Modal } from "../Modal";
import { IFehler, IGruppe, IMitarbeitende, ILeerNachrichten, INachrichtLoeschen, IZurueckPfeil } from "../icons";
import { ChatEingabe } from "./ChatEingabe";
import { useChatEreignisse } from "./ereignisse";
import { NachrichtBlase } from "./NachrichtBlase";

function zusammenfuehren(alt: ChatNachrichtDto[], neu: ChatNachrichtDto[]): ChatNachrichtDto[] {
  const karte = new Map(alt.map((n) => [n.id, n]));
  for (const n of neu) karte.set(n.id, n);
  return [...karte.values()].sort((a, b) => (a.erstelltAm === b.erstelltAm ? a.id.localeCompare(b.id) : a.erstelltAm.localeCompare(b.erstelltAm)));
}

export function ChatVerlauf({
  chat,
  onZurueck,
  onGruppeVerwalten,
  onListeAktualisieren,
  klient = false,
}: {
  chat: ChatDto;
  onZurueck: () => void;
  onGruppeVerwalten: () => void;
  onListeAktualisieren: () => void;
  /** Klient-Sicht: im Direktchat mit einer Mitarbeiter:in gibt es ihr freigegebenes Profil. */
  klient?: boolean;
}) {
  const { abonnieren, badgeNeuLaden } = useChatEreignisse();
  const [nachrichten, setNachrichten] = useState<ChatNachrichtDto[]>([]);
  const [weitere, setWeitere] = useState(false);
  const [geladen, setGeladen] = useState(false);
  const [aelterLaedt, setAelterLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [bildGross, setBildGross] = useState<{ url: string; name: string } | null>(null);
  const [loeschZiel, setLoeschZiel] = useState<ChatNachrichtDto | null>(null);
  const [loescht, setLoescht] = useState(false);
  const [profilOffen, setProfilOffen] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const amEnde = useRef(true);
  const vorherHoehe = useRef<number | null>(null);
  const gemeldet = useRef<string | null>(null);
  const erstesLaden = useRef(true);

  const meldeGelesen = useCallback(
    (liste: ChatNachrichtDto[]) => {
      const letzteFremde = [...liste].reverse().find((n) => !n.eigene && !n.geloescht && n.art !== "system");
      if (!letzteFremde || letzteFremde.id === gemeldet.current) return;
      if (document.visibilityState !== "visible") return;
      gemeldet.current = letzteFremde.id;
      api
        .chatGelesen(chat.id)
        .then(() => {
          badgeNeuLaden();
          onListeAktualisieren();
        })
        .catch(() => {
          gemeldet.current = null;
        });
    },
    [chat.id, badgeNeuLaden, onListeAktualisieren]
  );

  const neuesteLaden = useCallback(async () => {
    try {
      const seite = await api.chatNachrichten(chat.id);
      setNachrichten((alt) => {
        const neu = zusammenfuehren(alt, seite.nachrichten);
        meldeGelesen(neu);
        return neu;
      });
      if (erstesLaden.current) {
        erstesLaden.current = false;
        setWeitere(seite.weitere);
      }
      setFehler(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Nachrichten konnten nicht geladen werden.");
    } finally {
      setGeladen(true);
    }
  }, [chat.id, meldeGelesen]);

  useEffect(() => {
    void neuesteLaden();
    return abonnieren((e) => {
      if (e.art === "resync" || e.chatId === chat.id) void neuesteLaden();
    });
  }, [chat.id, abonnieren, neuesteLaden]);

  // Kam man mit dem Tab zurueck, sind evtl. Nachrichten eingetroffen, die im Hintergrund nicht als gelesen galten.
  useEffect(() => {
    function sichtbar() {
      if (document.visibilityState === "visible") setNachrichten((alt) => (meldeGelesen(alt), alt));
    }
    document.addEventListener("visibilitychange", sichtbar);
    return () => document.removeEventListener("visibilitychange", sichtbar);
  }, [meldeGelesen]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (vorherHoehe.current !== null) {
      el.scrollTop = el.scrollHeight - vorherHoehe.current;
      vorherHoehe.current = null;
    } else if (amEnde.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [nachrichten, geladen]);

  async function aelterLaden() {
    if (aelterLaedt || nachrichten.length === 0) return;
    setAelterLaedt(true);
    try {
      const seite = await api.chatNachrichten(chat.id, nachrichten[0].id);
      vorherHoehe.current = scroller.current?.scrollHeight ?? null;
      setNachrichten((alt) => zusammenfuehren(alt, seite.nachrichten));
      setWeitere(seite.weitere);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      setAelterLaedt(false);
    }
  }

  async function loeschen() {
    if (!loeschZiel) return;
    setLoescht(true);
    try {
      const geloescht = await api.chatNachrichtLoeschen(loeschZiel.id);
      setNachrichten((alt) => zusammenfuehren(alt, [geloescht]));
      setLoeschZiel(null);
      onListeAktualisieren();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Nachricht konnte nicht gelöscht werden.");
      setLoeschZiel(null);
    } finally {
      setLoescht(false);
    }
  }

  const andere = chat.teilnehmer.length - 1;
  const untertitel =
    chat.art === "gruppe"
      ? `${chat.teilnehmer.length} Personen: ${chat.teilnehmer.map((t) => t.name).join(", ")}`
      : chat.teilnehmer.find((t) => t.name === chat.anzeigename)?.art === "klient"
        ? "Klient:in"
        : andere > 0
          ? "Direktchat"
          : "";

  const profilPartner = klient && chat.art === "direkt" ? chat.teilnehmer.find((t) => t.art === "benutzer") : undefined;

  let letzterTag = "";
  return (
    <section className="zv-chat-verlauf" aria-label={`Chat ${chat.anzeigename}`}>
      <header className="zv-chat-kopf">
        <button type="button" className="zv-icon-btn zv-chat-zurueck" onClick={onZurueck} aria-label="Zurück zur Chatliste">
          <IZurueckPfeil />
        </button>
        <div className="zv-chat-kopf-text">
          <strong>{chat.anzeigename}</strong>
          {untertitel && <span>{untertitel}</span>}
        </div>
        {profilPartner && (
          <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={() => setProfilOffen(true)}>
            <IMitarbeitende />
            Profil
          </button>
        )}
        {chat.art === "gruppe" && (
          <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={onGruppeVerwalten}>
            <IGruppe />
            Gruppe
          </button>
        )}
      </header>

      <div
        className="zv-chat-nachrichten"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          amEnde.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        role="log"
        aria-live="polite"
        aria-label="Nachrichtenverlauf"
      >
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler" role="alert">
            <IFehler />
            {fehler}
          </div>
        )}
        {weitere && (
          <button type="button" className="zv-btn zv-btn-still zv-btn-klein zv-chat-aelter" onClick={() => void aelterLaden()} disabled={aelterLaedt}>
            {aelterLaedt ? "Lädt…" : "Ältere laden"}
          </button>
        )}
        {geladen && nachrichten.length === 0 && !fehler && <Leerzustand icon={ILeerNachrichten}>Noch keine Nachrichten. Schreiben Sie die erste.</Leerzustand>}
        {nachrichten.map((n) => {
          const tag = lokalesDatum(new Date(n.erstelltAm));
          const trenner = tag !== letzterTag;
          letzterTag = tag;
          return (
            <Fragment key={n.id}>
              {trenner && <div className="zv-chat-tag">{formatTagTrenner(n.erstelltAm)}</div>}
              <NachrichtBlase n={n} onLoeschen={setLoeschZiel} onBildOeffnen={(url, name) => setBildGross({ url, name })} />
            </Fragment>
          );
        })}
      </div>

      <ChatEingabe
        chatId={chat.id}
        onGesendet={(n) => {
          amEnde.current = true;
          setNachrichten((alt) => zusammenfuehren(alt, [n]));
          onListeAktualisieren();
        }}
      />

      {bildGross && (
        <Modal titel={bildGross.name} onClose={() => setBildGross(null)}>
          <img className="zv-bild-gross" src={bildGross.url} alt={bildGross.name} />
        </Modal>
      )}
      {loeschZiel && (
        <Modal titel="Nachricht löschen?" onClose={() => setLoeschZiel(null)}>
          <p style={{ marginTop: 0 }}>Die Nachricht wird für alle in diesem Chat gelöscht. Das lässt sich nicht rückgängig machen.</p>
          <div className="zv-aktionszeile">
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => void loeschen()} disabled={loescht}>
              <INachrichtLoeschen />
              {loescht ? "Löscht…" : "Löschen"}
            </button>
            <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setLoeschZiel(null)}>
              Abbrechen
            </button>
          </div>
        </Modal>
      )}

      {profilOffen && profilPartner && (
        <Modal titel="Profil" onClose={() => setProfilOffen(false)}>
          <MitarbeiterProfilKlient benutzerId={profilPartner.id} />
        </Modal>
      )}
    </section>
  );
}
