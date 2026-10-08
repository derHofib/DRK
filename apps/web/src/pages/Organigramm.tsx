import {
  CSSProperties,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AccountTypDto,
  BenutzerListEintragDto,
  BesetzungDto,
  OrgUnitDto,
  PositionDto,
  RechtRegistryEintragDto,
  SimulationZelleDto,
} from "@zimmerakte/shared";
import { ORG_UNIT_TYP_LABEL, POSITION_TYP_LABEL, RECHT_HERKUNFT_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { Seitenpanel } from "../components/Seitenpanel";
import {
  IAbbrechen,
  IAnpassen,
  IAnzeigenAls,
  IAufklappen,
  IAuszug,
  IBearbeiten,
  IBereichTeam,
  IDeaktivieren,
  IEinziehen,
  IFehler,
  IHerunterladen,
  ILeerOrganigramm,
  INeu,
  IOrganigramm,
  IPosition,
  ISpeichern,
  IStabsstelle,
  ITabelle,
  ITraeger,
  IVergroessern,
  IVerkleinern,
  IVerknuepft,
  IVerschieben,
  IVerschiebenLinks,
  IVerschiebenRechts,
  IZiehen,
  IZuklappen,
} from "../components/icons";

/**
 * Ein Knoten im Organigramm -- entweder eine Organisationseinheit oder eine
 * Position. Beide Arten stehen bewusst im selben Baum (nicht zwei getrennte
 * Visualisierungen): eine Position haengt immer unter der Einheit, zu der
 * sie gehoert (org_unit_id), zusaetzlich -- wenn gesetzt -- unter einer
 * anderen Position derselben Einheit (parent_position_id), fuer eine lokale
 * Berichtshierarchie innerhalb der Einheit (z.B. Teamleitung ueber
 * Mitarbeiter-Positionen im selben Team).
 */
interface Knoten {
  schluessel: string;
  art: "einheit" | "position";
  einheit?: OrgUnitDto;
  position?: PositionDto;
  kinder: Knoten[];
  tiefe: number;
  x: number;
  /**
   * true fuer die zusaetzliche Karte einer Linienposition unter einer
   * WEITEREN Organisationseinheit (Migration 0047, Mehrfachzuordnung --
   * z.B. Einrichtungsleitung mit zwei Einrichtungen). Diese Karte hat keine
   * eigene Berichtslinie (parent_position_id bezieht sich nur auf die
   * Heimat-Einheit) und ist bewusst weder zieh- noch Reihenfolge-bar (siehe
   * istZiehbar()/geschwister()) -- die Reihenfolge-Spalte gehoert zur
   * Position als Ganzes, nicht zu einem einzelnen weiteren Auftrittsort.
   */
  istWeitereZuordnung?: boolean;
  /** Nur gesetzt, wenn der Knoten wegen Einklappen (kollabiert-Set) seine Kinder verbirgt. */
  versteckteNachkommen?: number;
}

/**
 * parentPositionId, die auf eine Position AUSSERHALB der eigenen Einheit
 * zeigt, wird hier bewusst ignoriert (die Position haengt dann direkt unter
 * ihrer eigenen Einheit) -- die uebergeordnete Einheit ist im Baum ohnehin
 * schon verschachtelt sichtbar, eine zusaetzliche Verbindung quer durch den
 * Baum wuerde im einfachen Ebenen-Layout (s.u.) zu Ueberschneidungen
 * zwischen Teilbaeumen fuehren. Eine spaetere Drag&Drop-Ansicht kann das
 * bei Bedarf genauer darstellen.
 */
function baueBaum(orgUnits: OrgUnitDto[], positionen: PositionDto[]): Knoten | null {
  const einheitKnoten = new Map<string, Knoten>();
  for (const u of orgUnits) {
    einheitKnoten.set(u.id, { schluessel: `u:${u.id}`, art: "einheit", einheit: u, kinder: [], tiefe: 0, x: 0 });
  }
  let wurzel: Knoten | null = null;
  for (const u of orgUnits) {
    const knoten = einheitKnoten.get(u.id)!;
    if (u.parentId && einheitKnoten.has(u.parentId)) {
      einheitKnoten.get(u.parentId)!.kinder.push(knoten);
    } else {
      wurzel = knoten;
    }
  }
  if (!wurzel) return null;

  const positionenJeEinheit = new Map<string, PositionDto[]>();
  for (const p of positionen) {
    const liste = positionenJeEinheit.get(p.orgUnitId) ?? [];
    liste.push(p);
    positionenJeEinheit.set(p.orgUnitId, liste);
  }

  for (const [orgUnitId, liste] of positionenJeEinheit) {
    const einheit = einheitKnoten.get(orgUnitId);
    if (!einheit) continue;
    const posKnoten = new Map<string, Knoten>();
    for (const p of liste) {
      posKnoten.set(p.id, { schluessel: `p:${p.id}`, art: "position", position: p, kinder: [], tiefe: 0, x: 0 });
    }
    for (const p of liste) {
      const knoten = posKnoten.get(p.id)!;
      const elternId = p.parentPositionId;
      if (elternId && posKnoten.has(elternId)) {
        posKnoten.get(elternId)!.kinder.push(knoten);
      } else {
        einheit.kinder.push(knoten);
      }
    }
  }

  // Weitere Organisationseinheiten (Mehrfachzuordnung, Migration 0047):
  // zusaetzliche, eigenstaendige Karten direkt unter der jeweils anderen
  // Einheit -- ein eigener Schluessel (nicht `p:${id}`), damit sich die
  // Heimat-Karte und ihre weiteren Auftrittsorte im Baum unterscheiden
  // lassen (istWeitereZuordnung, siehe Knoten-Kommentar oben).
  for (const p of positionen) {
    for (const weitereId of p.weitereOrgUnitIds) {
      const einheit = einheitKnoten.get(weitereId);
      if (!einheit) continue;
      einheit.kinder.push({
        schluessel: `p:${p.id}:weiter:${weitereId}`,
        art: "position",
        position: p,
        kinder: [],
        tiefe: 0,
        x: 0,
        istWeitereZuordnung: true,
      });
    }
  }

  return wurzel;
}

/**
 * Liefert einen flachen Klon des Baums, in dem jeder kollabierte Knoten
 * (siehe Organigramm(): kollabiert-Set) seine Kinder fuers Layout/Rendering
 * verliert -- die Originaldaten (wurzelVoll) bleiben unangetastet, damit
 * Zyklenschutz/"Verschieben nach…"-Zieloptionen weiterhin den VOLLEN Baum
 * sehen (Einklappen ist eine reine Anzeige-Praeferenz, keine
 * Struktur-Aenderung).
 */
function sichtbarerBaum(wurzel: Knoten, kollabiert: Set<string>): Knoten {
  function klon(k: Knoten): Knoten {
    if (kollabiert.has(k.schluessel) && k.kinder.length > 0) {
      return { ...k, kinder: [], versteckteNachkommen: alleKnoten(k).length - 1 };
    }
    return { ...k, kinder: k.kinder.map(klon) };
  }
  return klon(wurzel);
}

/**
 * Live-Rueckmeldung: "unter der Karte Träger den Geschäftsführer, darunter
 * alles andere" / "unter der Einrichtungsleitung die Häuser" -- eine
 * fuehrende Position (Linie, kein parentPositionId, Heimat-Einheit = die
 * aktuelle Einheit) soll in der ZEICHNUNG ueber ihrer Einheit stehen statt
 * darunter, mit der Einheit (und ihren per "weitere Einheiten" verknuepften
 * Schwestereinheiten) als Kind-Karten.
 *
 * Reine ANZEIGE-Transformation, bewusst NUR auf den Render-Pfad angewendet
 * (wurzelSichtbar -> wurzelAnzeige in Organigramm()), NICHT auf wurzelVoll:
 * Geschwister-Reihenfolge, Zyklenschutz und "Verschieben nach…" muessen
 * weiterhin auf der echten Containment-Struktur arbeiten (siehe deren
 * eigene Kommentare) -- sonst wuerde z.B. "Haus A" und "Haus B" trotz
 * echter Geschwisterschaft unter Träger plötzlich als Kinder verschiedener
 * Positionen gelten.
 *
 * Wurzel-Sonderfall: die Wurzel (Träger) selbst wird nie ersetzt (sie ist
 * immer genau einmal sichtbar) -- nur ihre ANDEREN Kinder wandern unter die
 * fuehrende Position. Jede tiefere Einheit mit fuehrender Position wird
 * dagegen an ihrer Stelle durch die Position ERSETZT, die Einheit selbst
 * (ohne die Position) wird zu deren Kind.
 */
function wendeLeitungsStruktur(wurzel: Knoten): Knoten {
  // orgUnitId -> positionId: welche Einheit soll (zusaetzlich zur eigenen
  // Heimat-Einheit der Position) als "weitere Einheit" unter dieser
  // Position haengen, statt an ihrer natuerlichen Stelle zu bleiben.
  const weitereAnspruch = new Map<string, string>();
  (function sammleAnsprueche(k: Knoten) {
    if (k.art === "position" && !k.istWeitereZuordnung && k.position?.typ === "linie" && !k.position.parentPositionId) {
      for (const weitereId of k.position.weitereOrgUnitIds) weitereAnspruch.set(weitereId, k.position.id);
    }
    k.kinder.forEach(sammleAnsprueche);
  })(wurzel);

  // positionId -> bereits verarbeitete (!) Teilbaeume weiterer Einheiten,
  // zum Schluss an die jeweilige Leitungs-Position angehaengt.
  const zuLeiter = new Map<string, Knoten[]>();

  function istLeiterVon(kind: Knoten, einheitId: string): boolean {
    return (
      kind.art === "position" &&
      !kind.istWeitereZuordnung &&
      kind.position?.typ === "linie" &&
      !kind.position.parentPositionId &&
      kind.position.orgUnitId === einheitId
    );
  }

  function verarbeite(k: Knoten, istWurzel: boolean): Knoten | null {
    const kinder: Knoten[] = [];
    for (const kind of k.kinder) {
      // Die alte "weitere Zuordnung"-Duplikat-Karte (siehe baueBaum() oben)
      // ist fuer eine Leitungs-Position jetzt ueberfluessig: ihre weiteren
      // Einheiten erscheinen bereits als echte Kind-Teilbaeume unter ihr
      // (siehe weitereAnspruch/zuLeiter oben) -- die alte Karte wuerde die
      // Position nur ein zweites Mal redundant zeigen. Fuer alle anderen
      // Positionen (Stabsstellen, Positionen mit parentPositionId) bleibt
      // die alte Karte die einzige Darstellung weiterer Einheiten.
      if (
        kind.istWeitereZuordnung &&
        kind.position?.typ === "linie" &&
        !kind.position.parentPositionId
      ) {
        continue;
      }
      const ergebnis = verarbeite(kind, false);
      if (ergebnis) kinder.push(ergebnis);
    }
    let knoten: Knoten = { ...k, kinder };

    // Eigene Leitungs-Befoerderung IMMER zuerst versuchen -- AUCH wenn
    // diese Einheit gleich darunter als "weitere Einheit" einer ANDEREN
    // Position erkannt und umgehaengt wird. Sonst wuerde eine Einheit mit
    // eigener Leitung, die GLEICHZEITIG weitere Einheit einer anderen
    // Leitung ist, ihre eigene Leitung beim Umhaengen verlieren (die
    // Pruefung unten arbeitet auf dem ggf. schon befoerderten Ergebnis).
    if (knoten.art === "einheit") {
      const leiterIndex = knoten.kinder.findIndex((kind) => istLeiterVon(kind, knoten.einheit!.id));
      if (leiterIndex !== -1) {
        const leiter = { ...knoten.kinder[leiterIndex] };
        const andereKinder = knoten.kinder.filter((_, i) => i !== leiterIndex);
        if (istWurzel) {
          leiter.kinder = [...andereKinder, ...leiter.kinder];
          knoten = { ...knoten, kinder: [leiter] };
        } else {
          leiter.kinder = [{ ...knoten, kinder: andereKinder }, ...leiter.kinder];
          knoten = leiter;
        }
      }
    }

    // Erst jetzt pruefen, ob die URSPRUENGLICHE Einheit (k, unabhaengig
    // von einer eigenen Befoerderung oben) anderswo als weitere Einheit
    // beansprucht wird -- umgehaengt wird dann das ggf. schon befoerderte
    // Ergebnis (knoten), nicht die nackte Einheit.
    if (!istWurzel && k.art === "einheit" && weitereAnspruch.has(k.einheit!.id)) {
      const zielPositionId = weitereAnspruch.get(k.einheit!.id)!;
      const liste = zuLeiter.get(zielPositionId) ?? [];
      liste.push(knoten);
      zuLeiter.set(zielPositionId, liste);
      return null;
    }

    return knoten;
  }

  let neueWurzel = verarbeite(wurzel, true) ?? wurzel;

  if (zuLeiter.size > 0) {
    function anhaengen(k: Knoten): Knoten {
      const kinder = k.kinder.map(anhaengen);
      if (k.art === "position" && !k.istWeitereZuordnung && k.position && zuLeiter.has(k.position.id)) {
        kinder.push(...zuLeiter.get(k.position.id)!);
      }
      return { ...k, kinder };
    }
    neueWurzel = anhaengen(neueWurzel);
  }

  return neueWurzel;
}

const BOX_BREITE = 212;
const SPALTEN_SCHRITT = BOX_BREITE + 28;
// Hoch genug fuer eine Position mit allen vier Zeilen (Titel, Account-Typ,
// Status-Pill, Namen) OHNE dass der Spaltenflex etwas zusammenquetschen
// muss (siehe .zv-organigramm-knoten-sub/-namen in app.css) -- gemessen an
// den tatsaechlich gerenderten Zeilenhoehen, nicht geschaetzt.
const BOX_HOEHE = 112;
const ZEILEN_LUECKE = 48;
// Abstand zwischen gestapelten Platzkarten EINER Position (siehe
// knotenHoehe() unten) -- kleiner als ZEILEN_LUECKE, weil es derselbe
// Knoten bleibt, nur mit mehreren Mitarbeiter-Karten statt einer.
const PLATZKARTEN_LUECKE = 6;

/**
 * Anzahl der zu stapelnden Karten EINES Knotens: eine Organisationseinheit
 * ist immer genau eine Karte, eine Position eine Karte je Mitarbeiter
 * (mindestens eine -- "Vakant"/"Geplant" braucht trotzdem eine Karte, siehe
 * KnotenBox). "Jeder Mitarbeiter eine eigene Karte" (Live-Rueckmeldung)
 * heisst hier: volle, gestapelte Karten UNTEREINANDER am selben Platz,
 * nicht nebeneinander -- vermeidet eine Neuberechnung der Spaltenbreiten
 * im Layout-Algorithmus unten, der Spalten bewusst gleich breit haelt.
 */
function platzkarten(k: Knoten): number {
  if (k.art !== "position") return 1;
  return Math.max(1, k.position!.besetztMit.length);
}

function knotenHoehe(k: Knoten): number {
  const n = platzkarten(k);
  return n * BOX_HOEHE + (n - 1) * PLATZKARTEN_LUECKE;
}

/**
 * Einfaches, selbstgebautes Ebenen-Layout (kein Force-Simulation, keine
 * neue Graph-Library -- siehe Organigramm-Plan): Blaetter bekommen
 * aufsteigende, eindeutige Spalten in Durchlaufreihenfolge, jeder innere
 * Knoten wird ueber dem Mittel seiner Kinder zentriert. Das ist
 * ueberschneidungsfrei, solange jede Spalte dieselbe Breite hat (hier der
 * Fall) -- ein vollwertiger Tidy-Tree-Algorithmus waere fuer die hier
 * erwartete Knotenzahl (zwei- bis niedrig dreistellig) unnoetiger Aufwand.
 *
 * yJeTiefe ersetzt seit der Mehrfachbesetzungs-Darstellung (eine Karte je
 * Mitarbeiter, gestapelt) das vorherige "tiefe * ZEILEN_SCHRITT": jede
 * Zeile ist jetzt so hoch wie ihr hoechster Knoten (eine Position mit drei
 * Mitarbeitern braucht mehr Platz als eine mit einem) -- ein einzelner
 * fester Zeilenabstand wuerde hohe Karten in die naechste Zeile ragen
 * lassen.
 */
function layout(wurzel: Knoten): { breiteSpalten: number; tiefe: number; yJeTiefe: number[]; gesamtHoehe: number } {
  let naechsteSpalte = 0;
  let maxTiefe = 0;
  const maxHoeheJeTiefe = new Map<number, number>();
  function besuch(knoten: Knoten, tiefe: number) {
    knoten.tiefe = tiefe;
    maxTiefe = Math.max(maxTiefe, tiefe);
    maxHoeheJeTiefe.set(tiefe, Math.max(maxHoeheJeTiefe.get(tiefe) ?? 0, knotenHoehe(knoten)));
    if (knoten.kinder.length === 0) {
      knoten.x = naechsteSpalte;
      naechsteSpalte += 1;
      return;
    }
    for (const kind of knoten.kinder) besuch(kind, tiefe + 1);
    const erste = knoten.kinder[0].x;
    const letzte = knoten.kinder[knoten.kinder.length - 1].x;
    knoten.x = (erste + letzte) / 2;
  }
  besuch(wurzel, 0);

  const yJeTiefe: number[] = [];
  let kumulativ = 0;
  for (let t = 0; t <= maxTiefe; t++) {
    yJeTiefe[t] = kumulativ;
    kumulativ += (maxHoeheJeTiefe.get(t) ?? BOX_HOEHE) + ZEILEN_LUECKE;
  }
  return { breiteSpalten: naechsteSpalte, tiefe: maxTiefe, yJeTiefe, gesamtHoehe: kumulativ - ZEILEN_LUECKE };
}

function alleKnoten(wurzel: Knoten): Knoten[] {
  const ergebnis: Knoten[] = [];
  function besuch(k: Knoten) {
    ergebnis.push(k);
    for (const kind of k.kinder) besuch(kind);
  }
  besuch(wurzel);
  return ergebnis;
}

function nachkommenSchluessel(knoten: Knoten): Set<string> {
  const ergebnis = new Set<string>();
  function besuch(k: Knoten) {
    for (const kind of k.kinder) {
      ergebnis.add(kind.schluessel);
      besuch(kind);
    }
  }
  besuch(knoten);
  return ergebnis;
}

/**
 * Wer kommt fuer "quelle" ueberhaupt als neues Ziel infrage -- fuer Drag &
 * Drop UND fuer "Verschieben nach…" dieselbe Funktion, damit beide Wege nie
 * auseinanderlaufen. Nur dieselbe Art (Einheit auf Einheit, Position auf
 * Position -- eine Position unter eine andere Einheit haengen gibt es in
 * diesem API-Stand nicht, org_unit_id einer Position ist nicht aenderbar),
 * nie man selbst, nie der eigene Teilbaum (sonst Zyklus). Eine
 * "falsche Reihenfolge" (z.B. Bereich unter Team) wird hier NICHT
 * zusaetzlich ausgeschlossen -- der Zyklenschutz-Trigger in der DB kennt
 * diese Unterscheidung auch nicht, Client und Server sollen dieselbe
 * Grenze ziehen.
 */
function gueltigeZiele(quelle: Knoten, alle: Knoten[]): Set<string> {
  const nachkommen = nachkommenSchluessel(quelle);
  const ziele = new Set<string>();
  for (const k of alle) {
    if (k.art !== quelle.art || k.schluessel === quelle.schluessel || nachkommen.has(k.schluessel)) continue;
    if (k.istWeitereZuordnung) continue;
    ziele.add(k.schluessel);
  }
  return ziele;
}

/** Schluessel -> Elternknoten, einmal pro Baum berechnet -- Grundlage fuer
 * geschwister() (Geschwister-Reihenfolge per Drag/Buttons, siehe Organigramm()). */
function elternKarte(wurzel: Knoten): Map<string, Knoten> {
  const karte = new Map<string, Knoten>();
  function besuch(k: Knoten) {
    for (const kind of k.kinder) {
      karte.set(kind.schluessel, k);
      besuch(kind);
    }
  }
  besuch(wurzel);
  return karte;
}

/** Geschwister EXKLUSIVE weitere-Zuordnung-Karten (siehe Knoten-Kommentar) -- die haben keine eigene Reihenfolge. */
function geschwister(eltern: Knoten): Knoten[] {
  return eltern.kinder.filter((k) => !k.istWeitereZuordnung);
}

/** Nur traeger/einrichtung bleiben fest -- siehe legeOrgUnitAn(), dieselbe Grenze. */
function istZiehbareEinheit(u: OrgUnitDto): boolean {
  return u.typ === "bereich" || u.typ === "team";
}

function istZiehbar(k: Knoten): boolean {
  return k.art === "position" || istZiehbareEinheit(k.einheit!);
}

interface ZielOption {
  id: string;
  label: string;
}

function zielOptionen(quelle: Knoten, alle: Knoten[], orgUnitNamen: Map<string, string>): ZielOption[] {
  const erlaubt = gueltigeZiele(quelle, alle);
  const optionen: ZielOption[] = [];
  for (const k of alle) {
    if (!erlaubt.has(k.schluessel)) continue;
    if (k.art === "einheit") {
      optionen.push({ id: k.einheit!.id, label: `${k.einheit!.name} (${ORG_UNIT_TYP_LABEL[k.einheit!.typ]})` });
    } else {
      optionen.push({
        id: k.position!.id,
        label: `${k.position!.titel} (${orgUnitNamen.get(k.position!.orgUnitId) ?? "?"})`,
      });
    }
  }
  optionen.sort((a, b) => a.label.localeCompare(b.label, "de"));
  return optionen;
}

function positionsStatus(p: PositionDto): { label: string; klasse: string } {
  if (p.istGeplant) return { label: "Geplant (Platzhalter)", klasse: "zv-pill-info" };
  if (p.besetztMit.length === 0) return { label: "Vakant", klasse: "zv-pill-neutral" };
  if (p.besetztMit.length < p.sollBesetzung) {
    return { label: `Besetzt ${p.besetztMit.length}/${p.sollBesetzung}`, klasse: "zv-pill-teilweise" };
  }
  return { label: "Besetzt", klasse: "zv-pill-ok" };
}

/**
 * Gemeinsame Herleitung fuer KnotenBox (Baumansicht) UND TabellenAnsicht --
 * ohne organigramm.personendaten-sehen liefert der Server benutzerName=null
 * bei trotzdem vorhandenen besetztMit-Eintraegen (CLAUDE.md Regel 6), das
 * muss sich von "wirklich vakant" unterscheiden lassen.
 */
function besetzteNamen(p: PositionDto): { namen: string[]; ausgeblendet: boolean } {
  const namen = p.besetztMit.filter((b) => b.benutzerName !== null).map((b) => b.benutzerName as string);
  return { namen, ausgeblendet: p.besetztMit.length > 0 && namen.length === 0 };
}

/** Dieselbe "Besetzt mit"-Zelle fuer Tabellenansicht UND CSV-Export, damit
 * beide nie auseinanderlaufen -- anders als KnotenBox (die zeigt bei
 * Vakanz gar keine Namenszeile, der Status-Pill traegt das dort schon). */
function besetztMitText(p: PositionDto): string {
  const { namen, ausgeblendet } = besetzteNamen(p);
  if (namen.length > 0) return namen.join(", ");
  if (ausgeblendet) return "Namen ausgeblendet";
  return "Derzeit nicht besetzt";
}

function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

function datumAnzeige(iso: string): string {
  const [jahr, monat, tag] = iso.split("-");
  return `${tag}.${monat}.${jahr}`;
}

function KnotenBox({
  knoten,
  yJeTiefe,
  accountTypNamen,
  ausgewaehlt,
  onOeffnen,
  ziehtGerade,
  istZielMoeglich,
  istZielAktuell,
  einfuegeAn,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKollabierenUmschalten,
}: {
  knoten: Knoten;
  yJeTiefe: number[];
  accountTypNamen: Map<string, string>;
  ausgewaehlt: boolean;
  onOeffnen: () => void;
  ziehtGerade: boolean;
  istZielMoeglich: boolean;
  istZielAktuell: boolean;
  einfuegeAn: "vor" | "nach" | null;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onKollabierenUmschalten: (() => void) | null;
}) {
  const links = knoten.x * SPALTEN_SCHRITT + (SPALTEN_SCHRITT - BOX_BREITE) / 2;
  const oben = yJeTiefe[knoten.tiefe] ?? 0;
  const hoehe = knotenHoehe(knoten);
  const stil = { left: links, top: oben, width: BOX_BREITE, height: hoehe };
  const ziehbar = istZiehbar(knoten);
  // Knoten sind div[role=button], kein <button> -- der Ein-/Ausklapp-Knopf
  // steckt als echtes <button> darin, und zwei verschachtelte <button>
  // sind ungueltiges HTML (React warnt: validateDOMNesting). Deshalb hier
  // die Tastatur-Aktivierung manuell nachgebaut.
  function beiKnotenTaste(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOeffnen();
    }
  }
  const zugsKlassen = `${ziehtGerade ? " zv-organigramm-knoten-zieht" : ""}${
    istZielMoeglich ? " zv-organigramm-knoten-ziel-moeglich" : ""
  }${istZielAktuell ? " zv-organigramm-knoten-ziel-aktuell" : ""}${
    einfuegeAn ? ` zv-organigramm-knoten-einfuegen-${einfuegeAn}` : ""
  }`;
  const ziehGriff = ziehbar && (
    <span className="zv-organigramm-knoten-griff" aria-hidden="true">
      <IZiehen />
    </span>
  );
  const kollabierenKnopf = onKollabierenUmschalten && (
    <button
      type="button"
      className="zv-organigramm-knoten-kollabieren"
      onClick={(e) => {
        e.stopPropagation();
        onKollabierenUmschalten();
      }}
      aria-label={knoten.versteckteNachkommen ? "Teilbaum einblenden" : "Teilbaum ausblenden"}
      title={knoten.versteckteNachkommen ? "Teilbaum einblenden" : "Teilbaum ausblenden"}
    >
      {knoten.versteckteNachkommen ? <IAufklappen /> : <IZuklappen />}
    </button>
  );
  const verstecktHinweis = knoten.versteckteNachkommen ? (
    <span className="zv-pill zv-pill-neutral zv-organigramm-knoten-versteckt">+{knoten.versteckteNachkommen}</span>
  ) : null;

  if (knoten.art === "einheit") {
    const u = knoten.einheit!;
    const Icon = u.typ === "traeger" || u.typ === "einrichtung" ? ITraeger : IBereichTeam;
    return (
      <div
        role="button"
        tabIndex={0}
        style={stil}
        draggable={ziehbar}
        onClick={onOeffnen}
        onKeyDown={beiKnotenTaste}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={`zv-organigramm-knoten zv-organigramm-knoten-einheit${u.aktiv ? "" : " zv-organigramm-knoten-inaktiv"}${ausgewaehlt ? " zv-organigramm-knoten-aktiv" : ""}${zugsKlassen}`}
      >
        {ziehGriff}
        {kollabierenKnopf}
        <div className="zv-organigramm-knoten-kopf">
          <Icon />
          <span className="zv-organigramm-knoten-titel">{u.name}</span>
        </div>
        <span className="zv-organigramm-knoten-sub">
          {ORG_UNIT_TYP_LABEL[u.typ]}
          {!u.aktiv && " · inaktiv"}
        </span>
        {verstecktHinweis}
      </div>
    );
  }

  const p = knoten.position!;
  const status = positionsStatus(p);
  const { namen, ausgeblendet: namenAusgeblendet } = besetzteNamen(p);
  const Icon = p.typ === "stabsstelle" ? IStabsstelle : IPosition;
  // Eine Karte je Mitarbeiter (Live-Rueckmeldung): mindestens eine
  // Platzkarte ("Vakant"/"Geplant"), sonst eine je tatsaechlich besetztem
  // Platz -- gestapelt, siehe knotenHoehe()/platzkarten() oben.
  const anzahlKarten = platzkarten(knoten);
  const zeilen: (string | null)[] = anzahlKarten === 1 ? [namen[0] ?? null] : namen.length > 0 ? namen : [null];
  while (zeilen.length < anzahlKarten) zeilen.push(null);

  return (
    <div style={{ position: "absolute", left: links, top: oben, width: BOX_BREITE, height: hoehe }}>
      {zeilen.map((name, i) => (
        <div
          key={knoten.position!.besetztMit[i]?.besetzungId ?? `leer-${i}`}
          role="button"
          tabIndex={0}
          style={{ position: "absolute", top: i * (BOX_HOEHE + PLATZKARTEN_LUECKE), left: 0, width: BOX_BREITE, height: BOX_HOEHE }}
          draggable={ziehbar}
          onClick={onOeffnen}
          onKeyDown={beiKnotenTaste}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          className={`zv-organigramm-knoten zv-organigramm-knoten-position${
            p.typ === "stabsstelle" ? " zv-organigramm-knoten-stabsstelle" : ""
          }${!p.aktiv ? " zv-organigramm-knoten-inaktiv" : ""}${ausgewaehlt ? " zv-organigramm-knoten-aktiv" : ""}${zugsKlassen}`}
        >
          {i === 0 && ziehGriff}
          {i === 0 && kollabierenKnopf}
          <div className="zv-organigramm-knoten-kopf">
            <Icon />
            <span className="zv-organigramm-knoten-titel">{p.titel}</span>
            {knoten.istWeitereZuordnung && (
              <span title="Weitere Organisationseinheit derselben Position" aria-hidden="true">
                <IVerknuepft />
              </span>
            )}
          </div>
          <span className="zv-organigramm-knoten-sub">
            {accountTypNamen.get(p.accountTypId) ?? "?"}
            {p.typ === "stabsstelle" && " · Stabsstelle"}
            {!p.aktiv && " · inaktiv"}
          </span>
          <span className={`zv-pill ${status.klasse}`}>{status.label}</span>
          {name && <span className="zv-organigramm-knoten-namen">{name}</span>}
          {!name && namenAusgeblendet && anzahlKarten === 1 && (
            <span className="zv-organigramm-knoten-namen">Namen ausgeblendet</span>
          )}
          {i === 0 && verstecktHinweis}
        </div>
      ))}
    </div>
  );
}

