import { useState } from "react";
import { DIENST_LABEL, SchichtuebergabeDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { IFehler, INeu, ISErledigt, ISOffen } from "./icons";

function zeitpunkt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Eine gesendete Uebergabe mit ihren Punkten -- gleiche Darstellung auf der
 * Seite "Schichtübergabe" und in der Dashboard-Karte. Die Punkte selbst sind
 * unveraenderlich; zu tun bleibt: als gelesen bestaetigen, aus einem Punkt
 * eine Aufgabe machen (und deren Stand sehen).
 */
export function UebergabeAnzeige({
  uebergabe,
  onAktualisieren,
  nachtragFeld = false,
}: {
  uebergabe: SchichtuebergabeDto;
  onAktualisieren: () => void;
  nachtragFeld?: boolean;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [nachtrag, setNachtrag] = useState("");

  async function ausfuehren(schluessel: string, aktion: () => Promise<unknown>) {
    setLaeuft(schluessel);
    setFehler(null);
    try {
      await aktion();
      onAktualisieren();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Die Aktion ist fehlgeschlagen.");
    } finally {
      setLaeuft(null);
    }
  }

  return (
    <article className="zv-uebergabe-karte" aria-label={`Übergabe ${DIENST_LABEL[uebergabe.dienst]} ${uebergabe.standortName}`}>
      <header className="zv-uebergabe-karte-kopf">
        <div>
          <h3>
            {DIENST_LABEL[uebergabe.dienst]} · {uebergabe.standortName}
          </h3>
          <p className="zv-sub-inline" style={{ margin: 0 }}>
            <span className="zv-mono">{zeitpunkt(uebergabe.gesendetAm)}</span> · von {uebergabe.verfasstVonName}
            {uebergabe.gelesenAnzahl > 0 && ` · ${uebergabe.gelesenAnzahl} gelesen`}
          </p>
        </div>
        {!uebergabe.gelesen && !uebergabe.eigene && (
          <button
            type="button"
            className="zv-btn zv-btn-sekundaer"
            disabled={laeuft === "gelesen"}
            onClick={() => ausfuehren("gelesen", () => api.schichtuebergabeGelesen(uebergabe.id))}
          >
            <ISErledigt />
            Gelesen
          </button>
        )}
      </header>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}

      <ol className="zv-uebergabe-punkte">
        {uebergabe.punkte.map((p) => (
          <li key={p.id} className={p.nachtrag ? "nachtrag" : undefined}>
            <div className="zv-uebergabe-punkt-text">
              {p.nachtrag && <span className="zv-pill zv-pill-info">Nachtrag</span>} {p.text}
            </div>
            <div className="zv-uebergabe-punkt-meta">
              {p.klientName && <span>{p.klientName}</span>}
              {p.zimmerNummer && (
                <span>
                  Zimmer <span className="zv-mono">{p.zimmerNummer}</span>
                </span>
              )}
              {p.nachtrag && <span>{p.erstelltVonName}, <span className="zv-mono">{zeitpunkt(p.erstelltAm)}</span></span>}
            </div>
            <div className="zv-uebergabe-punkt-aktion">
              {p.aufgaben.map((a) => (
                <span key={a.id} className={`zv-pill ${a.erledigt ? "zv-pill-ok" : "zv-pill-offen"}`}>
                  {a.erledigt ? <ISErledigt /> : <ISOffen />}
                  Aufgabe: {a.titel.length > 40 ? `${a.titel.slice(0, 40)}…` : a.titel}
                </span>
              ))}
              {p.aufgaben.length === 0 && (
                <button
                  type="button"
                  className="zv-link-btn"
                  disabled={laeuft === p.id}
                  onClick={() => ausfuehren(p.id, () => api.schichtuebergabePunktAufgabe(p.id))}
                >
                  <INeu />
                  Als Aufgabe anlegen
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {nachtragFeld && (
        <form
          className="zv-uebergabe-nachtrag"
          onSubmit={(e) => {
            e.preventDefault();
            const text = nachtrag.trim();
            if (!text) return;
            void ausfuehren("nachtrag", async () => {
              await api.schichtuebergabeNachtrag(uebergabe.id, { text });
              setNachtrag("");
            });
          }}
        >
          <label htmlFor={`nachtrag-${uebergabe.id}`} className="zv-sub-inline" style={{ margin: 0 }}>
            Nachtrag (neuer Punkt, die bisherigen bleiben unverändert)
          </label>
          <div className="zv-uebergabe-nachtrag-zeile">
            <input
              id={`nachtrag-${uebergabe.id}`}
              value={nachtrag}
              maxLength={1000}
              onChange={(e) => setNachtrag(e.target.value)}
              placeholder="Was wurde nachträglich bekannt?"
            />
            <button type="submit" className="zv-btn zv-btn-sekundaer" disabled={laeuft === "nachtrag" || nachtrag.trim() === ""}>
              Nachtrag hinzufügen
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
