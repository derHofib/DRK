import { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IVerschieben, IZuruecksetzen } from "./icons";

/**
 * Position und Groesse einer Kachel in Rasterzeilen (je 40px plus Luecke).
 * y und h duerfen auf halbe Zeilen enden (z. B. h 1.5 fuer eine
 * Abschnittsueberschrift) -- siehe TEILUNG.
 */
export interface KachelPlatz {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KachelDef {
  id: string;
  /** Beschriftung fuer Screenreader am Anfasser. */
  titel: string;
  standard: KachelPlatz;
  /** Mindestgroesse in Zellen: darunter wuerde Inhalt abgeschnitten. */
  minW: number;
  minH: number;
  /** Hoechstens so hoch; = minH ergibt eine Kachel mit fester Hoehe (Abschnitt). */
  maxH?: number;
  /** "abschnitt": Ueberschrift ohne Kartenrahmen, nur in der Breite veraenderbar. */
  art?: "abschnitt";
  inhalt: ReactNode;
}

export const RASTER_SPALTEN = 12;
const ZEILE_PX = 40;
const LUECKE_PX = 12;

/**
 * Intern rechnet das Raster in HALBEN Zeilen: Eine Abschnittsueberschrift
 * soll halb so hoch sein wie die kleinste normale Kachel (Kennzahl, 3 Zeilen).
 * 1.5 Zeilen gehen in einem 40px-Raster nicht, und h 1 (40px) waere nicht
 * "halb", sondern weniger als ein Drittel. Darum ist eine interne Zeile
 * (40 - 12) / 2 = 14px hoch: zwei davon plus eine Luecke ergeben exakt die
 * alte Zeile, jede bisherige Kachel ist also pixelgleich so hoch wie vorher.
 * Nach aussen (KachelDef) bleibt die Einheit "Zeile" -- bestehende Kachel-
 * definitionen muessen nichts umrechnen, sie duerfen nur jetzt .5 nutzen.
 */
const TEILUNG = 2;
const HALBZEILE_PX = (ZEILE_PX - LUECKE_PX) / TEILUNG;

/** Positionen in internen Halbzeilen (y, h); x und w in Spalten wie bisher. */
type Layout = Record<string, KachelPlatz>;

function intern(p: KachelPlatz): KachelPlatz {
  return { x: p.x, w: p.w, y: Math.round(p.y * TEILUNG), h: Math.round(p.h * TEILUNG) };
}

/**
 * Speicherformat: Ab den Halbzeilen steht das Layout unter einem eigenen
 * Schluessel (Suffix _v2). Den alten Schluessel (ganze Zeilen) liest
 * ladeRoh und rechnet ihn um, ohne ihn zu ueberschreiben -- wer auf einen
 * aelteren Stand der App zurueckgeht, findet seine Anordnung dort noch.
 */
const V2 = "_v2";

function ladeRoh(schluessel: string): Layout | null {
  try {
    const neu = localStorage.getItem(schluessel + V2);
    if (neu) return JSON.parse(neu) as Layout;
    const alt = JSON.parse(localStorage.getItem(schluessel) ?? "null") as Layout | null;
    if (!alt || typeof alt !== "object") return null;
    const umgerechnet: Layout = {};
    for (const [id, p] of Object.entries(alt)) {
      if (p && [p.x, p.y, p.w, p.h].every(Number.isFinite)) umgerechnet[id] = { x: p.x, w: p.w, y: p.y * TEILUNG, h: p.h * TEILUNG };
    }
    return umgerechnet;
  } catch {
    return null;
  }
}

/** Liegt nur ein Layout im alten Format vor (Konto hat Heute vor den Abschnitten angeordnet)? */
export function nurAltesLayout(schluessel: string): boolean {
  try {
    return localStorage.getItem(schluessel + V2) === null && localStorage.getItem(schluessel) !== null;
  } catch {
    return false;
  }
}

function kollidiert(a: KachelPlatz, b: KachelPlatz) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Loest Ueberlappungen auf und zieht Kacheln nach oben. Die gerade bewegte
 * Kachel (`fest`) behaelt ihren Platz, alle anderen weichen ihr nach unten
 * aus -- so bleibt jedes Layout lueckenarm und ueberlappungsfrei, egal was
 * aus dem Speicher kommt.
 */
function ordnen(layout: Layout, fest?: string): Layout {
  const ids = Object.keys(layout).sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x);
  const gesetzt: Layout = {};
  if (fest && layout[fest]) gesetzt[fest] = layout[fest];
  for (const id of ids) {
    if (id === fest) continue;
    const p = { ...layout[id] };
    while (Object.values(gesetzt).some((q) => kollidiert(p, q))) p.y += 1;
    while (p.y > 0 && !Object.values(gesetzt).some((q) => kollidiert({ ...p, y: p.y - 1 }, q))) p.y -= 1;
    gesetzt[id] = p;
  }
  return gesetzt;
}