function Verbindungen({ knoten, yJeTiefe }: { knoten: Knoten[]; yJeTiefe: number[] }) {
  const pfade: string[] = [];
  for (const k of knoten) {
    const px = k.x * SPALTEN_SCHRITT + SPALTEN_SCHRITT / 2;
    const py = (yJeTiefe[k.tiefe] ?? 0) + knotenHoehe(k);
    for (const kind of k.kinder) {
      const cx = kind.x * SPALTEN_SCHRITT + SPALTEN_SCHRITT / 2;
      const cy = yJeTiefe[kind.tiefe] ?? 0;
      const midY = py + (cy - py) / 2;
      pfade.push(`M ${px} ${py} V ${midY} H ${cx} V ${cy}`);
    }
  }
  return (
    <svg className="zv-organigramm-verbindungen">
      {pfade.map((d, i) => (
        <path key={i} d={d} className="zv-organigramm-linie" />
      ))}
    </svg>
  );
}

interface GeschwisterInfo {
  eltern: Knoten;
  liste: Knoten[];
  index: number;
}

/**
 * "Nach links/rechts"-Knöpfe -- Tastatur-/Klick-Alternative zum Drag für
 * die Geschwister-Reihenfolge (Live-Rückmeldung: "ich möchte sie selbst
 * sortieren können"), gleiches Prinzip wie die Auf/Ab-Knöpfe in
 * Einstellungen.tsx::MenuReihenfolge -- nur horizontal, weil Geschwister
 * im Organigramm nebeneinander stehen, nicht untereinander. Erscheint nur,
 * wenn es überhaupt mehr als ein Geschwister gibt.
 */
