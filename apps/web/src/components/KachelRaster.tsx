import { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IVerschieben, IZuruecksetzen } from "./icons";

/** Position und Groesse einer Kachel in Rasterzellen. */
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
  inhalt: ReactNode;
}

export const RASTER_SPALTEN = 12;
const ZEILE_PX = 40;
const LUECKE_PX = 12;

type Layout = Record<string, KachelPlatz>;

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

function begrenzen(p: KachelPlatz, d: KachelDef): KachelPlatz {
  const w = Math.min(RASTER_SPALTEN, Math.max(d.minW, Math.round(p.w)));
  const h = Math.max(d.minH, Math.round(p.h));
  return { w, h, x: Math.min(RASTER_SPALTEN - w, Math.max(0, Math.round(p.x))), y: Math.max(0, Math.round(p.y)) };
}

function ladeLayout(schluessel: string, defs: KachelDef[]): Layout | null {
  try {
    const roh = JSON.parse(localStorage.getItem(schluessel) ?? "null") as Layout | null;
    if (!roh) return null;
    const out: Layout = {};
    for (const d of defs) {
      const p = roh[d.id];
      if (!p || ![p.x, p.y, p.w, p.h].every(Number.isFinite)) return null;
      out[d.id] = begrenzen(p, d);
    }
    return ordnen(out);
  } catch {
    return null;
  }
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
 * stehen nur als Variablen am Element, die Handy-Regel liest sie nicht) --
 * dort ist Ziehen ohnehin ausgeblendet.
 *
 * Gespeichert wird im localStorage dieses Geraets, je Konto: das Layout ist
 * reine Darstellung ohne Personenbezug und braucht deshalb weder Migration
 * noch RLS-Tabelle.
 */
export function KachelRaster({ speicherSchluessel, kacheln }: { speicherSchluessel: string; kacheln: KachelDef[] }) {
  const standardLayout = useMemo(() => {
    const l: Layout = {};
    for (const k of kacheln) l[k.id] = k.standard;
    return ordnen(l);
  }, [kacheln]);
  const [layout, setLayout] = useState<Layout>(() => ladeLayout(speicherSchluessel, kacheln) ?? standardLayout);
  const [angepasst, setAngepasst] = useState(() => ladeLayout(speicherSchluessel, kacheln) !== null);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const rasterRef = useRef<HTMLDivElement>(null);
  const griffRef = useRef<Griff | null>(null);
  const defsRef = useRef(kacheln);
  defsRef.current = kacheln;

  useEffect(() => {
    const geladen = ladeLayout(speicherSchluessel, kacheln);
    setLayout(geladen ?? standardLayout);
    setAngepasst(geladen !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speicherSchluessel]);

  function speichern(l: Layout) {
    try {
      localStorage.setItem(speicherSchluessel, JSON.stringify(l));
    } catch {
      // Ohne Speicher bleibt das Layout bis zum Neuladen -- das Umordnen selbst geht trotzdem.
    }
  }

  function zuruecksetzen() {
    try {
      localStorage.removeItem(speicherSchluessel);
    } catch {
      // egal
    }
    setLayout(standardLayout);
    setAngepasst(false);
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
      schrittY: ZEILE_PX + LUECKE_PX,
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
      speichern(l);
      return l;
    });
  }

  const zeilen = Math.max(1, ...Object.values(layout).map((p) => p.y + p.h));

  return (
    <div>
      <div className="zv-raster-leiste">
        <span className="zv-sub">Kacheln am Kopf verschieben, an der Ecke unten rechts in der Größe ändern.</span>
        <button className="zv-btn zv-btn-sekundaer" onClick={zuruecksetzen} disabled={!angepasst}>
          <IZuruecksetzen />
          Anordnung zurücksetzen
        </button>
      </div>
      <div
        ref={rasterRef}
        className="zv-raster"
        style={{ "--zv-raster-zeilen": zeilen, "--zv-raster-zeile": `${ZEILE_PX}px`, "--zv-raster-luecke": `${LUECKE_PX}px` } as CSSProperties}
      >
        {kacheln.map((k) => {
          const p = layout[k.id];
          if (!p) return null;
          return (
            <section
              key={k.id}
              className={`zv-raster-kachel${aktiv === k.id ? " zv-raster-kachel-aktiv" : ""}`}
              style={{ "--x": p.x + 1, "--y": p.y + 1, "--w": p.w, "--h": p.h } as CSSProperties}
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
                title={`${k.titel}: Größe ändern`}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
