/**
 * Reine Baumlogik des Organigramms: Aufbau aus Einheiten und Positionen,
 * Filter, Layout und Ziehziele. Bewusst ohne React, damit sie sich ohne
 * Browser lesen und prüfen lässt; die Seite (../Organigramm.tsx) und die
 * Panels greifen alle auf dieselben Funktionen zu.
 */

import type { OrgUnitDto, PositionDto } from "@zimmerakte/shared";
import { ORG_UNIT_TYP_LABEL } from "@zimmerakte/shared";

/**
 * Ein Knoten im Organigramm -- entweder eine Organisationseinheit oder eine
 * Position. Beide Arten stehen bewusst im selben Baum (nicht zwei getrennte
 * Visualisierungen): eine Position haengt immer unter der Einheit, zu der
 * sie gehoert (org_unit_id), zusaetzlich -- wenn gesetzt -- unter einer
 * anderen Position derselben Einheit (parent_position_id), fuer eine lokale
 * Berichtshierarchie innerhalb der Einheit (z.B. Teamleitung ueber
 * Mitarbeiter-Positionen im selben Team).
 */
export interface Knoten {
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
  /**
   * Untermenge von istWeitereZuordnung: die Karte zeigt die Personen, deren
   * BESETZUNG diese Einheit als Standort hat (Migration 0066), nicht die
   * Position als Ganzes. Anders als bei weitere_einheit gehoert die Einheit
   * hier nur den Personen, die sie haben -- nicht allen auf der Position.
   */
  istBesetzungsZuordnung?: boolean;
  /** Nur gesetzt, wenn der Knoten wegen Einklappen (kollabiert-Set) seine Kinder verbirgt. */
  versteckteNachkommen?: number;
  /**
   * Reiner Platzhalter ohne eigene Karte (siehe entferneEinheiten() unten)
   * -- sammelt mehrere voneinander unabhaengige Wurzel-Positionen als
   * Geschwister, falls keine gemeinsame Leitung existiert. layout()/
   * alleKnoten() ueberspringen ihn beim Zeichnen/Zaehlen der Tiefe.
   */
  unsichtbar?: boolean;
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
export function baueBaum(orgUnits: OrgUnitDto[], alle: PositionDto[]): Knoten | null {
  // Deaktivierte Positionen ohne Besetzung sind erledigt (die Oberflaeche
  // kann sie nicht wieder aktivieren) und bleiben in der Tabelle sichtbar.
  // Im Baum waeren sie nur graue "Vakant"-Karten, etwa die alten
  // Einrichtungs-Positionen nach dem Zusammenfuehren (Migration 0068).
  const positionen = alle.filter((p) => p.aktiv || p.besetztMit.length > 0);
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

  // Personen mit eigenen Standorten an der Besetzung stehen unter JEDEM davon
  // (je Einheit eine Karte mit nur ihren Leuten), nicht gesammelt an der
  // Einheit der geteilten Rang-Position. Sonst sähe man auf der Karte
  // "Haus B" auch die Mitarbeitenden, die dort gar nicht arbeiten.
  const besetzungsKarten: { position: PositionDto; einheitId: string }[] = [];
  const heimatPositionen: PositionDto[] = [];
  for (const p of positionen) {
    const mitStandorten = p.besetztMit.filter((b) => b.orgUnitIds.length > 0);
    if (mitStandorten.length === 0) {
      heimatPositionen.push(p);
      continue;
    }
    const daheim = p.besetztMit.filter((b) => b.orgUnitIds.length === 0 || b.orgUnitIds.includes(p.orgUnitId));
    if (daheim.length > 0) heimatPositionen.push({ ...p, besetztMit: daheim });
    const einheitIds = new Set(mitStandorten.flatMap((b) => b.orgUnitIds));
    einheitIds.delete(p.orgUnitId);
    for (const einheitId of einheitIds) {
      besetzungsKarten.push({
        position: { ...p, besetztMit: mitStandorten.filter((b) => b.orgUnitIds.includes(einheitId)) },
        einheitId,
      });
    }
  }

  const positionenJeEinheit = new Map<string, PositionDto[]>();
  for (const p of heimatPositionen) {
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

  for (const { position, einheitId } of besetzungsKarten) {
    const einheit = einheitKnoten.get(einheitId);
    if (!einheit) continue;
    einheit.kinder.push({
      schluessel: `p:${position.id}:besetzung:${einheitId}`,
      art: "position",
      position,
      kinder: [],
      tiefe: 0,
      x: 0,
      istWeitereZuordnung: true,
      istBesetzungsZuordnung: true,
    });
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
export function sichtbarerBaum(wurzel: Knoten, kollabiert: Set<string>): Knoten {
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
export function wendeLeitungsStruktur(wurzel: Knoten): Knoten {
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
        !kind.istBesetzungsZuordnung &&
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

/**
 * Live-Rueckmeldung: "es geht nur über die Personen" -- Organisationseinheiten
 * (Träger/Einrichtung/Bereich/Team) bekommen keine eigene Karte mehr, nur
 * noch Positionen. Reine ANZEIGE-Transformation wie wendeLeitungsStruktur()
 * (bewusst NUR auf den Render-Pfad angewendet, NICHT auf wurzelVoll --
 * Geschwister-Reihenfolge, Zyklenschutz und "Verschieben nach…" müssen
 * weiterhin die echte Containment-Struktur sehen, siehe deren Kommentare).
 *
 * Eine entfernte Einheit "verschwindet" einfach -- ihre Kinder (weitere
 * Positionen, tiefer verschachtelte, jetzt ebenfalls entfernte Einheiten)
 * rücken an ihre Stelle, eine Ebene höher. Bleiben am Ende mehrere
 * voneinander unabhängige Wurzel-Positionen übrig (keine gemeinsame
 * Leitung oberhalb), sammelt ein unsichtbarer Platzhalter-Knoten sie als
 * Geschwister -- layout()/alleKnoten() überspringen ihn beim Zeichnen und
 * zählen ihn nicht als zusätzliche Tiefe.
 */
export function entferneEinheiten(wurzel: Knoten): Knoten {
  function bereinige(k: Knoten): Knoten[] {
    const kinder = k.kinder.flatMap(bereinige);
    if (k.art === "einheit") return kinder;
    return [{ ...k, kinder }];
  }
  const ergebnisse = bereinige(wurzel);
  if (ergebnisse.length === 1) return ergebnisse[0];
  return { schluessel: "wurzel:unsichtbar", art: "position", kinder: ergebnisse, tiefe: 0, x: 0, unsichtbar: true };
}

/**
 * Rueckmeldung 1d0d9f97: "nach den Unterkuenften filtern und nur die
 * dazugehoerigen Mitarbeiter und Leiter sehen -- Geschaeftsfuehrer und
 * Bereichsleiter sollen beibehalten werden."
 *
 * Arbeitet auf dem Anzeige-Baum NACH wendeLeitungsStruktur() und VOR
 * entferneEinheiten(): Die Einheiten-Knoten sind dort noch da und markieren,
 * was zu welcher Einrichtung gehoert, und die Leitung einer Einrichtung steht
 * bereits ueber ihr. Behalten wird:
 *   1. alles unter einer gewaehlten Einheit (samt Bereichen/Teams darin und
 *      den Besetzungs-Karten "Mitarbeiter an Haus A");
 *   2. jeder Knoten, unter dem etwas Behaltenes haengt -- das ist der Weg
 *      nach oben: Einrichtungsleitung, Bereichsleitung, Geschaeftsfuehrung;
 *   3. Positionen, deren Heimat-Einheit gewaehlt ist, auch wenn sie neben
 *      statt unter der Einheit stehen (direkt der Einrichtungsleitung
 *      unterstellte Stellen derselben Einrichtung);
 *   4. Leitungsstellen oberhalb der gewaehlten Einrichtungen, die nicht auf
 *      dem Weg liegen (z.B. eine Bereichsleitung als Geschwister der
 *      Geschaeftsfuehrung): Linienposition mit fester Sollzahl an einer
 *      uebergeordneten Einheit, die nicht ausdruecklich nur fuer ANDERE
 *      Einrichtungen zustaendig ist. Sammelraenge (Sollzahl leer, z.B.
 *      "Mitarbeiter" am Traeger) fallen hier bewusst heraus: deren Leute
 *      erscheinen ueber ihre Besetzungs-Standorte bereits unter Regel 1.
 *      Stabsstellen ebenso -- sie gehoeren keiner Einrichtung.
 */
export function filtereNachStandorten(wurzel: Knoten, gewaehlt: Set<string>, orgUnits: OrgUnitDto[]): Knoten | null {
  const elternVon = new Map(orgUnits.map((u) => [u.id, u.parentId]));
  const oberhalb = new Set<string>();
  for (const id of gewaehlt) {
    for (let x = elternVon.get(id) ?? null; x; x = elternVon.get(x) ?? null) oberhalb.add(x);
  }
  function imZiel(id: string): boolean {
    for (let x: string | null = id; x; x = elternVon.get(x) ?? null) if (gewaehlt.has(x)) return true;
    return false;
  }
  const betrifft = (id: string) => imZiel(id) || oberhalb.has(id);

  function istUebergeordneteLeitung(k: Knoten): boolean {
    const p = k.position;
    if (!p || k.istWeitereZuordnung || p.typ !== "linie" || p.sollBesetzung === null) return false;
    if (!oberhalb.has(p.orgUnitId)) return false;
    return p.weitereOrgUnitIds.length === 0 || p.weitereOrgUnitIds.some(betrifft);
  }

  function besuch(k: Knoten): Knoten | null {
    if (k.art === "einheit" && gewaehlt.has(k.einheit!.id)) return k;
    const kinder = k.kinder.map(besuch).filter((x): x is Knoten => x !== null);
    if (kinder.length > 0) return { ...k, kinder };
    if (k.art !== "position" || !k.position) return null;
    if (!k.istWeitereZuordnung && imZiel(k.position.orgUnitId)) return { ...k, kinder };
    if (istUebergeordneteLeitung(k)) return { ...k, kinder };
    return null;
  }
  return besuch(wurzel);
}

export const BOX_BREITE = 212;
export const SPALTEN_SCHRITT = BOX_BREITE + 28;
// Hoch genug fuer eine Position mit allen vier Zeilen (Titel, Account-Typ,
// Status-Pill, Namen) OHNE dass der Spaltenflex etwas zusammenquetschen
// muss (siehe .zv-organigramm-knoten-sub/-namen in app.css) -- gemessen an
// den tatsaechlich gerenderten Zeilenhoehen, nicht geschaetzt.
export const BOX_HOEHE = 112;
const ZEILEN_LUECKE = 48;
// Abstand zwischen gestapelten Platzkarten EINER Position (siehe
// knotenHoehe() unten) -- kleiner als ZEILEN_LUECKE, weil es derselbe
// Knoten bleibt, nur mit mehreren Mitarbeiter-Karten statt einer.
export const PLATZKARTEN_LUECKE = 6;

/**
 * Anzahl der zu stapelnden Karten EINES Knotens: eine Organisationseinheit
 * ist immer genau eine Karte, eine Position eine Karte je Mitarbeiter
 * (mindestens eine -- "Vakant"/"Geplant" braucht trotzdem eine Karte, siehe
 * KnotenBox). "Jeder Mitarbeiter eine eigene Karte" (Live-Rueckmeldung)
 * heisst hier: volle, gestapelte Karten UNTEREINANDER am selben Platz,
 * nicht nebeneinander -- vermeidet eine Neuberechnung der Spaltenbreiten
 * im Layout-Algorithmus unten, der Spalten bewusst gleich breit haelt.
 */
export function platzkarten(k: Knoten): number {
  if (k.unsichtbar || k.art !== "position") return 1;
  return Math.max(1, k.position!.besetztMit.length);
}

export function knotenHoehe(k: Knoten): number {
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
export function layout(wurzel: Knoten): { breiteSpalten: number; tiefe: number; yJeTiefe: number[]; gesamtHoehe: number } {
  let naechsteSpalte = 0;
  let maxTiefe = 0;
  const maxHoeheJeTiefe = new Map<number, number>();
  function besuch(knoten: Knoten, tiefe: number) {
    knoten.tiefe = tiefe;
    if (!knoten.unsichtbar) {
      maxTiefe = Math.max(maxTiefe, tiefe);
      maxHoeheJeTiefe.set(tiefe, Math.max(maxHoeheJeTiefe.get(tiefe) ?? 0, knotenHoehe(knoten)));
    }
    if (knoten.kinder.length === 0) {
      knoten.x = naechsteSpalte;
      naechsteSpalte += 1;
      return;
    }
    // Ein unsichtbarer Platzhalter zaehlt nicht als eigene Zeile -- seine
    // Kinder (mehrere unabhaengige Wurzel-Positionen) starten selbst bei
    // Tiefe 0, nicht eine Ebene darunter.
    const kindTiefe = knoten.unsichtbar ? tiefe : tiefe + 1;
    for (const kind of knoten.kinder) besuch(kind, kindTiefe);
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

export function alleKnoten(wurzel: Knoten): Knoten[] {
  const ergebnis: Knoten[] = [];
  function besuch(k: Knoten) {
    // unsichtbar (entferneEinheiten()): zaehlt mit fuer Zyklenschutz/
    // Nachkommen-Zaehlung auf wurzelVoll (das diesen Knotentyp nie
    // enthaelt), wird aber nie als Karte gezeichnet -- hier ausgeschlossen,
    // damit KnotenBox/Verbindungen ihn gar nicht erst zu sehen bekommen.
    if (!k.unsichtbar) ergebnis.push(k);
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
export function gueltigeZiele(quelle: Knoten, alle: Knoten[]): Set<string> {
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
export function elternKarte(wurzel: Knoten): Map<string, Knoten> {
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
export function geschwister(eltern: Knoten): Knoten[] {
  return eltern.kinder.filter((k) => !k.istWeitereZuordnung);
}

/** Nur traeger/einrichtung bleiben fest -- siehe legeOrgUnitAn(), dieselbe Grenze. */
export function istZiehbareEinheit(u: OrgUnitDto): boolean {
  return u.typ === "bereich" || u.typ === "team";
}

export function istZiehbar(k: Knoten): boolean {
  return k.art === "position" || istZiehbareEinheit(k.einheit!);
}

export interface ZielOption {
  id: string;
  label: string;
}

export function zielOptionen(quelle: Knoten, alle: Knoten[], orgUnitNamen: Map<string, string>): ZielOption[] {
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

export function positionsStatus(p: PositionDto): { label: string; klasse: string } {
  if (p.istGeplant) return { label: "Geplant (Platzhalter)", klasse: "zv-pill-info" };
  if (p.besetztMit.length === 0) return { label: "Vakant", klasse: "zv-pill-neutral" };
  if (p.sollBesetzung !== null && p.besetztMit.length < p.sollBesetzung) {
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
export function besetzteNamen(p: PositionDto): { namen: string[]; ausgeblendet: boolean } {
  const namen = p.besetztMit.filter((b) => b.benutzerName !== null).map((b) => b.benutzerName as string);
  return { namen, ausgeblendet: p.besetztMit.length > 0 && namen.length === 0 };
}

/** Dieselbe "Besetzt mit"-Zelle fuer Tabellenansicht UND CSV-Export, damit
 * beide nie auseinanderlaufen -- anders als KnotenBox (die zeigt bei
 * Vakanz gar keine Namenszeile, der Status-Pill traegt das dort schon). */
export function besetztMitText(p: PositionDto): string {
  const { namen, ausgeblendet } = besetzteNamen(p);
  if (namen.length > 0) return namen.join(", ");
  if (ausgeblendet) return "Namen ausgeblendet";
  return "Derzeit nicht besetzt";
}

export function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

export function datumAnzeige(iso: string): string {
  const [jahr, monat, tag] = iso.split("-");
  return `${tag}.${monat}.${jahr}`;
}
