import { useMemo, useRef, useState } from "react";
import { CHAT_SCHNELLREAKTIONEN } from "@zimmerakte/shared";
import { ISuche } from "../icons";
import { SMILEY_GRUPPEN, smileyName, sucheSmileys } from "./smiley-liste";

const ZULETZT_SCHLUESSEL = "zv-chat-smileys-zuletzt";
const ZULETZT_MAX = 16;

/**
 * "Zuletzt verwendet" je Geraet. Nur eine Bequemlichkeit: localStorage kann
 * leer sein oder werfen (privates Fenster, gesperrte Website-Daten) -- dann
 * stehen einfach die Schnellreaktionen dort.
 */
function leseZuletzt(): string[] {
  try {
    const roh = JSON.parse(localStorage.getItem(ZULETZT_SCHLUESSEL) ?? "[]");
    if (Array.isArray(roh) && roh.every((z) => typeof z === "string") && roh.length > 0) return roh.slice(0, ZULETZT_MAX);
  } catch {
    /* Standard unten */
  }
  return [...CHAT_SCHNELLREAKTIONEN, "☕", "🎉"];
}

export function merkeSmiley(zeichen: string): void {
  try {
    const neu = [zeichen, ...leseZuletzt().filter((z) => z !== zeichen)].slice(0, ZULETZT_MAX);
    localStorage.setItem(ZULETZT_SCHLUESSEL, JSON.stringify(neu));
  } catch {
    /* siehe leseZuletzt */
  }
}

/**
 * Smiley-Auswahl als reine Flaeche, ohne eigene Positionierung: die
 * Eingabezeile legt sie als Aufklappfeld ueber das Textfeld, die Reaktion
 * ("+") zeigt sie in einem Fenster -- im Verlauf wuerde ein Aufklappfeld vom
 * Scrollbereich abgeschnitten.
 */
export function SmileyAuswahl({ onWahl, autoFokus = false }: { onWahl: (zeichen: string) => void; autoFokus?: boolean }) {
  const [suche, setSuche] = useState("");
  const [gruppe, setGruppe] = useState(-1);
  const zuletzt = useMemo(leseZuletzt, []);
  const raster = useRef<HTMLDivElement>(null);
  const treffer = useMemo(() => sucheSmileys(suche), [suche]);

  function waehle(zeichen: string) {
    merkeSmiley(zeichen);
    onWahl(zeichen);
  }

  const knopf = (zeichen: string, schluessel: string) => (
    <button key={schluessel} type="button" className="zv-smiley" onClick={() => waehle(zeichen)} aria-label={smileyName(zeichen)} title={smileyName(zeichen)}>
      {zeichen}
    </button>
  );

  return (
    <div className="zv-smiley-auswahl">
      <label className="zv-smiley-suche">
        <ISuche size={15} />
        <input
          type="search"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Smiley suchen, z. B. „daumen“"
          aria-label="Smiley suchen"
          // Nur am Computer: am Handy wuerde der Fokus die Tastatur aufklappen und die Auswahl verdecken.
          autoFocus={autoFokus}
        />
      </label>
      <div className="zv-smiley-raster-bereich" ref={raster}>
        {suche.trim() ? (
          treffer.length > 0 ? (
            <div className="zv-smiley-raster">{treffer.map((z) => knopf(z, `s-${z}`))}</div>
          ) : (
            <p className="zv-smiley-leer">Kein Smiley zu „{suche.trim()}“ gefunden.</p>
          )
        ) : (
          <>
            {gruppe < 0 && (
              <>
                <h4 className="zv-smiley-titel">Zuletzt verwendet</h4>
                <div className="zv-smiley-raster">{zuletzt.map((z) => knopf(z, `z-${z}`))}</div>
              </>
            )}
            {SMILEY_GRUPPEN.map((g, i) =>
              gruppe < 0 || gruppe === i ? (
                <section key={g.name} aria-label={g.name}>
                  <h4 className="zv-smiley-titel">{g.name}</h4>
                  <div className="zv-smiley-raster">{g.eintraege.map(([z]) => knopf(z, `${i}-${z}`))}</div>
                </section>
              ) : null
            )}
          </>
        )}
      </div>
      {!suche.trim() && (
        <div className="zv-smiley-reiter" role="tablist" aria-label="Gruppen">
          {SMILEY_GRUPPEN.map((g, i) => (
            <button
              key={g.name}
              type="button"
              role="tab"
              aria-selected={gruppe === i}
              aria-label={g.name}
              title={g.name}
              className={gruppe === i ? "aktiv" : undefined}
              onClick={() => {
                setGruppe((alt) => (alt === i ? -1 : i));
                raster.current?.scrollTo({ top: 0 });
              }}
            >
              {g.symbol}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
