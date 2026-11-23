import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  alleBausteine,
  ausrichtungVon,
  beispielDaten,
  druckUeberschriftFarbe,
  istEingabe,
  PDF_FREI_ART_LABEL,
  PDF_FREI_DRUCKRAND,
  PDF_FREI_FENSTER,
  PDF_FREI_MARKEN,
  PDF_FREI_MAX_BAUSTEINE,
  PDF_FREI_MIN_PT,
  PDF_FREI_RASTER,
  PDF_FREI_SEITE,
  PDF_PLATZHALTER,
  pdfFreiBaustein,
  pdfTextZeilen,
  type Baustein,
  type FormularDefinition,
  type PdfFrei,
  type PdfFreiArt,
  type PdfFreiAusrichtung,
  type PdfFreiBaustein,
  type PdfFreiHilfslinien,
  type PdfFreiSeitenart,
  type PdfGestaltung,
  type PdfZielgruppe,
} from "@zimmerakte/shared";
import { api } from "../../api/client";
import {
  IAbbrechen,
  IDokument,
  IEbenen,
  IEntsperrt,
  IFehler,
  IKopieren,
  ILoeschen,
  IRaster,
  IRueckgaengig,
  ISperre,
  ISuche,
  IVergroessern,
  IVerkleinern,
  IVerschiebenHoch,
  IVerschiebenRunter,
  IWiederholen,
  IErfolg,
} from "../../components/icons";
import libSansRegular from "@zimmerakte/shared/schriften/LiberationSans-Regular.ttf?url";
import libSansBold from "@zimmerakte/shared/schriften/LiberationSans-Bold.ttf?url";
import libSerifRegular from "@zimmerakte/shared/schriften/LiberationSerif-Regular.ttf?url";
import libSerifBold from "@zimmerakte/shared/schriften/LiberationSerif-Bold.ttf?url";

/**
 * Freier PDF-Designer (Konzept /mnt/project-files/pdf-designer, 21.11.2026).
 *
 * Das Blatt hier ist nur das WERKZEUG. Gespeichert wird eine Liste von
 * Bausteinen in mm, gezeichnet wird sie vom Server -- dieselbe Erzeugung wie
 * beim echten Export. Damit der Umbruch im Designer dem im PDF moeglichst
 * gleicht, laedt die Seite dieselben Schriftdateien wie der Server; ob ein
 * Text wirklich passt, sagt aber nur der Server ("Passt es?"), nicht das
 * Auge. Ein Baustein, der nicht passt, bekommt einen orangefarbenen Rahmen.
 *
 * Absichtlich keine freie Farbwahl je Baustein (Regel 7, aufs Papier
 * uebertragen): Text kennt nur Schwarz, Grau und die Traegerfarbe in der
 * festen druckfesten Helligkeit.
 */

// Schriften des Servers einmalig registrieren. FontFace statt CSS-Regel:
// die Dateien liegen im Paket "shared" und werden erst geladen, wenn der
// Designer aufgeht -- nicht mit jeder Seite der Anwendung.
let schriftenGeladen = false;
function schriftenLaden() {
  if (schriftenGeladen || typeof FontFace === "undefined") return;
  schriftenGeladen = true;
  const liste: [string, string, string][] = [
    ["Zimmerakte Liberation Sans", libSansRegular, "400"],
    ["Zimmerakte Liberation Sans", libSansBold, "700"],
    ["Zimmerakte Liberation Serif", libSerifRegular, "400"],
    ["Zimmerakte Liberation Serif", libSerifBold, "700"],
  ];
  for (const [name, url, weight] of liste) {
    const f = new FontFace(name, `url(${url})`, { weight });
    f.load()
      .then((x) => document.fonts.add(x))
      .catch(() => undefined);
  }
}

const SCHRIFT_FAMILIE: Record<PdfGestaltung["schrift"], string> = {
  nunito: "var(--zv-font-body)",
  "liberation-sans": '"Zimmerakte Liberation Sans", Arial, sans-serif',
  "liberation-serif": '"Zimmerakte Liberation Serif", "Times New Roman", serif',
};

const PT_MM = 25.4 / 72;
const ZEILE = 1.2;
const VERLAUF_MAX = 100;
/** Fangbereich fuer Ausrichtlinien in Bildschirmpunkten (unabhaengig vom Zoom). */
const FANG_PX = 6;

type Rechteck = { x: number; y: number; b: number; h: number };
type Fuehrung = { achse: "x" | "y"; wert: number };
type Ziehen =
  | { art: "neu"; vorlage: Omit<PdfFreiBaustein, "id" | "x" | "y">; cx: number; cy: number; sx: number; sy: number; ueberBlatt: boolean }
  | { art: "verschieben"; start: Map<string, Rechteck>; px: number; py: number; haupt: string; bewegt: boolean }
  | { art: "groesse"; id: string; griff: string; start: Rechteck; px: number; py: number };

const runde = (v: number, schritt: number) => Math.round(v / schritt) * schritt;
const halb = (v: number) => Math.round(v * 2) / 2;
const klemme = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function neueId(art: PdfFreiArt, vorhanden: PdfFreiBaustein[]): string {
  const basis = art === "flaeche" ? "fl" : art.slice(0, 4);
  for (;;) {
    const id = `${basis}${Math.random().toString(36).slice(2, 6)}`;
    if (!vorhanden.some((x) => x.id === id)) return id;
  }
}

type FeldInfo = { schluessel: string; label: string; typ: Baustein["typ"]; intern: boolean; ausrichtung: PdfFreiAusrichtung };