/**
 * Zieht Kacheln nach links, solange dort frei ist. Nur fuer die
 * Standardanordnung: Fehlt eine dort vorgesehene Kachel (ausgeblendet oder
 * noch nicht vorhanden), rueckt der Rest ihrer Reihe auf, statt ein Loch
 * mitten in der Reihe zu lassen. Eine selbst gebaute Anordnung bleibt
 * unangetastet -- da ist ein Loch Absicht.
 */
function linksBuendig(layout: Layout): Layout {
  const ids = Object.keys(layout).sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x);
  const gesetzt: Layout = {};
  for (const id of ids) {
    const p = { ...layout[id] };
    while (p.x > 0 && !Object.values(gesetzt).some((q) => kollidiert({ ...p, x: p.x - 1 }, q))) p.x -= 1;
    gesetzt[id] = p;
  }
  return gesetzt;
}

/** Grenzen in internen Einheiten; p ist bereits intern. */
function begrenzen(p: KachelPlatz, d: KachelDef): KachelPlatz {
  const w = Math.min(RASTER_SPALTEN, Math.max(d.minW, Math.round(p.w)));
  const minH = Math.round(d.minH * TEILUNG);
  const maxH = d.maxH === undefined ? Infinity : Math.round(d.maxH * TEILUNG);
  const h = Math.min(maxH, Math.max(minH, Math.round(p.h)));
  return { w, h, x: Math.min(RASTER_SPALTEN - w, Math.max(0, Math.round(p.x))), y: Math.max(0, Math.round(p.y)) };
}

function ladeLayout(schluessel: string, defs: KachelDef[]): Layout | null {
  const roh = ladeRoh(schluessel);
  if (!roh) return null;
  const gueltig = (p: KachelPlatz | undefined): p is KachelPlatz => !!p && [p.x, p.y, p.w, p.h].every(Number.isFinite);
  const out: Layout = {};
  const fehlend: KachelDef[] = [];
  for (const d of defs) {
    const p = roh[d.id];
    if (gueltig(p)) out[d.id] = begrenzen(p, d);
    else fehlend.push(d);
  }
  // Kacheln ohne gespeicherten Platz (neu hinzugekommen, bisher nie
  // sichtbar, neuer Abschnitt) werden UNTEN angehaengt, mit Breite/Hoehe aus
  // der Standardanordnung. Ihr Standardplatz liegt womoeglich mitten in einer
  // Anordnung, die es so beim Konto gar nicht gibt -- dort eingesetzt,
  // wuerde sie die selbst gebaute Ordnung nach unten wegschieben.
  let unten = Math.max(0, ...Object.values(out).map((p) => p.y + p.h));
  for (const d of fehlend) {
    const p = begrenzen({ ...intern(d.standard), y: unten }, d);
    out[d.id] = p;
    unten = p.y + p.h;
  }
  return ordnen(out);
}

