import { DragEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AccountTypDto,
  BenutzerListEintragDto,
  OrgUnitDto,
  PositionDto,
  RechtRegistryEintragDto,
} from "@zimmerakte/shared";
import { ORG_UNIT_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Seitenpanel } from "../components/Seitenpanel";
import {
  IAnpassen,
  IAnzeigenAls,
  IFehler,
  ILeerOrganigramm,
  IOrganigramm,
  IStandort,
  ITabelle,
  IVergroessern,
  IVerkleinern,
} from "../components/icons";
import { FilterMehrfachAuswahl, FilterPille } from "../components/Filterleiste";
import {
  type Knoten,
  SPALTEN_SCHRITT,
  alleKnoten,
  baueBaum,
  elternKarte,
  entferneEinheiten,
  filtereNachStandorten,
  geschwister,
  gueltigeZiele,
  istZiehbareEinheit,
  layout,
  sichtbarerBaum,
  wendeLeitungsStruktur,
  zielOptionen,
} from "./organigramm/baum";
import { AccountTypenAnsicht } from "./organigramm/AccountTypen";
import { SimulationAnsicht } from "./organigramm/SimulationAnsicht";
import { TabellenAnsicht } from "./organigramm/TabellenAnsicht";
import { KnotenBox, Verbindungen } from "./organigramm/KnotenBox";
import { EinheitPanel } from "./organigramm/EinheitPanel";
import { PositionPanel } from "./organigramm/PositionPanel";

/**
 * Organigramm-Grundansicht + Seitenpanel + Umhängen + Account-Typ-
 * Verwaltung + "Anzeigen als…" + Tabellenansicht/Export -- Organigramm-Plan,
 * Lieferreihenfolge Schritt 7/UI, damit vollstaendig.
 *
 * Umhängen geht zwei gleichwertige Wege (Organigramm-Plan: "Drag & Drop,
 * PLUS eine gleichwertige Tastatur-Alternative"): natives HTML5-Drag&Drop
 * direkt im Baum, oder im Seitenpanel "Verschieben nach…" -- ein Modal mit
 * einer <select>-Zielauswahl statt eines literalen Rechtsklick-
 * Kontextmenues. Bewusst so: ein echtes Kontextmenue ist fuer Tastatur-
 * und Screenreader-Nutzung notorisch schlecht zugaenglich, ein Modal mit
 * einer fokussierbaren Liste ist die tatsaechlich gleichwertige
 * Alternative, nicht nur eine andere Form desselben Mauswege. Beide Wege
 * nutzen dieselbe gueltigeZiele()-Funktion, damit sie nie auseinanderlaufen.
 */
