import { useMemo, useState } from "react";
import type { ChatKontaktDto, ChatKontaktEingabe } from "@zimmerakte/shared";
import { Leerzustand } from "../Leerzustand";
import { ILeerKontakte } from "../icons";

export const kontaktSchluessel = (k: { art: string; id: string }) => `${k.art}:${k.id}`;

export function kontaktEingabe(k: ChatKontaktDto): ChatKontaktEingabe {
  return k.art === "benutzer" ? { benutzerId: k.id } : { klientId: k.id };
}

/**
 * Suchbare Liste mit Haekchen. Mehrfach- und Einzelauswahl teilen sich die
 * Darstellung: bei `einzeln` waehlt ein Klick sofort (kein Haekchen-Zustand).
 */
export function KontaktAuswahl({
  kontakte,
  ausgewaehlt,
  onToggle,
  einzeln = false,
  idPraefix,
}: {
  kontakte: ChatKontaktDto[];
  ausgewaehlt?: Set<string>;
  onToggle: (k: ChatKontaktDto) => void;
  einzeln?: boolean;
  idPraefix: string;
}) {
  const [suche, setSuche] = useState("");
  const gefiltert = useMemo(() => {
    const q = suche.trim().toLocaleLowerCase("de-DE");
    return q ? kontakte.filter((k) => k.name.toLocaleLowerCase("de-DE").includes(q)) : kontakte;
  }, [kontakte, suche]);

  return (
    <div className="zv-kontaktwahl">
      <div className="zv-field" style={{ marginBottom: "var(--zv-space-2)" }}>
        <label htmlFor={`${idPraefix}-suche`}>Person suchen</label>
        <input
          id={`${idPraefix}-suche`}
          type="search"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Name eingeben"
          autoComplete="off"
        />
      </div>
      {gefiltert.length === 0 ? (
        <Leerzustand icon={ILeerKontakte}>{kontakte.length === 0 ? "Keine Kontakte verfügbar." : "Niemand gefunden."}</Leerzustand>
      ) : (
        <ul className="zv-kontaktliste" role={einzeln ? "list" : "group"} aria-label="Kontakte">
          {gefiltert.map((k) => {
            const gewaehlt = ausgewaehlt?.has(kontaktSchluessel(k)) ?? false;
            return (
              <li key={kontaktSchluessel(k)}>
                {einzeln ? (
                  <button type="button" className="zv-kontakt-zeile" onClick={() => onToggle(k)}>
                    <span className="zv-kontakt-name">{k.name}</span>
                    <span className="zv-pill zv-pill-vergeben">{k.art === "klient" ? "Klient:in" : "Mitarbeitende:r"}</span>
                  </button>
                ) : (
                  <label className="zv-kontakt-zeile">
                    <input type="checkbox" checked={gewaehlt} onChange={() => onToggle(k)} />
                    <span className="zv-kontakt-name">{k.name}</span>
                    <span className="zv-pill zv-pill-vergeben">{k.art === "klient" ? "Klient:in" : "Mitarbeitende:r"}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
