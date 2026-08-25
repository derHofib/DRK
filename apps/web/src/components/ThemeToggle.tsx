import { useTheme } from "../theme/ThemeProvider";
import { THEME_MODI, type ThemeModus } from "../theme/theme";
import { IDunkel, IHell, ISystem, type IconKomponente } from "./icons";

const ICON: Record<ThemeModus, IconKomponente> = {
  system: ISystem,
  hell: IHell,
  dunkel: IDunkel,
};

const NAECHSTER: Record<ThemeModus, ThemeModus> = {
  system: "hell",
  hell: "dunkel",
  dunkel: "system",
};

const LABEL: Record<ThemeModus, string> = {
  system: "Systemvorgabe",
  hell: "Helles Design",
  dunkel: "Dunkles Design",
};

/**
 * Kompakter Umschalter fuer die Kopfzeile: ein Klick zykliert
 * System -> Hell -> Dunkel. Rein ikonisch, deshalb zwingend mit aria-label
 * und title -- und beide nennen auch das ZIEL, damit vor dem Klick klar
 * ist, was passiert.
 */
export function ThemeToggle() {
  const { modus, setModus } = useTheme();
  const Icon = ICON[modus];
  const ziel = NAECHSTER[modus];

  return (
    <button
      type="button"
      className="zv-icon-btn"
      onClick={() => setModus(ziel)}
      aria-label={`Design: ${LABEL[modus]}. Weiter zu ${LABEL[ziel]}.`}
      title={`Design: ${LABEL[modus]} — klicken für ${LABEL[ziel]}`}
    >
      <Icon />
    </button>
  );
}

/**
 * Ausfuehrliche Variante fuer die Einstellungsseite. Als echte Radiogruppe,
 * damit Screenreader "3 von 3" ansagen und die Pfeiltasten funktionieren --
 * bei drei gleichrangigen, sich ausschliessenden Optionen ist das die
 * richtige Semantik, nicht drei einzelne Knoepfe.
 */
export function ThemeAuswahl() {
  const { modus, setModus } = useTheme();

  return (
    <div className="zv-segmented" role="radiogroup" aria-label="Design">
      {THEME_MODI.map(({ wert, label }) => {
        const Icon = ICON[wert];
        return (
          <button
            key={wert}
            type="button"
            role="radio"
            aria-checked={modus === wert}
            className={modus === wert ? "active" : ""}
            onClick={() => setModus(wert)}
          >
            <Icon />
            {label}
          </button>
        );
      })}
    </div>
  );
}