interface Griff {
  id: string;
  art: "ziehen" | "groesse";
  startX: number;
  startY: number;
  start: KachelPlatz;
  schrittX: number;
  schrittY: number;
}

/**
 * Frei anordenbare Kacheln auf einem 12-Spalten-Raster. Ziehen am Kopf
 * verschiebt, die Ecke unten rechts aendert die Groesse; beides rastet auf
 * Zellen ein. Unter 641px wird CSS-seitig einspaltig gestapelt (Positionen
 * stehen nur als Variablen am Element, die Handy-Regel liest nur die
 * Lesereihenfolge --o) -- dort ist Ziehen ohnehin ausgeblendet.
 *
 * Gespeichert wird im localStorage dieses Geraets, je Konto: das Layout ist
 * reine Darstellung ohne Personenbezug und braucht deshalb weder Migration
 * noch RLS-Tabelle.
 */
export function KachelRaster({
  speicherSchluessel,
  kacheln,
  onZuruecksetzen,
  weitereAnpassung = false,
}: {
  speicherSchluessel: string;
  kacheln: KachelDef[];
  /** Zusaetzlich beim Zuruecksetzen (z. B. Abschnitte auf den Standard). */
  onZuruecksetzen?: () => void;
  /** Ausserhalb des Rasters angepasst (Abschnitte) -- haelt "Zuruecksetzen" aktiv. */
  weitereAnpassung?: boolean;
}) {
  const standardLayout = useMemo(() => {
    const l: Layout = {};
    for (const k of kacheln) l[k.id] = begrenzen(intern(k.standard), k);
    return ordnen(linksBuendig(ordnen(l)));
  }, [kacheln]);
  const [layout, setLayout] = useState<Layout>(() => ladeLayout(speicherSchluessel, kacheln) ?? standardLayout);
  const [angepasst, setAngepasst] = useState(() => ladeLayout(speicherSchluessel, kacheln) !== null);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const rasterRef = useRef<HTMLDivElement>(null);
  const griffRef = useRef<Griff | null>(null);
  const defsRef = useRef(kacheln);
  defsRef.current = kacheln;

  // Auch beim Ein-/Ausblenden einzelner Kacheln neu aufbauen.
  const idSchluessel = kacheln.map((k) => k.id).join("|");
  useEffect(() => {
    const geladen = ladeLayout(speicherSchluessel, kacheln);
    setLayout(geladen ?? standardLayout);
    setAngepasst(geladen !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speicherSchluessel, idSchluessel]);

  function speichern(l: Layout) {
    try {
      // Ausgeblendete Kacheln behalten ihren gespeicherten Platz (auch die
      // aus dem alten Format umgerechneten).
      const alt = ladeRoh(speicherSchluessel) ?? {};
      localStorage.setItem(speicherSchluessel + V2, JSON.stringify({ ...alt, ...l }));
    } catch {
      // Ohne Speicher bleibt das Layout bis zum Neuladen -- das Umordnen selbst geht trotzdem.
    }
  }

  function zuruecksetzen() {
    try {
      // Beide Formate, sonst taucht das alte beim naechsten Laden wieder auf.
      localStorage.removeItem(speicherSchluessel + V2);
      localStorage.removeItem(speicherSchluessel);
    } catch {
      // egal
    }
    setLayout(standardLayout);
    setAngepasst(false);
    onZuruecksetzen?.();
  }

  const anfassen = (id: string, art: Griff["art"]) => (e: ReactPointerEvent<HTMLElement>) => {
    const raster = rasterRef.current;
    if (!raster || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const spaltePx = (raster.clientWidth - LUECKE_PX * (RASTER_SPALTEN - 1)) / RASTER_SPALTEN;
    griffRef.current = {
      id,
      art,
      startX: e.clientX,
      startY: e.clientY,
      start: layout[id],
      schrittX: spaltePx + LUECKE_PX,
      schrittY: HALBZEILE_PX + LUECKE_PX,
    };
    setAktiv(id);
  };

  const bewegen = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const g = griffRef.current;
    if (!g) return;
    const dx = Math.round((e.clientX - g.startX) / g.schrittX);
    const dy = Math.round((e.clientY - g.startY) / g.schrittY);
    const def = defsRef.current.find((k) => k.id === g.id)!;
    const neu = begrenzen(
      g.art === "ziehen" ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy } : { ...g.start, w: g.start.w + dx, h: g.start.h + dy },
      def,
    );
    // Eine Groessenaenderung darf die Kachel nicht ueber den rechten Rand schieben.
    if (g.art === "groesse") neu.w = Math.min(neu.w, RASTER_SPALTEN - neu.x);
    setLayout((alt) => {
      const a = alt[g.id];
      if (a.x === neu.x && a.y === neu.y && a.w === neu.w && a.h === neu.h) return alt;
      return ordnen({ ...alt, [g.id]: neu }, g.id);
    });
  }, []);

  function loslassen() {
    if (!griffRef.current) return;
    griffRef.current = null;
    setAktiv(null);
    setAngepasst(true);
    setLayout((l) => {
      // Beim Loslassen einmal ohne festgehaltene Kachel ordnen: Waehrend des
      // Ziehens darf sie ueber einer Luecke schweben, gespeichert wird aber,
      // was auch das Neuladen zeigen wuerde -- sonst springt sie dann hoch.
      const fertig = ordnen(l);
      speichern(fertig);
      return fertig;
    });
  }

  const zeilen = Math.max(1, ...Object.values(layout).map((p) => p.y + p.h));
  // Lesereihenfolge oben-links nach unten-rechts: bestimmt auf dem Handy
  // (einspaltig) per CSS `order` die Reihenfolge, damit dort Abschnitt und
  // zugehoerige Kacheln zusammenbleiben statt in Definitionsreihenfolge.
  const reihenfolge = new Map(
    Object.keys(layout)
      .sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x)
      .map((id, i) => [id, i]),
  );

  return (
    <div>
      <div className="zv-raster-leiste">
        <span className="zv-sub">Kacheln am Kopf verschieben, an der Ecke unten rechts in der Größe ändern.</span>
        <button className="zv-btn zv-btn-sekundaer" onClick={zuruecksetzen} disabled={!angepasst && !weitereAnpassung}>
          <IZuruecksetzen />
          Anordnung zurücksetzen
        </button>
      </div>
      <div
        ref={rasterRef}
        className="zv-raster"
        style={{ "--zv-raster-zeilen": zeilen, "--zv-raster-zeile": `${HALBZEILE_PX}px`, "--zv-raster-luecke": `${LUECKE_PX}px` } as CSSProperties}
      >
        {kacheln.map((k) => {
          const p = layout[k.id];
          if (!p) return null;
          return (
            <section
              key={k.id}
              className={`zv-raster-kachel${k.art === "abschnitt" ? " zv-raster-abschnitt" : ""}${aktiv === k.id ? " zv-raster-kachel-aktiv" : ""}`}
              data-kachel={k.id}
              style={{ "--x": p.x + 1, "--y": p.y + 1, "--w": p.w, "--h": p.h, "--o": reihenfolge.get(k.id) ?? 0 } as CSSProperties}
            >
              <div
                className="zv-raster-griff"
                onPointerDown={anfassen(k.id, "ziehen")}
                onPointerMove={bewegen}
                onPointerUp={loslassen}
                onPointerCancel={loslassen}
                title={`${k.titel} verschieben`}
              >
                <IVerschieben />
              </div>
              <div className="zv-raster-inhalt">{k.inhalt}</div>
              <div
                className="zv-raster-ecke"
                onPointerDown={anfassen(k.id, "groesse")}
                onPointerMove={bewegen}
                onPointerUp={loslassen}
                onPointerCancel={loslassen}
                role="presentation"
                title={k.art === "abschnitt" ? `${k.titel}: Breite ändern` : `${k.titel}: Größe ändern`}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