export function Organigramm() {
  const [orgUnits, setOrgUnits] = useState<OrgUnitDto[]>([]);
  const [positionen, setPositionen] = useState<PositionDto[]>([]);
  const [accountTypen, setAccountTypen] = useState<AccountTypDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);
  // Schluessel statt Objekt-Referenz: nach jeder Mutation werden die Listen
  // neu geladen und der Baum neu gebaut (useMemo unten) -- eine gehaltene
  // Knoten-Referenz waere dann veraltet. Der Schluessel findet den
  // aktuellen Knoten jedes Mal frisch in der neu gebauten Liste.
  const [ausgewaehlterSchluessel, setAusgewaehlterSchluessel] = useState<string | null>(null);
  // Organisationseinheiten bekommen seit "es geht nur über die Personen"
  // (Live-Rückmeldung) keine eigene Karte mehr im Baum -- ohne diesen
  // Auswahl-Umweg gäbe es keinen Weg mehr zu EinheitPanel (Bereich/Team
  // anlegen, Position anlegen, Umbenennen/Deaktivieren, Geschwister-
  // Reihenfolge einer Einheit), weil der Klick auf die Karte bisher der
  // EINZIGE Einstieg dafür war.
  const [einheitAuswahl, setEinheitAuswahl] = useState("");
  const organisationseinheitenSortiert = useMemo(
    () => [...orgUnits].sort((a, b) => a.name.localeCompare(b.name, "de")),
    [orgUnits]
  );
  const [gezogenerSchluessel, setGezogenerSchluessel] = useState<string | null>(null);
  const [zielSchluessel, setZielSchluessel] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<"baum" | "account-typen" | "simulation" | "tabelle">("baum");
  // Registry separat und erst bei Bedarf laden (nicht im Haupt-laden()):
  // GET /rechte/registry braucht organigramm.manage-permissions, waehrend
  // der Baum selbst nur organigramm.ansehen braucht -- ein Konto ohne das
  // engere Recht soll beim blossen Oeffnen der Organigramm-Seite keinen
  // Fehlerbanner sehen, nur falls es tatsaechlich auf "Account-Typen"
  // wechselt.
  const [registry, setRegistry] = useState<RechtRegistryEintragDto[]>([]);
  const [registryFehler, setRegistryFehler] = useState<string | null>(null);

  useEffect(() => {
    if (ansicht !== "account-typen" || registry.length > 0) return;
    api
      .rechteRegistry()
      .then(setRegistry)
      .catch((err) => setRegistryFehler(err instanceof Error ? err.message : "Rechte-Übersicht konnte nicht geladen werden."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ansicht]);

  function laden() {
    return Promise.all([
      api.organigrammOrgUnits(),
      api.organigrammPositionen(),
      api.organigrammAccountTypen(),
      api.benutzerListe(),
    ])
      .then(([u, p, a, b]) => {
        setOrgUnits(u);
        setPositionen(p);
        setAccountTypen(a);
        setBenutzerListe(b);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Organigramm konnte nicht geladen werden."))
      .finally(() => setGeladen(true));
  }

  useEffect(() => {
    laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountTypNamen = useMemo(() => new Map(accountTypen.map((a) => [a.id, a.name])), [accountTypen]);

  // wurzelVoll: der VOLLSTAENDIGE Baum, Grundlage fuer Zyklenschutz
  // (gueltigeZiele), "Verschieben nach…"-Zieloptionen und die
  // Geschwister-Ermittlung -- Einklappen (kollabiert) ist eine reine
  // Anzeige-Praeferenz und darf diese Entscheidungen nicht beeinflussen
  // (siehe sichtbarerBaum()-Kommentar).
  const wurzelVoll = useMemo(() => baueBaum(orgUnits, positionen), [orgUnits, positionen]);
  const [kollabiert, setKollabiert] = useState<Set<string>>(new Set());
  const wurzelSichtbar = useMemo(
    () => (wurzelVoll ? sichtbarerBaum(wurzelVoll, kollabiert) : null),
    [wurzelVoll, kollabiert]
  );

  // wurzelAnzeige: NUR fuers Rendering/Layout (Live-Rueckmeldung: Leitungs-
  // Positionen ueber ihrer Einheit zeigen, dann gar keine Einheiten-Karten
  // mehr -- "es geht nur ueber die Personen", siehe wendeLeitungsStruktur()/
  // entferneEinheiten()). alleKnotenVoll/elternMap weiter unten bauen
  // bewusst weiterhin auf wurzelVoll auf (nicht auf diesem Zweig hier),
  // damit Drag&Drop/Geschwister/Zyklenschutz die echte Containment-
  // Struktur sehen.
  // Standortfilter (Rueckmeldung 1d0d9f97, siehe filtereNachStandorten()).
  // Solange er gesetzt ist, zeigt der Baum alles ausgeklappt: ein
  // eingeklappter Knoten oberhalb der Einrichtung wuerde sie sonst
  // verschlucken und der Filter liefe ins Leere.
  const [standortFilter, setStandortFilter] = useState<string[]>([]);
  const einrichtungen = useMemo(
    () => organisationseinheitenSortiert.filter((u) => u.typ === "einrichtung" && u.aktiv),
    [organisationseinheitenSortiert]
  );
  // Ein inzwischen deaktivierter/geloeschter Standort darf nicht unsichtbar weiterfiltern.
  const standortFilterGueltig = useMemo(
    () => standortFilter.filter((id) => einrichtungen.some((u) => u.id === id)),
    [standortFilter, einrichtungen]
  );
  const gefiltert = standortFilterGueltig.length > 0;
  const wurzelAnzeige = useMemo(() => {
    const basis = gefiltert ? wurzelVoll : wurzelSichtbar;
    if (!basis) return null;
    const struktur = wendeLeitungsStruktur(basis);
    const auswahl = gefiltert ? filtereNachStandorten(struktur, new Set(standortFilterGueltig), orgUnits) : struktur;
    return auswahl ? entferneEinheiten(auswahl) : null;
  }, [gefiltert, wurzelVoll, wurzelSichtbar, standortFilterGueltig, orgUnits]);

  const { breite, hoehe, yJeTiefe, knoten } = useMemo(() => {
    if (!wurzelAnzeige) return { breite: 0, hoehe: 0, yJeTiefe: [] as number[], knoten: [] as Knoten[] };
    const { breiteSpalten, yJeTiefe, gesamtHoehe } = layout(wurzelAnzeige);
    return {
      breite: Math.max(breiteSpalten, 1) * SPALTEN_SCHRITT,
      hoehe: gesamtHoehe,
      yJeTiefe,
      knoten: alleKnoten(wurzelAnzeige),
    };
  }, [wurzelAnzeige]);

  const alleKnotenVoll = useMemo(() => (wurzelVoll ? alleKnoten(wurzelVoll) : []), [wurzelVoll]);
  const elternMap = useMemo(() => (wurzelVoll ? elternKarte(wurzelVoll) : new Map<string, Knoten>()), [wurzelVoll]);

  const ausgewaehlterKnoten = alleKnotenVoll.find((k) => k.schluessel === ausgewaehlterSchluessel) ?? null;
  const orgUnitNamen = useMemo(() => new Map(orgUnits.map((u) => [u.id, u.name])), [orgUnits]);

  const gezogenerKnoten = alleKnotenVoll.find((k) => k.schluessel === gezogenerSchluessel) ?? null;
  const gezogenesEltern = gezogenerKnoten ? elternMap.get(gezogenerKnoten.schluessel) ?? null : null;
  const gueltigeZielSchluessel = useMemo(
    () => (gezogenerKnoten ? gueltigeZiele(gezogenerKnoten, alleKnotenVoll) : new Set<string>()),
    [gezogenerKnoten, alleKnotenVoll]
  );

  const verschiebenZiele = useMemo(() => {
    if (!ausgewaehlterKnoten) return [];
    if (ausgewaehlterKnoten.art === "einheit" && !istZiehbareEinheit(ausgewaehlterKnoten.einheit!)) return [];
    return zielOptionen(ausgewaehlterKnoten, alleKnotenVoll, orgUnitNamen);
  }, [ausgewaehlterKnoten, alleKnotenVoll, orgUnitNamen]);

  // Geschwister-Reihenfolge des ausgewaehlten Knotens -- Grundlage fuer die
  // "Nach links/rechts"-Knoepfe im Seitenpanel (Tastatur-/Klick-
  // Alternative zum Drag, siehe geordneteGeschwister()/beiDrop() unten).
  // Weitere-Zuordnung-Karten haben keinen Eltern-Eintrag in elternMap
  // (sie haengen direkt, aber ausserhalb der normalen Geschwister-Zaehlung)
  // -- fuer sie bleibt das Ergebnis bewusst null.
  const geschwisterDesAusgewaehlten = useMemo(() => {
    if (!ausgewaehlterKnoten || ausgewaehlterKnoten.istWeitereZuordnung) return null;
    const eltern = elternMap.get(ausgewaehlterKnoten.schluessel);
    if (!eltern) return null;
    const liste = geschwister(eltern);
    const index = liste.findIndex((k) => k.schluessel === ausgewaehlterKnoten.schluessel);
    if (index === -1) return null;
    return { eltern, liste, index };
  }, [ausgewaehlterKnoten, elternMap]);

  async function verschiebenNachId(quelle: Knoten, zielId: string) {
    if (quelle.art === "einheit") {
      await api.organigrammOrgUnitAktualisieren(quelle.einheit!.id, { parentId: zielId });
    } else {
      await api.organigrammPositionAktualisieren(quelle.position!.id, { parentPositionId: zielId });
    }
    await laden();
  }

  /** Persistiert eine neue Geschwister-Reihenfolge -- welcher Endpunkt greift, hängt von der ART des bewegten Knotens ab, nicht vom Elternknoten (eine Einheit kann sowohl Unter-Einheiten als auch Positionen als Kinder haben). */
  async function reihenfolgeSpeichern(gezogen: Knoten, eltern: Knoten, geordnet: Knoten[]) {
    const ids = geordnet.map((k) => (k.art === "einheit" ? k.einheit!.id : k.position!.id));
    if (gezogen.art === "einheit") {
      await api.organigrammOrgUnitsReihenfolge(eltern.einheit!.id, ids);
    } else {
      const orgUnitId = eltern.art === "einheit" ? eltern.einheit!.id : eltern.position!.orgUnitId;
      const parentPositionId = eltern.art === "position" ? eltern.position!.id : null;
      await api.organigrammPositionenReihenfolge(orgUnitId, parentPositionId, ids);
    }
  }

  async function geschwisterVerschieben(richtung: "links" | "rechts") {
    if (!geschwisterDesAusgewaehlten || !ausgewaehlterKnoten) return;
    const { eltern, liste, index } = geschwisterDesAusgewaehlten;
    const zielIndex = richtung === "links" ? index - 1 : index + 1;
    if (zielIndex < 0 || zielIndex >= liste.length) return;
    const neu = [...liste];
    [neu[index], neu[zielIndex]] = [neu[zielIndex], neu[index]];
    try {
      await reihenfolgeSpeichern(ausgewaehlterKnoten, eltern, neu);
      await laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Reihenfolge konnte nicht gespeichert werden.");
    }
  }

  function istGeschwisterVonGezogenem(ziel: Knoten): boolean {
    if (!gezogenerKnoten || !gezogenesEltern || ziel.schluessel === gezogenerKnoten.schluessel) return false;
    if (ziel.art !== gezogenerKnoten.art || ziel.istWeitereZuordnung) return false;
    return elternMap.get(ziel.schluessel) === gezogenesEltern;
  }

  const [einfuegeZiel, setEinfuegeZiel] = useState<{ schluessel: string; an: "vor" | "nach" } | null>(null);

  function beiDragOver(e: DragEvent<HTMLDivElement>, ziel: Knoten) {
    if (istGeschwisterVonGezogenem(ziel)) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const mitte = rect.left + rect.width / 2;
      setEinfuegeZiel({ schluessel: ziel.schluessel, an: e.clientX < mitte ? "vor" : "nach" });
      setZielSchluessel(null);
      return;
    }
    setEinfuegeZiel(null);
    if (!gueltigeZielSchluessel.has(ziel.schluessel)) return;
    e.preventDefault();
    setZielSchluessel(ziel.schluessel);
  }

  async function beiDrop(e: DragEvent<HTMLDivElement>, ziel: Knoten) {
    e.preventDefault();
    const quelle = gezogenerKnoten;
    const eltern = gezogenesEltern;
    const einfuegeAktuell = einfuegeZiel;
    setGezogenerSchluessel(null);
    setZielSchluessel(null);
    setEinfuegeZiel(null);
    if (!quelle) return;
    try {
      if (einfuegeAktuell && einfuegeAktuell.schluessel === ziel.schluessel && eltern) {
        const aktuelleGeschwister = geschwister(eltern);
        const ohneGezogen = aktuelleGeschwister.filter((k) => k.schluessel !== quelle.schluessel);
        const zielIndex = ohneGezogen.findIndex((k) => k.schluessel === ziel.schluessel);
        const einfuegeIndex = einfuegeAktuell.an === "vor" ? zielIndex : zielIndex + 1;
        const geordnet = [...ohneGezogen];
        geordnet.splice(einfuegeIndex, 0, quelle);
        await reihenfolgeSpeichern(quelle, eltern, geordnet);
        await laden();
        return;
      }
      if (!gueltigeZielSchluessel.has(ziel.schluessel)) return;
      const zielId = ziel.art === "einheit" ? ziel.einheit!.id : ziel.position!.id;
      await verschiebenNachId(quelle, zielId);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Verschieben nicht möglich.");
    }
  }

  function beiDragEnd() {
    setGezogenerSchluessel(null);
    setZielSchluessel(null);
    setEinfuegeZiel(null);
  }

  function kollabierenUmschalten(schluessel: string) {
    setKollabiert((alt) => {
      const neu = new Set(alt);
      if (neu.has(schluessel)) neu.delete(schluessel);
      else neu.add(schluessel);
      return neu;
    });
  }

  // Zoom/Fit-to-view (Live-Rueckmeldung: Standardansicht immer vollstaendig
  // sichtbar). leinwandAussenRef misst die tatsaechlich verfuegbare Flaeche
  // des Scroll-Containers (.zv-organigramm-scroll) -- die Zoomstufe wird
  // bei JEDER Aenderung der Baumgroesse neu eingepasst, ein manuelles
  // Herein-/Herauszoomen gilt also bis zum naechsten Laden (z.B. nach
  // einer Bearbeitung), dann wieder "Einpassen" als Standard.
  const leinwandAussenRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 2;

  // Randlos/vollbild (Live-Rueckmeldung): keine feste CSS-Hoehe mehr --
  // einpassen() vermisst bei jedem Aufruf neu, wie viel Platz bis zum
  // unteren Seitenrand frei ist, und setzt ihn als inline style. Das
  // passiert hier per JS statt per CSS calc(100vh - X), weil X von der
  // tatsaechlichen Flussposition abhaengt (z.B. verschiebt eine
  // Fehlermeldung ueber dem Baum alles nach unten).
  function einpassen() {
    const el = leinwandAussenRef.current;
    if (!el) return;
    const oben = el.getBoundingClientRect().top;
    el.style.height = `${Math.max(360, window.innerHeight - oben - 24)}px`;
    if (breite === 0 || hoehe === 0) return;
    const passend = Math.min(1, el.clientWidth / breite, el.clientHeight / hoehe);
    setZoom(Math.max(ZOOM_MIN, passend));
  }

  useEffect(() => {
    einpassen();
    window.addEventListener("resize", einpassen);
    return () => window.removeEventListener("resize", einpassen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breite, hoehe]);

  function zoomAendern(faktor: number) {
    setZoom((alt) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((alt + faktor) * 100) / 100)));
  }

  // Mausrad/Trackpad-Zoom (Live-Rueckmeldung), um den Cursor verankert --
  // sonst "springt" der Baum bei jedem Zoomschritt zur Fensterecke. Echter
  // (nicht-passiver) DOM-Listener statt React onWheel: React haengt
  // wheel/touch-Handler standardmaessig passiv ein (Scroll-Performance),
  // wo e.preventDefault() wirkungslos waere und der Container trotz
  // Zoom-Absicht weiterscrollen wuerde. zoomRef haelt den aktuellen Zoom
  // fuer den Listener bereit, ohne ihn bei jedem Tick neu zu binden.
  // pendingScrollRef + der useLayoutEffect direkt darunter setzen
  // scrollLeft/-Top SYNCHRON nach der Zoom-Aenderung, aber vor dem
  // naechsten Bildaufbau -- sonst waere kurz der alte Ausschnitt mit der
  // neuen Zoomstufe sichtbar (ein sichtbarer Sprung).
  //
  // ctrlKey unterscheidet Zoomen von Schwenken (Live-Rueckmeldung: "frei
  // bewegen" in alle Richtungen zusaetzlich zum Zoom) -- Browser setzen
  // ctrlKey=true bei einer Trackpad-Pinch-Geste UND bei Strg+Mausrad,
  // waehrend normales Zwei-Finger-Scrollen (Trackpad) oder ein einfaches
  // Mausrad OHNE Strg kein ctrlKey mitbringen. Das ist dieselbe Konvention
  // wie in Google Maps/Figma/Miro: Pinch=Zoom, Scrollen=Schwenken.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const el = leinwandAussenRef.current;
    if (!el) return;
    function beiWheel(e: WheelEvent) {
      e.preventDefault();
      if (!e.ctrlKey) {
        // Schwenken: deltaX/-Y kommen bei einer Trackpad-Zweifinger-Geste
        // bereits in beide Richtungen, bei einem reinen Mausrad meist nur
        // vertikal (deltaX bleibt dann 0) -- beides direkt uebernehmen.
        el!.scrollLeft += e.deltaX;
        el!.scrollTop += e.deltaY;
        return;
      }
      const rect = el!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const altZoom = zoomRef.current;
      const inhaltX = (el!.scrollLeft + cursorX) / altZoom;
      const inhaltY = (el!.scrollTop + cursorY) / altZoom;
      // Multiplikativ statt additiv: fuehlt sich bei Mausrad-Einzelschritten
      // (deltaY ~100) genauso richtig an wie bei den vielen kleinen
      // deltaY-Werten einer Trackpad-Geste.
      const faktor = Math.exp(-e.deltaY * 0.0015);
      const neuerZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, altZoom * faktor));
      pendingScrollRef.current = {
        left: inhaltX * neuerZoom - cursorX,
        top: inhaltY * neuerZoom - cursorY,
      };
      setZoom(neuerZoom);
    }
    el.addEventListener("wheel", beiWheel, { passive: false });
    return () => el.removeEventListener("wheel", beiWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breite, hoehe]);

  useLayoutEffect(() => {
    const anker = pendingScrollRef.current;
    if (!anker) return;
    pendingScrollRef.current = null;
    const el = leinwandAussenRef.current;
    if (!el) return;
    el.scrollLeft = anker.left;
    el.scrollTop = anker.top;
  }, [zoom]);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Organigramm</h2>
      </div>

      <div className="zv-segmented" role="radiogroup" aria-label="Ansicht" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "baum"}
          className={ansicht === "baum" ? "active" : ""}
          onClick={() => setAnsicht("baum")}
        >
          <IOrganigramm />
          Baum
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "account-typen"}
          className={ansicht === "account-typen" ? "active" : ""}
          onClick={() => setAnsicht("account-typen")}
        >
          <IAnpassen />
          Account-Typen
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "simulation"}
          className={ansicht === "simulation" ? "active" : ""}
          onClick={() => setAnsicht("simulation")}
        >
          <IAnzeigenAls />
          Anzeigen als…
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "tabelle"}
          className={ansicht === "tabelle" ? "active" : ""}
          onClick={() => setAnsicht("tabelle")}
        >
          <ITabelle />
          Tabelle
        </button>
      </div>

      {ansicht === "account-typen" ? (
        <>
          {registryFehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {registryFehler}
            </div>
          )}
          <AccountTypenAnsicht accountTypen={accountTypen} registry={registry} onAktualisiert={laden} />
        </>
      ) : ansicht === "simulation" ? (
        <SimulationAnsicht benutzerListe={benutzerListe} positionen={positionen} orgUnitNamen={orgUnitNamen} />
      ) : ansicht === "tabelle" ? (
        <TabellenAnsicht
          orgUnits={orgUnits}
          positionen={positionen}
          accountTypNamen={accountTypNamen}
          orgUnitNamen={orgUnitNamen}
        />
      ) : (
        <>
          <p className="zv-sub" style={{ marginTop: -8, marginBottom: 16 }}>
            Positionen dieses Trägers -- Organisationseinheiten erscheinen nicht als eigene Karte, eine Leitungsposition
            steht stattdessen über der Einheit, die sie verantwortet. Durchgezogener Rahmen: Linienposition.
            Gestrichelter Rahmen: Stabsstelle (kein automatischer Zuständigkeitsbereich). Namen erscheinen nur mit dem
            Recht „Personendaten sehen" -- sonst nur die Anzahl der besetzten Plätze. Klick auf einen Knoten zeigt
            Details und Aktionen.
          </p>

          {einrichtungen.length > 0 && (
            <div className="zv-filterleiste" role="search" aria-label="Organigramm filtern">
              <FilterPille
                icon={<IStandort />}
                label="Standort"
                wert={
                  gefiltert
                    ? `: ${standortFilterGueltig.length === 1 ? einrichtungen.find((u) => u.id === standortFilterGueltig[0])!.name : `${standortFilterGueltig.length} gewählt`}`
                    : null
                }
                onEntfernen={() => setStandortFilter([])}
              >
                {() => (
                  <FilterMehrfachAuswahl
                    optionen={einrichtungen.map((u) => ({ wert: u.id, label: u.name }))}
                    gewaehlt={standortFilterGueltig}
                    onAendern={setStandortFilter}
                  />
                )}
              </FilterPille>
            </div>
          )}

          {organisationseinheitenSortiert.length > 0 && (
            <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
              <select
                aria-label="Organisationseinheit bearbeiten"
                value={einheitAuswahl}
                onChange={(e) => {
                  const id = e.target.value;
                  setEinheitAuswahl("");
                  if (id) setAusgewaehlterSchluessel(`u:${id}`);
                }}
              >
                <option value="">Organisationseinheit bearbeiten…</option>
                {organisationseinheitenSortiert.map((u) => (
                  <option key={u.id} value={u.id}>
                    {ORG_UNIT_TYP_LABEL[u.typ]}: {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!wurzelVoll && geladen && !fehler ? (
            <Leerzustand icon={ILeerOrganigramm}>Noch keine Organisationsstruktur angelegt.</Leerzustand>
          ) : gefiltert && !wurzelAnzeige ? (
            <Leerzustand icon={ILeerOrganigramm}>Für diesen Standort ist im Organigramm niemand eingetragen.</Leerzustand>
          ) : wurzelSichtbar ? (
            <>
              <div className="zv-organigramm-zoom-leiste">
                <button className="zv-icon-btn" type="button" onClick={() => zoomAendern(-0.1)} aria-label="Verkleinern" title="Verkleinern">
                  <IVerkleinern />
                </button>
                <span className="zv-organigramm-zoom-wert">{Math.round(zoom * 100)}%</span>
                <button className="zv-icon-btn" type="button" onClick={() => zoomAendern(0.1)} aria-label="Vergrößern" title="Vergrößern">
                  <IVergroessern />
                </button>
                <button className="zv-btn zv-btn-still zv-btn-klein" type="button" onClick={einpassen}>
                  Einpassen
                </button>
              </div>
              <div className="zv-organigramm-scroll" ref={leinwandAussenRef}>
                <div style={{ width: breite * zoom, height: hoehe * zoom }}>
                  <div
                    className="zv-organigramm-leinwand"
                    style={{ width: breite, height: hoehe, transform: `scale(${zoom})` }}
                  >
                    <Verbindungen knoten={knoten} yJeTiefe={yJeTiefe} />
                    {knoten.map((k) => (
                      <KnotenBox
                        key={k.schluessel}
                        knoten={k}
                        yJeTiefe={yJeTiefe}
                        accountTypNamen={accountTypNamen}
                        ausgewaehlt={k.schluessel === ausgewaehlterSchluessel}
                        onOeffnen={() => setAusgewaehlterSchluessel(k.schluessel)}
                        ziehtGerade={k.schluessel === gezogenerSchluessel}
                        istZielMoeglich={gezogenerSchluessel !== null && gueltigeZielSchluessel.has(k.schluessel)}
                        istZielAktuell={k.schluessel === zielSchluessel}
                        einfuegeAn={einfuegeZiel?.schluessel === k.schluessel ? einfuegeZiel.an : null}
                        onDragStart={() => setGezogenerSchluessel(k.schluessel)}
                        onDragOver={(e) => beiDragOver(e, k)}
                        onDrop={(e) => beiDrop(e, k)}
                        onDragEnd={beiDragEnd}
                        onKollabierenUmschalten={
                          !gefiltert && (k.kinder.length > 0 || k.versteckteNachkommen) ? () => kollabierenUmschalten(k.schluessel) : null
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <Seitenpanel offen={ausgewaehlterKnoten !== null} onSchliessen={() => setAusgewaehlterSchluessel(null)}>
            {ausgewaehlterKnoten?.art === "einheit" && ausgewaehlterKnoten.einheit && (
              <EinheitPanel
                einheit={ausgewaehlterKnoten.einheit}
                positionenInEinheit={positionen.filter((p) => p.orgUnitId === ausgewaehlterKnoten.einheit!.id)}
                accountTypen={accountTypen}
                verschiebenZiele={verschiebenZiele}
                aufVerschieben={(zielId) => verschiebenNachId(ausgewaehlterKnoten, zielId)}
                geschwister={geschwisterDesAusgewaehlten}
                aufGeschwisterVerschieben={geschwisterVerschieben}
                onAktualisiert={laden}
              />
            )}
            {ausgewaehlterKnoten?.art === "position" && ausgewaehlterKnoten.position && (
              <PositionPanel
                position={ausgewaehlterKnoten.position}
                accountTypNamen={accountTypNamen}
                benutzerListe={benutzerListe}
                orgUnits={orgUnits}
                orgUnitNamen={orgUnitNamen}
                positionen={positionen}
                verschiebenZiele={verschiebenZiele}
                aufVerschieben={(zielId) => verschiebenNachId(ausgewaehlterKnoten, zielId)}
                istWeitereZuordnung={ausgewaehlterKnoten.istWeitereZuordnung ?? false}
                geschwister={geschwisterDesAusgewaehlten}
                aufGeschwisterVerschieben={geschwisterVerschieben}
                onAktualisiert={laden}
              />
            )}
          </Seitenpanel>
        </>
      )}
    </div>
  );
}
