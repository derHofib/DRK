import { KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ChatNachrichtDto, TerminAnlegenEingabe } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { bildVerkleinern } from "../../datei";
import { Modal } from "../Modal";
import { TerminFormular } from "../TerminFormular";
import { IAbbrechen, IAnhang, IBildAnhaengen, IFehler, IKalender, ISenden, IStandort } from "../icons";

const ERLAUBTE_BILDTYPEN = ["image/jpeg", "image/png", "image/webp"];
const MAX_TEXT = 4000;

function standortFehlertext(err: GeolocationPositionError | Error): string {
  if ("code" in err) {
    if (err.code === err.PERMISSION_DENIED)
      return "Der Zugriff auf den Standort wurde verweigert. Bitte in den Browser-Einstellungen für diese Seite erlauben und erneut versuchen.";
    if (err.code === err.POSITION_UNAVAILABLE) return "Der Standort ist gerade nicht verfügbar. Bitte prüfen, ob die Ortungsdienste eingeschaltet sind.";
    if (err.code === err.TIMEOUT) return "Die Standortbestimmung hat zu lange gedauert. Bitte erneut versuchen, am besten mit freier Sicht zum Himmel oder WLAN.";
  }
  return err.message || "Standort konnte nicht gesendet werden.";
}

/**
 * Eingabezeile mit Textfeld, Anhangsmenue (Bild, Standort, Termin) und
 * Senden. Sendet selbst und meldet die fertige Nachricht zurueck -- der
 * Verlauf mischt sie ein, ohne auf das SSE-Ereignis zu warten.
 */
