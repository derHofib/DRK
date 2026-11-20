import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AbwesenheitDto, AbwesenheitRechteDto, ChatKontaktDto, KalenderStundenEinstellungenDto, TerminAnlegenEingabe, TerminDto } from "@zimmerakte/shared";
import { LEISTUNGSART_LABEL, TERMIN_ANTWORT_LABEL, formatMinutenAlsStunden, terminStundenLeistungsart } from "@zimmerakte/shared";
import { api, tokenBenutzerId } from "../api/client";
import { FilterMehrfachAuswahl, FilterPille } from "../components/Filterleiste";
import { Filterleiste } from "../components/Listenfilter";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { TerminFormular } from "../components/TerminFormular";
import { IBearbeiten, IDarstellung, IFehler, IHerunterladen, IInfo, ILeerKalender, INeu, IPerson, IStornieren, IStunden, ITag, IVor, IZurueckPfeil } from "../components/icons";
import { AbwesenheitDetail, AbwesenheitEintragen, AbwesenheitsZeile, ArtDreieck } from "../kalender/Abwesenheiten";
import {
  KALENDER_ARTEN,
  KALENDER_ART_LABEL,
  KEIN_FILTER,
  abwesenheitArt,
  abwesenheitPasst,
  abwesenheitTage,
  filterAktiv,
  istAbwesenheitsArt,
  terminPasst,
  wichtigsteArt,
  type KalenderArt,
  type KalenderFilter,
} from "../kalender/eintraege";
import { WochenZeitraster } from "../kalender/WochenZeitraster";
import { personFarbStil, useMitarbeitendeMitFarbe } from "../personFarbe";
import { formatDatum, formatTagTrenner, formatTerminUhrzeit, formatTerminZeit, kalenderwoche, lokalesDatum, terminTag } from "../format";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_TAGE_JE_TERMIN = 62;
/**
 * Ab mehr als drei aktiven Terminen an einem Tag bekommt die Zelle im
 * Jahresueberblick die Sammelfarbe statt Personenstreifen: vier oder mehr
 * Streifen in einer ~30 px breiten Zelle sind nicht mehr zu unterscheiden,
 * und "hier ist viel los" ist dann die nuetzlichere Aussage.
 */
const SAMMEL_AB = 4;
/** Mehr Zeilen machen die Vorschau hoeher als den Monatskasten; der Rest steht in der Monatsansicht. */
const VORSCHAU_MAX = 6;

type Ansicht = "woche" | "monat" | "jahr";
/** Woher die Farbe einer Tageszelle im Jahresueberblick kommt. Standard: Person (Rueckmeldung "Filter Kalender"). */
type FarbModus = "person" | "art";
const ANSICHTEN: { wert: Ansicht; label: string }[] = [
  { wert: "woche", label: "Woche" },
  { wert: "monat", label: "Monat" },
  { wert: "jahr", label: "Jahr" },
];

function datumAusKey(key: string): Date {
  const [j, m, t] = key.split("-").map(Number);
  return new Date(j, m - 1, t);
}

function addTage(key: string, tage: number): string {
  const d = datumAusKey(key);
  d.setDate(d.getDate() + tage);
  return lokalesDatum(d);
}

/**
 * Verschiebt um ganze Monate und haelt den Tag im Zielmonat: der 31.1. plus
 * ein Monat ist der 28./29.2. -- nicht der 3.3., wie es setMonth() taete.
 */
function addMonate(key: string, monate: number): string {
  const [j, m, t] = key.split("-").map(Number);
  const ziel = new Date(j, m - 1 + monate, 1);
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  ziel.setDate(Math.min(t, letzter));
  return lokalesDatum(ziel);
}

/** Montag der Woche, in der `key` liegt. */
function wochenStart(key: string): string {
  const d = datumAusKey(key);
  return addTage(key, -((d.getDay() + 6) % 7));
}

