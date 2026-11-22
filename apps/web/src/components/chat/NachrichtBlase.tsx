import { useEffect, useRef, useState, type TouchEvent } from "react";
import type { ChatAnhangDto, ChatNachrichtDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { formatKoordinate, formatTerminZeit, formatUhrzeit, osmLink } from "../../format";
import { IBestaetigen, IFehler, IKalender, INachrichtLoeschen, ISmileyHinzufuegen, IStandort } from "../icons";
import { meineReaktion, NachrichtMenue, ReaktionenFenster, ReaktionsKnoepfe, ReaktionsLeiste, SmileyFenster } from "./Reaktionen";
import { merkeSmiley } from "./SmileyAuswahl";

const LANG_DRUECKEN_MS = 450;
const DOPPELTIPP_MS = 300;
// Mehr Bewegung ist Scrollen, kein Druecken.
const TOLERANZ_PX = 10;

/** Gezielt "kann schweben" statt Bildschirmbreite: ein Tablet mit Maus soll die Leiste bekommen, ein grosses Handy nicht. */
const mitMaus = () => window.matchMedia("(hover: hover)").matches;

/**
 * Bilder liegen hinter dem Auth-Header und lassen sich deshalb nicht per
 * <img src> laden: als Blob holen und eine Objekt-URL daraus machen, die
 * beim Verlassen wieder freigegeben wird (sonst haelt der Browser jedes Bild
 * bis zum Tab-Schliessen im Speicher).
 */
function AnhangBild({ anhang, onOeffnen }: { anhang: ChatAnhangDto; onOeffnen: (url: string, name: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    let aktiv = true;
    let erzeugt: string | null = null;
    api
      .chatAnhangUrl(anhang.id)
      .then((u) => {
        if (!aktiv) return URL.revokeObjectURL(u);
        erzeugt = u;
        setUrl(u);
      })
      .catch(() => aktiv && setFehler(true));
    return () => {
      aktiv = false;
      if (erzeugt) URL.revokeObjectURL(erzeugt);
    };
  }, [anhang.id]);

  if (fehler) {
    return (
      <div className="zv-blase-bildfehler">
        <IFehler /> Bild konnte nicht geladen werden.
      </div>
    );
  }
  if (!url) return <div className="zv-blase-bild zv-blase-bild-laedt" aria-label="Bild wird geladen" />;
  return (
    <button type="button" className="zv-blase-bild-knopf" onClick={() => onOeffnen(url, anhang.dateiname)} aria-label={`Bild ${anhang.dateiname} vergrößern`}>
      <img className="zv-blase-bild" src={url} alt={anhang.dateiname} />
    </button>
  );
}

function StandortKarte({ n }: { n: ChatNachrichtDto }) {
  const s = n.standort!;
  return (
    <div className="zv-blase-karte">
      <div className="zv-blase-karte-kopf">
        <IStandort />
        <strong>{s.bezeichnung || "Standort"}</strong>
      </div>
      <div className="zv-blase-karte-zeile">
        {formatKoordinate(s.lat)}, {formatKoordinate(s.lng)}
      </div>
      {s.genauigkeitM !== null && <div className="zv-blase-karte-zeile">Genauigkeit ca. {Math.round(s.genauigkeitM)} m</div>}
      {/* Nur ein Link, keine eingebettete Karte: eingebundene Kacheln wuerden
          bei jedem Anzeigen die IP an den Kartenanbieter senden. */}
      <a className="zv-btn zv-btn-sekundaer zv-btn-klein" href={osmLink(s.lat, s.lng)} target="_blank" rel="noopener noreferrer">
        In Karten-App öffnen
      </a>
    </div>
  );
}

function TerminKarte({ n }: { n: ChatNachrichtDto }) {
  const t = n.termin!;
  const [uebernommen, setUebernommen] = useState(t.uebernommen);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function uebernehmen() {
    setLaeuft(true);
    setFehler(null);
    try {
      await api.terminUebernehmen(t.id);
      setUebernommen(true);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termin konnte nicht übernommen werden.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="zv-blase-karte">
      <div className="zv-blase-karte-kopf">
        <IKalender />
        <strong className={t.abgesagtAm ? "zv-durchgestrichen" : undefined}>{t.titel}</strong>
      </div>
      <div className="zv-blase-karte-zeile">{formatTerminZeit(t)}</div>
      {t.ort && <div className="zv-blase-karte-zeile">{t.ort}</div>}
      {t.abgesagtAm ? (
        <span className="zv-pill zv-pill-danger">Abgesagt</span>
      ) : uebernommen ? (
        <span className="zv-pill zv-pill-ok">
          <IBestaetigen size={12} />
          Übernommen
        </span>
      ) : (
        <button type="button" className="zv-btn zv-btn-klein" onClick={uebernehmen} disabled={laeuft}>
          {laeuft ? "Übernimmt…" : "In meinen Kalender übernehmen"}
        </button>
      )}
      {fehler && <div className="zv-blase-karte-zeile zv-fehlertext">{fehler}</div>}
    </div>
  );
}

export function NachrichtBlase({
  n,
  onLoeschen,
  onBildOeffnen,
  onAktualisiert,
  onFehler,
}: {
  n: ChatNachrichtDto;
  onLoeschen: (n: ChatNachrichtDto) => void;
  onBildOeffnen: (url: string, name: string) => void;
  /** Die Nachricht nach einer Reaktion, wie der Server sie jetzt liefert. */
  onAktualisiert: (n: ChatNachrichtDto) => void;
  onFehler: (text: string) => void;
}) {
  const [schwebt, setSchwebt] = useState(false);
  const [leisteFest, setLeisteFest] = useState(false);
  const [leisteUnten, setLeisteUnten] = useState(false);
  const [fenster, setFenster] = useState<null | "smileys" | "wer" | "menue">(null);
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const blase = useRef<HTMLDivElement>(null);
  const druck = useRef<{ timer: number; x: number; y: number; lang: boolean } | null>(null);
  const letzterTipp = useRef(0);

  if (n.art === "system") {
    return <div className="zv-chat-system">{n.text}</div>;
  }
  const reagierbar = !n.geloescht;

  async function reagieren(zeichen: string) {
    setFenster(null);
    setLeisteFest(false);
    if (beschaeftigt) return;
    setBeschaeftigt(true);
    try {
      const zuruecknehmen = meineReaktion(n) === zeichen;
      if (!zuruecknehmen) merkeSmiley(zeichen);
      onAktualisiert(zuruecknehmen ? await api.chatReaktionEntfernen(n.id) : await api.chatReagieren(n.id, zeichen));
    } catch (err) {
      onFehler(err instanceof Error ? err.message : "Reaktion konnte nicht gespeichert werden.");
    } finally {
      setBeschaeftigt(false);
    }
  }

  async function entfernen() {
    setBeschaeftigt(true);
    try {
      const neu = await api.chatReaktionEntfernen(n.id);
      onAktualisiert(neu);
      if (neu.reaktionen.length === 0) setFenster(null);
    } catch (err) {
      onFehler(err instanceof Error ? err.message : "Reaktion konnte nicht entfernt werden.");
    } finally {
      setBeschaeftigt(false);
    }
  }

  /**
   * Die Leiste steht ueber der Blase -- ausser ganz oben im Verlauf, wo der
   * Scrollbereich sie abschneiden wuerde; dann darunter.
   */
  function leisteZeigen() {
    const el = blase.current;
    const bereich = el?.closest(".zv-chat-nachrichten");
    if (el && bereich) setLeisteUnten(el.getBoundingClientRect().top - bereich.getBoundingClientRect().top < 56);
    setSchwebt(true);
  }

  function beiTouchStart(e: TouchEvent) {
    if (!reagierbar || e.touches.length !== 1 || mitMaus()) return;
    const t = e.touches[0];
    const d = { timer: 0, x: t.clientX, y: t.clientY, lang: false };
    d.timer = window.setTimeout(() => {
      d.lang = true;
      navigator.vibrate?.(10);
      setFenster("menue");
    }, LANG_DRUECKEN_MS);
    druck.current = d;
  }

  function beiTouchMove(e: TouchEvent) {
    const d = druck.current;
    if (!d) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - d.x) > TOLERANZ_PX || Math.abs(t.clientY - d.y) > TOLERANZ_PX) {
      window.clearTimeout(d.timer);
      druck.current = null;
    }
  }

  function beiTouchEnd(e: TouchEvent) {
    const d = druck.current;
    druck.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    if (d.lang) {
      // Sonst loest das Loslassen noch einen Klick auf das aus, was unter dem Finger liegt.
      e.preventDefault();
      return;
    }
    // Doppeltippen = 👍, aber nie auf Knoepfen und Links in der Blase (Termin uebernehmen, Bild, Karte).
    if ((e.target as HTMLElement).closest("button, a")) return;
    const jetzt = Date.now();
    if (jetzt - letzterTipp.current < DOPPELTIPP_MS) {
      letzterTipp.current = 0;
      e.preventDefault();
      if (meineReaktion(n) !== "👍") void reagieren("👍");
    } else {
      letzterTipp.current = jetzt;
    }
  }

  const leisteSichtbar = reagierbar && (schwebt || leisteFest) && fenster === null;

  return (
    <div
      className={`zv-blase-reihe${n.eigene ? " zv-blase-reihe-eigene" : ""}`}
      onMouseEnter={() => reagierbar && mitMaus() && leisteZeigen()}
      onMouseLeave={() => setSchwebt(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && leisteFest) setLeisteFest(false);
      }}
    >
      {leisteSichtbar && (
        <ReaktionsLeiste
          meine={meineReaktion(n)}
          onWahl={(z) => void reagieren(z)}
          onMehr={() => setFenster("smileys")}
          onWer={n.reaktionen.length > 0 ? () => setFenster("wer") : undefined}
          className={`zv-reaktionsleiste-schwebend${leisteUnten ? " unten" : ""}`}
        />
      )}
      <div
        ref={blase}
        className={`zv-blase${n.eigene ? " zv-blase-eigene" : ""}${n.geloescht ? " zv-blase-geloescht" : ""}${leisteSichtbar ? " zv-blase-aktiv" : ""}`}
        data-nachricht-id={n.id}
        onTouchStart={beiTouchStart}
        onTouchMove={beiTouchMove}
        onTouchEnd={beiTouchEnd}
        onTouchCancel={() => {
          if (druck.current) window.clearTimeout(druck.current.timer);
          druck.current = null;
        }}
        onContextMenu={(e) => {
          // Lang druecken am Handy oeffnet sonst zusaetzlich das Kontextmenue des Browsers.
          if (!mitMaus() && reagierbar) e.preventDefault();
        }}
      >
        {!n.eigene && <div className="zv-blase-absender">{n.absender?.name ?? "Unbekannt"}</div>}
        {n.geloescht ? (
          <div className="zv-blase-text">Nachricht gelöscht</div>
        ) : (
          <>
            {n.art === "bild" && n.anhaenge.map((a) => <AnhangBild key={a.id} anhang={a} onOeffnen={onBildOeffnen} />)}
            {n.art === "standort" && n.standort && <StandortKarte n={n} />}
            {n.art === "termin" && n.termin && <TerminKarte n={n} />}
            {n.text && <div className="zv-blase-text">{n.text}</div>}
          </>
        )}
        <div className="zv-blase-fuss">
          <span>{formatUhrzeit(n.erstelltAm)}</span>
          {reagierbar && (
            // Fuer Tastatur und als fester Weg neben dem Ueberfahren; am Handy ausgeblendet (lang druecken).
            <button
              type="button"
              className="zv-blase-reagieren"
              onClick={() => {
                leisteZeigen();
                setLeisteFest((v) => !v);
              }}
              aria-label="Reagieren"
              title="Reagieren"
              aria-expanded={leisteFest}
            >
              <ISmileyHinzufuegen size={14} />
            </button>
          )}
          {n.eigene && !n.geloescht && (
            <button type="button" className="zv-blase-loeschen" onClick={() => onLoeschen(n)} aria-label="Nachricht löschen" title="Nachricht löschen">
              <INachrichtLoeschen size={14} />
            </button>
          )}
        </div>
      </div>
      <ReaktionsKnoepfe n={n} onUmschalten={(z) => void reagieren(z)} onAlleZeigen={() => setFenster("wer")} beschaeftigt={beschaeftigt} />

      {fenster === "smileys" && <SmileyFenster onWahl={(z) => void reagieren(z)} onClose={() => setFenster(null)} />}
      {fenster === "wer" && <ReaktionenFenster n={n} onEntfernen={() => void entfernen()} onClose={() => setFenster(null)} beschaeftigt={beschaeftigt} />}
      {fenster === "menue" && (
        <NachrichtMenue
          n={n}
          onWahl={(z) => void reagieren(z)}
          onMehr={() => setFenster("smileys")}
          onWer={() => setFenster("wer")}
          onLoeschen={() => {
            setFenster(null);
            onLoeschen(n);
          }}
          onClose={() => setFenster(null)}
        />
      )}
    </div>
  );
}