export function ChatEingabe({ chatId, onGesendet }: { chatId: string; onGesendet: (n: ChatNachrichtDto) => void }) {
  const [text, setText] = useState("");
  const [bild, setBild] = useState<{ datei: File; vorschau: string } | null>(null);
  const [menueOffen, setMenueOffen] = useState(false);
  const [wirdGesendet, setWirdGesendet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [standortOffen, setStandortOffen] = useState(false);
  const [terminOffen, setTerminOffen] = useState(false);
  const feld = useRef<HTMLTextAreaElement>(null);
  const dateiFeld = useRef<HTMLInputElement>(null);
  const menueRef = useRef<HTMLDivElement>(null);

  // Hoehe waechst mit dem Inhalt (bis zu einem Deckel), danach scrollt das Feld selbst.
  useEffect(() => {
    const el = feld.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => {
    if (!menueOffen) return;
    function aussen(e: MouseEvent) {
      if (!menueRef.current?.contains(e.target as Node)) setMenueOffen(false);
    }
    function esc(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setMenueOffen(false);
    }
    document.addEventListener("mousedown", aussen);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", aussen);
      document.removeEventListener("keydown", esc);
    };
  }, [menueOffen]);

  useEffect(
    () => () => {
      if (bild) URL.revokeObjectURL(bild.vorschau);
    },
    [bild]
  );

  function bildGewaehlt(datei: File | undefined) {
    if (!datei) return;
    if (!ERLAUBTE_BILDTYPEN.includes(datei.type)) {
      setFehler("Bitte ein Bild im Format JPG, PNG oder WebP wählen.");
      return;
    }
    setFehler(null);
    setBild({ datei, vorschau: URL.createObjectURL(datei) });
  }

  async function senden() {
    const inhalt = text.trim();
    if (wirdGesendet || (!inhalt && !bild)) return;
    if (inhalt.length > MAX_TEXT) {
      setFehler(`Die Nachricht ist zu lang (höchstens ${MAX_TEXT} Zeichen).`);
      return;
    }
    setWirdGesendet(true);
    setFehler(null);
    try {
      let nachricht: ChatNachrichtDto;
      if (bild) {
        const klein = await bildVerkleinern(bild.datei, 2400);
        nachricht = await api.chatBildSenden(chatId, klein, inhalt);
        setBild(null);
      } else {
        nachricht = await api.chatSenden(chatId, { art: "text", text: inhalt });
      }
      setText("");
      onGesendet(nachricht);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Nachricht konnte nicht gesendet werden.");
    } finally {
      setWirdGesendet(false);
      feld.current?.focus();
    }
  }

  function beiTaste(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter bestaetigt bei IME-Eingabe (z. B. Handy-Tastaturen) nur die Wortwahl.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void senden();
    }
  }

  return (
    <div className="zv-chat-eingabe">
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert" style={{ marginBottom: "var(--zv-space-2)" }}>
          <IFehler />
          {fehler}
        </div>
      )}
      {bild && (
        <div className="zv-chat-bildvorschau">
          <img src={bild.vorschau} alt="Ausgewähltes Bild" />
          <span className="zv-chat-bildname">{bild.datei.name}</span>
          <button type="button" className="zv-icon-btn" onClick={() => setBild(null)} aria-label="Bild entfernen">
            <IAbbrechen />
          </button>
        </div>
      )}
      <div className="zv-chat-eingabezeile">
        <div className="zv-chat-anhang" ref={menueRef}>
          <button
            type="button"
            className="zv-icon-btn"
            onClick={() => setMenueOffen((v) => !v)}
            aria-label="Anhang hinzufügen"
            aria-expanded={menueOffen}
            aria-haspopup="menu"
          >
            <IAnhang />
          </button>
          {menueOffen && (
            <div className="zv-chat-anhangmenue" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenueOffen(false);
                  dateiFeld.current?.click();
                }}
              >
                <IBildAnhaengen /> Bild
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenueOffen(false);
                  setStandortOffen(true);
                }}
              >
                <IStandort /> Standort
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenueOffen(false);
                  setTerminOffen(true);
                }}
              >
                <IKalender /> Termin
              </button>
            </div>
          )}
          <input
            ref={dateiFeld}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            data-testid="chat-bild-datei"
            onChange={(e) => {
              bildGewaehlt(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <textarea
          ref={feld}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={beiTaste}
          placeholder={bild ? "Bildunterschrift (optional)" : "Nachricht schreiben"}
          aria-label={bild ? "Bildunterschrift" : "Nachricht"}
          className="zv-chat-textfeld"
        />
        <button
          type="button"
          className="zv-btn zv-chat-senden"
          onClick={() => void senden()}
          disabled={wirdGesendet || (!text.trim() && !bild)}
          aria-label="Senden"
        >
          <ISenden />
        </button>
      </div>

      {standortOffen && (
        <StandortModal
          onClose={() => setStandortOffen(false)}
          chatId={chatId}
          onGesendet={(n) => {
            setStandortOffen(false);
            onGesendet(n);
          }}
        />
      )}
      {terminOffen && (
        <TerminModal
          onClose={() => setTerminOffen(false)}
          chatId={chatId}
          onGesendet={(n) => {
            setTerminOffen(false);
            onGesendet(n);
          }}
        />
      )}
    </div>
  );
}

function StandortModal({ chatId, onClose, onGesendet }: { chatId: string; onClose: () => void; onGesendet: (n: ChatNachrichtDto) => void }) {
  const [bezeichnung, setBezeichnung] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  function senden() {
    setFehler(null);
    if (!("geolocation" in navigator)) {
      setFehler("Dieses Gerät oder dieser Browser unterstützt keine Standortbestimmung.");
      return;
    }
    setLaeuft(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const n = await api.chatSenden(chatId, {
            art: "standort",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            genauigkeitM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
            bezeichnung: bezeichnung.trim() || null,
          });
          onGesendet(n);
        } catch (err) {
          setFehler(err instanceof Error ? err.message : "Standort konnte nicht gesendet werden.");
          setLaeuft(false);
        }
      },
      (err) => {
        setFehler(standortFehlertext(err));
        setLaeuft(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  return (
    <Modal titel="Standort senden" onClose={onClose}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      <p className="zv-sub" style={{ marginTop: 0 }}>
        Es wird einmalig Ihr aktueller Standort gesendet. Der Chat erhält die Position, keine Live-Verfolgung.
      </p>
      <div className="zv-field">
        <label htmlFor="standort-bezeichnung">Bezeichnung (optional)</label>
        <input id="standort-bezeichnung" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} maxLength={200} placeholder="z. B. Treffpunkt Haupteingang" autoFocus />
      </div>
      <button type="button" className="zv-btn zv-btn-block" onClick={senden} disabled={laeuft}>
        <IStandort />
        {laeuft ? "Standort wird bestimmt…" : "Aktuellen Standort senden"}
      </button>
    </Modal>
  );
}

function TerminModal({ chatId, onClose, onGesendet }: { chatId: string; onClose: () => void; onGesendet: (n: ChatNachrichtDto) => void }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(termin: TerminAnlegenEingabe) {
    setLaeuft(true);
    setFehler(null);
    try {
      onGesendet(await api.chatSenden(chatId, { art: "termin", termin }));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termin konnte nicht geteilt werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Termin teilen" onClose={onClose}>
      <TerminFormular absendenLabel="Termin anlegen und teilen" wirdGesendet={laeuft} fehler={fehler} onAbsenden={absenden} />
    </Modal>
  );
}