/** Die 42 Tage (6 Wochen) des Monatsrasters, in dem `key` liegt. */
function monatsRaster(key: string): string[] {
  const start = wochenStart(`${key.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => addTage(start, i));
}

/** Alle Tage eines Monats ("YYYY-MM") ohne Auffuellung, mit Leerfeldern vorne, damit der erste unter dem richtigen Wochentag steht. */
function miniMonat(monat: string): (string | null)[] {
  const erster = `${monat}-01`;
  const vorn = (datumAusKey(erster).getDay() + 6) % 7;
  const anzahl = new Date(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), 0).getDate();
  return [...Array<null>(vorn).fill(null), ...Array.from({ length: anzahl }, (_, i) => `${monat}-${String(i + 1).padStart(2, "0")}`)];
}

/** Abgefragter Zeitraum je Ansicht; je einen Tag Puffer, weil Zeitpunkt-Termine UTC gespeichert sind, die Grenzen aber lokal. */
function ladeZeitraum(ansicht: Ansicht, tag: string): [string, string] {
  if (ansicht === "woche") {
    const start = wochenStart(tag);
    return [addTage(start, -1), addTage(start, 8)];
  }
  if (ansicht === "monat") {
    const start = monatsRaster(tag)[0];
    return [addTage(start, -1), addTage(start, 43)];
  }
  const jahr = tag.slice(0, 4);
  return [addTage(`${jahr}-01-01`, -1), addTage(`${jahr}-12-31`, 2)];
}

/** Alle lokalen Kalendertage, die ein Termin beruehrt (gedeckelt, damit ein Termin ueber Jahre nichts aufblaeht). */
function tageVon(t: TerminDto): string[] {
  const von = terminTag(t.beginn, t.ganztaegig);
  let bis = terminTag(t.ende, t.ganztaegig);
  // Ein Termin, der genau um Mitternacht endet, gehoert nicht mehr zum Folgetag.
  if (!t.ganztaegig && t.ende > t.beginn) bis = lokalesDatum(new Date(new Date(t.ende).getTime() - 1));
  const tage: string[] = [];
  for (let k = von, i = 0; k <= bis && i < MAX_TAGE_JE_TERMIN; k = addTage(k, 1), i++) tage.push(k);
  return tage.length > 0 ? tage : [von];
}

function sortiere(a: TerminDto, b: TerminDto): number {
  if (a.ganztaegig !== b.ganztaegig) return a.ganztaegig ? -1 : 1;
  return a.beginn.localeCompare(b.beginn);
}

function terminWort(anzahl: number): string {
  return `${anzahl} Termin${anzahl === 1 ? "" : "e"}`;
}

/** Text einer Mehrfachauswahl in der Pille: zwei Namen passen, danach zaehlt sie nur noch. */
function auswahlText(labels: string[]): string {
  return labels.length <= 2 ? labels.join(", ") : `${labels[0]} und ${labels.length - 1} weitere`;
}

/**
 * `kontakteLaden`: woher die waehlbaren Teilnehmenden kommen. Mitarbeitende
 * nutzen die Voreinstellung (/chat/kontakte); fuer Klient:innen liefert
 * dieser Endpunkt bewusst nichts -- sie koennen nur Personen eintragen, mit
 * denen sie einen gemeinsamen Chat haben (KlientShell leitet sie daraus ab).
 */
export function Kalender({
  titel = "Kalender",
  kontakteLaden = () => api.chatKontakte(),
  mitAbwesenheiten = true,
}: {
  titel?: string;
  kontakteLaden?: () => Promise<ChatKontaktDto[]>;
  /** Klient:innen sehen keine Abwesenheiten des Teams (die API laesst sie gar nicht erst zu). */
  mitAbwesenheiten?: boolean;
}) {
  const heute = lokalesDatum(new Date());
  // `gewaehlt` ist der einzige Zeitanker: Woche, Monat und Jahr leiten sich daraus ab.
  // So landet man beim Umschalten immer im Zeitraum, den man gerade ansieht.
  const [gewaehlt, setGewaehlt] = useState(heute);
  const [ansicht, setAnsicht] = useState<Ansicht>("woche");
  const [termine, setTermine] = useState<TerminDto[]>([]);
  const [abwesenheiten, setAbwesenheiten] = useState<AbwesenheitDto[]>([]);
  const [abwRechte, setAbwRechte] = useState<AbwesenheitRechteDto>({ artSehen: false, verwalten: false });
  const [filter, setFilter] = useState<KalenderFilter>(KEIN_FILTER);
  const [farbModus, setFarbModus] = useState<FarbModus>("person");
  const [abwNeuOffen, setAbwNeuOffen] = useState(false);
  const [abwDetail, setAbwDetail] = useState<AbwesenheitDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  // Beginn fuer "Neuer Termin", wenn er per Klick in eine Stunde des Zeitrasters geoeffnet wurde.
  const [neuUhrzeit, setNeuUhrzeit] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Stunden aus dem Kalender (migrations/0080) -- nur fuer Mitarbeitende;
  // die Klient:innen-Ansicht ist die einzige ohne Abwesenheiten.
  const [stundenEinst, setStundenEinst] = useState<KalenderStundenEinstellungenDto | null>(null);
  // Tagesvorschau im Jahresueberblick: welcher Tag, und wie weit unter der
  // Kastenoberkante sie haengt (Unterkante der Tageszelle).
  const [vorschau, setVorschau] = useState<{ tag: string; oben: number; scrollen: boolean } | null>(null);
  // Zeigertyp des letzten pointerdown: ein Klick per Maus kommt nach dem
  // Hover und soll die Vorschau nicht wieder schliessen, ein Tippen schon.
  const letzterZeiger = useRef<string>("");

  const monat = gewaehlt.slice(0, 7);
  const jahr = gewaehlt.slice(0, 4);
  const wochenTage = useMemo(() => Array.from({ length: 7 }, (_, i) => addTage(wochenStart(gewaehlt), i)), [gewaehlt]);
  const rasterTage = useMemo(() => monatsRaster(gewaehlt), [gewaehlt]);
  const [ladeVon, ladeBis] = useMemo(() => ladeZeitraum(ansicht, gewaehlt), [ansicht, gewaehlt]);

  const laden = useCallback(() => {
    let verworfen = false;
    Promise.all([api.termine(ladeVon, ladeBis), mitAbwesenheiten ? api.abwesenheiten(ladeVon, ladeBis) : Promise.resolve([])])
      .then(([t, a]) => {
        // Schnelles Durchblaettern: eine spaete Antwort fuer einen laengst verlassenen Zeitraum darf die aktuelle nicht ueberschreiben.
        if (verworfen) return;
        setTermine(t);
        setAbwesenheiten(a);
        setFehler(null);
      })
      .catch((err) => {
        if (!verworfen) setFehler(err instanceof Error ? err.message : "Termine konnten nicht geladen werden.");
      });
    return () => {
      verworfen = true;
    };
  }, [ladeVon, ladeBis, mitAbwesenheiten]);

  useEffect(laden, [laden]);

  useEffect(() => {
    if (mitAbwesenheiten) api.stundenKalenderEinstellungen().then(setStundenEinst).catch(() => setStundenEinst(null));
  }, [mitAbwesenheiten]);

  useEffect(() => {
    if (mitAbwesenheiten) api.abwesenheitRechte().then(setAbwRechte).catch(() => {});
  }, [mitAbwesenheiten]);

  // Gefiltert wird hier einmal fuer alle drei Ansichten: der Filter bleibt
  // beim Umschalten zwischen Woche, Monat und Jahr erhalten.
  const sichtTermine = useMemo(() => termine.filter((t) => terminPasst(t, filter)), [termine, filter]);
  const sichtAbwesenheiten = useMemo(() => abwesenheiten.filter((a) => abwesenheitPasst(a, filter)), [abwesenheiten, filter]);

  const nachTag = useMemo(() => {
    const karte = new Map<string, TerminDto[]>();
    for (const t of sichtTermine) for (const tag of tageVon(t)) karte.set(tag, [...(karte.get(tag) ?? []), t]);
    for (const liste of karte.values()) liste.sort(sortiere);
    return karte;
  }, [sichtTermine]);

  const abwNachTag = useMemo(() => {
    const karte = new Map<string, AbwesenheitDto[]>();
    for (const a of sichtAbwesenheiten) for (const tag of abwesenheitTage(a, addTage)) karte.set(tag, [...(karte.get(tag) ?? []), a]);
    return karte;
  }, [sichtAbwesenheiten]);

  const { liste: mitarbeitende, farbIndizes } = useMitarbeitendeMitFarbe();
  /** Personenfarbe eines Termins: nur fuer von Mitarbeitenden angelegte Termine, deren Konto die Liste kennt. */
  const farbIndexVon = (t: TerminDto): number | undefined =>
    t.erstelltVon.art === "benutzer" ? farbIndizes.get(t.erstelltVon.id) : undefined;

  const listenTage = ansicht === "woche" ? wochenTage : ansicht === "monat" ? rasterTage.filter((t) => t.startsWith(monat)) : [];
  const listeMitTerminen = listenTage.filter((t) => (nachTag.get(t) ?? []).length > 0);

  // Legende: alle Mitarbeitenden, die im sichtbaren Zeitraum einen Termin
  // eingetragen haben. Zugeordnet wird nach der Person, die den Termin
  // angelegt hat -- wer sich "Urlaub" oder "Fortbildung" eintraegt, ist
  // genau die Person, die dann weg ist. Von Klient:innen angelegte Termine
  // bleiben neutral (keine Personenfarbe fuer Klient:innen).
  const sichtbareTage = new Set(
    ansicht === "jahr" ? [...new Set([...nachTag.keys(), ...abwNachTag.keys()])].filter((t) => t.startsWith(jahr)) : listenTage,
  );
  const legende = [
    ...new Map([
      ...[...sichtbareTage]
        .flatMap((tag) => nachTag.get(tag) ?? [])
        .filter((t) => farbIndexVon(t) !== undefined)
        .map((t) => [t.erstelltVon.id, { name: t.erstelltVon.name, farbIndex: farbIndexVon(t)! }] as const),
      ...[...sichtbareTage]
        .flatMap((tag) => abwNachTag.get(tag) ?? [])
        .filter((a) => farbIndizes.has(a.benutzer.id))
        .map((a) => [a.benutzer.id, { name: a.benutzer.name, farbIndex: farbIndizes.get(a.benutzer.id)! }] as const),
    ]),
  ].sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"));
  const artenImBlick = KALENDER_ARTEN.filter((art) =>
    [...sichtbareTage].some(
      (tag) => (nachTag.get(tag) ?? []).some((t) => !t.abgesagtAm && t.art === art) || (abwNachTag.get(tag) ?? []).some((a) => abwesenheitArt(a) === art),
    ),
  );

  // Ein Tag im Jahresueberblick: aktive Termine und Abwesenheiten bestimmen
  // die Farbe, abgesagte Termine nicht (wer abgesagt hat, ist ja da).
  const jahresTag = (tag: string) => {
    const liste = nachTag.get(tag) ?? [];
    const abw = abwNachTag.get(tag) ?? [];
    const aktiv = liste.filter((t) => !t.abgesagtAm);
    const arten = KALENDER_ARTEN.filter((art) => aktiv.some((t) => t.art === art) || abw.some((a) => abwesenheitArt(a) === art));
    // Je Person ein Streifen; von Klient:innen angelegte Termine teilen sich einen neutralen.
    const personen = [
      ...new Map([
        ...abw.map((a) => [farbIndizes.get(a.benutzer.id) ?? "neutral", farbIndizes.get(a.benutzer.id)] as const),
        ...aktiv.map((t) => [farbIndexVon(t) ?? "neutral", farbIndexVon(t)] as const),
      ]).values(),
    ];
    const anzahl = aktiv.length + abw.length;
    const sammel = farbModus === "art" ? arten.length >= SAMMEL_AB : anzahl >= SAMMEL_AB;
    return { liste, abw, aktiv, anzahl, arten, personen, sammel, ecke: wichtigsteArt(arten) };
  };
  const sammelImJahr = ansicht === "jahr" && [...sichtbareTage].some((tag) => jahresTag(tag).sammel);

  // Personen fuer den Filter: aktive Konten plus alle, die im geladenen
  // Zeitraum vorkommen (auch deaktivierte mit alten Eintraegen).
  const personenOptionen = [
    ...new Map([
      ...mitarbeitende.filter((m) => m.aktiv).map((m) => [m.id, m.name] as const),
      ...termine.filter((t) => t.erstelltVon.art === "benutzer").map((t) => [t.erstelltVon.id, t.erstelltVon.name] as const),
      ...abwesenheiten.map((a) => [a.benutzer.id, a.benutzer.name] as const),
    ]),
  ]
    .map(([wert, label]) => ({ wert, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));
  // "abwesend" ist nur eine Art fuer alle, die den Grund nicht sehen duerfen.
  const artOptionen = KALENDER_ARTEN.filter((a) =>
    !mitAbwesenheiten ? !istAbwesenheitsArt(a) : a === "abwesend" ? !abwRechte.artSehen : true,
  );

  useEffect(() => {
    if (!vorschau) return;
    // Tippen ausserhalb schliesst: iOS-Safari fokussiert Knoepfe beim Tippen
    // nicht, ein blur kommt dort also nie.
    const aussen = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".zv-kal-mini-tag")) setVorschau(null);
    };
    document.addEventListener("pointerdown", aussen);
    return () => document.removeEventListener("pointerdown", aussen);
  }, [vorschau]);

  useEffect(() => setVorschau(null), [ansicht, jahr]);

  // `scrollen` nur bei Tippen und Tastatur: am Handy haengt die Vorschau eines
  // Tages im unteren Bildrand sonst unsichtbar unter der Navigationsleiste.
  // Beim Maus-Hover nicht -- die Seite wuerde unter dem Zeiger wegrutschen.
  function vorschauZeigen(tag: string, knopf: HTMLElement, scrollen: boolean) {
    setVorschau({ tag, oben: knopf.offsetTop + knopf.offsetHeight + 4, scrollen });
  }

  function schritt(richtung: 1 | -1) {
    setGewaehlt((alt) => (ansicht === "woche" ? addTage(alt, 7 * richtung) : addMonate(alt, (ansicht === "monat" ? 1 : 12) * richtung)));
  }

  const monatsName = datumAusKey(`${monat}-01`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const zeitraumName =
    ansicht === "jahr"
      ? jahr
      : ansicht === "monat"
        ? monatsName
        : `KW ${kalenderwoche(datumAusKey(wochenTage[0]))} · ${formatDatum(wochenTage[0])} – ${formatDatum(wochenTage[6])}`;
  // Grammatik der Knopfbeschriftung: die Woche, der Monat, das Jahr.
  const endung = ansicht === "monat" ? "r" : ansicht === "jahr" ? "s" : "";
  const einheit = ansicht === "woche" ? "Woche" : ansicht === "monat" ? "Monat" : "Jahr";
  const detail = termine.find((t) => t.id === detailId) ?? null;

  function ersetzen(t: TerminDto) {
    setTermine((alt) => alt.map((x) => (x.id === t.id ? t : x)));
  }

  function tagKnopf(tag: string, fremd: boolean) {
    const liste = nachTag.get(tag) ?? [];
    const abw = abwNachTag.get(tag) ?? [];
    const aktiv = liste.filter((t) => !t.abgesagtAm).length;
    return (
      <button
        type="button"
        key={tag}
        role="gridcell"
        className={`zv-kal-tag${tag === gewaehlt ? " gewaehlt" : ""}${tag === heute ? " heute" : ""}${fremd ? " fremd" : ""}`}
        onClick={() => setGewaehlt(tag)}
        aria-label={`${formatDatum(tag)}${liste.length ? `, ${terminWort(liste.length)}` : ""}${abw.length ? `, ${abw.length} abwesend` : ""}`}
        aria-pressed={tag === gewaehlt}
      >
        <span className="zv-kal-tag-zahl">{Number(tag.slice(8))}</span>
        {(liste.length > 0 || abw.length > 0) && (
          <span className="zv-kal-punkte" aria-hidden="true">
            {/* Abwesenheiten als Ring statt Punkt: "fehlt" ist etwas anderes als "hat einen Termin". */}
            {abw.slice(0, 3).map((a) => {
              const fi = farbIndizes.get(a.benutzer.id);
              return <span key={a.id} className="zv-kal-punkt zv-kal-punkt-abwesend zv-person-farbe" style={fi === undefined ? undefined : personFarbStil(fi)} />;
            })}
            {liste
              .filter((t) => !t.abgesagtAm)
              .slice(0, Math.max(0, 3 - abw.length))
              .map((t) => {
                const fi = farbIndexVon(t);
                return fi === undefined ? (
                  <span key={t.id} className="zv-kal-punkt" />
                ) : (
                  <span key={t.id} className="zv-kal-punkt zv-person-farbe" style={personFarbStil(fi)} />
                );
              })}
            {aktiv === 0 && <span className="zv-kal-punkt abgesagt" />}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="zv-kalender">
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      <div className="zv-seiten-kopf">
        <h2>{titel}</h2>
        <div className="zv-kal-kopf-aktionen">
        <button
          className="zv-btn"
          onClick={() => {
            setNeuUhrzeit(undefined);
            setNeuOffen(true);
          }}
        >
          <INeu />
          Neuer Termin
        </button>
        {mitAbwesenheiten && (
          <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setAbwNeuOffen(true)}>
            <INeu />
            Abwesenheit
          </button>
        )}
        </div>
      </div>

      <div className="zv-kal-umschalter">
        <div className="zv-segmented" role="tablist" aria-label="Ansicht">
          {ANSICHTEN.map((a) => (
            <button key={a.wert} type="button" role="tab" aria-selected={ansicht === a.wert} className={ansicht === a.wert ? "active" : ""} onClick={() => setAnsicht(a.wert)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <Filterleiste ariaLabel="Kalender filtern" aktiv={filterAktiv(filter) || farbModus !== "person"} onZuruecksetzen={() => (setFilter(KEIN_FILTER), setFarbModus("person"))}>
        {personenOptionen.length > 0 && (
          <FilterPille
            icon={<IPerson />}
            label="Mitarbeitende"
            wert={filter.personen.length > 0 ? `: ${auswahlText(filter.personen.map((id) => personenOptionen.find((o) => o.wert === id)?.label ?? "?"))}` : null}
            onEntfernen={() => setFilter((f) => ({ ...f, personen: [] }))}
          >
            {() => <FilterMehrfachAuswahl optionen={personenOptionen} gewaehlt={filter.personen} onAendern={(personen) => setFilter((f) => ({ ...f, personen }))} durchsuchbar />}
          </FilterPille>
        )}
        <FilterPille
          icon={<ITag />}
          label="Art"
          wert={filter.arten.length > 0 ? `: ${auswahlText(filter.arten.map((a) => KALENDER_ART_LABEL[a]))}` : null}
          onEntfernen={() => setFilter((f) => ({ ...f, arten: [] }))}
        >
          {() => (
            <FilterMehrfachAuswahl
              optionen={artOptionen.map((a) => ({ wert: a, label: istAbwesenheitsArt(a) ? `Abwesenheit: ${KALENDER_ART_LABEL[a]}` : KALENDER_ART_LABEL[a] }))}
              gewaehlt={filter.arten}
              onAendern={(arten) => setFilter((f) => ({ ...f, arten }))}
              durchsuchbar={false}
            />
          )}
        </FilterPille>
        {ansicht === "jahr" && (
          <div className="zv-segmented zv-kal-farbmodus" role="radiogroup" aria-label="Farbe der Tage nach">
            <span className="zv-kal-farbmodus-titel" aria-hidden="true">
              <IDarstellung />
              Farbe nach
            </span>
            {(["person", "art"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={farbModus === m} className={farbModus === m ? "active" : ""} onClick={() => setFarbModus(m)}>
                {m === "person" ? "Person" : "Art"}
              </button>
            ))}
          </div>
        )}
      </Filterleiste>

      <div className="zv-kal-navigation">
        <button type="button" className="zv-icon-btn" onClick={() => schritt(-1)} aria-label={`Vorherige${endung} ${einheit}`}>
          <IZurueckPfeil />
        </button>
        <strong className="zv-kal-monat" aria-live="polite">
          {zeitraumName}
        </strong>
        <button type="button" className="zv-icon-btn" onClick={() => schritt(1)} aria-label={`Nächste${endung} ${einheit}`}>
          <IVor />
        </button>
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => setGewaehlt(heute)}>
          Heute
        </button>
      </div>

      {ansicht !== "jahr" && (
        <AbwesenheitsZeile
          abwesenheiten={sichtAbwesenheiten.filter((a) => a.bis >= listenTage[0] && a.von <= listenTage[listenTage.length - 1])}
          farbIndizes={farbIndizes}
          onOeffnen={setAbwDetail}
        />
      )}

      {/* Container fuer die Breitenabfrage Zeitraster/Kacheln (app.css). Bewusst nicht
          .zv-kalender selbst: Containment macht das Element zum Bezugsrahmen fuer
          position: fixed, und die Dialoge unten wuerden darin eingesperrt. */}
      <div className="zv-kal-inhalt">
      {ansicht === "jahr" ? (
        <div className="zv-kal-jahr" data-testid="kalender-jahr">
          {Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, "0")}`).map((m) => {
            const zellen = miniMonat(m);
            const anzahl = zellen.reduce((n, tag) => n + (tag && ((nachTag.get(tag) ?? []).length > 0 || abwNachTag.has(tag)) ? 1 : 0), 0);
            const name = datumAusKey(`${m}-01`).toLocaleDateString("de-DE", { month: "long" });
            return (
              <section key={m} className={`zv-kal-mini${m === heute.slice(0, 7) ? " heute" : ""}`}>
                <button
                  type="button"
                  className="zv-kal-mini-titel"
                  onClick={() => {
                    setGewaehlt(m === heute.slice(0, 7) ? heute : `${m}-01`);
                    setAnsicht("monat");
                  }}
                  aria-label={`${name} ${jahr} öffnen${anzahl ? `, ${anzahl} Tag${anzahl === 1 ? "" : "e"} mit Terminen` : ""}`}
                >
                  {name}
                </button>
                <div className="zv-kal-mini-raster">
                  {WOCHENTAGE.map((w) => (
                    <span key={w} className="zv-kal-mini-kopf" aria-hidden="true">
                      {w.slice(0, 1)}
                    </span>
                  ))}
                  {zellen.map((tag, i) => {
                    if (!tag) return <span key={`leer-${i}`} aria-hidden="true" />;
                    const { liste, abw, aktiv, anzahl: tagAnzahl, arten, personen, sammel, ecke } = jahresTag(tag);
                    const heuteKlasse = tag === heute ? " heute" : "";
                    if (liste.length === 0 && abw.length === 0) {
                      return (
                        <span key={tag} className={`zv-kal-mini-tag${heuteKlasse}`} aria-hidden="true">
                          {Number(tag.slice(8))}
                        </span>
                      );
                    }
                    const farbig = !sammel && (farbModus === "art" ? arten.length > 0 : personen.some((fi) => fi !== undefined));
                    const offen = vorschau?.tag === tag;
                    const zustand = tagAnzahl === 0 ? " abgesagt" : sammel ? " belegt sammel" : ` belegt${farbig ? " personfarbe" : ""}`;
                    const namen = [...new Set(aktiv.map((t) => t.erstelltVon.name))].join(", ");
                    const abwesendText = abw.map((a) => (a.art ? `${a.benutzer.name} (${KALENDER_ART_LABEL[a.art]})` : a.benutzer.name)).join(", ");
                    // Die Ecke traegt nur im Personenmodus Information: im Artmodus ist die Flaeche selbst schon die Art.
                    const mitEcke = farbModus === "person" && ecke !== null && tagAnzahl > 0;
                    return (
                      <button
                        type="button"
                        key={tag}
                        className={`zv-kal-mini-tag${heuteKlasse}${zustand}`}
                        data-tag={tag}
                        aria-label={[
                          formatDatum(tag),
                          liste.length > 0 ? `${terminWort(liste.length)}${namen ? ` von ${namen}` : ""}` : null,
                          abw.length > 0 ? `abwesend: ${abwesendText}` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                        aria-describedby={offen ? `kal-vorschau-${tag}` : undefined}
                        aria-expanded={offen}
                        onPointerDown={(e) => (letzterZeiger.current = e.pointerType)}
                        onPointerEnter={(e: ReactPointerEvent<HTMLButtonElement>) => e.pointerType === "mouse" && vorschauZeigen(tag, e.currentTarget, false)}
                        onPointerLeave={(e) => e.pointerType === "mouse" && document.activeElement !== e.currentTarget && setVorschau(null)}
                        onFocus={(e) => e.currentTarget.matches(":focus-visible") && vorschauZeigen(tag, e.currentTarget, true)}
                        onBlur={() => setVorschau((v) => (v?.tag === tag ? null : v))}
                        onKeyDown={(e) => e.key === "Escape" && offen && (e.stopPropagation(), setVorschau(null))}
                        onClick={(e) => {
                          // Maus: Hover hat schon geoeffnet, Klick haelt offen. Tippen und Enter schalten um.
                          if (offen && letzterZeiger.current !== "mouse") setVorschau(null);
                          else vorschauZeigen(tag, e.currentTarget, letzterZeiger.current !== "mouse");
                          letzterZeiger.current = "";
                        }}
                      >
                        {farbig && (
                          <span className="zv-kal-mini-farben" aria-hidden="true">
                            {farbModus === "art"
                              ? arten.map((a) => <span key={a} className={`zv-art-flaeche zv-art-${a}`} />)
                              : personen.map((fi, j) =>
                                  fi === undefined ? (
                                    <span key={`n${j}`} className="zv-kal-mini-neutral" />
                                  ) : (
                                    <span key={fi} className="zv-person-flaeche" style={personFarbStil(fi)} />
                                  ),
                                )}
                          </span>
                        )}
                        <span className="zv-kal-mini-zahl">{Number(tag.slice(8))}</span>
                        {mitEcke && <span className={`zv-kal-ecke zv-art-${ecke}`} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
                {vorschau && vorschau.tag.startsWith(m) && (
                  <TagesVorschau
                    id={`kal-vorschau-${vorschau.tag}`}
                    tag={vorschau.tag}
                    oben={vorschau.oben}
                    scrollen={vorschau.scrollen}
                    termine={nachTag.get(vorschau.tag) ?? []}
                    abwesenheiten={abwNachTag.get(vorschau.tag) ?? []}
                    farbIndexVon={farbIndexVon}
                    farbIndizes={farbIndizes}
                  />
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          {ansicht === "woche" && (
            <WochenZeitraster
              wochenTage={wochenTage}
              heute={heute}
              gewaehlt={gewaehlt}
              termine={sichtTermine}
              farbIndexVon={farbIndexVon}
              onTagWaehlen={setGewaehlt}
              onTerminOeffnen={setDetailId}
              onNeu={(tag, uhrzeit) => {
                setGewaehlt(tag);
                setNeuUhrzeit(uhrzeit);
                setNeuOffen(true);
              }}
            />
          )}
        <div className={`zv-kal-raster${ansicht === "woche" ? " zv-kal-nur-schmal" : ""}`} role="grid" aria-label={ansicht === "woche" ? `Wochenübersicht ${zeitraumName}` : `Monatsübersicht ${monatsName}`}>
          {WOCHENTAGE.map((w) => (
            <div key={w} className="zv-kal-wochentag" role="columnheader">
              {w}
            </div>
          ))}
          {ansicht === "woche" ? wochenTage.map((tag) => tagKnopf(tag, false)) : rasterTage.map((tag) => tagKnopf(tag, !tag.startsWith(monat)))}
        </div>
        </>
      )}

      {ansicht !== "jahr" && (
        <div className={ansicht === "woche" ? "zv-kal-nur-schmal" : undefined}>
        {listeMitTerminen.length === 0 ? (
          <Leerzustand icon={ILeerKalender} aktion={<button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => (setNeuUhrzeit(undefined), setNeuOffen(true))}>Termin anlegen</button>}>
            Keine Termine in diesem Zeitraum.
          </Leerzustand>
        ) : (
          listeMitTerminen.map((tag) => (
            <div key={tag} className="zv-kal-gruppe">
              <h4 className="zv-etagen-kopf">{formatTagTrenner(`${tag}T12:00:00`)}</h4>
              <ul className="zv-kal-liste">
                {(nachTag.get(tag) ?? []).map((t) => (
                  <li key={t.id}>
                    <button type="button" className="zv-kal-termin" onClick={() => setDetailId(t.id)}>
                      {farbIndexVon(t) !== undefined && (
                        <span className="zv-kal-person-streifen zv-person-farbe" style={personFarbStil(farbIndexVon(t)!)} aria-hidden="true" />
                      )}
                      <span className="zv-kal-zeit">{formatTerminUhrzeit(t)}</span>
                      <span className="zv-kal-termin-text">
                        <strong className={t.abgesagtAm ? "zv-durchgestrichen" : undefined}>
                          {t.stunden?.vorgemerkt && !t.abgesagtAm && <IStunden className="zv-kal-stunden-marke" role="img" aria-hidden={false} aria-label="Als Betreuungszeit vorgemerkt" />}
                          {t.titel}
                        </strong>
                        <span>
                          {t.art !== "termin" && <span className={`zv-art-marke zv-art-${t.art}`}>{KALENDER_ART_LABEL[t.art]}</span>}
                          {t.erstelltVon.name}
                          {t.ort && ` · ${t.ort}`}
                        </span>
                      </span>
                      {t.abgesagtAm ? (
                        <span className="zv-pill zv-pill-danger">Abgesagt</span>
                      ) : t.meineAntwort && t.meineAntwort !== "zugesagt" ? (
                        <span className={`zv-pill ${t.meineAntwort === "abgelehnt" ? "zv-pill-danger" : "zv-pill-offen"}`}>{TERMIN_ANTWORT_LABEL[t.meineAntwort]}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        </div>
      )}
      </div>

      {(legende.length > 0 || sammelImJahr || artenImBlick.length > 0) && (
        <div className="zv-kal-legende" role="list" aria-label="Legende der Farben">
          {farbModus === "art" && ansicht === "jahr" ? (
            <>
              <span className="zv-kal-legende-titel">Arten</span>
              {artenImBlick.map((a) => (
                <span key={a} className="zv-kal-legende-eintrag" role="listitem">
                  <span className={`zv-person-punkt zv-art-flaeche zv-art-${a}`} aria-hidden="true" />
                  {KALENDER_ART_LABEL[a]}
                </span>
              ))}
            </>
          ) : (
            <>
          <span className="zv-kal-legende-titel">Farben</span>
          {legende.map(([id, p]) => (
            <span key={id} className="zv-kal-legende-eintrag" role="listitem">
              <span className="zv-person-punkt zv-person-farbe" style={personFarbStil(p.farbIndex)} aria-hidden="true" />
              {p.name}
            </span>
          ))}
          {sammelImJahr && (
            <span className="zv-kal-legende-eintrag" role="listitem">
              <span className="zv-person-punkt zv-kal-sammel-punkt" aria-hidden="true" />
              Mehr als {SAMMEL_AB - 1} {farbModus === "art" ? "Arten" : "Einträge"} am Tag
            </span>
          )}
          {ansicht === "jahr" && artenImBlick.length > 0 && (
            <>
              <span className="zv-kal-legende-titel">Ecke = Art</span>
              {artenImBlick.map((a) => (
                <span key={a} className="zv-kal-legende-eintrag" role="listitem">
                  <ArtDreieck art={a} />
                  {KALENDER_ART_LABEL[a]}
                </span>
              ))}
            </>
          )}
            </>
          )}
        </div>
      )}

      {neuOffen && (
        <NeuerTermin
          standardDatum={gewaehlt}
          standardUhrzeit={neuUhrzeit}
          kontakteLaden={kontakteLaden}
          stunden={stundenEinst}
          onClose={() => setNeuOffen(false)}
          onAngelegt={(t) => {
            setNeuOffen(false);
            setGewaehlt(terminTag(t.beginn, t.ganztaegig));
            laden();
          }}
        />
      )}
      {abwNeuOffen && (
        <AbwesenheitEintragen
          standardDatum={gewaehlt}
          verwalten={abwRechte.verwalten}
          mitarbeitende={mitarbeitende}
          ichId={tokenBenutzerId()}
          onClose={() => setAbwNeuOffen(false)}
          onAngelegt={() => {
            setAbwNeuOffen(false);
            laden();
          }}
        />
      )}
      {abwDetail && (
        <AbwesenheitDetail
          abwesenheit={abwDetail}
          onClose={() => setAbwDetail(null)}
          onStorniert={() => {
            setAbwDetail(null);
            laden();
          }}
        />
      )}
      {detail && <TerminDetail termin={detail} stunden={stundenEinst} onClose={() => setDetailId(null)} onGeaendert={ersetzen} />}
    </div>
  );
}

/** Tagesvorschau im Jahresueberblick: rein lesend (role=tooltip), bearbeitet wird in Woche/Monat. */
function TagesVorschau({
  id,
  tag,
  oben,
  scrollen,
  termine,
  abwesenheiten,
  farbIndexVon,
  farbIndizes,
}: {
  id: string;
  tag: string;
  oben: number;
  scrollen: boolean;
  termine: TerminDto[];
  abwesenheiten: AbwesenheitDto[];
  farbIndexVon: (t: TerminDto) => number | undefined;
  farbIndizes: Map<string, number>;
}) {
  // Abwesenheiten zuerst: "wer fehlt" ist die Frage, mit der man in den Jahresueberblick schaut.
  const platzFuerTermine = Math.max(0, VORSCHAU_MAX - abwesenheiten.length);
  const rest = termine.length - platzFuerTermine;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollen) ref.current?.scrollIntoView({ block: "nearest" });
  }, [scrollen, tag]);
  return (
    <div ref={ref} className="zv-kal-vorschau" role="tooltip" id={id} data-testid="kalender-vorschau" style={{ top: oben }}>
      <strong className="zv-kal-vorschau-kopf">
        {formatTagTrenner(`${tag}T12:00:00`)}
        {termine.length > 0 && ` · ${terminWort(termine.length)}`}
        {abwesenheiten.length > 0 && ` · ${abwesenheiten.length} abwesend`}
      </strong>
      <ul>
        {abwesenheiten.map((a) => {
          const fi = farbIndizes.get(a.benutzer.id);
          const art = abwesenheitArt(a);
          return (
            <li key={a.id}>
              {fi === undefined ? (
                <span className="zv-person-punkt zv-kal-vorschau-punkt" aria-hidden="true" />
              ) : (
                <span className="zv-person-punkt zv-person-farbe" style={personFarbStil(fi)} aria-hidden="true" />
              )}
              <span className="zv-kal-vorschau-zeit">ganztägig</span>
              <span className="zv-kal-vorschau-text">
                <strong>{a.benutzer.name}</strong> <span className={`zv-art-marke zv-art-${art}`}>{KALENDER_ART_LABEL[art]}</span>
              </span>
            </li>
          );
        })}
        {termine.slice(0, platzFuerTermine).map((t) => {
          const fi = farbIndexVon(t);
          return (
            <li key={t.id}>
              {fi === undefined ? (
                <span className="zv-person-punkt zv-kal-vorschau-punkt" aria-hidden="true" />
              ) : (
                <span className="zv-person-punkt zv-person-farbe" style={personFarbStil(fi)} aria-hidden="true" />
              )}
              <span className="zv-kal-vorschau-zeit">{formatTerminUhrzeit(t)}</span>
              <span className="zv-kal-vorschau-text">
                <strong className={t.abgesagtAm ? "zv-durchgestrichen" : undefined}>{t.titel}</strong>
                {t.abgesagtAm && " (abgesagt)"} <span>· {t.erstelltVon.name}</span>{" "}
                {t.art !== "termin" && <span className={`zv-art-marke zv-art-${t.art}`}>{KALENDER_ART_LABEL[t.art]}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {rest > 0 && <span className="zv-kal-vorschau-zeit">und {rest} weitere</span>}
    </div>
  );
}

function NeuerTermin({
  standardDatum,
  standardUhrzeit,
  kontakteLaden,
  stunden,
  onClose,
  onAngelegt,
}: {
  standardDatum: string;
  standardUhrzeit?: string;
  kontakteLaden: () => Promise<ChatKontaktDto[]>;
  stunden: KalenderStundenEinstellungenDto | null;
  onClose: () => void;
  onAngelegt: (t: TerminDto) => void;
}) {
  const [kontakte, setKontakte] = useState<ChatKontaktDto[] | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    kontakteLaden().then(setKontakte).catch(() => setKontakte([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function absenden(eingabe: TerminAnlegenEingabe) {
    setLaeuft(true);
    setFehler(null);
    try {
      onAngelegt(await api.terminAnlegen(eingabe));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termin konnte nicht angelegt werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Neuer Termin" onClose={onClose}>
      {kontakte === null ? (
        <p className="zv-sub">Wird geladen…</p>
      ) : (
        <TerminFormular
          standardDatum={standardDatum}
          standardUhrzeit={standardUhrzeit}
          kontakte={kontakte}
          mitBeschreibung
          absendenLabel="Termin anlegen"
          wirdGesendet={laeuft}
          fehler={fehler}
          onAbsenden={absenden}
          stunden={stunden}
        />
      )}
    </Modal>
  );
}

function TerminDetail({
  termin,
  stunden,
  onClose,
  onGeaendert,
}: {
  termin: TerminDto;
  stunden: KalenderStundenEinstellungenDto | null;
  onClose: () => void;
  onGeaendert: (t: TerminDto) => void;
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  // Haken neben "Zusagen" fuer Eingeladene, vorbelegt aus der eigenen Voreinstellung (Konzept 3.2).
  const stundenMoeglich = !!stunden?.funktionAn && !!stunden.darfBuchen && !!termin.stunden && !termin.stunden.hindernis;
  const [zusageMitStunden, setZusageMitStunden] = useState(stunden?.vorauswahlZusage ?? false);
  const [absagenFrage, setAbsagenFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function aktion(fn: () => Promise<TerminDto | void>, fallback: string) {
    setLaeuft(true);
    setFehler(null);
    try {
      const neu = await fn();
      if (neu) onGeaendert(neu);
      return true;
    } catch (err) {
      setFehler(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setLaeuft(false);
    }
  }

  if (bearbeiten) {
    return (
      <Modal titel="Termin bearbeiten" onClose={() => setBearbeiten(false)}>
        <TerminFormular
          initial={termin}
          mitBeschreibung
          absendenLabel="Änderungen speichern"
          wirdGesendet={laeuft}
          fehler={fehler}
          stunden={stunden}
          onAbsenden={async (e) => {
            const ok = await aktion(
              () =>
                api.terminAendern(termin.id, {
                  titel: e.titel,
                  beschreibung: e.beschreibung ?? null,
                  ort: e.ort ?? null,
                  beginn: e.beginn,
                  ende: e.ende,
                  ganztaegig: e.ganztaegig,
                  art: e.art,
                  ...(e.stundenErfassen !== undefined ? { stundenErfassen: e.stundenErfassen, stundenLeistungsart: e.stundenLeistungsart ?? null } : {}),
                }),
              "Termin konnte nicht gespeichert werden."
            );
            if (ok) setBearbeiten(false);
          }}
        />
      </Modal>
    );
  }

  const abgesagt = !!termin.abgesagtAm;
  return (
    <Modal titel={termin.titel} onClose={onClose}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {abgesagt && <span className="zv-pill zv-pill-danger">Abgesagt</span>}
      <dl className="zv-datenliste" style={{ marginTop: "var(--zv-space-2)" }}>
        <dt>Wann</dt>
        <dd className={abgesagt ? "zv-durchgestrichen" : undefined}>{formatTerminZeit(termin)}</dd>
        {termin.ort && (
          <>
            <dt>Ort</dt>
            <dd>{termin.ort}</dd>
          </>
        )}
        {termin.beschreibung && (
          <>
            <dt>Beschreibung</dt>
            <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{termin.beschreibung}</dd>
          </>
        )}
        <dt>Erstellt von</dt>
        <dd>{termin.erstelltVon.name}</dd>
      </dl>

      {termin.stunden && stunden?.funktionAn && stunden.darfBuchen && (
        <TerminStunden termin={termin} laeuft={laeuft} onVormerken={(v) => void aktion(() => api.terminStundenVormerken(termin.id, v), "Vormerkung fehlgeschlagen.")} />
      )}

      <h3 className="zv-etagen-kopf">Teilnehmende ({termin.teilnehmer.length})</h3>
      <ul className="zv-kontaktliste">
        {termin.teilnehmer.map((t) => (
          <li key={`${t.art}:${t.id}`} className="zv-kontakt-zeile">
            <span className="zv-kontakt-name">{t.name}</span>
            <span className={`zv-pill ${t.antwort === "zugesagt" ? "zv-pill-ok" : t.antwort === "abgelehnt" ? "zv-pill-danger" : "zv-pill-offen"}`}>{TERMIN_ANTWORT_LABEL[t.antwort]}</span>
          </li>
        ))}
      </ul>

      <div className="zv-aktionszeile" style={{ marginTop: "var(--zv-space-4)" }}>
        {!abgesagt && termin.meineAntwort !== null && (
          <>
            <button
              type="button"
              className="zv-btn"
              disabled={laeuft || termin.meineAntwort === "zugesagt"}
              onClick={() =>
                void aktion(() => api.terminAntworten(termin.id, "zugesagt", stundenMoeglich ? zusageMitStunden : undefined), "Zusage fehlgeschlagen.")
              }
            >
              Zusagen
            </button>
            {stundenMoeglich && termin.meineAntwort !== "zugesagt" && (
              <label className="zv-checkbox-zeile">
                <input type="checkbox" checked={zusageMitStunden} onChange={(e) => setZusageMitStunden(e.target.checked)} />
                Als Betreuungszeit erfassen
              </label>
            )}
            <button type="button" className="zv-btn zv-btn-sekundaer" disabled={laeuft || termin.meineAntwort === "abgelehnt"} onClick={() => void aktion(() => api.terminAntworten(termin.id, "abgelehnt"), "Absage fehlgeschlagen.")}>
              Ablehnen
            </button>
          </>
        )}
        {!abgesagt && termin.meineAntwort === null && (
          <button type="button" className="zv-btn" disabled={laeuft} onClick={() => void aktion(() => api.terminUebernehmen(termin.id), "Termin konnte nicht übernommen werden.")}>
            In meinen Kalender übernehmen
          </button>
        )}
        <button type="button" className="zv-btn zv-btn-still" disabled={laeuft} onClick={() => void aktion(() => api.terminIcsHerunterladen(termin.id), "Download fehlgeschlagen.")}>
          <IHerunterladen />
          .ics herunterladen
        </button>
      </div>

      {termin.binErsteller && !abgesagt && (
        <div className="zv-aktionszeile" style={{ marginTop: "var(--zv-space-3)" }}>
          <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setBearbeiten(true)} disabled={laeuft}>
            <IBearbeiten />
            Bearbeiten
          </button>
          {absagenFrage ? (
            <>
              <button type="button" className="zv-btn zv-btn-gefahr" disabled={laeuft} onClick={() => void aktion(() => api.terminAbsagen(termin.id), "Termin konnte nicht abgesagt werden.").then(() => setAbsagenFrage(false))}>
                Ja, Termin absagen
              </button>
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setAbsagenFrage(false)}>
                Abbrechen
              </button>
            </>
          ) : (
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => setAbsagenFrage(true)} disabled={laeuft}>
              <IStornieren />
              Termin absagen
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Abschnitt "Stunden" im Termindetail: nur die EIGENE Vormerkung und die
 * eigenen Buchungen -- ueber fremde sagt der Termin nichts. Abgleichen gibt es
 * nicht als Knopf: nach einer Aenderung storniert die Anwendung die alte
 * Buchung und bucht neu (Entscheidung vom 20.11.2026), beides bleibt sichtbar.
 */
function TerminStunden({ termin, laeuft, onVormerken }: { termin: TerminDto; laeuft: boolean; onVormerken: (v: boolean) => void }) {
  const s = termin.stunden!;
  const gueltig = s.buchungen.filter((b) => !b.storniert);
  const automatisch = s.buchungen.filter((b) => b.stornoAutomatisch);
  const vorbei = new Date(termin.ende).getTime() <= Date.now();
  const klientAnzahl = termin.teilnehmer.filter((t) => t.art === "klient" && t.antwort !== "abgelehnt").length;
  const leistung = LEISTUNGSART_LABEL[terminStundenLeistungsart(termin.stundenLeistungsart, klientAnzahl)];
  const abgesagt = !!termin.abgesagtAm;
  return (
    <section className="zv-termin-stunden">
      <h3 className="zv-etagen-kopf">Stunden</h3>
      {gueltig.length > 0 ? (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          <span>
            Gebucht: {gueltig.map((b) => `${formatMinutenAlsStunden(b.minuten)} ${LEISTUNGSART_LABEL[b.leistungsart]} für ${b.klientName}`).join(", ")}.
            {automatisch.length > 0 && " Automatisch neu gebucht, weil der Termin geändert wurde."}
          </span>
        </div>
      ) : automatisch.length > 0 ? (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          <span>Die Buchung wurde automatisch storniert ({automatisch[0].stornoGrund}).</span>
        </div>
      ) : s.buchungen.length > 0 ? (
        <p className="zv-sub">Die Buchung aus diesem Termin wurde storniert ({s.buchungen[0].stornoGrund}).</p>
      ) : s.vorgemerkt && !s.hindernis && !abgesagt ? (
        <p className="zv-sub">
          Vorgemerkt: {formatMinutenAlsStunden(s.minuten ?? 0)} {leistung}
          {vorbei ? ". Nicht gebucht – Grund siehe „Stunden“." : ", gebucht wird nach dem Ende des Termins."}
        </p>
      ) : (
        <p className="zv-sub">{s.hindernis ?? "Nicht als Betreuungszeit vorgemerkt."}</p>
      )}
      {!abgesagt && termin.meineAntwort !== "abgelehnt" && !s.hindernis && (
        <label className="zv-checkbox-zeile">
          <input type="checkbox" checked={s.vorgemerkt} disabled={laeuft} onChange={(e) => onVormerken(e.target.checked)} />
          Als Betreuungszeit erfassen
        </label>
      )}
    </section>
  );
}
