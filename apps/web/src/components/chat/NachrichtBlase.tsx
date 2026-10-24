import { useEffect, useState } from "react";
import type { ChatAnhangDto, ChatNachrichtDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { formatKoordinate, formatTerminZeit, formatUhrzeit, osmLink } from "../../format";
import { IBestaetigen, IFehler, IKalender, INachrichtLoeschen, IStandort } from "../icons";

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
}: {
  n: ChatNachrichtDto;
  onLoeschen: (n: ChatNachrichtDto) => void;
  onBildOeffnen: (url: string, name: string) => void;
}) {
  if (n.art === "system") {
    return <div className="zv-chat-system">{n.text}</div>;
  }
  return (
    <div className={`zv-blase${n.eigene ? " zv-blase-eigene" : ""}${n.geloescht ? " zv-blase-geloescht" : ""}`} data-nachricht-id={n.id}>
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
        {n.eigene && !n.geloescht && (
          <button type="button" className="zv-blase-loeschen" onClick={() => onLoeschen(n)} aria-label="Nachricht löschen" title="Nachricht löschen">
            <INachrichtLoeschen size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