function GeschwisterButtons({
  geschwister,
  aufVerschieben,
}: {
  geschwister: GeschwisterInfo | null;
  aufVerschieben: (richtung: "links" | "rechts") => Promise<void>;
}) {
  if (!geschwister || geschwister.liste.length < 2) return null;
  return (
    <>
      <button
        className="zv-btn zv-btn-still"
        type="button"
        onClick={() => aufVerschieben("links")}
        disabled={geschwister.index === 0}
        aria-label="In der Reihenfolge nach links verschieben"
        title="Nach links"
      >
        <IVerschiebenLinks />
      </button>
      <button
        className="zv-btn zv-btn-still"
        type="button"
        onClick={() => aufVerschieben("rechts")}
        disabled={geschwister.index === geschwister.liste.length - 1}
        aria-label="In der Reihenfolge nach rechts verschieben"
        title="Nach rechts"
      >
        <IVerschiebenRechts />
      </button>
    </>
  );
}

/**
 * Seitenpanel-Inhalt fuer eine Organisationseinheit: Stammdaten, die darin
 * enthaltenen Positionen, und -- fuer traeger/einrichtung/bereich als
 * Elternknoten erlaubt, siehe orgUnitAnlegenSchema -- die Aktionen "Neue
 * Unter-Einheit" (Bereich/Team) und "Neue Position".
 *
 * Es gibt hier bewusst KEINE clientseitige Rechtepruefung, die Aktionen aus-
 * blendet: rollen-mapping.ts (Organigramm-Plan Schritt 3) kennt
 * organigramm.bearbeiten fuer Einrichtungsleitung/Mitarbeiter noch nicht --
 * ein serverseitiges 403 waere also heute fuer fast jedes Konto der
 * Normalfall. Die Knoepfe bleiben trotzdem sichtbar (der Server ist die
 * einzige Instanz, die wirklich entscheidet, CLAUDE.md Regel 1-Prinzip
 * sinngemaess auf die Rechte-Engine uebertragen) und zeigen im Fehlerfall
 * die Server-Meldung an.
 */