export function PdfDesigner({
  formularId,
  formularName,
  exportName,
  definition,
  gestaltung,
  zielgruppe,
  logoId,
  onUebernehmen,
  onSchliessen,
}: {
  formularId: string;
  formularName: string;
  exportName: string;
  definition: FormularDefinition;
  gestaltung: PdfGestaltung;
  zielgruppe: PdfZielgruppe;
  logoId: string | null;
  onUebernehmen: (frei: PdfFrei) => void;
  onSchliessen: () => void;
}) {
  const [frei, setFreiRoh] = useState<PdfFrei>(gestaltung.frei);
  // Verlauf in einer Ref statt im State: Rueckgaengig muss den aktuellen
  // Stand lesen UND ersetzen; als State-Updater liefe das im StrictMode doppelt.
  const freiRef = useRef(frei);
  freiRef.current = frei;
  const verlaufRef = useRef<{ zurueck: PdfFrei[]; vor: PdfFrei[] }>({ zurueck: [], vor: [] });
  const [, setVerlaufStand] = useState(0);
  const verlauf = verlaufRef.current;
  const [seite, setSeite] = useState<PdfFreiSeitenart>("erste");
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [zoom, setZoom] = useState(3.2);
  const [einrasten, setEinrasten] = useState(true);
  const [suche, setSuche] = useState("");
  const [ziehen, setZiehen] = useState<Ziehen | null>(null);
  const [fuehrungen, setFuehrungen] = useState<Fuehrung[]>([]);
  const [laengste, setLaengste] = useState(false);
  const [pruefung, setPruefung] = useState<{ ueberlauf: string[]; seiten: number } | null>(null);
  const [pruefFehler, setPruefFehler] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<string | null>(null);
  const [vorschauLaeuft, setVorschauLaeuft] = useState(false);
  const [schliessenFragen, setSchliessenFragen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const blattRef = useRef<HTMLDivElement>(null);
  const altRef = useRef(false);

  const elemente = frei[seite];
  const gewaehlt = elemente.filter((x) => auswahl.includes(x.id));
  const eins = gewaehlt.length === 1 ? gewaehlt[0] : null;
  const geaendert = JSON.stringify(frei) !== JSON.stringify(gestaltung.frei);

  useEffect(() => schriftenLaden(), []);
  useEffect(() => {
    if (!logoId) return setLogoUrl(null);
    let url: string | null = null;
    api
      .traegerDateiUrl(logoId)
      .then((u) => {
        url = u;
        setLogoUrl(u);
      })
      .catch(() => setLogoUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [logoId]);

  // Seite wechseln: Auswahl gilt nur fuer die sichtbare Seite.
  useEffect(() => setAuswahl([]), [seite]);

  /** Aenderung mit Eintrag im Verlauf (Rueckgaengig). */
  const aendern = useCallback((fn: (f: PdfFrei) => PdfFrei) => {
    const alt = freiRef.current;
    const neu = fn(alt);
    if (neu === alt) return;
    verlaufRef.current = { zurueck: [...verlaufRef.current.zurueck, alt].slice(-VERLAUF_MAX), vor: [] };
    freiRef.current = neu;
    setFreiRoh(neu);
    setVerlaufStand((n) => n + 1);
  }, []);
  /** Aenderung ohne Verlaufseintrag (laufendes Ziehen; der Eintrag entsteht beim Start). */
  const setFreiStill = setFreiRoh;

  const seiteAendern = useCallback(
    (fn: (l: PdfFreiBaustein[]) => PdfFreiBaustein[], still = false) => {
      const f = (alt: PdfFrei) => ({ ...alt, [seite]: fn(alt[seite]) });
      if (still) setFreiStill(f);
      else aendern(f);
    },
    [seite, aendern, setFreiStill]
  );

  const rueckgaengig = useCallback(() => {
    const v = verlaufRef.current;
    if (v.zurueck.length === 0) return;
    const vorher = v.zurueck[v.zurueck.length - 1];
    verlaufRef.current = { zurueck: v.zurueck.slice(0, -1), vor: [...v.vor, freiRef.current] };
    freiRef.current = vorher;
    setFreiRoh(vorher);
    setVerlaufStand((n) => n + 1);
  }, []);
  const wiederholen = useCallback(() => {
    const v = verlaufRef.current;
    if (v.vor.length === 0) return;
    const nach = v.vor[v.vor.length - 1];
    verlaufRef.current = { zurueck: [...v.zurueck, freiRef.current], vor: v.vor.slice(0, -1) };
    freiRef.current = nach;
    setFreiRoh(nach);
    setVerlaufStand((n) => n + 1);
  }, []);

  // --- Felder und Beispielwerte -----------------------------------------------

  const felder = useMemo<FeldInfo[]>(
    () =>
      alleBausteine(definition)
        .filter((b) => istEingabe(b) || b.typ === "anzeige" || b.typ === "berechnung")
        .map((b) => ({ schluessel: b.schluessel, label: b.beschriftung || b.schluessel, typ: b.typ, intern: "intern" in b && !!b.intern, ausrichtung: ausrichtungVon(b) })),
    [definition]
  );
  const feldMap = useMemo(() => new Map(felder.map((f) => [f.schluessel, f])), [felder]);
  const beispiel = useMemo(() => {
    const d = beispielDaten(definition);
    const werte: Record<string, string> = {};
    for (const p of PDF_PLATZHALTER) werte[p.schluessel] = p.beispiel;
    werte["klient.name"] = "Mira Beispiel";
    for (const f of felder) {
      const w = f.typ === "anzeige" ? d.anzeige[f.schluessel] : d.werte[f.schluessel];
      werte[`feld.${f.schluessel}`] = w === null || w === undefined ? "" : f.typ === "ja_nein" ? (w ? "Ja" : "Nein") : Array.isArray(w) ? w.join(", ") : String(w);
    }
    return werte;
  }, [definition, felder]);
  const platziert = useMemo(
    () => new Set([...frei.erste, ...frei.folge].filter((x) => x.art === "feld" || x.art === "ankreuz").map((x) => x.feld)),
    [frei]
  );

  // --- "Passt es?" ------------------------------------------------------------

  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const r = await api.pdfExportPruefen(formularId, {
          name: exportName,
          zielgruppe,
          logoId,
          gestaltung: { ...gestaltung, vorlage: "frei", frei },
          empfaenger: null,
          laengste,
        });
        setPruefung(r);
        setPruefFehler(null);
      } catch (e) {
        setPruefFehler((e as Error).message);
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [formularId, exportName, zielgruppe, logoId, gestaltung, frei, laengste]);

  const passtNicht = useMemo(() => new Set((pruefung?.ueberlauf ?? []).filter((k) => k.startsWith(`${seite}:`)).map((k) => k.slice(seite.length + 1))), [pruefung, seite]);

  const hinweise = useMemo(() => {
    const h: { text: string; ids: string[] }[] = [];
    const l = frei[seite];
    const rand = l.filter((e) => e.art !== "flaeche" && e.art !== "linie" && (e.x < PDF_FREI_DRUCKRAND || e.y < PDF_FREI_DRUCKRAND || e.x + e.b > PDF_FREI_SEITE.b - PDF_FREI_DRUCKRAND || e.y + e.h > PDF_FREI_SEITE.h - PDF_FREI_DRUCKRAND));
    if (rand.length) h.push({ text: `${rand.length} Baustein${rand.length > 1 ? "e liegen" : " liegt"} im Druckrand (5 mm). Viele Drucker schneiden dort ab.`, ids: rand.map((e) => e.id) });
    if (frei.hilfslinien !== "keine") {
      const fe = PDF_FREI_FENSTER[frei.hilfslinien];
      const aussen = l.filter((e) => e.art === "anschrift" && (e.x < fe.x - 0.01 || e.y < fe.y - 0.01 || e.x + e.b > fe.x + fe.b + 0.01 || e.y + e.h > fe.y + fe.h + 0.01));
      if (aussen.length) h.push({ text: "Das Anschriftfeld liegt nicht ganz im Umschlagfenster.", ids: aussen.map((e) => e.id) });
    }
    const flussErste = frei.erste.some((e) => e.art === "fluss");
    const offen = felder.filter((f) => !platziert.has(f.schluessel) && !(zielgruppe === "extern" && f.intern) && (gestaltung.felder === "alle" || gestaltung.felder.includes(f.schluessel)));
    if (!flussErste && offen.length) {
      h.push({ text: `${offen.length} Feld${offen.length > 1 ? "er erscheinen" : " erscheint"} nicht im PDF: weder platziert noch Fließbereich auf der ersten Seite (${offen.map((f) => f.label).join(", ")}).`, ids: [] });
    }
    const intern = l.filter((e) => (e.art === "feld" || e.art === "ankreuz") && zielgruppe === "extern" && feldMap.get(e.feld)?.intern);
    if (intern.length) h.push({ text: "Felder „nur intern“ bleiben in diesem externen Export leer.", ids: intern.map((e) => e.id) });
    const weg = l.filter((e) => (e.art === "feld" || e.art === "ankreuz") && !feldMap.has(e.feld));
    if (weg.length) h.push({ text: `${weg.length} Baustein${weg.length > 1 ? "e zeigen" : " zeigt"} auf ein Feld, das es im Formular nicht mehr gibt.`, ids: weg.map((e) => e.id) });
    return h;
  }, [frei, seite, felder, platziert, zielgruppe, feldMap, gestaltung.felder]);

  // --- Koordinaten und Einrasten ---------------------------------------------

  const mmAus = useCallback(
    (cx: number, cy: number) => {
      const r = blattRef.current!.getBoundingClientRect();
      return { x: (cx - r.left) / zoom, y: (cy - r.top) / zoom, drueber: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom };
    },
    [zoom]
  );

  /** Kandidaten fuer Ausrichtlinien: Kanten und Mitten anderer Bausteine, Fenster, Seitenmitte. */
  const kanten = useCallback(
    (ausser: Set<string>) => {
      const xs: number[] = [PDF_FREI_SEITE.b / 2, 20, PDF_FREI_SEITE.b - 20];
      const ys: number[] = [PDF_FREI_SEITE.h / 2];
      for (const e of elemente) {
        if (ausser.has(e.id)) continue;
        xs.push(e.x, e.x + e.b / 2, e.x + e.b);
        ys.push(e.y, e.y + e.h / 2, e.y + e.h);
      }
      if (frei.hilfslinien !== "keine") {
        const f = PDF_FREI_FENSTER[frei.hilfslinien];
        xs.push(f.x, f.x + f.b);
        ys.push(f.y, f.y + f.h);
      }
      return { xs, ys };
    },
    [elemente, frei.hilfslinien]
  );

  /** Position einrasten: zuerst an Kanten anderer Bausteine (sichtbare Linie), sonst ans Raster. */
  const fangen = useCallback(
    (r: Rechteck, ausser: Set<string>): { r: Rechteck; f: Fuehrung[] } => {
      if (!einrasten || altRef.current) return { r: { ...r, x: halb(r.x), y: halb(r.y) }, f: [] };
      const { xs, ys } = kanten(ausser);
      const fang = FANG_PX / zoom;
      const f: Fuehrung[] = [];
      let x = runde(r.x, frei.raster);
      let y = runde(r.y, frei.raster);
      let besteX = fang;
      for (const [eigen, versatz] of [[r.x, 0], [r.x + r.b / 2, r.b / 2], [r.x + r.b, r.b]] as const) {
        for (const k of xs) {
          const d = Math.abs(k - eigen);
          if (d < besteX) {
            besteX = d;
            x = k - versatz;
            f[0] = { achse: "x", wert: k };
          }
        }
      }
      let besteY = fang;
      for (const [eigen, versatz] of [[r.y, 0], [r.y + r.h / 2, r.h / 2], [r.y + r.h, r.h]] as const) {
        for (const k of ys) {
          const d = Math.abs(k - eigen);
          if (d < besteY) {
            besteY = d;
            y = k - versatz;
            f[1] = { achse: "y", wert: k };
          }
        }
      }
      return { r: { ...r, x: halb(x), y: halb(y) }, f: f.filter(Boolean) };
    },
    [einrasten, kanten, zoom, frei.raster]
  );

  // --- Ziehen: aus dem Baukasten, Verschieben, Groesse -----------------------

  function neuZiehen(e: ReactPointerEvent, vorlage: Omit<PdfFreiBaustein, "id" | "x" | "y">) {
    if (e.button !== 0) return;
    e.preventDefault();
    setZiehen({ art: "neu", vorlage, cx: e.clientX, cy: e.clientY, sx: e.clientX, sy: e.clientY, ueberBlatt: false });
  }

  function hinzufuegen(vorlage: Omit<PdfFreiBaustein, "id" | "x" | "y">, x?: number, y?: number) {
    if (elemente.length >= PDF_FREI_MAX_BAUSTEINE) return;
    if (vorlage.art === "fluss" && elemente.some((e) => e.art === "fluss")) return;
    const b = Math.min(vorlage.b, PDF_FREI_SEITE.b);
    const h = Math.min(vorlage.h, PDF_FREI_SEITE.h);
    const px = klemme(x ?? 20, 0, PDF_FREI_SEITE.b - b);
    const py = klemme(y ?? 30, 0, PDF_FREI_SEITE.h - h);
    const id = neueId(vorlage.art, elemente);
    seiteAendern((l) => [...l, { ...vorlage, id, x: halb(px), y: halb(py), b, h }]);
    setAuswahl([id]);
  }

  function elementDown(e: ReactPointerEvent, el: PdfFreiBaustein) {
    if (e.button !== 0) return;
    e.stopPropagation();
    let neueAuswahl = auswahl;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      neueAuswahl = auswahl.includes(el.id) ? auswahl.filter((x) => x !== el.id) : [...auswahl, el.id];
      setAuswahl(neueAuswahl);
      return;
    }
    if (!auswahl.includes(el.id)) {
      neueAuswahl = [el.id];
      setAuswahl(neueAuswahl);
    }
    const beweglich = elemente.filter((x) => neueAuswahl.includes(x.id) && !x.gesperrt);
    if (beweglich.length === 0) return;
    e.preventDefault();
    setZiehen({ art: "verschieben", start: new Map(beweglich.map((x) => [x.id, { x: x.x, y: x.y, b: x.b, h: x.h }])), px: e.clientX, py: e.clientY, haupt: el.gesperrt ? beweglich[0].id : el.id, bewegt: false });
  }

  function griffDown(e: ReactPointerEvent, el: PdfFreiBaustein, griff: string) {
    e.stopPropagation();
    e.preventDefault();
    aendern((f) => ({ ...f })); // Verlaufseintrag vor dem Ziehen
    setZiehen({ art: "groesse", id: el.id, griff, start: { x: el.x, y: el.y, b: el.b, h: el.h }, px: e.clientX, py: e.clientY });
  }

  useEffect(() => {
    if (!ziehen) return;
    function bewegen(e: PointerEvent) {
      altRef.current = e.altKey;
      if (!ziehen) return;
      if (ziehen.art === "neu") {
        const m = mmAus(e.clientX, e.clientY);
        setZiehen({ ...ziehen, cx: e.clientX, cy: e.clientY, ueberBlatt: m.drueber });
        if (m.drueber) {
          const { f } = fangen({ x: m.x, y: m.y, b: ziehen.vorlage.b, h: ziehen.vorlage.h }, new Set());
          setFuehrungen(f);
        } else setFuehrungen([]);
        return;
      }
      const dx = (e.clientX - ziehen.px) / zoom;
      const dy = (e.clientY - ziehen.py) / zoom;
      if (ziehen.art === "verschieben") {
        if (!ziehen.bewegt && Math.hypot(e.clientX - ziehen.px, e.clientY - ziehen.py) < 3) return;
        if (!ziehen.bewegt) {
          aendern((f) => ({ ...f }));
          setZiehen({ ...ziehen, bewegt: true });
        }
        const h0 = ziehen.start.get(ziehen.haupt)!;
        const { r, f } = fangen({ ...h0, x: h0.x + dx, y: h0.y + dy }, new Set(ziehen.start.keys()));
        const ddx = r.x - h0.x;
        const ddy = r.y - h0.y;
        setFuehrungen(f);
        seiteAendern(
          (l) =>
            l.map((x) => {
              const s = ziehen.start.get(x.id);
              if (!s) return x;
              return { ...x, x: halb(klemme(s.x + ddx, 0, PDF_FREI_SEITE.b - x.b)), y: halb(klemme(s.y + ddy, 0, PDF_FREI_SEITE.h - x.h)) };
            }),
          true
        );
        return;
      }
      // Groesse
      const s = ziehen.start;
      const schritt = einrasten && !altRef.current ? frei.raster : 0.5;
      let { x, y, b, h } = s;
      const g = ziehen.griff;
      const min = 0.5;
      if (g.includes("e")) b = klemme(runde(s.x + s.b + dx, schritt) - s.x, min, PDF_FREI_SEITE.b - s.x);
      if (g.includes("s")) h = klemme(runde(s.y + s.h + dy, schritt) - s.y, min, PDF_FREI_SEITE.h - s.y);
      if (g.includes("w")) {
        x = klemme(runde(s.x + dx, schritt), 0, s.x + s.b - min);
        b = s.x + s.b - x;
      }
      if (g.includes("n")) {
        y = klemme(runde(s.y + dy, schritt), 0, s.y + s.h - min);
        h = s.y + s.h - y;
      }
      seiteAendern((l) => l.map((el) => (el.id === ziehen.id ? { ...el, x: halb(x), y: halb(y), b: halb(b), h: halb(h) } : el)), true);
    }
    function loslassen(e: PointerEvent) {
      if (ziehen?.art === "neu") {
        const m = mmAus(e.clientX, e.clientY);
        if (m.drueber) {
          const { r } = fangen({ x: m.x, y: m.y, b: ziehen.vorlage.b, h: ziehen.vorlage.h }, new Set());
          hinzufuegen(ziehen.vorlage, r.x, r.y);
        } else if (Math.hypot(e.clientX - ziehen.sx, e.clientY - ziehen.sy) < 4) {
          // Nur angetippt (auch am Tablet): an einer freien Standardstelle einsetzen.
          hinzufuegen(ziehen.vorlage);
        }
      }
      setZiehen(null);
      setFuehrungen([]);
    }
    window.addEventListener("pointermove", bewegen);
    window.addEventListener("pointerup", loslassen);
    return () => {
      window.removeEventListener("pointermove", bewegen);
      window.removeEventListener("pointerup", loslassen);
    };
    // hinzufuegen haengt an elemente; der Effekt laeuft je Ziehvorgang neu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ziehen, zoom, mmAus, fangen, seiteAendern, aendern, einrasten, frei.raster]);

  // --- Tastatur ----------------------------------------------------------------

  useEffect(() => {
    function taste(e: KeyboardEvent) {
      const ziel = e.target as HTMLElement;
      if (ziel.closest("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) wiederholen();
        else rueckgaengig();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        wiederholen();
        return;
      }
      if (auswahl.length === 0) return;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplizieren();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        entfernen();
        return;
      }
      if (e.key === "Escape") {
        setAuswahl([]);
        return;
      }
      const schritt = e.shiftKey ? 5 : frei.raster;
      const d = { ArrowLeft: [-schritt, 0], ArrowRight: [schritt, 0], ArrowUp: [0, -schritt], ArrowDown: [0, schritt] }[e.key];
      if (d) {
        e.preventDefault();
        seiteAendern((l) =>
          l.map((x) =>
            auswahl.includes(x.id) && !x.gesperrt
              ? { ...x, x: halb(klemme(x.x + d[0], 0, PDF_FREI_SEITE.b - x.b)), y: halb(klemme(x.y + d[1], 0, PDF_FREI_SEITE.h - x.h)) }
              : x
          )
        );
      }
    }
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  });

  function duplizieren() {
    const neu: PdfFreiBaustein[] = [];
    for (const x of gewaehlt) {
      if (x.art === "fluss") continue;
      neu.push({ ...x, id: neueId(x.art, [...elemente, ...neu]), x: halb(klemme(x.x + 5, 0, PDF_FREI_SEITE.b - x.b)), y: halb(klemme(x.y + 5, 0, PDF_FREI_SEITE.h - x.h)), gesperrt: false });
    }
    if (neu.length === 0 || elemente.length + neu.length > PDF_FREI_MAX_BAUSTEINE) return;
    seiteAendern((l) => [...l, ...neu]);
    setAuswahl(neu.map((x) => x.id));
  }

  function entfernen() {
    const weg = new Set(auswahl);
    seiteAendern((l) => l.filter((x) => !weg.has(x.id)));
    setAuswahl([]);
  }

  function setze(id: string, teil: Partial<PdfFreiBaustein>) {
    seiteAendern((l) =>
      l.map((x) => {
        if (x.id !== id) return x;
        const n = { ...x, ...teil };
        n.b = halb(klemme(n.b, 0.5, PDF_FREI_SEITE.b));
        n.h = halb(klemme(n.h, 0.5, PDF_FREI_SEITE.h));
        n.x = halb(klemme(n.x, 0, PDF_FREI_SEITE.b - n.b));
        n.y = halb(klemme(n.y, 0, PDF_FREI_SEITE.h - n.h));
        return n;
      })
    );
  }

  function ebene(id: string, richtung: 1 | -1) {
    seiteAendern((l) => {
      const i = l.findIndex((x) => x.id === id);
      const j = i + richtung;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  /** Ausrichten mehrerer Bausteine an der Auswahl. */
  function ausrichten(wie: "links" | "rechts" | "oben" | "unten" | "mitteH" | "verteilenH" | "verteilenV" | "breite" | "hoehe") {
    const l = gewaehlt.filter((x) => !x.gesperrt);
    if (l.length < 2) return;
    const minX = Math.min(...l.map((x) => x.x));
    const maxX = Math.max(...l.map((x) => x.x + x.b));
    const minY = Math.min(...l.map((x) => x.y));
    const maxY = Math.max(...l.map((x) => x.y + x.h));
    const neu = new Map<string, Partial<PdfFreiBaustein>>();
    if (wie === "links") l.forEach((x) => neu.set(x.id, { x: minX }));
    if (wie === "rechts") l.forEach((x) => neu.set(x.id, { x: maxX - x.b }));
    if (wie === "oben") l.forEach((x) => neu.set(x.id, { y: minY }));
    if (wie === "unten") l.forEach((x) => neu.set(x.id, { y: maxY - x.h }));
    if (wie === "mitteH") l.forEach((x) => neu.set(x.id, { y: halb((minY + maxY) / 2 - x.h / 2) }));
    if (wie === "breite") l.forEach((x) => neu.set(x.id, { b: l[0].b }));
    if (wie === "hoehe") l.forEach((x) => neu.set(x.id, { h: l[0].h }));
    if (wie === "verteilenH") {
      const s = [...l].sort((a, b) => a.x - b.x);
      const luecke = (maxX - minX - s.reduce((n, x) => n + x.b, 0)) / (s.length - 1);
      let pos = minX;
      for (const x of s) {
        neu.set(x.id, { x: halb(pos) });
        pos += x.b + luecke;
      }
    }
    if (wie === "verteilenV") {
      const s = [...l].sort((a, b) => a.y - b.y);
      const luecke = (maxY - minY - s.reduce((n, x) => n + x.h, 0)) / (s.length - 1);
      let pos = minY;
      for (const x of s) {
        neu.set(x.id, { y: halb(pos) });
        pos += x.h + luecke;
      }
    }
    seiteAendern((liste) =>
      liste.map((x) => {
        const t = neu.get(x.id);
        if (!t) return x;
        const n = { ...x, ...t };
        return { ...n, x: halb(klemme(n.x, 0, PDF_FREI_SEITE.b - n.b)), y: halb(klemme(n.y, 0, PDF_FREI_SEITE.h - n.h)) };
      })
    );
  }

  async function pdfVorschau() {
    setVorschauLaeuft(true);
    try {
      const blob = await api.pdfExportVorschau(formularId, {
        name: exportName,
        zielgruppe,
        logoId,
        gestaltung: { ...gestaltung, vorlage: "frei", frei },
        empfaenger: frei.erste.some((e) => e.art === "anschrift") ? "Bezirksamt Beispiel\nTeilhabefachdienst\nMusterstraße 1\n10000 Berlin" : null,
      });
      setVorschau(URL.createObjectURL(blob));
    } catch (e) {
      setPruefFehler((e as Error).message);
    } finally {
      setVorschauLaeuft(false);
    }
  }

  // --- Baukasten ---------------------------------------------------------------

  const s = suche.trim().toLocaleLowerCase("de-DE");
  const passt = (t: string) => !s || t.toLocaleLowerCase("de-DE").includes(s);
  const hatFluss = elemente.some((e) => e.art === "fluss");
  const v = (teil: Partial<PdfFreiBaustein> & Pick<PdfFreiBaustein, "art" | "b" | "h">) => {
    const { id: _id, x: _x, y: _y, ...rest } = pdfFreiBaustein({ id: "x", x: 0, y: 0, ...teil });
    return rest;
  };
  const gestaltungsBausteine: { label: string; vorlage: Omit<PdfFreiBaustein, "id" | "x" | "y">; aus?: boolean }[] = [
    { label: "Text", vorlage: v({ art: "text", b: 60, h: 6, text: "Text" }) },
    { label: "Seitenzahl", vorlage: v({ art: "text", b: 35, h: 5, text: "Seite {seite} von {seiten}", pt: 7, farbe: "grau", ausrichtung: "rechts" }) },
    { label: "Logo", vorlage: v({ art: "logo", b: 30, h: 13 }) },
    { label: "Linie", vorlage: v({ art: "linie", b: 80, h: 1, staerke: 0.5 }) },
    { label: "Fläche", vorlage: v({ art: "flaeche", b: 60, h: 20 }) },
    { label: "Unterschrift", vorlage: v({ art: "unterschrift", b: 65, h: 15 }) },
    { label: "Anschriftfeld", vorlage: v({ art: "anschrift", b: 85, h: 27, pt: 10 }) },
  ];
  const gruppen = useMemo(() => {
    const m = new Map<string, typeof PDF_PLATZHALTER>();
    for (const p of PDF_PLATZHALTER) if (p.schluessel !== "seite" && p.schluessel !== "seiten") m.set(p.gruppe, [...(m.get(p.gruppe) ?? []), p]);
    return [...m.entries()];
  }, []);

  // --- Darstellung ---------------------------------------------------------------

  const akzentDruck = druckUeberschriftFarbe(gestaltung.farbe ?? "#e60005");
  const blattStil = {
    width: PDF_FREI_SEITE.b * zoom,
    height: PDF_FREI_SEITE.h * zoom,
    "--pd-raster": `${frei.raster * zoom}px`,
    "--pd-raster-5": `${5 * zoom}px`,
    // Druckfarben des Exports (Daten, nicht Oberflaechenfarbe): die
    // Helligkeit legt druckUeberschriftFarbe fest, wie im echten PDF.
    "--pd-akzent": gestaltung.farbe ?? "var(--zv-accent)",
    "--pd-akzent-druck": akzentDruck,
    fontFamily: SCHRIFT_FAMILIE[gestaltung.schrift],
  } as CSSProperties;

  const rechteckStil = (r: Rechteck): CSSProperties => ({ left: r.x * zoom, top: r.y * zoom, width: r.b * zoom, height: r.h * zoom });
  const ptPx = (pt: number) => pt * PT_MM * zoom;

  function inhalt(el: PdfFreiBaustein) {
    const schrift: CSSProperties = { fontSize: ptPx(el.pt), lineHeight: ZEILE, textAlign: el.ausrichtung === "mitte" ? "center" : el.ausrichtung === "rechts" ? "right" : "left", fontWeight: el.fett ? 700 : 400 };
    switch (el.art) {
      case "text": {
        const zeilen = pdfTextZeilen(el.text, { ...beispiel, seite: "1", seiten: "2" });
        return (
          <div className={`zv-pd-text zv-pd-farbe-${el.farbe}`} style={schrift}>
            {zeilen.length === 0 ? <span className="zv-pd-leer">{el.text ? "leer mit Beispieldaten" : "Text"}</span> : zeilen.map((z, i) => <div key={i} style={z.fett ? { fontWeight: 700 } : undefined}>{z.text || " "}</div>)}
          </div>
        );
      }
      case "feld":
      case "ankreuz": {
        const f = feldMap.get(el.feld);
        if (!f) return <span className="zv-pd-leer">Feld fehlt</span>;
        const kreuz = f.typ === "ja_nein" && (el.art === "ankreuz" || gestaltung.jaNein === "kreuz");
        const wert = kreuz ? (
          <span className="zv-pd-kreuze">
            <span className="zv-pd-kasten zv-pd-kasten-an" />
            Ja <span className="zv-pd-kasten" /> Nein
          </span>
        ) : (
          beispiel[`feld.${f.schluessel}`] || "–"
        );
        const labelStil = { fontSize: ptPx(Math.max(PDF_FREI_MIN_PT, el.pt - 1.5)) };
        return (
          <div className={`zv-pd-feld zv-pd-beschriftung-${el.beschriftung} zv-pd-farbe-${el.farbe}`} style={schrift}>
            {el.beschriftung === "darueber" && <div className="zv-pd-label" style={labelStil}>{f.label}</div>}
            {el.beschriftung === "links" && <div className="zv-pd-label">{f.label}</div>}
            <div className="zv-pd-wert">{wert}</div>
            {zielgruppe === "extern" && f.intern && <span className="zv-pd-marke">nur intern</span>}
          </div>
        );
      }
      case "logo":
        return logoUrl ? <img className={`zv-pd-logo zv-pd-logo-${el.ausrichtung}`} src={logoUrl} alt="" draggable={false} /> : <span className="zv-pd-leer">Logo (im Editor wählen)</span>;
      case "linie":
        return <span className={`zv-pd-linie zv-pd-linie-${el.b >= el.h ? "waag" : "senk"} zv-pd-farbe-${el.farbe}`} style={{ "--pd-staerke": `${Math.max(1, el.staerke * PT_MM * zoom)}px` } as CSSProperties} />;
      case "flaeche":
        return <span className={`zv-pd-flaeche zv-pd-flaeche-${el.flaeche}`} />;
      case "unterschrift":
        return (
          <div className="zv-pd-unterschrift" style={{ fontSize: ptPx(Math.max(PDF_FREI_MIN_PT, el.pt - 1.5)) }}>
            <span />
            Anna Berger, 21.11.2026
          </div>
        );
      case "anschrift":
        return (
          <div className="zv-pd-text" style={schrift}>
            <div>Bezirksamt Beispiel</div>
            <div>Teilhabefachdienst</div>
            <div>Musterstraße 1</div>
            <div>10000 Berlin</div>
          </div>
        );
      case "fluss": {
        const offen = felder.filter((f) => !platziert.has(f.schluessel) && !(zielgruppe === "extern" && f.intern) && (gestaltung.felder === "alle" || gestaltung.felder.includes(f.schluessel)));
        return (
          <div className="zv-pd-fluss-inhalt">
            <strong>Fließbereich</strong>
            <span>{seite === "erste" ? "beginnt hier" : "Fortsetzung auf jeder Folgeseite"} · {offen.length} Feld{offen.length === 1 ? "" : "er"}</span>
            <span className="zv-pd-fluss-felder">{offen.map((f) => f.label).join(" · ")}</span>
          </div>
        );
      }
    }
  }

  const griffe = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const ziehNeu = ziehen?.art === "neu" ? ziehen : null;
  const fenster = frei.hilfslinien !== "keine" ? PDF_FREI_FENSTER[frei.hilfslinien] : null;
  const marken = frei.hilfslinien !== "keine" ? PDF_FREI_MARKEN[frei.hilfslinien] : [];
  const anzeigeRechteck = eins ? { x: eins.x, y: eins.y, b: eins.b, h: eins.h } : null;

  return (
    <div className="zv-pd-scrim" role="dialog" aria-modal="true" aria-label="PDF-Designer">
      <div className="zv-pd">
        <header className="zv-pd-kopf">
          <div className="zv-pd-titel">
            <strong>PDF-Designer</strong>
            <span className="zv-sub-inline">
              {formularName} › {exportName}
            </span>
            <span className={zielgruppe === "extern" ? "zv-pill zv-pill-frist" : "zv-pill"}>{zielgruppe}</span>
            {geaendert && <span className="zv-pill zv-pill-frist">nicht übernommen</span>}
          </div>
          <div className="zv-segmented" role="group" aria-label="Seite">
            <button type="button" className={seite === "erste" ? "active" : ""} aria-pressed={seite === "erste"} onClick={() => setSeite("erste")}>
              Erste Seite
            </button>
            <button type="button" className={seite === "folge" ? "active" : ""} aria-pressed={seite === "folge"} onClick={() => setSeite("folge")}>
              Folgeseiten
            </button>
          </div>
          <label className="zv-pd-wahl">
            <IRaster />
            <span className="zv-sr-only">Raster</span>
            <select value={frei.raster} onChange={(e) => aendern((f) => ({ ...f, raster: Number(e.target.value) }))} aria-label="Raster">
              {PDF_FREI_RASTER.map((r) => (
                <option key={r} value={r}>
                  {String(r).replace(".", ",")} mm
                </option>
              ))}
            </select>
          </label>
          <label className="zv-checkbox-zeile zv-pd-einrasten">
            <input type="checkbox" checked={einrasten} onChange={(e) => setEinrasten(e.target.checked)} />
            einrasten
          </label>
          <label className="zv-pd-wahl" title="Hilfslinien: Umschlagfenster, Falz- und Lochmarken">
            <span className="zv-sr-only">Hilfslinien</span>
            <select value={frei.hilfslinien} onChange={(e) => aendern((f) => ({ ...f, hilfslinien: e.target.value as PdfFreiHilfslinien }))} aria-label="Hilfslinien">
              <option value="din5008b">Hilfslinien DIN 5008 B</option>
              <option value="din5008a">Hilfslinien DIN 5008 A</option>
              <option value="keine">ohne Hilfslinien</option>
            </select>
          </label>
          <span className="zv-pd-sp" />
          <div className="zv-pd-kopf-rechts">
          <button type="button" className="zv-icon-btn" title="Rückgängig (⌘Z)" aria-label="Rückgängig" disabled={verlauf.zurueck.length === 0} onClick={rueckgaengig}>
            <IRueckgaengig />
          </button>
          <button type="button" className="zv-icon-btn" title="Wiederholen (⇧⌘Z)" aria-label="Wiederholen" disabled={verlauf.vor.length === 0} onClick={wiederholen}>
            <IWiederholen />
          </button>
          <div className="zv-pd-zoom">
            <button type="button" className="zv-icon-btn" aria-label="Verkleinern" onClick={() => setZoom((z) => Math.max(1.5, Math.round((z - 0.4) * 10) / 10))}>
              <IVerkleinern />
            </button>
            <span>{Math.round((zoom / 3.78) * 100)} %</span>
            <button type="button" className="zv-icon-btn" aria-label="Vergrößern" onClick={() => setZoom((z) => Math.min(9, Math.round((z + 0.4) * 10) / 10))}>
              <IVergroessern />
            </button>
          </div>
          <button type="button" className="zv-btn zv-btn-still" disabled={vorschauLaeuft} onClick={pdfVorschau}>
            <IDokument />
            {vorschauLaeuft ? "Erzeugt…" : "PDF-Vorschau"}
          </button>
          <button type="button" className="zv-btn zv-btn-still" onClick={() => (geaendert ? setSchliessenFragen(true) : onSchliessen())}>
            Schließen
          </button>
          <button type="button" className="zv-btn" onClick={() => onUebernehmen(frei)}>
            Übernehmen
          </button>
          </div>
        </header>
        {schliessenFragen && (
          <div className="zv-hinweis zv-hinweis-achtung zv-pd-frage">
            <IFehler />
            Änderungen im Designer verwerfen?
            <button type="button" className="zv-btn zv-btn-still" onClick={() => setSchliessenFragen(false)}>
              Weiter gestalten
            </button>
            <button type="button" className="zv-btn" onClick={onSchliessen}>
              Verwerfen
            </button>
          </div>
        )}

        <div className="zv-pd-spalten">
          <aside className="zv-pd-baukasten" aria-label="Baukasten">
            <label className="zv-pd-suche">
              <ISuche />
              <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Baustein suchen …" aria-label="Baustein suchen" />
            </label>
            <p className="zv-sub-inline">Aufs Blatt ziehen oder antippen.</p>
            <div className="zv-gruppenlabel">Felder dieses Formulars</div>
            {felder.filter((f) => passt(f.label)).map((f) => {
              const gesperrt = zielgruppe === "extern" && f.intern;
              // Die Ausrichtung aus dem Formular ist nur der Start; im Designer bleibt sie je Element frei waehlbar.
              const vorlage = v({ art: "feld", feld: f.schluessel, b: f.typ === "langtext" ? 120 : 60, h: f.typ === "langtext" ? 25 : 9, ausrichtung: f.ausrichtung });
              return (
                <button
                  key={f.schluessel}
                  type="button"
                  className="zv-pd-chip"
                  disabled={gesperrt}
                  title={gesperrt ? "Nur intern: in einem externen Export nicht verfügbar." : undefined}
                  onPointerDown={(e) => !gesperrt && neuZiehen(e, vorlage)}
                  onKeyDown={(e) => e.key === "Enter" && hinzufuegen(vorlage)}
                >
                  <span className="zv-pd-griff" aria-hidden="true">⋮⋮</span>
                  <span className="zv-pd-chip-name">{f.label}</span>
                  <span className="zv-pd-chip-typ">{gesperrt ? "nur intern" : platziert.has(f.schluessel) ? "platziert" : f.typ.replace("_", "/")}</span>
                </button>
              );
            })}
            <div className="zv-gruppenlabel">Angaben</div>
            {gruppen.map(([gruppe, liste]) => {
              const sichtbar = liste.filter((p) => passt(`${gruppe} ${p.schluessel} ${p.beispiel}`));
              if (sichtbar.length === 0) return null;
              return (
                <details key={gruppe} className="zv-pd-gruppe" open={!!s}>
                  <summary>{gruppe}</summary>
                  {sichtbar.map((p) => {
                    const vorlage = v({ art: "text", b: 60, h: 5, text: `{${p.schluessel}}` });
                    return (
                      <button key={p.schluessel} type="button" className="zv-pd-chip" onPointerDown={(e) => neuZiehen(e, vorlage)} onKeyDown={(e) => e.key === "Enter" && hinzufuegen(vorlage)}>
                        <span className="zv-pd-griff" aria-hidden="true">⋮⋮</span>
                        <span className="zv-pd-chip-name">{p.beispiel}</span>
                        <code className="zv-pd-chip-typ">{p.schluessel.split(".").pop()}</code>
                      </button>
                    );
                  })}
                </details>
              );
            })}
            <div className="zv-gruppenlabel">Gestaltung</div>
            <div className="zv-pd-raster2">
              {gestaltungsBausteine.filter((g) => passt(g.label)).map((g) => (
                <button key={g.label} type="button" className="zv-pd-chip" onPointerDown={(e) => neuZiehen(e, g.vorlage)} onKeyDown={(e) => e.key === "Enter" && hinzufuegen(g.vorlage)}>
                  <span className="zv-pd-griff" aria-hidden="true">⋮⋮</span>
                  <span className="zv-pd-chip-name">{g.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="zv-pd-chip zv-pd-chip-fluss"
              disabled={hatFluss}
              title={hatFluss ? "Auf dieser Seite gibt es schon einen Fließbereich." : undefined}
              onPointerDown={(e) => !hatFluss && neuZiehen(e, v({ art: "fluss", b: 170, h: 120 }))}
              onKeyDown={(e) => e.key === "Enter" && hinzufuegen(v({ art: "fluss", b: 170, h: 120 }))}
            >
              <span className="zv-pd-griff" aria-hidden="true">⋮⋮</span>
              <span className="zv-pd-chip-name">Fließbereich</span>
              <span className="zv-pd-chip-typ">{hatFluss ? "vorhanden" : "restliche Felder"}</span>
            </button>
            <p className="zv-sub-inline">
              Alle Felder, die nicht frei platziert sind, laufen in den Fließbereich und brechen auf die Folgeseite um. Höchstens einer je Seite.
            </p>
          </aside>

          <div className="zv-pd-buehne" onPointerDown={() => setAuswahl([])}>
            <div ref={blattRef} className={`zv-pd-blatt${frei.raster <= 1 && zoom >= 3 ? " zv-pd-blatt-fein" : ""}`} style={blattStil} data-testid="pd-blatt">
              {fenster && (
                <div className="zv-pd-fenster" style={rechteckStil(fenster)}>
                  <span>Umschlagfenster</span>
                </div>
              )}
              {marken.map((y) => (
                <span key={y} className="zv-pd-marke-falz" style={{ top: y * zoom }} />
              ))}
              {elemente.map((el) => {
                const sel = auswahl.includes(el.id);
                const ueber = passtNicht.has(el.id);
                return (
                  <div
                    key={el.id}
                    data-id={el.id}
                    className={`zv-pd-el zv-pd-el-${el.art}${sel ? " zv-pd-el-sel" : ""}${ueber ? " zv-pd-el-ueber" : ""}${el.gesperrt ? " zv-pd-el-gesperrt" : ""}${el.rahmen !== "keiner" ? ` zv-pd-rahmen-${el.rahmen}` : ""}`}
                    style={rechteckStil(el)}
                    onPointerDown={(e) => elementDown(e, el)}
                    title={`${PDF_FREI_ART_LABEL[el.art]}${ueber ? " – passt nicht" : ""}`}
                  >
                    {inhalt(el)}
                    {sel && auswahl.length === 1 && !el.gesperrt &&
                      griffe.map((g) => <span key={g} className={`zv-pd-griffpunkt zv-pd-griffpunkt-${g}`} onPointerDown={(e) => griffDown(e, el, g)} />)}
                  </div>
                );
              })}
              {fuehrungen.map((f, i) => (
                <span key={i} className={`zv-pd-fuehrung zv-pd-fuehrung-${f.achse}`} style={f.achse === "x" ? { left: f.wert * zoom } : { top: f.wert * zoom }} />
              ))}
              {anzeigeRechteck && ziehen && ziehen.art !== "neu" && (
                <span className="zv-pd-mass" style={{ left: anzeigeRechteck.x * zoom, top: (anzeigeRechteck.y + anzeigeRechteck.h) * zoom + 4 }}>
                  {ziehen.art === "groesse"
                    ? `${String(anzeigeRechteck.b).replace(".", ",")} × ${String(anzeigeRechteck.h).replace(".", ",")} mm`
                    : `x ${String(anzeigeRechteck.x).replace(".", ",")} · y ${String(anzeigeRechteck.y).replace(".", ",")} mm`}
                </span>
              )}
              {gewaehlt.length > 1 && (
                <div
                  className="zv-pd-leiste"
                  style={{ left: Math.min(...gewaehlt.map((x) => x.x)) * zoom, top: Math.max(0, Math.min(...gewaehlt.map((x) => x.y)) * zoom - 40) }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span>{gewaehlt.length} ausgewählt</span>
                  <button type="button" onClick={() => ausrichten("links")}>links</button>
                  <button type="button" onClick={() => ausrichten("rechts")}>rechts</button>
                  <button type="button" onClick={() => ausrichten("oben")}>oben</button>
                  <button type="button" onClick={() => ausrichten("unten")}>unten</button>
                  <button type="button" onClick={() => ausrichten("verteilenH")}>waagrecht verteilen</button>
                  <button type="button" onClick={() => ausrichten("verteilenV")}>senkrecht verteilen</button>
                  <button type="button" onClick={() => ausrichten("breite")}>gleiche Breite</button>
                  <button type="button" onClick={duplizieren}>duplizieren</button>
                </div>
              )}
            </div>
          </div>

          <aside className="zv-pd-eigenschaften" aria-label="Eigenschaften">
            {eins ? (
              <Eigenschaften el={eins} felder={felder} zielgruppe={zielgruppe} ueberlauf={passtNicht.has(eins.id)} laengste={laengste} onSetze={(t) => setze(eins.id, t)} />
            ) : gewaehlt.length > 1 ? (
              <p className="zv-sub">{gewaehlt.length} Bausteine ausgewählt. Ausrichten über die Leiste auf dem Blatt; Pfeiltasten verschieben alle.</p>
            ) : (
              <div className="zv-pd-seiteninfo">
                <h3>{seite === "erste" ? "Erste Seite" : "Folgeseiten"}</h3>
                <p className="zv-sub">
                  {seite === "erste"
                    ? "So sieht Seite 1 aus. Reicht der Fließbereich nicht, geht es auf den Folgeseiten weiter."
                    : "Gilt für jede weitere Seite, auch für den Anhang „Fortsetzung“. Meist: kleiner Kopf, Fließbereich, Fuß."}
                </p>
              </div>
            )}
            {eins && (
              <div className="zv-aktionen-reihe zv-pd-el-aktionen">
                <button type="button" className="zv-icon-btn" title="Nach vorn" aria-label="Nach vorn" onClick={() => ebene(eins.id, 1)}>
                  <IVerschiebenHoch />
                </button>
                <button type="button" className="zv-icon-btn" title="Nach hinten" aria-label="Nach hinten" onClick={() => ebene(eins.id, -1)}>
                  <IVerschiebenRunter />
                </button>
                <button type="button" className="zv-icon-btn" title={eins.gesperrt ? "Entsperren" : "Sperren"} aria-label={eins.gesperrt ? "Entsperren" : "Sperren"} onClick={() => setze(eins.id, { gesperrt: !eins.gesperrt })}>
                  {eins.gesperrt ? <ISperre /> : <IEntsperrt />}
                </button>
                <button type="button" className="zv-icon-btn" title="Duplizieren (⌘D)" aria-label="Duplizieren" disabled={eins.art === "fluss"} onClick={duplizieren}>
                  <IKopieren />
                </button>
                <button type="button" className="zv-icon-btn" title="Entfernen (Entf)" aria-label="Entfernen" onClick={entfernen}>
                  <ILoeschen />
                </button>
              </div>
            )}

            <div className="zv-pd-pruefung">
              <div className="zv-gruppenlabel">Passt es?</div>
              <div className="zv-segmented" role="group" aria-label="Prüfen mit">
                <button type="button" className={!laengste ? "active" : ""} aria-pressed={!laengste} onClick={() => setLaengste(false)}>
                  Beispieldaten
                </button>
                <button type="button" className={laengste ? "active" : ""} aria-pressed={laengste} onClick={() => setLaengste(true)}>
                  längste Werte
                </button>
              </div>
              {laengste && <span className="zv-sub-inline">Längen aus den letzten 50 Protokollen, Inhalt durch Beispieltext ersetzt.</span>}
              {pruefFehler ? (
                <div className="zv-hinweis zv-hinweis-fehler">
                  <IFehler />
                  {pruefFehler}
                </div>
              ) : pruefung && pruefung.ueberlauf.length === 0 ? (
                <div className="zv-hinweis zv-hinweis-erfolg" data-testid="pd-passt">
                  <IErfolg />
                  Alles passt. Das PDF hat {pruefung.seiten} Seite{pruefung.seiten === 1 ? "" : "n"}.
                </div>
              ) : pruefung ? (
                <div className="zv-hinweis zv-hinweis-achtung" data-testid="pd-passt-nicht">
                  <IFehler />
                  {pruefung.ueberlauf.length} Baustein{pruefung.ueberlauf.length > 1 ? "e passen" : " passt"} nicht. Der Rest steht dann im Anhang „Fortsetzung“ ({pruefung.seiten} Seiten).
                </div>
              ) : null}
              {hinweise.map((h) => (
                <button key={h.text} type="button" className="zv-pd-hinweis" disabled={h.ids.length === 0} onClick={() => setAuswahl(h.ids)}>
                  {h.text}
                </button>
              ))}
            </div>

            <div className="zv-pd-ebenen">
              <div className="zv-gruppenlabel">
                <IEbenen /> Ebenen <span className="zv-sub-inline">oben liegt vorn</span>
              </div>
              <ul>
                {[...elemente].reverse().map((el) => (
                  <li key={el.id}>
                    <button
                      type="button"
                      className={`zv-pd-ebene${auswahl.includes(el.id) ? " active" : ""}`}
                      onClick={(e) => setAuswahl(e.shiftKey ? (auswahl.includes(el.id) ? auswahl.filter((x) => x !== el.id) : [...auswahl, el.id]) : [el.id])}
                    >
                      <span>{ebenenName(el, feldMap, beispiel)}</span>
                      {passtNicht.has(el.id) && <span className="zv-pd-ebene-warn">passt nicht</span>}
                      {el.gesperrt && <ISperre />}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="zv-sub-inline zv-pd-tasten">
                Pfeiltasten: 1 Rasterschritt, mit ⇧ 5 mm · ⌥ beim Ziehen: ohne Raster · ⌘D duplizieren · ⌘Z rückgängig · Entf entfernen
              </p>
            </div>
          </aside>
        </div>
      </div>

      {ziehNeu && (
        <div className="zv-pd-geist" style={{ left: ziehNeu.cx + 8, top: ziehNeu.cy + 8, width: ziehNeu.vorlage.b * zoom, height: ziehNeu.vorlage.h * zoom }}>
          {PDF_FREI_ART_LABEL[ziehNeu.vorlage.art]}
          {ziehNeu.vorlage.art === "feld" ? `: ${feldMap.get(ziehNeu.vorlage.feld)?.label ?? ""}` : ""}
        </div>
      )}

      {vorschau && (
        <div
          className="zv-pd-vorschau-scrim"
          onClick={() => {
            URL.revokeObjectURL(vorschau);
            setVorschau(null);
          }}
        >
          <div className="zv-pd-vorschau" onClick={(e) => e.stopPropagation()}>
            <div className="zv-modal-kopf">
              <h3>PDF-Vorschau (Beispieldaten)</h3>
              <button
                type="button"
                className="zv-icon-btn"
                aria-label="Schließen"
                onClick={() => {
                  URL.revokeObjectURL(vorschau);
                  setVorschau(null);
                }}
              >
                <IAbbrechen />
              </button>
            </div>
            <iframe title="PDF-Vorschau" src={`${vorschau}#toolbar=0&navpanes=0&view=FitH`} />
          </div>
        </div>
      )}
    </div>
  );
}

function ebenenName(el: PdfFreiBaustein, feldMap: Map<string, FeldInfo>, beispiel: Record<string, string>): string {
  if (el.art === "feld" || el.art === "ankreuz") return feldMap.get(el.feld)?.label ?? "Feld (fehlt)";
  if (el.art === "text") {
    // Mit Beispielwerten statt "{traeger.name}": so erkennt man den Baustein wieder.
    const t = pdfTextZeilen(el.text, { ...beispiel, seite: "1", seiten: "2" })[0]?.text.trim() ?? "";
    return t ? `„${t.length > 28 ? `${t.slice(0, 27)}…` : t}“` : "Text";
  }
  return PDF_FREI_ART_LABEL[el.art];
}

function Eigenschaften({
  el,
  felder,
  zielgruppe,
  ueberlauf,
  laengste,
  onSetze,
}: {
  el: PdfFreiBaustein;
  felder: FeldInfo[];
  zielgruppe: PdfZielgruppe;
  ueberlauf: boolean;
  laengste: boolean;
  onSetze: (t: Partial<PdfFreiBaustein>) => void;
}) {
  const feld = felder.find((f) => f.schluessel === el.feld);
  const mitText = el.art === "text" || el.art === "feld" || el.art === "ankreuz" || el.art === "anschrift" || el.art === "unterschrift";
  const zahl = (label: string, wert: number, setze: (n: number) => void, min: number, max: number, schritt = 0.5) => (
    <label className="zv-pd-zahl">
      <span>{label}</span>
      <input
        type="number"
        value={wert}
        min={min}
        max={max}
        step={schritt}
        onChange={(e) => {
          const n = Number(e.target.value.replace(",", "."));
          if (Number.isFinite(n)) setze(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
  const seg = <T extends string>(label: string, wert: T, optionen: [T, string][], setze: (w: T) => void) => (
    <div className="zv-field">
      <span className="zv-pe-label">{label}</span>
      <div className="zv-segmented" role="group" aria-label={label}>
        {optionen.map(([w, l]) => (
          <button key={w} type="button" className={w === wert ? "active" : ""} aria-pressed={w === wert} onClick={() => setze(w)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="zv-pd-eig">
      <h3>{el.art === "feld" || el.art === "ankreuz" ? feld?.label ?? "Feld" : PDF_FREI_ART_LABEL[el.art]}</h3>
      <span className="zv-sub-inline">{el.art === "feld" || el.art === "ankreuz" ? `Feld aus dem Formular${feld ? ` · ${feld.typ.replace("_", "/")}` : ""}` : "Gestaltung"}</span>
      <span className="zv-pe-label">Position und Größe (mm)</span>
      <div className="zv-pd-vier">
        {zahl("X", el.x, (x) => onSetze({ x }), 0, 210)}
        {zahl("Y", el.y, (y) => onSetze({ y }), 0, 297)}
        {zahl("B", el.b, (b) => onSetze({ b }), 0.5, 210)}
        {zahl("H", el.h, (h) => onSetze({ h }), 0.5, 297)}
      </div>

      {(el.art === "feld" || el.art === "ankreuz") && (
        <>
          <div className="zv-field">
            <label htmlFor="pd-feld">Feld</label>
            <select id="pd-feld" value={el.feld} onChange={(e) => onSetze({ feld: e.target.value })}>
              {!feld && <option value={el.feld}>(fehlt im Formular)</option>}
              {felder.map((f) => (
                <option key={f.schluessel} value={f.schluessel} disabled={zielgruppe === "extern" && f.intern}>
                  {f.label}
                  {f.intern ? " (nur intern)" : ""}
                </option>
              ))}
            </select>
          </div>
          {seg("Beschriftung", el.beschriftung, [["darueber", "darüber"], ["links", "links daneben"], ["keine", "keine"]], (beschriftung) => onSetze({ beschriftung }))}
          {feld?.typ === "ja_nein" &&
            seg("Darstellung", el.art, [["feld", "als Wort"], ["ankreuz", "Ankreuzfelder"]] as [PdfFreiArt, string][], (art) => onSetze({ art }))}
        </>
      )}

      {el.art === "text" && (
        <div className="zv-field">
          <label htmlFor="pd-text">Text</label>
          <textarea id="pd-text" className="zv-pe-mono" rows={4} value={el.text} maxLength={4000} onChange={(e) => onSetze({ text: e.target.value })} />
          <span className="zv-sub-inline">Platzhalter wie {"{standort.telefon}"}, {"{feld.<schlüssel>}"}, {"{seite}"}. Zeile mit leerem Platzhalter entfällt. **Zeile** = fett.</span>
        </div>
      )}

      {mitText && (
        <>
          <div className="zv-pd-zwei">
            {zahl("Schrift (pt)", el.pt, (pt) => onSetze({ pt }), PDF_FREI_MIN_PT, 36)}
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={el.fett} onChange={(e) => onSetze({ fett: e.target.checked })} />
              fett
            </label>
          </div>
          {el.art !== "unterschrift" &&
            seg("Ausrichtung", el.ausrichtung, [["links", "links"], ["mitte", "Mitte"], ["rechts", "rechts"]], (ausrichtung) => onSetze({ ausrichtung }))}
        </>
      )}
      {(mitText || el.art === "linie") && el.art !== "anschrift" && el.art !== "unterschrift" && (
        <div className="zv-field">
          <span className="zv-pe-label">Farbe</span>
          <div className="zv-pd-farben" role="group" aria-label="Farbe">
            {(
              [
                ["schwarz", "Schwarz"],
                ["grau", "Grau"],
                ["akzent", "Trägerfarbe (druckfest)"],
              ] as const
            ).map(([w, l]) => (
              <button key={w} type="button" className={`zv-pd-farbknopf zv-pd-farbe-${w}${el.farbe === w ? " active" : ""}`} aria-pressed={el.farbe === w} title={l} aria-label={l} onClick={() => onSetze({ farbe: w })} />
            ))}
          </div>
          <span className="zv-sub-inline">Mehr Farben gibt es bewusst nicht: so bleibt Text auf Papier und in Kopien lesbar.</span>
        </div>
      )}
      {el.art === "flaeche" &&
        seg("Fläche", el.flaeche, [["akzent-hell", "Trägerfarbe hell"], ["akzent", "Trägerfarbe"], ["grau-hell", "Grau hell"]], (flaeche) => onSetze({ flaeche }))}
      {(el.art === "linie" || (mitText && el.rahmen !== "keiner")) && zahl("Linienstärke (pt)", el.staerke, (staerke) => onSetze({ staerke }), 0.25, 4, 0.25)}
      {mitText && el.art !== "unterschrift" && seg("Rahmen", el.rahmen, [["keiner", "keiner"], ["unten", "Linie unten"], ["kasten", "Kasten"]], (rahmen) => onSetze({ rahmen }))}

      {mitText && el.art !== "unterschrift" && (
        <div className="zv-field">
          <span className="zv-pe-label">Wenn der Text nicht passt</span>
          <span className="zv-sub-inline">Wird bis {PDF_FREI_MIN_PT} pt verkleinert. Reicht das nicht, steht der volle Text im Anhang „Fortsetzung“. Abgeschnitten wird nie.</span>
          {ueberlauf ? (
            <div className="zv-hinweis zv-hinweis-achtung">
              <IFehler />
              Passt nicht mit {laengste ? "den längsten Werten" : "den Beispieldaten"}. Kasten größer ziehen oder Schrift verkleinern.
            </div>
          ) : (
            <div className="zv-hinweis zv-hinweis-erfolg">
              <IErfolg />
              Passt mit {laengste ? "den längsten Werten" : "den Beispieldaten"}.
            </div>
          )}
        </div>
      )}
      {el.art === "fluss" && (
        <p className="zv-sub">
          Hier laufen alle nicht platzierten Felder hinein, im Feldstil aus dem Editor (Darstellung der Felder), dazu Anrede, Einleitung, Gruß und Unterschrift.
        </p>
      )}
      {el.art === "logo" && <p className="zv-sub">Zeigt das im Editor gewählte Logo, eingepasst in den Kasten.</p>}
    </div>
  );
}
