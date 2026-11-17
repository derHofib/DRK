import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ChatKontaktDto, TerminAnlegenEingabe, TerminDto } from "@zimmerakte/shared";
import { TERMIN_ANTWORT_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { TerminFormular } from "../components/TerminFormular";
import { IBearbeiten, IFehler, IHerunterladen, ILeerKalender, INeu, IStornieren, IVor, IZurueckPfeil } from "../components/icons";
import { personFarbStil, useFarbIndizes } from "../personFarbe";
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

/**
 * `kontakteLaden`: woher die waehlbaren Teilnehmenden kommen. Mitarbeitende
 * nutzen die Voreinstellung (/chat/kontakte); fuer Klient:innen liefert
 * dieser Endpunkt bewusst nichts -- sie koennen nur Personen eintragen, mit
 * denen sie einen gemeinsamen Chat haben (KlientShell leitet sie daraus ab).
 */
export function Kalender({ titel = "Kalender", kontakteLaden = () => api.chatKontakte() }: { titel?: string; kontakteLaden?: () => Promise<ChatKontaktDto[]> }) {
  const heute = lokalesDatum(new Date());
  // `gewaehlt` ist der einzige Zeitanker: Woche, Monat und Jahr leiten sich daraus ab.
  // So landet man beim Umschalten immer im Zeitraum, den man gerade ansieht.
  const [gewaehlt, setGewaehlt] = useState(heute);
  const [ansicht, setAnsicht] = useState<Ansicht>("woche");
  const [termine, setTermine] = useState<TerminDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
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
    api
      .termine(ladeVon, ladeBis)
      .then((t) => {
        // Schnelles Durchblaettern: eine spaete Antwort fuer einen laengst verlassenen Zeitraum darf die aktuelle nicht ueberschreiben.
        if (verworfen) return;
        setTermine(t);
        setFehler(null);
      })
      .catch((err) => {
        if (!verworfen) setFehler(err instanceof Error ? err.message : "Termine konnten nicht geladen werden.");
      });
    return () => {
      verworfen = true;
    };
  }, [ladeVon, ladeBis]);

  useEffect(laden, [laden]);

  const nachTag = useMemo(() => {
    const karte = new Map<string, TerminDto[]>();
    for (const t of termine) for (const tag of tageVon(t)) karte.set(tag, [...(karte.get(tag) ?? []), t]);
    for (const liste of karte.values()) liste.sort(sortiere);
    return karte;
  }, [termine]);

  const farbIndizes = useFarbIndizes();
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
  const sichtbareTage = new Set(ansicht === "jahr" ? [...nachTag.keys()].filter((t) => t.startsWith(jahr)) : listenTage);
  const legende = [
    ...new Map(
      [...sichtbareTage]
        .flatMap((tag) => nachTag.get(tag) ?? [])
        .filter((t) => farbIndexVon(t) !== undefined)
        .map((t) => [t.erstelltVon.id, { name: t.erstelltVon.name, farbIndex: farbIndexVon(t)! }] as const),
    ),
  ].sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"));

  // Ein Tag im Jahresueberblick: aktive Termine bestimmen die Farbe,
  // abgesagte nicht (wer abgesagt hat, ist ja da).
  const jahresTag = (tag: string) => {
    const liste = nachTag.get(tag) ?? [];
    const aktiv = liste.filter((t) => !t.abgesagtAm);
    // Je Person ein Streifen; von Klient:innen angelegte Termine teilen sich einen neutralen.
    const personen = [...new Map(aktiv.map((t) => [farbIndexVon(t) ?? "neutral", farbIndexVon(t)] as const)).values()];
    return { liste, aktiv, personen, sammel: aktiv.length >= SAMMEL_AB };
  };
  const sammelImJahr = ansicht === "jahr" && [...sichtbareTage].some((tag) => jahresTag(tag).sammel);

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
    const aktiv = liste.filter((t) => !t.abgesagtAm).length;
    return (
      <button
        type="button"
        key={tag}
        role="gridcell"
        className={`zv-kal-tag${tag === gewaehlt ? " gewaehlt" : ""}${tag === heute ? " heute" : ""}${fremd ? " fremd" : ""}`}
        onClick={() => setGewaehlt(tag)}
        aria-label={`${formatDatum(tag)}${liste.length ? `, ${terminWort(liste.length)}` : ""}`}
        aria-pressed={tag === gewaehlt}
      >
        <span className="zv-kal-tag-zahl">{Number(tag.slice(8))}</span>
        {liste.length > 0 && (
          <span className="zv-kal-punkte" aria-hidden="true">
            {liste
              .filter((t) => !t.abgesagtAm)
              .slice(0, 3)
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
        <button className="zv-btn" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neuer Termin
        </button>
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

      {ansicht === "jahr" ? (
        <div className="zv-kal-jahr" data-testid="kalender-jahr">
          {Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, "0")}`).map((m) => {
            const zellen = miniMonat(m);
            const anzahl = zellen.reduce((n, tag) => n + (tag && (nachTag.get(tag) ?? []).length > 0 ? 1 : 0), 0);
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
                    const { liste, aktiv, personen, sammel } = jahresTag(tag);
                    const heuteKlasse = tag === heute ? " heute" : "";
                    if (liste.length === 0) {
                      return (
                        <span key={tag} className={`zv-kal-mini-tag${heuteKlasse}`} aria-hidden="true">
                          {Number(tag.slice(8))}
                        </span>
                      );
                    }
                    const farbig = !sammel && personen.some((fi) => fi !== undefined);
                    const offen = vorschau?.tag === tag;
                    const zustand = aktiv.length === 0 ? " abgesagt" : sammel ? " belegt sammel" : ` belegt${farbig ? " personfarbe" : ""}`;
                    const namen = [...new Set(aktiv.map((t) => t.erstelltVon.name))].join(", ");
                    return (
                      <button
                        type="button"
                        key={tag}
                        className={`zv-kal-mini-tag${heuteKlasse}${zustand}`}
                        data-tag={tag}
                        aria-label={`${formatDatum(tag)}, ${terminWort(liste.length)}${namen ? ` von ${namen}` : ""}`}
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
                            {personen.map((fi, j) =>
                              fi === undefined ? (
                                <span key={`n${j}`} className="zv-kal-mini-neutral" />
                              ) : (
                                <span key={fi} className="zv-person-flaeche" style={personFarbStil(fi)} />
                              ),
                            )}
                          </span>
                        )}
                        <span className="zv-kal-mini-zahl">{Number(tag.slice(8))}</span>
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
                    farbIndexVon={farbIndexVon}
                  />
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="zv-kal-raster" role="grid" aria-label={ansicht === "woche" ? `Wochenübersicht ${zeitraumName}` : `Monatsübersicht ${monatsName}`}>
          {WOCHENTAGE.map((w) => (
            <div key={w} className="zv-kal-wochentag" role="columnheader">
              {w}
            </div>
          ))}
          {ansicht === "woche" ? wochenTage.map((tag) => tagKnopf(tag, false)) : rasterTage.map((tag) => tagKnopf(tag, !tag.startsWith(monat)))}
        </div>
      )}

      {ansicht !== "jahr" &&
        (listeMitTerminen.length === 0 ? (
          <Leerzustand icon={ILeerKalender} aktion={<button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setNeuOffen(true)}>Termin anlegen</button>}>
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
                        <strong className={t.abgesagtAm ? "zv-durchgestrichen" : undefined}>{t.titel}</strong>
                        <span>
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
        ))}

      {(legende.length > 0 || sammelImJahr) && (
        <div className="zv-kal-legende" role="list" aria-label="Farben je Mitarbeiter:in">
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
              Mehr als {SAMMEL_AB - 1} Termine am Tag
            </span>
          )}
        </div>
      )}

      {neuOffen && (
        <NeuerTermin
          standardDatum={gewaehlt}
          kontakteLaden={kontakteLaden}
          onClose={() => setNeuOffen(false)}
          onAngelegt={(t) => {
            setNeuOffen(false);
            setGewaehlt(terminTag(t.beginn, t.ganztaegig));
            laden();
          }}
        />
      )}
      {detail && <TerminDetail termin={detail} onClose={() => setDetailId(null)} onGeaendert={ersetzen} />}
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
  farbIndexVon,
}: {
  id: string;
  tag: string;
  oben: number;
  scrollen: boolean;
  termine: TerminDto[];
  farbIndexVon: (t: TerminDto) => number | undefined;
}) {
  const rest = termine.length - VORSCHAU_MAX;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollen) ref.current?.scrollIntoView({ block: "nearest" });
  }, [scrollen, tag]);
  return (
    <div ref={ref} className="zv-kal-vorschau" role="tooltip" id={id} data-testid="kalender-vorschau" style={{ top: oben }}>
      <strong className="zv-kal-vorschau-kopf">
        {formatTagTrenner(`${tag}T12:00:00`)} · {terminWort(termine.length)}
      </strong>
      <ul>
        {termine.slice(0, VORSCHAU_MAX).map((t) => {
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
                {t.abgesagtAm && " (abgesagt)"} <span>· {t.erstelltVon.name}</span>
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
  kontakteLaden,
  onClose,
  onAngelegt,
}: {
  standardDatum: string;
  kontakteLaden: () => Promise<ChatKontaktDto[]>;
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
        <TerminFormular standardDatum={standardDatum} kontakte={kontakte} mitBeschreibung absendenLabel="Termin anlegen" wirdGesendet={laeuft} fehler={fehler} onAbsenden={absenden} />
      )}
    </Modal>
  );
}

function TerminDetail({ termin, onClose, onGeaendert }: { termin: TerminDto; onClose: () => void; onGeaendert: (t: TerminDto) => void }) {
  const [bearbeiten, setBearbeiten] = useState(false);
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
          onAbsenden={async (e) => {
            const ok = await aktion(
              () => api.terminAendern(termin.id, { titel: e.titel, beschreibung: e.beschreibung ?? null, ort: e.ort ?? null, beginn: e.beginn, ende: e.ende, ganztaegig: e.ganztaegig }),
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
            <button type="button" className="zv-btn" disabled={laeuft || termin.meineAntwort === "zugesagt"} onClick={() => void aktion(() => api.terminAntworten(termin.id, "zugesagt"), "Zusage fehlgeschlagen.")}>
              Zusagen
            </button>
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