function EinheitPanel({
  einheit,
  positionenInEinheit,
  accountTypen,
  verschiebenZiele,
  aufVerschieben,
  geschwister,
  aufGeschwisterVerschieben,
  onAktualisiert,
}: {
  einheit: OrgUnitDto;
  positionenInEinheit: PositionDto[];
  accountTypen: AccountTypDto[];
  verschiebenZiele: ZielOption[];
  aufVerschieben: (zielId: string) => Promise<void>;
  geschwister: GeschwisterInfo | null;
  aufGeschwisterVerschieben: (richtung: "links" | "rechts") => Promise<void>;
  onAktualisiert: () => void;
}) {
  const [neueEinheitOffen, setNeueEinheitOffen] = useState(false);
  const [neuePositionOffen, setNeuePositionOffen] = useState(false);
  const [verschiebenOffen, setVerschiebenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function verschieben(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await aufVerschieben(String(form.get("zielId") ?? ""));
      setVerschiebenOffen(false);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Einheit konnte nicht verschoben werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function einheitAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammOrgUnitAnlegen({
        typ: form.get("typ") as "bereich" | "team",
        name: String(form.get("name") ?? "").trim(),
        parentId: einheit.id,
      });
      setNeueEinheitOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Einheit konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function positionAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      const sollBesetzung = Number(form.get("sollBesetzung") ?? 1);
      await api.organigrammPositionAnlegen({
        orgUnitId: einheit.id,
        titel: String(form.get("titel") ?? "").trim(),
        typ: form.get("typ") as "linie" | "stabsstelle",
        accountTypId: String(form.get("accountTypId") ?? ""),
        sollBesetzung: Number.isFinite(sollBesetzung) && sollBesetzung > 0 ? sollBesetzung : undefined,
      });
      setNeuePositionOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <h3>{einheit.name}</h3>
      <p className="zv-sub">
        {ORG_UNIT_TYP_LABEL[einheit.typ]}
        {!einheit.aktiv && " · inaktiv"}
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-vorschau-zeile" style={{ marginTop: 16, marginBottom: 20 }}>
        <button className="zv-btn zv-btn-still" type="button" onClick={() => setNeueEinheitOffen(true)}>
          <INeu />
          Bereich/Team anlegen
        </button>
        <button className="zv-btn zv-btn-still" type="button" onClick={() => setNeuePositionOffen(true)}>
          <INeu />
          Position anlegen
        </button>
        {verschiebenZiele.length > 0 && (
          <button className="zv-btn zv-btn-still" type="button" onClick={() => setVerschiebenOffen(true)}>
            <IVerschieben />
            Verschieben nach…
          </button>
        )}
        <GeschwisterButtons geschwister={geschwister} aufVerschieben={aufGeschwisterVerschieben} />
      </div>

      <h4>Positionen in dieser Einheit</h4>
      <ul className="zv-verlauf-liste">
        {positionenInEinheit.map((p) => {
          const status = positionsStatus(p);
          return (
            <li key={p.id}>
              <strong>{p.titel}</strong>
              <span className={`zv-pill ${status.klasse}`} style={{ marginLeft: 6 }}>
                {status.label}
              </span>
            </li>
          );
        })}
        {positionenInEinheit.length === 0 && <li className="zv-sub-inline">Noch keine Positionen angelegt.</li>}
      </ul>

      {neueEinheitOffen && (
        <Modal titel="Bereich/Team anlegen" onClose={() => setNeueEinheitOffen(false)}>
          <form onSubmit={einheitAnlegen}>
            <div className="zv-field">
              <label htmlFor="einheit-typ">Typ</label>
              <select id="einheit-typ" name="typ" defaultValue="bereich">
                <option value="bereich">Bereich</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="einheit-name">Name</label>
              <input id="einheit-name" name="name" required autoFocus />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {neuePositionOffen && (
        <Modal titel="Position anlegen" onClose={() => setNeuePositionOffen(false)}>
          <form onSubmit={positionAnlegen}>
            <div className="zv-field">
              <label htmlFor="position-titel">Titel</label>
              <input id="position-titel" name="titel" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="position-typ">Typ</label>
              <select id="position-typ" name="typ" defaultValue="linie">
                <option value="linie">Linie</option>
                <option value="stabsstelle">Stabsstelle</option>
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="position-account-typ">Account-Typ</label>
              <select id="position-account-typ" name="accountTypId" required defaultValue="">
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {accountTypen.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="position-soll">Soll-Besetzung</label>
              <input id="position-soll" name="sollBesetzung" type="number" min={1} defaultValue={1} />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {verschiebenOffen && (
        <Modal titel="Verschieben nach…" onClose={() => setVerschiebenOffen(false)}>
          <form onSubmit={verschieben}>
            <p className="zv-sub">Neue übergeordnete Organisationseinheit für „{einheit.name}".</p>
            <div className="zv-field">
              <label htmlFor="einheit-ziel">Neue übergeordnete Einheit</label>
              <select id="einheit-ziel" name="zielId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {verschiebenZiele.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <IVerschieben />
              {wirdGespeichert ? "Speichert…" : "Verschieben"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/**
 * Verwaltung der weiteren Organisationseinheiten einer Linienposition
 * (Migration 0047, Live-Rückmeldung "Einrichtungsleitung mit zwei
 * Einrichtungen"). Replace-Set wie bei der Stabsstelle-Scope-Verwaltung,
 * hier aber mit sofortiger Einzel-Aktion je Zeile (Hinzufügen/Entfernen)
 * statt eines gesammelten "Speichern" -- es ist immer nur eine einzelne
 * Einheit, die dazukommt oder wegfällt, kein mehrzeiliges Formular wie die
 * Rechte-Matrix.
 */
function WeitereEinheiten({
  position,
  orgUnits,
  orgUnitNamen,
  onAktualisiert,
}: {
  position: PositionDto;
  orgUnits: OrgUnitDto[];
  orgUnitNamen: Map<string, string>;
  onAktualisiert: () => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const optionen = orgUnits.filter((u) => u.id !== position.orgUnitId && !position.weitereOrgUnitIds.includes(u.id));

  async function setzen(neu: string[]) {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammWeitereEinheitenSetzen(position.id, neu);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Weitere Organisationseinheiten konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function hinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const orgUnitId = String(new FormData(form).get("orgUnitId") ?? "");
    if (!orgUnitId) return;
    await setzen([...position.weitereOrgUnitIds, orgUnitId]);
    form.reset();
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h4>Weitere Organisationseinheiten</h4>
      <p className="zv-sub">
        Zusätzlich zur Heimat-Einheit zugeordnet -- z.B. eine Einrichtungsleitung mit zwei Einrichtungen. Wirkt sich
        sofort auf die Rechte dieser Position aus.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <ul className="zv-verlauf-liste">
        {position.weitereOrgUnitIds.map((id) => (
          <li key={id}>
            <strong>{orgUnitNamen.get(id) ?? "?"}</strong>
            <button
              className="zv-link-btn"
              type="button"
              onClick={() => setzen(position.weitereOrgUnitIds.filter((wid) => wid !== id))}
              disabled={wirdGespeichert}
            >
              <IAbbrechen />
              Entfernen
            </button>
          </li>
        ))}
        {position.weitereOrgUnitIds.length === 0 && <li className="zv-sub-inline">Keine weiteren Einheiten.</li>}
      </ul>

      {optionen.length > 0 && (
        <form onSubmit={hinzufuegen} className="zv-vorschau-zeile" style={{ marginTop: 12 }}>
          <select name="orgUnitId" defaultValue="" required aria-label="Weitere Einheit wählen">
            <option value="" disabled>
              Einheit wählen…
            </option>
            {optionen.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button className="zv-btn zv-btn-still" type="submit" disabled={wirdGespeichert}>
            <INeu />
            Hinzufügen
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Seitenpanel-Inhalt fuer eine Position: Stammdaten, die aktiven
 * Besetzungen (mit "seit"-Datum) je mit "Beenden", sowie "Besetzen" und
 * "Deaktivieren". Siehe EinheitPanel fuer die Begruendung, warum die
 * Aktionen hier nicht clientseitig nach Rolle ausgeblendet werden.
 */
function PositionPanel({
  position,
  accountTypNamen,
  benutzerListe,
  orgUnits,
  orgUnitNamen,
  verschiebenZiele,
  aufVerschieben,
  istWeitereZuordnung,
  geschwister,
  aufGeschwisterVerschieben,
  onAktualisiert,
}: {
  position: PositionDto;
  accountTypNamen: Map<string, string>;
  benutzerListe: BenutzerListEintragDto[];
  orgUnits: OrgUnitDto[];
  orgUnitNamen: Map<string, string>;
  verschiebenZiele: ZielOption[];
  aufVerschieben: (zielId: string) => Promise<void>;
  istWeitereZuordnung: boolean;
  geschwister: GeschwisterInfo | null;
  aufGeschwisterVerschieben: (richtung: "links" | "rechts") => Promise<void>;
  onAktualisiert: () => void;
}) {
  const [besetzenOffen, setBesetzenOffen] = useState(false);
  const [beendenBesetzung, setBeendenBesetzung] = useState<BesetzungDto | null>(null);
  const [deaktivierenOffen, setDeaktivierenOffen] = useState(false);
  const [verschiebenOffen, setVerschiebenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const status = positionsStatus(position);

  async function verschieben(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await aufVerschieben(String(form.get("zielId") ?? ""));
      setVerschiebenOffen(false);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht verschoben werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function besetzen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammPositionBesetzen(position.id, {
        benutzerId: String(form.get("benutzerId") ?? ""),
        gueltigAb: String(form.get("gueltigAb") ?? "") || undefined,
      });
      setBesetzenOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht besetzt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function besetzungBeenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!beendenBesetzung) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammBesetzungBeenden(position.id, beendenBesetzung.besetzungId, {
        gueltigBis: String(form.get("gueltigBis") ?? "") || undefined,
      });
      setBeendenBesetzung(null);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Besetzung konnte nicht beendet werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function deaktivieren() {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammPositionDeaktivieren(position.id);
      setDeaktivierenOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht deaktiviert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <h3>{position.titel}</h3>
      <p className="zv-sub">
        {POSITION_TYP_LABEL[position.typ]} · {accountTypNamen.get(position.accountTypId) ?? "?"}
        {!position.aktiv && " · inaktiv"}
      </p>
      <span className={`zv-pill ${status.klasse}`}>{status.label}</span>

      {istWeitereZuordnung && (
        <div className="zv-hinweis zv-hinweis-info" style={{ marginTop: 16 }}>
          <IVerknuepft />
          Weitere Organisationseinheit dieser Position -- Heimat-Einheit: {orgUnitNamen.get(position.orgUnitId) ?? "?"}
          . Besetzen/Verschieben/Reihenfolge gelten nur dort, siehe die Karte in der Heimat-Einheit.
        </div>
      )}

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" style={{ marginTop: 16 }}>
          <IFehler />
          {fehler}
        </div>
      )}

      {!istWeitereZuordnung && (
        <div className="zv-vorschau-zeile" style={{ marginTop: 16, marginBottom: 20 }}>
          {position.aktiv && (
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setBesetzenOffen(true)}>
              <IEinziehen />
              Besetzen
            </button>
          )}
          {position.aktiv && (
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setDeaktivierenOffen(true)}>
              <IDeaktivieren />
              Deaktivieren
            </button>
          )}
          {verschiebenZiele.length > 0 && (
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setVerschiebenOffen(true)}>
              <IVerschieben />
              Verschieben nach…
            </button>
          )}
          <GeschwisterButtons geschwister={geschwister} aufVerschieben={aufGeschwisterVerschieben} />
        </div>
      )}

      {!istWeitereZuordnung && position.typ === "linie" && (
        <WeitereEinheiten position={position} orgUnits={orgUnits} orgUnitNamen={orgUnitNamen} onAktualisiert={onAktualisiert} />
      )}

      <h4 style={{ marginTop: 20 }}>Besetzungen</h4>
      <ul className="zv-verlauf-liste">
        {position.besetztMit.map((b) => (
          <li key={b.besetzungId}>
            <strong>{b.benutzerName ?? "Namen ausgeblendet"}</strong>
            <span className="zv-sub-inline" style={{ whiteSpace: "nowrap" }}>
              seit {datumAnzeige(b.gueltigAb)}
            </span>
            <button className="zv-link-btn" type="button" onClick={() => setBeendenBesetzung(b)}>
              <IAuszug />
              Beenden
            </button>
          </li>
        ))}
        {position.besetztMit.length === 0 && <li className="zv-sub-inline">Derzeit nicht besetzt.</li>}
      </ul>

      {besetzenOffen && (
        <Modal titel="Position besetzen" onClose={() => setBesetzenOffen(false)}>
          <form onSubmit={besetzen}>
            <div className="zv-field">
              <label htmlFor="besetzen-benutzer">Mitarbeiter/in</label>
              <select id="besetzen-benutzer" name="benutzerId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {benutzerListe.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="besetzen-gueltig-ab">Besetzt ab</label>
              <input id="besetzen-gueltig-ab" name="gueltigAb" type="date" defaultValue={heute()} />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <IEinziehen />
              {wirdGespeichert ? "Speichert…" : "Besetzen"}
            </button>
          </form>
        </Modal>
      )}

      {beendenBesetzung && (
        <Modal titel="Besetzung beenden" onClose={() => setBeendenBesetzung(null)}>
          <form onSubmit={besetzungBeenden}>
            <p className="zv-sub">
              Beendet die Besetzung von {beendenBesetzung.benutzerName ?? "dieser Person"} auf dieser Position.
            </p>
            <div className="zv-field">
              <label htmlFor="beenden-datum">Ende (optional, Standard: heute)</label>
              <input id="beenden-datum" name="gueltigBis" type="date" defaultValue={heute()} />
            </div>
            <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
              <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
                <IAuszug />
                {wirdGespeichert ? "Speichert…" : "Beenden"}
              </button>
              <button className="zv-btn zv-btn-still" type="button" onClick={() => setBeendenBesetzung(null)}>
                <IAbbrechen />
                Abbrechen
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deaktivierenOffen && (
        <Modal titel="Position deaktivieren" onClose={() => setDeaktivierenOffen(false)}>
          <p className="zv-sub">
            „{position.titel}" wird deaktiviert und verschwindet aus der Auswahl für neue Besetzungen. Das lässt sich
            über die API nicht rückgängig machen.
          </p>
          <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
            <button className="zv-btn" type="button" onClick={deaktivieren} disabled={wirdGespeichert}>
              <IDeaktivieren />
              {wirdGespeichert ? "Speichert…" : "Deaktivieren"}
            </button>
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setDeaktivierenOffen(false)}>
              <IAbbrechen />
              Abbrechen
            </button>
          </div>
        </Modal>
      )}

      {verschiebenOffen && (
        <Modal titel="Verschieben nach…" onClose={() => setVerschiebenOffen(false)}>
          <form onSubmit={verschieben}>
            <p className="zv-sub">
              Neue übergeordnete Position für „{position.titel}" (Berichtslinie, nicht die Organisationseinheit --
              die bleibt dieselbe).
            </p>
            <div className="zv-field">
              <label htmlFor="position-ziel">Neue übergeordnete Position</label>
              <select id="position-ziel" name="zielId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {verschiebenZiele.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <IVerschieben />
              {wirdGespeichert ? "Speichert…" : "Verschieben"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/**
 * Scope ist in der DB/API absichtlich freier Text (keine DB-Enum, siehe
 * account_typ_recht), aber die Rechte-Engine kennt nur diese acht Werte
 * (Organigramm-Plan, Abschnitt "Rechte-Engine"). Die Auswahl hier bietet
 * deshalb genau diese Liste an, statt ein Freitextfeld zu zeigen.
 */
const SCOPE_LABEL: Record<string, string> = {
  own: "Eigene",
  team: "Team",
  wohngruppe: "Wohngruppe",
  subtree: "Teilbaum (Linie)",
  einrichtung: "Einrichtung",
  bereich: "Bereich",
  tenant: "Trägerweit",
  assigned: "Zugewiesen",
};
const SCOPE_OPTIONEN = Object.keys(SCOPE_LABEL);

/**
 * Rechte-Matrix einer einzelnen Account-Typ-Zeile (Organigramm-Plan: "Matrix
 * als Grid-Komponente aus der registry.ts, dieselbe Liste wie
 * serverseitig"). Eine Zeile ohne Eintrag in `karte` ist ein impliziter
 * Deny -- exakt wie eine fehlende account_typ_recht-Zeile serverseitig.
 * Sammelt Aenderungen lokal und schreibt sie erst auf "Speichern" komplett
 * (PUT ersetzt die gesamte Rechte-Menge, kein Sinn in einem Request pro
 * Zelle).
 */
function AccountTypRechteEditor({
  accountTyp,
  registry,
  onAktualisiert,
}: {
  accountTyp: AccountTypDto;
  registry: RechtRegistryEintragDto[];
  onAktualisiert: () => void;
}) {
  const [karte, setKarte] = useState<Map<string, string>>(new Map());
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    const neu = new Map<string, string>();
    for (const r of accountTyp.rechte) if (r.erlaubt) neu.set(`${r.modul}.${r.aktion}`, r.scope);
    setKarte(neu);
    setFehler(null);
  }, [accountTyp.id, accountTyp.rechte]);

  async function speichern() {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      const rechte = Array.from(karte.entries()).map(([schluessel, scope]) => {
        const [modul, aktion] = schluessel.split(".");
        return { modul, aktion, scope, erlaubt: true };
      });
      await api.organigrammAccountTypRechteSetzen(accountTyp.id, rechte);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Rechte konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  if (accountTyp.istVollzugriff) {
    return (
      <div>
        <h3>{accountTyp.name}</h3>
        <p className="zv-sub">
          Alle Rechte, trägerweit -- nicht reduzierbar. Dieser Account-Typ ist die Wildcard für Geschäftsführung
          (Organigramm-Plan) und bekommt deshalb nie einzelne Rechte-Zeilen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3>{accountTyp.name}</h3>
      <p className="zv-sub" style={{ marginBottom: 16 }}>
        Fehlt eine Zeile hier komplett, gilt sie als „Kein Zugriff" -- ohne dass jemand das pflegen müsste, wenn ein
        neues Modul dazukommt.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span>Modul · Aktion</span>
          <span>Zugriff</span>
        </div>
        {registry.map((r) => {
          const schluessel = `${r.modul}.${r.aktion}`;
          const wert = karte.get(schluessel) ?? "";
          return (
            <div className="zv-info-karte" key={schluessel}>
              <span className="zv-liste-zelle-titel">
                {r.modul} · {r.aktion}
                {r.sensibel && <span className="zv-sub-inline">sensibel</span>}
                {r.nieDelegierbar && <span className="zv-sub-inline">nie delegierbar</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Zugriff">
                <select
                  value={wert}
                  onChange={(e) => {
                    const neu = new Map(karte);
                    if (e.target.value === "") neu.delete(schluessel);
                    else neu.set(schluessel, e.target.value);
                    setKarte(neu);
                  }}
                >
                  <option value="">Kein Zugriff</option>
                  {SCOPE_OPTIONEN.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          );
        })}
      </div>

      <button className="zv-btn zv-btn-block" type="button" onClick={speichern} disabled={wirdGespeichert} style={{ marginTop: 16 }}>
        <ISpeichern />
        {wirdGespeichert ? "Speichert…" : "Speichern"}
      </button>
    </div>
  );
}

/**
 * Account-Typ-Verwaltung -- Organigramm-Plan, Lieferreihenfolge Schritt
 * 7/UI. Liste + Anlegen/Umbenennen nach dem Muster von
 * `KassenbuchTypen.tsx` (`ist_system`-Zeilen mit eingeschränkter Aktion,
 * genau wie dort `istHzl`); die Rechte-Matrix selbst öffnet sich im
 * Seitenpanel, damit sie bei Bedarf per Vollbild mehr Platz bekommt.
 */
function AccountTypenAnsicht({
  accountTypen,
  registry,
  onAktualisiert,
}: {
  accountTypen: AccountTypDto[];
  registry: RechtRegistryEintragDto[];
  onAktualisiert: () => void;
}) {
  const [neuOffen, setNeuOffen] = useState(false);
  const [umbenennenTyp, setUmbenennenTyp] = useState<AccountTypDto | null>(null);
  const [ausgewaehlteId, setAusgewaehlteId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const ausgewaehlt = accountTypen.find((a) => a.id === ausgewaehlteId) ?? null;

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammAccountTypAnlegen({
        name: String(form.get("name") ?? "").trim(),
        kategorie: form.get("kategorie") as "intern" | "extern",
      });
      setNeuOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Account-Typ konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function umbenennen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!umbenennenTyp) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammAccountTypAktualisieren(umbenennenTyp.id, { name: String(form.get("name") ?? "").trim() });
      setUmbenennenTyp(null);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Account-Typ konnte nicht umbenannt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
        <button className="zv-btn" type="button" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neuer Account-Typ
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.6fr" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span>Name</span>
          <span>Kategorie</span>
          <span>Rechte</span>
          <span></span>
        </div>
        {accountTypen.map((a) => (
          <div className="zv-info-karte" key={a.id}>
            <span className="zv-liste-zelle-titel">
              {a.name}
              {a.istSystem && <span className="zv-sub-inline">Systemvorlage</span>}
            </span>
            <span className="zv-liste-zelle" data-label="Kategorie">
              {a.kategorie === "extern" ? "Extern" : "Intern"}
            </span>
            <span className="zv-liste-zelle" data-label="Rechte">
              {a.istVollzugriff ? "Alle (Vollzugriff)" : `${a.rechte.length} erlaubt`}
            </span>
            <span className="zv-liste-zelle-aktionen">
              <button className="zv-link-btn" type="button" onClick={() => setAusgewaehlteId(a.id)}>
                <IAnpassen />
                Rechte bearbeiten
              </button>
              {!a.istSystem && (
                <button className="zv-link-btn" type="button" onClick={() => setUmbenennenTyp(a)}>
                  <IBearbeiten />
                  Umbenennen
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {neuOffen && (
        <Modal titel="Neuer Account-Typ" onClose={() => setNeuOffen(false)}>
          <form onSubmit={anlegen}>
            <div className="zv-field">
              <label htmlFor="accounttyp-name">Name</label>
              <input id="accounttyp-name" name="name" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="accounttyp-kategorie">Kategorie</label>
              <select id="accounttyp-kategorie" name="kategorie" defaultValue="intern">
                <option value="intern">Intern</option>
                <option value="extern">Extern</option>
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {umbenennenTyp && (
        <Modal titel="Account-Typ umbenennen" onClose={() => setUmbenennenTyp(null)}>
          <form onSubmit={umbenennen}>
            <div className="zv-field">
              <label htmlFor="accounttyp-umbenennen-name">Name</label>
              <input id="accounttyp-umbenennen-name" name="name" defaultValue={umbenennenTyp.name} required autoFocus />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}

      <Seitenpanel offen={ausgewaehlt !== null} onSchliessen={() => setAusgewaehlteId(null)}>
        {ausgewaehlt && <AccountTypRechteEditor accountTyp={ausgewaehlt} registry={registry} onAktualisiert={onAktualisiert} />}
      </Seitenpanel>
    </div>
  );
}

/**
 * "Anzeigen als…" -- Organigramm-Plan, Lieferreihenfolge Schritt 7/UI,
 * fuenfter Teilschritt. Rein lesend: zeigt, welche Rechte fuer eine
 * gewaehlte Person ODER eine gewaehlte Position effektiv gelten wuerden,
 * inklusive Herkunft je Zelle -- keine Mutation, kein Knopf, der etwas
 * aendert. Laedt wie AccountTypenAnsicht NICHTS automatisch beim Oeffnen
 * der Ansicht (das waere GET /rechte/simulation ohne Ziel, das die API gar
 * nicht annimmt), sondern erst nach einer tatsaechlichen Auswahl.
 *
 * Zwei getrennte Formulare (Mitarbeiter/in vs. Position) statt eines
 * gemeinsamen Ziel-Dropdowns ueber beide Listen: die beiden IDs sind nicht
 * aus demselben Wertebereich (ein Dropdown muesste sie technisch trennen,
 * um ueberhaupt zu wissen, welcher API-Parameter gemeint ist) und die
 * fachliche Frage ist ohnehin eine andere, s. RechteService.simuliereFuer-
 * Benutzer()/-Position().
 */
function SimulationAnsicht({
  benutzerListe,
  positionen,
  orgUnitNamen,
}: {
  benutzerListe: BenutzerListEintragDto[];
  positionen: PositionDto[];
  orgUnitNamen: Map<string, string>;
}) {
  const [art, setArt] = useState<"benutzer" | "position">("benutzer");
  const [benutzerId, setBenutzerId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [zellen, setZellen] = useState<SimulationZelleDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  const positionOptionen = useMemo(
    () =>
      positionen
        .map((p) => ({ id: p.id, label: `${p.titel} (${orgUnitNamen.get(p.orgUnitId) ?? "?"})` }))
        .sort((a, b) => a.label.localeCompare(b.label, "de")),
    [positionen, orgUnitNamen]
  );

  async function simulieren(gewaehlteId: string) {
    if (!gewaehlteId) {
      setZellen(null);
      return;
    }
    setFehler(null);
    setLaedt(true);
    try {
      const ergebnis =
        art === "benutzer" ? await api.rechteSimulation({ benutzerId: gewaehlteId }) : await api.rechteSimulation({ positionId: gewaehlteId });
      setZellen(ergebnis.zellen);
    } catch (err) {
      setZellen(null);
      setFehler(err instanceof Error ? err.message : "Simulation konnte nicht geladen werden.");
    } finally {
      setLaedt(false);
    }
  }

  function artWechseln(neu: "benutzer" | "position") {
    setArt(neu);
    setBenutzerId("");
    setPositionId("");
    setZellen(null);
    setFehler(null);
  }

  return (
    <div>
      <p className="zv-sub" style={{ marginTop: -8, marginBottom: 16 }}>
        Zeigt, welche Rechte effektiv gelten würden — ändert nichts.
      </p>

      <div className="zv-segmented" role="radiogroup" aria-label="Simulieren für" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="radio"
          aria-checked={art === "benutzer"}
          className={art === "benutzer" ? "active" : ""}
          onClick={() => artWechseln("benutzer")}
        >
          Mitarbeiter/in
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={art === "position"}
          className={art === "position" ? "active" : ""}
          onClick={() => artWechseln("position")}
        >
          Position
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-field" style={{ maxWidth: 420 }}>
        {art === "benutzer" ? (
          <>
            <label htmlFor="simulation-benutzer">Mitarbeiter/in</label>
            <select
              id="simulation-benutzer"
              value={benutzerId}
              onChange={(e) => {
                setBenutzerId(e.target.value);
                void simulieren(e.target.value);
              }}
            >
              <option value="">Bitte wählen…</option>
              {benutzerListe.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label htmlFor="simulation-position">Position</label>
            <select
              id="simulation-position"
              value={positionId}
              onChange={(e) => {
                setPositionId(e.target.value);
                void simulieren(e.target.value);
              }}
            >
              <option value="">Bitte wählen…</option>
              {positionOptionen.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {laedt && <p className="zv-sub">Lädt…</p>}

      {zellen && (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Modul · Aktion</span>
            <span>Zugriff</span>
            <span>Herkunft</span>
          </div>
          {zellen.map((z) => (
            <div className="zv-info-karte" key={`${z.modul}.${z.aktion}`}>
              <span className="zv-liste-zelle-titel">
                {z.modul} · {z.aktion}
              </span>
              <span className="zv-liste-zelle" data-label="Zugriff">
                <span className={`zv-pill ${z.erlaubt ? "zv-pill-ok" : "zv-pill-neutral"}`}>
                  {z.erlaubt ? "Erlaubt" : "Kein Zugriff"}
                </span>
              </span>
              <span className="zv-liste-zelle" data-label="Herkunft">
                {RECHT_HERKUNFT_LABEL[z.herkunft]}
                {z.scope && ` · ${SCOPE_LABEL[z.scope] ?? z.scope}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Ein Feld fuer den CSV-Export. Semikolon statt Komma als Trennzeichen
 * (siehe erzeugeCsv()) heisst: ein Wert, der selbst ein Semikolon oder
 * Anführungszeichen enthaelt, muss in Anführungszeichen stehen, enthaltene
 * Anführungszeichen werden verdoppelt -- Standard-CSV-Escaping (RFC 4180).
 */
function csvFeld(wert: string): string {
  if (/[;"\n]/.test(wert)) return `"${wert.replace(/"/g, '""')}"`;
  return wert;
}

/**
 * Semikolon statt Komma: ein deutsches Excel erwartet per Locale das
 * Komma als Dezimaltrennzeichen und wuerde eine komma-getrennte CSV-Datei
 * sonst als eine einzige Spalte einlesen. Dieselben sechs Spalten wie die
 * Tabellenansicht (dieselbe besetztMitText()-Funktion), damit CSV und
 * UI nie auseinanderlaufen.
 */
function erzeugeCsv(
  positionen: PositionDto[],
  orgUnitNamen: Map<string, string>,
  accountTypNamen: Map<string, string>
): string {
  const kopf = ["Titel", "Einheit", "Typ", "Account-Typ", "Status", "Besetzt mit"];
  const zeilen = positionen.map((p) => [
    p.titel,
    orgUnitNamen.get(p.orgUnitId) ?? "?",
    POSITION_TYP_LABEL[p.typ],
    accountTypNamen.get(p.accountTypId) ?? "?",
    positionsStatus(p).label,
    besetztMitText(p),
  ]);
  return [kopf, ...zeilen].map((zeile) => zeile.map(csvFeld).join(";")).join("\r\n");
}

/**
 * Klassischer Blob+<a download>-Mechanismus direkt im Browser -- anders als
 * api.organigrammExportPdf() braucht der CSV-Export keinen Server-
 * Roundtrip, die Daten sind ueber laden() schon vollstaendig im State.
 */
function csvHerunterladen(inhalt: string, dateiname: string) {
  const blob = new Blob([inhalt], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Tabellenansicht/Export -- letzter UI-Teilschritt aus Schritt 7 (Baum →
 * Seitenpanel → Umhängen → Account-Typ-Verwaltung → Anzeigen als… →
 * Tabellenansicht/Export). Ein echtes <table>-Element (.zv-table) statt des
 * .zv-karten-liste-Grid-Patterns der anderen Ansichten hier in dieser Datei:
 * export-taugliche tabellarische Daten (CSV/PDF) spiegeln sich in einer
 * echten Tabelle natuerlicher als in einem Karten-Grid.
 */
function TabellenAnsicht({
  orgUnits,
  positionen,
  accountTypNamen,
  orgUnitNamen,
}: {
  orgUnits: OrgUnitDto[];
  positionen: PositionDto[];
  accountTypNamen: Map<string, string>;
  orgUnitNamen: Map<string, string>;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdExportiert, setWirdExportiert] = useState(false);

  const sortiert = useMemo(
    () => [...positionen].sort((a, b) => a.titel.localeCompare(b.titel, "de")),
    [positionen]
  );

  function csvExportieren() {
    setFehler(null);
    const inhalt = `﻿${erzeugeCsv(sortiert, orgUnitNamen, accountTypNamen)}`;
    csvHerunterladen(inhalt, "organigramm.csv");
  }

  async function pdfExportieren() {
    setFehler(null);
    setWirdExportiert(true);
    try {
      await api.organigrammExportPdf();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "PDF konnte nicht erzeugt werden.");
    } finally {
      setWirdExportiert(false);
    }
  }

  return (
    <div>
      <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
        <button className="zv-btn zv-btn-still" type="button" onClick={csvExportieren} disabled={sortiert.length === 0}>
          <IHerunterladen />
          CSV exportieren
        </button>
        <button
          className="zv-btn zv-btn-still"
          type="button"
          onClick={pdfExportieren}
          disabled={wirdExportiert}
        >
          <IHerunterladen />
          {wirdExportiert ? "Erzeugt…" : "PDF exportieren"}
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {sortiert.length === 0 ? (
        <Leerzustand icon={ILeerOrganigramm}>
          {orgUnits.length === 0 ? "Noch keine Organisationsstruktur angelegt." : "Noch keine Positionen angelegt."}
        </Leerzustand>
      ) : (
        <table className="zv-table">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Einheit</th>
              <th>Typ</th>
              <th>Account-Typ</th>
              <th>Status</th>
              <th>Besetzt mit</th>
            </tr>
          </thead>
          <tbody>
            {sortiert.map((p) => {
              const status = positionsStatus(p);
              return (
                <tr key={p.id}>
                  <td>{p.titel}</td>
                  <td>{orgUnitNamen.get(p.orgUnitId) ?? "?"}</td>
                  <td>{POSITION_TYP_LABEL[p.typ]}</td>
                  <td>{accountTypNamen.get(p.accountTypId) ?? "?"}</td>
                  <td>
                    <span className={`zv-pill ${status.klasse}`}>{status.label}</span>
                  </td>
                  <td>{besetztMitText(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

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
  // Positionen ueber ihrer Einheit zeigen, siehe wendeLeitungsStruktur()).
  // alleKnotenVoll/elternMap weiter unten bauen bewusst weiterhin auf
  // wurzelVoll auf (nicht auf diesem Zweig hier), damit Drag&Drop/
  // Geschwister/Zyklenschutz die echte Containment-Struktur sehen.
  const wurzelAnzeige = useMemo(() => (wurzelSichtbar ? wendeLeitungsStruktur(wurzelSichtbar) : null), [wurzelSichtbar]);

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
            Organisationseinheiten und Positionen dieses Trägers. Durchgezogener Rahmen: Linienposition. Gestrichelter
            Rahmen: Stabsstelle (kein automatischer Zuständigkeitsbereich). Namen erscheinen nur mit dem Recht
            „Personendaten sehen" -- sonst nur die Anzahl der besetzten Plätze. Klick auf einen Knoten zeigt Details
            und Aktionen.
          </p>

          {!wurzelVoll && geladen && !fehler ? (
            <Leerzustand icon={ILeerOrganigramm}>Noch keine Organisationsstruktur angelegt.</Leerzustand>
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
                          k.kinder.length > 0 || k.versteckteNachkommen ? () => kollabierenUmschalten(k.schluessel) : null
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
