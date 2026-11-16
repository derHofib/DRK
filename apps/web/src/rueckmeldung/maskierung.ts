/**
 * Maskiert den KLON der Seite, bevor er zum Bild wird (Rückmeldung-Screenshot).
 *
 * Warum so und nicht "erst aufnehmen, dann schwärzen": ein unmaskiertes Bild
 * darf nie existieren, weder im Speicher des Dialogs noch auf dem Weg zum
 * Server. Hier wird deshalb der Klon verändert, den modern-screenshot ohnehin
 * für das Rendern anlegt (Hook `onCloneNode`) -- die sichtbare Seite bleibt
 * unberührt, es gibt kein Flackern und kein "Wiederherstellen", das scheitern
 * könnte.
 *
 * Sicher als Voreinstellung: maskiert wird ALLES, was nicht ausdrücklich als
 * `data-screenshot-sichtbar` ausgezeichnet ist (die Navigation). Eine neue
 * Komponente mit Klientennamen ist damit von der ersten Minute an geschützt;
 * die umgekehrte Lösung ("sensible Felder markieren") würde jede vergessene
 * Markierung zu einem Datenleck machen -- Art. 9 DSGVO, SGB X.
 *
 * Maskiert wird per Farbe, nicht per Textersatz: Schrift- und Hintergrundfarbe
 * werden gleich gesetzt, die Zeilen behalten ihre Breite und Umbrüche. So
 * bleibt das Layout (worum es bei Fehlern meist geht) erkennbar, der Inhalt
 * nicht -- die Pixel enthalten die Zeichen nicht mehr.
 */

/** Auf Elementen, deren Text im Screenshot lesbar bleiben darf (statische Navigation). */
export const SICHTBAR_ATTRIBUT = "data-screenshot-sichtbar";

const BILD_ELEMENTE = new Set(["IMG", "CANVAS", "VIDEO", "PICTURE", "OBJECT", "EMBED", "IFRAME"]);
const EINGABE_ELEMENTE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface MaskierungsErgebnis {
  /** Anzahl maskierter Elemente -- ein Prüfskript, das nichts misst, muss scheitern. */
  maskiert: number;
}

function setzeWichtig(el: HTMLElement | SVGElement, eigenschaft: string, wert: string) {
  el.style.setProperty(eigenschaft, wert, "important");
}

function maskiereElement(el: HTMLElement | SVGElement, farbe: string) {
  setzeWichtig(el, "color", farbe);
  setzeWichtig(el, "-webkit-text-fill-color", farbe);
  setzeWichtig(el, "background-color", farbe);
  setzeWichtig(el, "background-image", "none");
  setzeWichtig(el, "text-shadow", "none");
  setzeWichtig(el, "caret-color", farbe);
  if (el instanceof SVGElement) {
    setzeWichtig(el, "fill", farbe);
    setzeWichtig(el, "stroke", farbe);
  }
}

function hatEigenenText(el: Element): boolean {
  for (const kind of Array.from(el.childNodes)) {
    if (kind.nodeType === 3 && (kind.textContent ?? "").trim() !== "") return true;
  }
  return false;
}

/**
 * Maskiert `wurzel` und alle Nachfahren. `farbe` ist eine aufgelöste Farbe
 * (kein var()), weil Custom Properties im gerenderten Klon nicht zuverlässig
 * ankommen.
 */
export function maskiereKlon(wurzel: Node, farbe: string): MaskierungsErgebnis {
  let maskiert = 0;

  function besuche(knoten: Node, sichtbar: boolean) {
    if (knoten.nodeType === 1) {
      const el = knoten as HTMLElement | SVGElement;
      const hier = sichtbar || el.hasAttribute(SICHTBAR_ATTRIBUT);
      if (!hier) {
        const tag = el.tagName.toUpperCase();
        if (BILD_ELEMENTE.has(tag)) {
          // Quelle entfernen, bevor modern-screenshot sie als Data-URI einbettet.
          el.removeAttribute("src");
          el.removeAttribute("srcset");
          el.removeAttribute("data");
          maskiereElement(el, farbe);
          maskiert++;
        } else if (EINGABE_ELEMENTE.has(tag)) {
          el.removeAttribute("value");
          el.removeAttribute("placeholder");
          if (tag === "TEXTAREA") el.textContent = "";
          maskiereElement(el, farbe);
          maskiert++;
        } else if (hatEigenenText(el)) {
          maskiereElement(el, farbe);
          maskiert++;
        } else {
          // Auch Boxen ohne Text koennen ein Bild per CSS tragen (Unterschrift, Plan).
          setzeWichtig(el, "background-image", "none");
        }
      }
      for (const kind of Array.from(el.childNodes)) besuche(kind, hier);
    } else if (knoten.nodeType === 11) {
      for (const kind of Array.from(knoten.childNodes)) besuche(kind, sichtbar);
    }
  }

  besuche(wurzel, false);
  return { maskiert };
}

/**
 * Löst das Token `--zv-border-strong` zu einer konkreten Farbe auf: Element
 * anlegen, die computed color lesen. Muss im Dokument der echten Seite laufen
 * (nicht im Klon), weil nur dort Tokens und Hell/Dunkel gelten.
 */
export function ermittleMaskenfarbe(doc: Document = document): string {
  const probe = doc.createElement("span");
  probe.style.color = "var(--zv-border-strong)";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  doc.body.appendChild(probe);
  try {
    const farbe = doc.defaultView?.getComputedStyle(probe).color ?? "";
    // Fallback nur fuer Umgebungen ohne Tokens; ein leerer Wert wuerde "keine Maskierung" bedeuten.
    return farbe && farbe !== "rgba(0, 0, 0, 0)" ? farbe : "rgb(128, 128, 128)";
  } finally {
    probe.remove();
  }
}
