import { IStandort } from "./icons";

export interface StandortReiterEintrag {
  /** null = "Alle Standorte". */
  id: string | null;
  label: string;
  /** Kurzer Zusatz in Mono, z. B. "9/10" (belegte/vorhandene Plaetze). */
  zaehler?: string;
}

/**
 * Standortwahl als Unterstrich-Reiter unter dem Seitenkopf.
 *
 * Statt eines Auswahlfelds oder Unterpunkten in der Seitenleiste: der
 * Standort ist ein FILTER der Seite, kein eigenes Ziel. Als Reiter sind alle
 * Standorte mit einem Klick erreichbar und zugleich sichtbar (zusammen mit
 * ihrer Belegung), ohne dass ein Menue aufgeklappt werden muss. Die Leiste
 * scrollt selbst, wenn viele Standorte nicht passen -- nie die Seite.
 */
export function StandortReiter({
  eintraege,
  aktiv,
  onWaehle,
}: {
  eintraege: StandortReiterEintrag[];
  aktiv: string | null;
  onWaehle: (id: string | null) => void;
}) {
  if (eintraege.length < 2) return null;
  return (
    <nav className="zv-reiter" aria-label="Standort">
      {eintraege.map((e) => {
        const istAktiv = e.id === aktiv;
        return (
          <button
            key={e.id ?? "alle"}
            type="button"
            className={istAktiv ? "active" : ""}
            aria-current={istAktiv ? "true" : undefined}
            onClick={() => onWaehle(e.id)}
          >
            <IStandort />
            {e.label}
            {e.zaehler && <span className="zv-mono zv-reiter-zaehler">{e.zaehler}</span>}
          </button>
        );
      })}
    </nav>
  );
}
