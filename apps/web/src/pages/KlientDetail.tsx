import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  BenutzerListEintragDto,
  HilfeplanDto,
  KlientEintragArt,
  VerlaufDto,
  VerlaufRechteDto,
  KassenbuchungDto,
  KlientDetailDto,
  KlientKontaktDto,
  KlientStammdatenDto,
  KostenuebernahmeDto,
  RechnungDto,
  RechnungStatus,
  TagDto,
  TagesberichtDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { HZL_RHYTHMUS_LABEL, RECHNUNG_STATUS_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { AktionsMenue } from "../components/AktionsMenue";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { KlientZugang } from "../components/KlientZugang";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { NeuerEintragFenster } from "../components/NeuerEintrag";
import { NeuerTagesberichtFenster } from "../components/NeuerTagesbericht";
import { Reiterleiste, reiterPanelProps, type ReiterEintrag } from "../components/Reiterleiste";
import {
  IAbbrechen,
  IAblehnen,
  IArchivieren,
  IAufklappen,
  IAuszahlen,
  IAuszug,
  IBearbeiten,
  IBeenden,
  IDokument,
  IEinziehen,
  IEntarchivieren,
  IFehler,
  IGenehmigen,
  IGeplant,
  IHerunterladen,
  ILeerKassenbuch,
  ILeerKontakte,
  ILeerKostenuebernahmen,
  ILeerRechnungen,
  ILeerTagesberichte,
  ILoeschen,
  INeu,
  ISErledigt,
  ISOffen,
  ISStorniert,
  ISpeichern,
  ITagesberichte,
  IWarteliste,
  IZurueck,
} from "../components/icons";
import { dateiZuBase64 } from "../datei";
import { formatBetrag, formatDatum, heuteBerlin, lokalesDatum } from "../format";
import { HilfeplanTab } from "./klient/HilfeplanTab";
import { ProtokolleTab } from "./klient/ProtokolleTab";
import { ProtokollSprungKontext, type ProtokollSprung } from "../components/ProtokollSprung";
import { VerlaufTab, verlaufArtLabel, verlaufKlasse } from "./klient/VerlaufTab";
import { berichtFormularTexte, TagesberichtZeile, TagVorschlaegeDatalist } from "./Tagesberichte";
import { Datumsfeld, Monatsfeld, Zeitraumfeld } from "../components/Datumsfeld";

type Tab = "ueberblick" | "verlauf" | "dokumentation" | "hilfeplan" | "finanzen" | "akte";
type DokuTeil = "tagesberichte" | "protokolle";
type FinanzTeil = "kassenbuch" | "kostenuebernahmen" | "rechnungen";
type AkteTeil = "stammdaten" | "kontakte" | "zugang";

interface AkteAnsicht {
  tab: Tab;
  doku: DokuTeil;
  finanz: FinanzTeil;
  akte: AkteTeil;
}

const ANSICHT_SCHLUESSEL = "zv-akte-ansicht";
const ANSICHT_START: AkteAnsicht = { tab: "ueberblick", doku: "tagesberichte", finanz: "kassenbuch", akte: "stammdaten" };

/**
 * Welcher Reiter (und welcher Umschalter darin) zuletzt offen war, fuer die
 * Sitzung gemerkt: wer gerade die Kassenbuecher mehrerer Klient:innen
 * durchgeht, soll nicht bei jeder Akte neu auf "Finanzen" klicken muessen
 * (Konzept klienten-ansicht, 3.3 Punkt 4). sessionStorage statt Zustand im
 * Elternteil, weil das Panel beim Schliessen die Akte abbaut. Nur
 * Ansichtsangaben, keine Daten -- und ohne Speicher (privates Fenster)
 * startet die Akte eben im Ueberblick.
 */
function ansichtLesen(): AkteAnsicht {
  try {
    const roh = sessionStorage.getItem(ANSICHT_SCHLUESSEL);
    return roh ? { ...ANSICHT_START, ...(JSON.parse(roh) as Partial<AkteAnsicht>) } : ANSICHT_START;
  } catch {
    return ANSICHT_START;
  }
}

function ansichtMerken(a: AkteAnsicht) {
  try {
    sessionStorage.setItem(ANSICHT_SCHLUESSEL, JSON.stringify(a));
  } catch {
    // Kein Speicher verfuegbar: dann eben ohne Gedaechtnis.
  }
}

/** Segment-Umschalter innerhalb eines Reiters (wie in der Anwaerter-Ansicht). */
function Umschalter<T extends string>({
  label,
  wert,
  optionen,
  onWahl,
}: {
  label: string;
  wert: T;
  optionen: { wert: T; label: string }[];
  onWahl: (w: T) => void;
}) {
  return (
    <div className="zv-segmented zv-akte-umschalter" role="radiogroup" aria-label={label}>
      {optionen.map((o) => (
        <button
          key={o.wert}
          type="button"
          role="radio"
          aria-checked={wert === o.wert}
          className={wert === o.wert ? "active" : ""}
          onClick={() => onWahl(o.wert)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


export function KlientDetail({
  klientId,
  onZurueck,
  startProtokoll,
  zurueckText = "Zurück zur Liste",
}: {
  klientId: string;
  onZurueck: () => void;
  /** Aus dem Zimmer-Panel geoeffnet fuehrt "Zurueck" zum Zimmer, nicht zur Liste. */
  zurueckText?: string;
  /** Sprung von ausserhalb (Seite Dokumentation, „In der Akte öffnen“). */
  startProtokoll?: ProtokollSprung;
}) {
  const [klient, setKlient] = useState<KlientDetailDto | null>(null);
  const [ansicht, setAnsichtRoh] = useState<AkteAnsicht>(() =>
    startProtokoll ? { ...ansichtLesen(), tab: "dokumentation", doku: "protokolle" } : ansichtLesen()
  );
  // Aus einem Tagesbericht geoeffnetes Protokoll (Konzept protokoll-ansicht,
  // Variante A): im selben Panel unter Protokolle statt als drittes Fenster.
  const [protokollSprung, setProtokollSprung] = useState<ProtokollSprung | null>(startProtokoll ?? null);
  const [markierterBericht, setMarkierterBericht] = useState<string | null>(null);
  const tab = ansicht.tab;
  // Fuer Zaehler am Reiter und als Ersatz fuer den Verlauf im Ueberblick,
  // wenn das Verlaufsrecht fehlt; nach jedem Tabwechsel neu geholt, damit
  // ein im Tab angelegter Bericht sofort zaehlt.
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [berichtFormularBeiStart, setBerichtFormularBeiStart] = useState(false);
  const [verlaufRechte, setVerlaufRechte] = useState<VerlaufRechteDto | null>(null);
  const [eintragFenster, setEintragFenster] = useState<{ art: KlientEintragArt } | null>(null);
  // Zaehlt bei jedem neuen Eintrag hoch; Verlauf und Ueberblick laden dann neu.
  const [verlaufStand, setVerlaufStand] = useState(0);
  const [fehler, setFehler] = useState<string | null>(null);
  const [anonymisierenOffen, setAnonymisierenOffen] = useState(false);
  const [wirdAnonymisiert, setWirdAnonymisiert] = useState(false);
  const [archivierenOffen, setArchivierenOffen] = useState(false);
  const [entarchivierenOffen, setEntarchivierenOffen] = useState(false);
  const [wirdArchiviert, setWirdArchiviert] = useState(false);

  const setAnsicht = useCallback((teil: Partial<AkteAnsicht>) => {
    setAnsichtRoh((alt) => {
      const neu = { ...alt, ...teil };
      ansichtMerken(neu);
      return neu;
    });
  }, []);
  const setTab = useCallback((t: Tab) => setAnsicht({ tab: t }), [setAnsicht]);

  function laden() {
    api.klient(klientId).then(setKlient).catch((err) => setFehler(err.message));
  }

  useEffect(laden, [klientId]);

  useEffect(() => {
    api.verlaufRechte().then(setVerlaufRechte).catch(() => setVerlaufRechte(null));
  }, []);

  const berichteLaden = useCallback(() => {
    api.tagesberichteListe({ klientId }).then(setBerichte).catch(() => setBerichte([]));
  }, [klientId]);
  useEffect(berichteLaden, [berichteLaden, tab]);

  function berichtSchreiben() {
    setBerichtFormularBeiStart(true);
    setAnsicht({ tab: "dokumentation", doku: "tagesberichte" });
  }

  function eintragAnlegen(art: KlientEintragArt = "notiz") {
    setEintragFenster({ art });
  }

  async function anonymisieren() {
    setFehler(null);
    setWirdAnonymisiert(true);
    try {
      await api.klientAnonymisieren(klientId);
      setAnonymisierenOffen(false);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Klient:in konnte nicht anonymisiert werden.");
    } finally {
      setWirdAnonymisiert(false);
    }
  }

  async function archivieren() {
    setFehler(null);
    setWirdArchiviert(true);
    try {
      await api.klientArchivieren(klientId);
      setArchivierenOffen(false);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Klient:in konnte nicht archiviert werden.");
    } finally {
      setWirdArchiviert(false);
    }
  }

  async function entarchivieren() {
    setFehler(null);
    setWirdArchiviert(true);
    try {
      await api.klientEntarchivieren(klientId);
      setEntarchivierenOffen(false);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Klient:in konnte nicht entarchiviert werden.");
    } finally {
      setWirdArchiviert(false);
    }
  }

  async function archivPdfHerunterladen(archivId: string) {
    if (!klient) return;
    setFehler(null);
    try {
      await api.klientArchivPdfHerunterladen(
        klientId,
        archivId,
        `Aktenauszug_${klient.nachname}_${klient.vorname}.pdf`
      );
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Aktenauszug konnte nicht heruntergeladen werden.");
    }
  }

  const archiviert = !!klient?.archiviertAm;
  const darfEintragen = !!verlaufRechte?.anlegen && !archiviert;
  const zeigeVerlauf = verlaufRechte?.ansehen ?? false;

  const reiter: ReiterEintrag<Tab>[] = [
    { wert: "ueberblick", label: "Überblick" },
    ...(zeigeVerlauf ? [{ wert: "verlauf" as const, label: "Verlauf" }] : []),
    { wert: "dokumentation", label: "Dokumentation", zaehler: berichte.length },
    { wert: "hilfeplan", label: "Hilfeplan" },
    { wert: "finanzen", label: "Finanzen" },
    { wert: "akte", label: "Akte" },
  ];
  // Gemerkter Reiter "Verlauf", aber hier kein Recht dazu: Ueberblick zeigen.
  const sichtbarerTab: Tab = tab === "verlauf" && verlaufRechte && !zeigeVerlauf ? "ueberblick" : tab;

  const sprungWege = useMemo(
    () => ({
      imSelbenPanel: (s: ProtokollSprung) => {
        setProtokollSprung(s);
        setMarkierterBericht(null);
        setAnsicht({ tab: "dokumentation", doku: "protokolle" });
      },
    }),
    [setAnsicht]
  );
  // Wer Protokolle verlaesst (anderer Reiter, Umschalter), hat den Sprung
  // hinter sich; beim naechsten Oeffnen von Protokolle zeigt es die Liste.
  const imProtokollTeil = sichtbarerTab === "dokumentation" && ansicht.doku === "protokolle";
  useEffect(() => {
    if (!imProtokollTeil) setProtokollSprung(null);
  }, [imProtokollTeil]);
  // Die Markierung gilt nur fuer die Rueckkehr, nicht fuer spaetere Besuche.
  const imTagesberichtTeil = sichtbarerTab === "dokumentation" && ansicht.doku === "tagesberichte";
  useEffect(() => {
    if (!imTagesberichtTeil) setMarkierterBericht(null);
  }, [imTagesberichtTeil]);

  return (
    <ProtokollSprungKontext.Provider value={sprungWege}>
    <div className="zv-akte">
      <button className="zv-link-btn" onClick={onZurueck} style={{ marginBottom: 14 }}>
        <IZurueck />
        {zurueckText}
      </button>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {/* Zwei Zeilen statt vier (Konzept klienten-ansicht, 3.1): Name, dann
          nur was zur Orientierung noetig ist. Aktenzeichen, Amt, HZL und
          "seit" stehen im Ueberblick unter "Auf einen Blick". Archivieren
          und das nicht umkehrbare Anonymisieren liegen im Menue statt als
          gleichrangige Knoepfe neben der Hauptaktion. */}
      {klient && (
        <header className="zv-akte-kopf">
          <span className="zv-initialen-kachel" aria-hidden="true">
            {klient.vorname.charAt(0)}
            {klient.nachname.charAt(0)}
          </span>
          <div className="zv-akte-titel">
            <h2>
              {klient.vorname} {klient.nachname}
              {klient.archiviertAm && (
                <span className="zv-pill zv-pill-neutral">
                  <IArchivieren />
                  Archiviert {formatDatum(klient.archiviertAm.slice(0, 10))}
                </span>
              )}
              {klient.anonymisiertAm && (
                <span className="zv-pill zv-pill-vergeben">
                  <ILoeschen />
                  Anonymisiert
                </span>
              )}
            </h2>
            <p className="zv-akte-meta">
              {[
                klient.geburtsdatum ? `${alterIn(klient.geburtsdatum)} J.` : null,
                klient.aktuellesZimmer
                  ? `Zimmer ${klient.aktuellesZimmer.nummer}, ${klient.aktuellesZimmer.standortName}`
                  : "Kein Zimmer",
                klient.stammdaten?.bezugsbetreuerName ? `Bezug: ${klient.stammdaten.bezugsbetreuerName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="zv-akte-aktionen">
            {darfEintragen ? (
              <button type="button" className="zv-btn" onClick={() => eintragAnlegen()}>
                <INeu />
                Eintrag
              </button>
            ) : (
              !archiviert && (
                <button type="button" className="zv-btn" onClick={berichtSchreiben}>
                  <INeu />
                  Tagesbericht
                </button>
              )
            )}
            <AktionsMenue label="Weitere Aktionen zur Akte">
              {darfEintragen && (
                <button type="button" role="menuitem" onClick={berichtSchreiben}>
                  <ITagesberichte />
                  Tagesbericht schreiben
                </button>
              )}
              {klient.archivPdfs.map((pdf) => (
                <button key={pdf.id} type="button" role="menuitem" onClick={() => archivPdfHerunterladen(pdf.id)}>
                  <IHerunterladen />
                  Aktenauszug {formatDatum(pdf.erstelltAm.slice(0, 10))}
                </button>
              ))}
              {klient.archiviertAm ? (
                <button type="button" role="menuitem" onClick={() => setEntarchivierenOffen(true)}>
                  <IEntarchivieren />
                  Entarchivieren
                </button>
              ) : (
                <button type="button" role="menuitem" onClick={() => setArchivierenOffen(true)}>
                  <IArchivieren />
                  Archivieren
                </button>
              )}
              {!klient.anonymisiertAm && (
                <button type="button" role="menuitem" className="zv-menue-gefahr" onClick={() => setAnonymisierenOffen(true)}>
                  <ILoeschen />
                  Anonymisieren …
                </button>
              )}
            </AktionsMenue>
          </div>
        </header>
      )}

      {klient && eintragFenster && (
        <NeuerEintragFenster
          klientId={klientId}
          klientName={`${klient.vorname} ${klient.nachname}`}
          startArt={eintragFenster.art}
          kontakte={klient.kontakte}
          onSchliessen={() => setEintragFenster(null)}
          onAngelegt={() => {
            setEintragFenster(null);
            setVerlaufStand((n) => n + 1);
          }}
        />
      )}

      {anonymisierenOffen && (
        <Modal titel="Klient:in anonymisieren" onClose={() => setAnonymisierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Name und Geburtsdatum dieses Klienten werden dauerhaft überschrieben (Recht auf Löschung, Art. 17
            DSGVO). Aktenzeichen, Amt sowie Kassenbuch- und Rechnungshistorie bleiben als Belege erhalten. Diese
            Aktion kann nicht rückgängig gemacht werden.
          </p>
          <button className="zv-btn zv-btn-gefahr zv-btn-block" onClick={anonymisieren} disabled={wirdAnonymisiert}>
            <ILoeschen />
            {wirdAnonymisiert ? "Wird anonymisiert…" : "Klient:in jetzt anonymisieren"}
          </button>
        </Modal>
      )}

      {archivierenOffen && (
        <Modal titel="Klient:in archivieren" onClose={() => setArchivierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Es wird ein vollständiger PDF-Aktenauszug erzeugt (Stammdaten, Kontakte, Unterbringungshistorie,
            Kassenbuch, Kostenübernahmen, Rechnungen, Tagesberichte samt Anhängen, Verlauf) und dauerhaft
            gespeichert. Der Klient wird anschließend eingefroren -- keine neuen Einträge, Buchungen, Rechnungen
            oder Änderungen mehr möglich -- und aus der Klientenliste ausgeblendet. Das lässt sich jederzeit wieder
            aufheben.
          </p>
          <button className="zv-btn zv-btn-block" onClick={archivieren} disabled={wirdArchiviert}>
            <IArchivieren />
            {wirdArchiviert ? "Wird archiviert…" : "Klient:in jetzt archivieren"}
          </button>
        </Modal>
      )}

      {entarchivierenOffen && (
        <Modal titel="Klient:in entarchivieren" onClose={() => setEntarchivierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Der Klient ist danach wieder normal bearbeitbar und erscheint wieder in der aktiven Klientenliste. Die
            bereits erzeugten Aktenauszüge bleiben unverändert erhalten.
          </p>
          <button className="zv-btn zv-btn-block" onClick={entarchivieren} disabled={wirdArchiviert}>
            <IEntarchivieren />
            {wirdArchiviert ? "Wird entarchiviert…" : "Klient:in jetzt entarchivieren"}
          </button>
        </Modal>
      )}

      <Reiterleiste label="Bereiche der Akte" idPraefix="akte" reiter={reiter} aktiv={sichtbarerTab} onWahl={setTab} />

      {archiviert && (
        <div className="zv-hinweis zv-hinweis-info" style={{ marginBottom: 16 }}>
          <IArchivieren />
          Dieser Klient ist archiviert und schreibgeschützt -- neue Einträge sind erst nach dem Entarchivieren
          wieder möglich.
        </div>
      )}

      <div {...reiterPanelProps("akte", sichtbarerTab)}>
        {/* Umschalter ausserhalb des fieldset: sie wechseln nur die Ansicht
            und muessen auch in einer archivierten Akte bedienbar bleiben. */}
        {sichtbarerTab === "dokumentation" && (
          <Umschalter
            label="Art der Dokumentation"
            wert={ansicht.doku}
            onWahl={(doku) => setAnsicht({ doku })}
            optionen={[
              { wert: "tagesberichte", label: "Tagesberichte" },
              { wert: "protokolle", label: "Protokolle" },
            ]}
          />
        )}
        {sichtbarerTab === "finanzen" && (
          <Umschalter
            label="Finanzbereich"
            wert={ansicht.finanz}
            onWahl={(finanz) => setAnsicht({ finanz })}
            optionen={[
              { wert: "kassenbuch", label: "Kassenbuch" },
              { wert: "kostenuebernahmen", label: "Kostenübernahmen" },
              { wert: "rechnungen", label: "Rechnungen" },
            ]}
          />
        )}
        {sichtbarerTab === "akte" && (
          <Umschalter
            label="Bereich der Akte"
            wert={ansicht.akte}
            onWahl={(akte) => setAnsicht({ akte })}
            optionen={[
              { wert: "stammdaten", label: "Stammdaten" },
              { wert: "kontakte", label: "Kontakte" },
              { wert: "zugang", label: "Zugang & Freigaben" },
            ]}
          />
        )}

        {/* fieldset[disabled] deaktiviert automatisch JEDEN verschachtelten
            Button/Input/Select/Textarea in allen Tabs -- inklusive der
            Knoepfe, die ein Bearbeiten-Modal erst OEFFNEN -- ohne dass jede
            einzelne Schreibaktion separat verdrahtet werden muesste. Reine
            Lese-Links (z.B. "Dokument oeffnen") sind davon bewusst nicht
            betroffen, <a> ist kein "listed" Formularelement. Serverseitig
            durchgesetzt ueber klientIstArchiviert() -- dies hier ist nur die
            UI-Spiegelung davon. */}
        <fieldset disabled={archiviert} style={{ border: 0, padding: 0, margin: 0, minInlineSize: "auto" }}>
          {sichtbarerTab === "ueberblick" && klient && (
            <UeberblickTab
              klient={klient}
              berichte={berichte}
              mitVerlauf={zeigeVerlauf}
              verlaufStand={verlaufStand}
              onGanzerVerlauf={() => setTab(zeigeVerlauf ? "verlauf" : "dokumentation")}
              onKontakte={() => setAnsicht({ tab: "akte", akte: "kontakte" })}
              onFinanzen={(finanz) => setAnsicht({ tab: "finanzen", finanz })}
              onHilfeplan={() => setTab("hilfeplan")}
            />
          )}
          {sichtbarerTab === "verlauf" && (
            <VerlaufTab
              klientId={klientId}
              archiviert={archiviert}
              aktualisierung={verlaufStand}
              onNeuerEintrag={(art) => eintragAnlegen(art)}
              onDokumentationOeffnen={(quelle) =>
                setAnsicht({ tab: "dokumentation", doku: quelle === "protokoll" ? "protokolle" : "tagesberichte" })
              }
            />
          )}
          {sichtbarerTab === "dokumentation" && ansicht.doku === "tagesberichte" && (
            <TagesberichteTab
              klientId={klientId}
              markiert={markierterBericht}
              startMitFormular={berichtFormularBeiStart}
              onFormularGenutzt={() => setBerichtFormularBeiStart(false)}
            />
          )}
          {sichtbarerTab === "dokumentation" && ansicht.doku === "protokolle" && (
            <ProtokolleTab
              key={protokollSprung?.protokollId ?? "liste"}
              klientId={klientId}
              archiviert={archiviert}
              start={
                protokollSprung
                  ? {
                      protokollId: protokollSprung.protokollId,
                      ruecksprung: {
                        label: `Zurück zum Tagesbericht vom ${formatDatum(protokollSprung.berichtDatum)}`,
                        onKlick: () => {
                          setMarkierterBericht(protokollSprung.berichtId);
                          setAnsicht({ doku: "tagesberichte" });
                        },
                      },
                    }
                  : undefined
              }
            />
          )}
          {sichtbarerTab === "hilfeplan" && (
            <HilfeplanTab klientId={klientId} onBerichtOeffnen={() => setAnsicht({ tab: "dokumentation", doku: "tagesberichte" })} />
          )}
          {sichtbarerTab === "finanzen" && ansicht.finanz === "kassenbuch" && <KlientKassenbuchTab klientId={klientId} />}
          {sichtbarerTab === "finanzen" && ansicht.finanz === "kostenuebernahmen" && <KostenuebernahmenTab klientId={klientId} />}
          {sichtbarerTab === "finanzen" && ansicht.finanz === "rechnungen" && <RechnungenTab klientId={klientId} />}
          {sichtbarerTab === "akte" && ansicht.akte === "stammdaten" && klient && (
            <StammdatenTab klient={klient} onGeaendert={laden} />
          )}
          {sichtbarerTab === "akte" && ansicht.akte === "kontakte" && klient && (
            <KontakteAbschnitt klientId={klient.id} kontakte={klient.kontakte} onGeaendert={laden} />
          )}
          {sichtbarerTab === "akte" && ansicht.akte === "zugang" && <KlientZugang klientId={klientId} />}
        </fieldset>
      </div>
    </div>
    </ProtokollSprungKontext.Provider>
  );
}

function StammdatenTab({ klient, onGeaendert }: { klient: KlientDetailDto; onGeaendert: () => void }) {
  const [aktuelleKostenuebernahme, setAktuelleKostenuebernahme] = useState<KostenuebernahmeDto | null | undefined>(
    undefined
  );
  const [freieZimmer, setFreieZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [zuweisungOffen, setZuweisungOffen] = useState(false);
  const [auszugOffen, setAuszugOffen] = useState(false);
  const [belegungBearbeitenOffen, setBelegungBearbeitenOffen] = useState(false);
  const [wartelisteOffen, setWartelisteOffen] = useState(false);
  const [alleZimmer, setAlleZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    api.kostenuebernahmenListe(klient.id).then((liste) => {
      setAktuelleKostenuebernahme(liste.find((k) => k.bis === null) ?? null);
    });
  }, [klient.id]);

  useEffect(() => {
    api.zimmerListe().then((liste) => {
      setAlleZimmer(liste);
      if (!klient.aktuellesZimmer) setFreieZimmer(liste.filter((z) => z.bewohner.length < z.kapazitaet));
    });
  }, [klient.id, klient.aktuellesZimmer]);

  // Fuer das Bezugsbetreuer-Dropdown in den Stammdaten -- einmal fuer die
  // ganze Uebersicht geladen statt je Abschnitt neu.
  useEffect(() => {
    api.benutzerListe().then(setBenutzerListe).catch(() => {});
  }, []);

  async function zimmerZuweisen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungEinziehen({
        zimmerId: String(form.get("zimmerId")),
        klientId: klient.id,
        einzug: String(form.get("einzug")),
      });
      setZuweisungOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Zimmer konnte nicht zugewiesen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function auszugEintragen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!klient.aktuellesZimmer) return;
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungAusziehen(klient.aktuellesZimmer.belegungId, String(form.get("auszug")));
      setAuszugOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Auszug konnte nicht eingetragen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function belegungBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!klient.aktuellesZimmer) return;
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      const auszug = String(form.get("auszug"));
      await api.belegungBearbeiten(klient.aktuellesZimmer.belegungId, {
        einzug: String(form.get("einzug")),
        auszug: auszug === "" ? null : auszug,
      });
      setBelegungBearbeitenOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Belegung konnte nicht geändert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function wartelisteHinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerWartelisteHinzufuegen(String(form.get("zimmerId")), klient.id);
      setWartelisteOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Klient:in konnte nicht auf die Warteliste gesetzt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function wartelisteEntfernen(zimmerId: string, eintragId: string) {
    try {
      await api.zimmerWartelisteEntfernen(zimmerId, eintragId);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Eintrag konnte nicht entfernt werden.");
    }
  }

  return (
    <div className="zv-stammdaten">
    <StammdatenSprungliste />
    <div className="zv-stammdaten-gruppen">
    <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 12, fontSize: 14 }}>
        <div style={{ color: "var(--zv-text-muted)" }}>Zimmer</div>
        <div>
          {klient.aktuellesZimmer ? (
            <>
              {klient.aktuellesZimmer.nummer} · {klient.aktuellesZimmer.standortName}{" "}
              {klient.aktuellesZimmer.auszug && (
                <span className="zv-pill zv-pill-info">
                  <IGeplant />
                  Auszug geplant {formatDatum(klient.aktuellesZimmer.auszug)}
                </span>
              )}{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setAuszugOffen(true);
                }}
              >
                <IAuszug />
                Auszug eintragen
              </button>{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setBelegungBearbeitenOffen(true);
                }}
              >
                <IBearbeiten />
                Bearbeiten
              </button>
            </>
          ) : (
            <>
              Kein Zimmer zugeordnet{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setZuweisungOffen(true);
                }}
              >
                <IEinziehen />
                Zimmer zuweisen
              </button>
            </>
          )}
        </div>
        <div style={{ color: "var(--zv-text-muted)" }}>Aktuelle Kostenübernahme</div>
        <div>
          {aktuelleKostenuebernahme === undefined
            ? "…"
            : aktuelleKostenuebernahme
              ? `${aktuelleKostenuebernahme.amt}, seit ${formatDatum(aktuelleKostenuebernahme.von)}`
              : "Kein offener Zeitraum"}
        </div>
        <div style={{ color: "var(--zv-text-muted)" }}>Aufnahme am</div>
        <div>{klient.aufnahmeAm ? formatDatum(klient.aufnahmeAm) : "–"}</div>
        <div style={{ color: "var(--zv-text-muted)" }}>Entlassen am</div>
        <div>{klient.entlassenAm ? formatDatum(klient.entlassenAm) : "–"}</div>
        <div style={{ color: "var(--zv-text-muted)" }}>Wartelisten</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {klient.wartelisten.length === 0 ? (
            <span className="zv-sub-inline">Auf keiner Warteliste</span>
          ) : (
            klient.wartelisten.map((w) => (
              <span key={w.eintragId} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="zv-pill zv-pill-info">
                  <IWarteliste />
                  {w.standortName} · Zimmer {w.zimmerNummer}
                </span>
                <button className="zv-link-btn" onClick={() => wartelisteEntfernen(w.zimmerId, w.eintragId)}>
                  <ILoeschen />
                  Entfernen
                </button>
              </span>
            ))
          )}
          <button
            className="zv-link-btn"
            onClick={() => {
              setFormFehler(null);
              setWartelisteOffen(true);
            }}
          >
            <IWarteliste />
            Auf Warteliste setzen
          </button>
        </div>
      </div>

      {zuweisungOffen && (
        <Modal titel="Zimmer zuweisen" onClose={() => setZuweisungOffen(false)}>
          <form onSubmit={zimmerZuweisen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="klient-zimmer-select">Zimmer</label>
              <select id="klient-zimmer-select" name="zimmerId" required autoFocus defaultValue="">
                <option value="" disabled>
                  Bitte wählen
                </option>
                {freieZimmer.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nummer} · {z.standortName}
                    {z.kapazitaet > 1 ? ` (${z.bewohner.length}/${z.kapazitaet})` : ""}
                  </option>
                ))}
              </select>
              {freieZimmer.length === 0 && (
                <span className="zv-sub-inline">Kein freies Zimmer verfügbar.</span>
              )}
            </div>
            <div className="zv-field">
              <label htmlFor="klient-einzug">Einzugsdatum</label>
              <Datumsfeld id="klient-einzug" name="einzug" required defaultValue={heuteBerlin()} schnellwahl="heute" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IEinziehen />
              {wirdGespeichert ? "Speichert…" : "Einziehen"}
            </button>
          </form>
        </Modal>
      )}

      {auszugOffen && (
        <Modal titel="Auszug eintragen" onClose={() => setAuszugOffen(false)}>
          <form onSubmit={auszugEintragen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="klient-auszug">Auszugsdatum</label>
              <Datumsfeld id="klient-auszug" name="auszug" required autoFocus defaultValue={heuteBerlin()} schnellwahl="heute" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IAuszug />
              {wirdGespeichert ? "Speichert…" : "Auszug speichern"}
            </button>
          </form>
        </Modal>
      )}

      {belegungBearbeitenOffen && klient.aktuellesZimmer && (
        <Modal titel="Belegung bearbeiten" onClose={() => setBelegungBearbeitenOffen(false)}>
          <form onSubmit={belegungBearbeiten}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <p className="zv-sub" style={{ margin: "0 0 12px" }}>
              Nutzen, wenn sich ein Einzug oder Auszug verzögert oder sich geändert hat.
            </p>
            <div className="zv-field-row">
              <Zeitraumfeld
                von={{ id: "klient-belegung-einzug", name: "einzug", label: "Einzugsdatum", required: true }}
                bis={{ id: "klient-belegung-auszug", name: "auszug", label: "Auszugsdatum (optional)" }}
                defaultVon={klient.aktuellesZimmer.einzug}
                defaultBis={klient.aktuellesZimmer.auszug ?? ""}
                autoFocus
              />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}

      {wartelisteOffen && (
        <Modal titel="Auf Warteliste setzen" onClose={() => setWartelisteOffen(false)}>
          <form onSubmit={wartelisteHinzufuegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="klient-warteliste-zimmer">Zimmer</label>
              <select id="klient-warteliste-zimmer" name="zimmerId" required autoFocus defaultValue="">
                <option value="" disabled>
                  Bitte wählen
                </option>
                {alleZimmer
                  .filter(
                    (z) =>
                      z.id !== klient.aktuellesZimmer?.id &&
                      !klient.wartelisten.some((w) => w.zimmerId === z.id)
                  )
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.nummer} · {z.standortName}
                    </option>
                  ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IWarteliste />
              {wirdGespeichert ? "Speichert…" : "Eintragen"}
            </button>
          </form>
        </Modal>
      )}
    </div>

    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Schnelle Informationen"
      felder={SCHNELLE_INFO_FELDER}
      stammdaten={klient.stammdaten}
      benutzerListe={benutzerListe}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Weitere Informationen"
      felder={WEITERE_INFO_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Kontakt / Betreuung"
      felder={KONTAKT_BETREUUNG_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Gesundheit"
      standardOffen={false}
      felder={GESUNDHEIT_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Bildung / Ausbildung"
      felder={BILDUNG_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Vorherige Einrichtung"
      felder={VORHERIGE_EINRICHTUNG_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    </div>
    </div>
  );
}

function alterIn(geburtsdatum: string): number {
  const heute = new Date();
  const [j, m, t] = geburtsdatum.slice(0, 10).split("-").map(Number);
  let alter = heute.getFullYear() - j;
  if (heute.getMonth() + 1 < m || (heute.getMonth() + 1 === m && heute.getDate() < t)) alter -= 1;
  return alter;
}

function tageBis(datum: string): number {
  const [j, m, t] = datum.slice(0, 10).split("-").map(Number);
  const heute = new Date();
  return Math.round(
    (Date.UTC(j, m - 1, t) - Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate())) / 86_400_000,
  );
}

/**
 * Ueberblick (Konzept klienten-ansicht, 3.4): feste Reihenfolge nach
 * Wichtigkeit -- Auf einen Blick, Braucht Aufmerksamkeit, Zuletzt im
 * Verlauf, Kontakte. Im Seitenpanel eine Spalte, im Vollbild zwei; welche,
 * entscheidet die Breite der Akte (Container-Abfrage in app.css), nicht die
 * des Fensters. Geschrieben wird ueber "+ Eintrag" im Kopf, deshalb gibt es
 * hier keinen Schnelleintrag mehr (der legte einen Tagesbericht an, was die
 * Rueckmeldung "Überblick / Chronik" ausdruecklich nicht wollte).
 */
function UeberblickTab({
  klient,
  berichte,
  mitVerlauf,
  verlaufStand,
  onGanzerVerlauf,
  onKontakte,
  onFinanzen,
  onHilfeplan,
}: {
  klient: KlientDetailDto;
  berichte: TagesberichtDto[];
  mitVerlauf: boolean;
  verlaufStand: number;
  onGanzerVerlauf: () => void;
  onKontakte: () => void;
  onFinanzen: (teil: FinanzTeil) => void;
  onHilfeplan: () => void;
}) {
  const [kostenuebernahme, setKostenuebernahme] = useState<KostenuebernahmeDto | null | undefined>(undefined);
  const [barbetragCent, setBarbetragCent] = useState<number | null>(null);
  const [hilfeplan, setHilfeplan] = useState<HilfeplanDto | null>(null);
  const [verlauf, setVerlauf] = useState<VerlaufDto | null>(null);

  useEffect(() => {
    const heute = heuteBerlin();
    api
      .kostenuebernahmenListe(klient.id)
      .then((liste) => {
        const aktuelle = liste
          .filter((k) => k.von <= heute && (k.bis === null || k.bis >= heute))
          .sort((a, b) => b.von.localeCompare(a.von));
        // Abgelaufen ohne Nachfolger ist genau der Fall, der Aufmerksamkeit braucht.
        const juengste = [...liste].sort((a, b) => b.von.localeCompare(a.von))[0] ?? null;
        setKostenuebernahme(aktuelle[0] ?? (juengste && juengste.bis && juengste.bis < heute ? juengste : null));
      })
      .catch(() => setKostenuebernahme(null));
    // Stornierte Buchungen zaehlen nicht -- wie im Kassenstand (siehe
    // kassenbuchung.service.ts: Saldo nur ueber NOT storniert).
    api
      .kassenbuchungenListe({ klientId: klient.id })
      .then((liste) => setBarbetragCent(liste.filter((b) => !b.storniert).reduce((summe, b) => summe + b.betragCent, 0)))
      .catch(() => setBarbetragCent(null));
    api
      .hilfeplaeneListe(klient.id)
      .then((liste) => {
        const laufend = liste
          .filter((p) => p.von <= heute && (p.bis === null || p.bis >= heute))
          .sort((a, b) => b.von.localeCompare(a.von));
        setHilfeplan(laufend[0] ?? null);
      })
      .catch(() => setHilfeplan(null));
  }, [klient.id]);

  useEffect(() => {
    if (!mitVerlauf) return;
    api.verlauf(klient.id).then(setVerlauf).catch(() => setVerlauf(null));
  }, [klient.id, mitVerlauf, verlaufStand]);

  const ku = kostenuebernahme;
  const kuGesamt = ku && ku.bis ? Math.max(1, tageBis(ku.bis) - tageBis(ku.von)) : null;
  const kuVerbleibend = ku && ku.bis ? tageBis(ku.bis) : null;
  const kuFortschritt = kuGesamt && kuVerbleibend !== null ? Math.min(100, Math.max(0, ((kuGesamt - kuVerbleibend) / kuGesamt) * 100)) : 0;

  // Nur, was jetzt Handeln verlangt. Ist nichts davon faellig, entfaellt der
  // ganze Block -- ein "nichts zu tun" waere eine Zeile, die man jedes Mal
  // liest, ohne dass sie etwas sagt.
  const achtung: { schluessel: string; titel: string; meta: string; balken?: number; onKlick?: () => void }[] = [];
  if (ku && kuVerbleibend !== null && kuVerbleibend <= 30) {
    achtung.push({
      schluessel: "ku",
      titel: kuVerbleibend < 0 ? "Kostenübernahme abgelaufen" : "Kostenübernahme endet bald",
      meta: `${ku.amt} · ${kuVerbleibend < 0 ? `seit ${formatDatum(ku.bis!)}` : `noch ${kuVerbleibend} ${kuVerbleibend === 1 ? "Tag" : "Tage"}, bis ${formatDatum(ku.bis!)}`}`,
      balken: kuFortschritt,
      onKlick: () => onFinanzen("kostenuebernahmen"),
    });
  }
  if (hilfeplan?.naechstesGespraech && tageBis(hilfeplan.naechstesGespraech) <= 14) {
    const t = tageBis(hilfeplan.naechstesGespraech);
    achtung.push({
      schluessel: "hp-gespraech",
      titel: t < 0 ? "Hilfeplangespräch überfällig" : "Hilfeplangespräch steht an",
      meta: `${t < 0 ? "war am" : "am"} ${formatDatum(hilfeplan.naechstesGespraech)}`,
      onKlick: onHilfeplan,
    });
  }
  if (hilfeplan?.bis && tageBis(hilfeplan.bis) <= 30) {
    achtung.push({
      schluessel: "hp-ende",
      titel: "Hilfeplan-Fortschreibung fällig",
      meta: `Hilfeplan läuft bis ${formatDatum(hilfeplan.bis)}`,
      onKlick: onHilfeplan,
    });
  }
  if (klient.aktuellesZimmer?.auszug) {
    achtung.push({
      schluessel: "auszug",
      titel: "Auszug geplant",
      meta: `am ${formatDatum(klient.aktuellesZimmer.auszug)} aus Zimmer ${klient.aktuellesZimmer.nummer}`,
    });
  }
  for (const w of verlauf?.wiedervorlagen ?? []) {
    achtung.push({
      schluessel: `wv-${w.schluessel}`,
      titel: w.titel,
      meta: `${w.herkunft === "aufgabe" ? "Aufgabe" : "Wiedervorlage"}${w.datum ? ` · ${formatDatum(w.datum)}` : ""}`,
      onKlick: onGanzerVerlauf,
    });
  }

  const blick: [string, ReactNode][] = [
    [
      "Zimmer",
      klient.aktuellesZimmer ? `${klient.aktuellesZimmer.nummer} · ${klient.aktuellesZimmer.standortName}` : "kein Zimmer",
    ],
    ["seit", klient.aufnahmeAm ? <span className="zv-mono">{formatDatum(klient.aufnahmeAm)}</span> : "–"],
    ["Bezugsbetreuung", klient.stammdaten?.bezugsbetreuerName ?? "–"],
    ["Amt", klient.amt],
    ["Aktenzeichen", <span className="zv-mono">{klient.aktenzeichen}</span>],
    ["HZL", HZL_RHYTHMUS_LABEL[klient.hzlRhythmus]],
    ["Barbetrag", <span className="zv-mono">{barbetragCent === null ? "–" : formatBetrag(barbetragCent)}</span>],
  ];

  const letzteZeilen = (verlauf?.zeilen ?? []).slice(0, 5);

  return (
    <div className="zv-ueberblick">
      <div className="zv-ueberblick-haupt">
        <section className="zv-ueberblick-verlauf" aria-label="Zuletzt im Verlauf">
          <div className="zv-abschnittskopf">
            <h3>Zuletzt im Verlauf</h3>
            <button type="button" className="zv-link-btn" onClick={onGanzerVerlauf}>
              {mitVerlauf ? "Ganzer Verlauf" : "Alle Tagesberichte"}
            </button>
          </div>
          {mitVerlauf ? (
            verlauf === null ? null : letzteZeilen.length === 0 ? (
              <p className="zv-rand-leer">Noch nichts im Verlauf. Neue Einträge über „+ Eintrag“ oben.</p>
            ) : (
              <ol className="zv-chronik">
                {letzteZeilen.map((z) => (
                  <li key={z.schluessel} className={verlaufKlasse(z)}>
                    <span className="zv-chronik-datum zv-mono">
                      {formatDatum(z.ganztaegig ? z.zeitpunkt.slice(0, 10) : lokalesDatum(new Date(z.zeitpunkt)))}
                    </span>
                    <span className="zv-chronik-text">
                      <span className="zv-chronik-titel">
                        <span className="zv-verlauf-punkt" aria-hidden="true" />
                        <span className="zv-verlauf-art">{verlaufArtLabel(z)}</span>
                        {z.titel}
                      </span>
                      {z.text && <span className="zv-chronik-inhalt">{z.text}</span>}
                      {z.autorName && <span className="zv-todo-meta">{z.autorName}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )
          ) : berichte.length === 0 ? (
            <Leerzustand icon={ILeerTagesberichte}>Noch kein Tagesbericht.</Leerzustand>
          ) : (
            <ol className="zv-chronik">
              {berichte.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <span className="zv-chronik-datum zv-mono">{formatDatum(b.datum)}</span>
                  <span className="zv-chronik-text">
                    <span className="zv-chronik-inhalt">{b.text || berichtFormularTexte(b).join(" · ")}</span>
                    <span className="zv-todo-meta">{b.autorName ?? "unbekannt"}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="zv-ueberblick-kontakte" aria-label="Kontakte">
          <div className="zv-abschnittskopf">
            <h3>Kontakte</h3>
            <button type="button" className="zv-link-btn" onClick={onKontakte}>
              Alle
            </button>
          </div>
          {klient.kontakte.length === 0 ? (
            <p className="zv-rand-leer">Keine Kontakte erfasst.</p>
          ) : (
            <ul className="zv-rand-liste zv-ueberblick-liste">
              {klient.kontakte.slice(0, 4).map((k) => (
                <li key={k.id}>
                  <span className="zv-todo-titel">{k.name}</span>
                  <span className="zv-todo-meta">{[k.beziehung, k.telefon].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="zv-ueberblick-rand">
        <section className="zv-ueberblick-blick" aria-label="Auf einen Blick">
          <div className="zv-abschnittskopf">
            <h3>Auf einen Blick</h3>
          </div>
          <dl className="zv-kennwerte">
            {blick.map(([label, wert]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{wert}</dd>
              </div>
            ))}
          </dl>
        </section>

        {achtung.length > 0 && (
          <section className="zv-ueberblick-achtung" aria-label="Braucht Aufmerksamkeit">
            <div className="zv-abschnittskopf">
              <h3>Braucht Aufmerksamkeit</h3>
            </div>
            <ul className="zv-achtung-liste">
              {achtung.map((a) => (
                <li key={a.schluessel}>
                  {a.onKlick ? (
                    <button type="button" className="zv-achtung-eintrag" onClick={a.onKlick}>
                      <AchtungInhalt titel={a.titel} meta={a.meta} balken={a.balken} />
                    </button>
                  ) : (
                    <div className="zv-achtung-eintrag">
                      <AchtungInhalt titel={a.titel} meta={a.meta} balken={a.balken} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function AchtungInhalt({ titel, meta, balken }: { titel: string; meta: string; balken?: number }) {
  return (
    <>
      <span className="zv-todo-titel">{titel}</span>
      <span className="zv-todo-meta">{meta}</span>
      {balken !== undefined && (
        <span className="zv-laufzeit" role="img" aria-label={`${Math.round(balken)} Prozent der Laufzeit vergangen`}>
          <span style={{ width: `${balken}%` }} />
        </span>
      )}
    </>
  );
}

type StammdatenFeldTyp = "text" | "textarea" | "datum" | "benutzer";

interface StammdatenFeld {
  key: keyof Omit<KlientStammdatenDto, "bezugsbetreuerName" | "aktualisiertAm">;
  label: string;
  typ: StammdatenFeldTyp;
}

const SCHNELLE_INFO_FELDER: StammdatenFeld[] = [
  { key: "geburtsort", label: "Geburtsort", typ: "text" },
  { key: "nationalitaet", label: "Nationalität", typ: "text" },
  { key: "sorgeberechtigt", label: "Sorgeberechtigt", typ: "text" },
  { key: "bezugsbetreuerId", label: "Bezugsbetreuer:in", typ: "benutzer" },
  { key: "betreuungsstunden", label: "Betreuungsstunden", typ: "text" },
  { key: "telefon", label: "Telefon", typ: "text" },
  { key: "sprachen", label: "Sprachen", typ: "text" },
  { key: "anmerkungen", label: "Anmerkungen", typ: "textarea" },
];

const WEITERE_INFO_FELDER: StammdatenFeld[] = [
  { key: "personaldokumente", label: "Personaldokumente", typ: "text" },
  { key: "bankkonto", label: "Bankkonto (Kontoinhaber:in)", typ: "text" },
  { key: "iban", label: "IBAN", typ: "text" },
];

const KONTAKT_BETREUUNG_FELDER: StammdatenFeld[] = [
  { key: "jugendamtAdresse", label: "Adresse des Jugendamts", typ: "text" },
  { key: "jugendamtSachbearbeiter", label: "Sachbearbeiter:in", typ: "text" },
  { key: "jugendamtStellenzeichen", label: "Stellenzeichen", typ: "text" },
  { key: "jugendamtTelefon", label: "Telefon Jugendamt", typ: "text" },
  { key: "jugendamtEmail", label: "E-Mail Jugendamt", typ: "text" },
  { key: "wjhName", label: "WJH (Name)", typ: "text" },
  { key: "wjhTelefon", label: "WJH Telefon", typ: "text" },
  { key: "wjhEmail", label: "WJH E-Mail", typ: "text" },
  { key: "personensorgeberechtigte", label: "Personensorgeberechtigte(r)", typ: "text" },
  { key: "besuchskontakte", label: "Besuchskontakte", typ: "textarea" },
];

const GESUNDHEIT_FELDER: StammdatenFeld[] = [
  { key: "krankenkasse", label: "Krankenkasse", typ: "text" },
  { key: "versichertennummer", label: "Versichertennummer", typ: "text" },
  { key: "medikamente", label: "Medikamente", typ: "textarea" },
  { key: "diagnosen", label: "Diagnosen", typ: "textarea" },
  { key: "allergien", label: "Allergien", typ: "textarea" },
  { key: "besonderheitenGesundheitlich", label: "Besonderheiten (gesundheitlich)", typ: "textarea" },
  { key: "besonderheitenPsychisch", label: "Besonderheiten (psychisch)", typ: "textarea" },
];

const BILDUNG_FELDER: StammdatenFeld[] = [
  { key: "schule", label: "Schule", typ: "text" },
  { key: "klassenstufe", label: "Klassenstufe", typ: "text" },
  { key: "schulabschluesse", label: "Schulabschlüsse", typ: "text" },
  { key: "foerderbedarfe", label: "Förderbedarfe", typ: "textarea" },
];

const VORHERIGE_EINRICHTUNG_FELDER: StammdatenFeld[] = [
  { key: "vorherigeEinrichtungTraeger", label: "Träger", typ: "text" },
  { key: "vorherigeEinrichtungKontakt", label: "Kontakt", typ: "text" },
  { key: "vorherigeEinrichtungAnfrageAm", label: "Anfrage am", typ: "datum" },
  { key: "vorherigeEinrichtungEinzugAm", label: "Einzug am", typ: "datum" },
  { key: "vorherigeEinrichtungAuszugAm", label: "Auszug am", typ: "datum" },
];

function anzeigeWert(feld: StammdatenFeld, stammdaten: KlientStammdatenDto | null): string {
  if (!stammdaten) return "–";
  if (feld.typ === "benutzer") return stammdaten.bezugsbetreuerName ?? "–";
  const wert = stammdaten[feld.key] as string | null;
  if (!wert) return "–";
  return feld.typ === "datum" ? formatDatum(wert) : wert;
}

const STAMMDATEN_GRUPPEN = [
  "Schnelle Informationen",
  "Weitere Informationen",
  "Kontakt / Betreuung",
  "Gesundheit",
  "Bildung / Ausbildung",
  "Vorherige Einrichtung",
];

function gruppenId(titel: string): string {
  return titel.toLowerCase().replace(/[^a-z]+/g, "-");
}

/** Sprungliste fuer die Stammdaten im Vollbild; oeffnet eine zugeklappte Gruppe gleich mit. */
function StammdatenSprungliste() {
  return (
    <nav className="zv-stammdaten-sprung" aria-label="Abschnitte der Stammdaten">
      {STAMMDATEN_GRUPPEN.map((t) => (
        <button
          key={t}
          type="button"
          className="zv-link-btn"
          onClick={() => {
            const el = document.getElementById(`stammdaten-${gruppenId(t)}`) as HTMLDetailsElement | null;
            if (!el) return;
            el.open = true;
            el.scrollIntoView({ block: "start" });
          }}
        >
          {t}
        </button>
      ))}
    </nav>
  );
}

function StammdatenAbschnitt({
  klientId,
  titel,
  felder,
  stammdaten,
  benutzerListe,
  onGeaendert,
  standardOffen = true,
}: {
  klientId: string;
  titel: string;
  /** Gesundheit startet zu: Art.-9-Daten nicht nebenbei auf dem Bildschirm (Konzept klienten-ansicht, 3.2). */
  standardOffen?: boolean;
  felder: StammdatenFeld[];
  stammdaten: KlientStammdatenDto | null;
  benutzerListe?: BenutzerListEintragDto[];
  onGeaendert: () => void;
}) {
  const [bearbeitenOffen, setBearbeitenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload: Record<string, string> = {};
    for (const f of felder) {
      const wert = String(form.get(f.key) ?? "");
      // "Nicht zugeordnet" beim Bezugsbetreuer wird bewusst NICHT
      // mitgeschickt: die Spalte ist eine uuid-FK, ein leerer String waere
      // dort kein gueltiger "loeschen"-Wert wie bei Text (siehe
      // KlientStammdatenService.setzen()) -- einmal zugeordnet, laesst sich
      // die Zuordnung ueber dieses Formular nicht wieder entfernen.
      if (f.typ === "benutzer" && wert === "") continue;
      payload[f.key] = wert;
    }
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientStammdatenSetzen(klientId, payload);
      setBearbeitenOffen(false);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Angaben konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <details className="zv-card zv-card-weit zv-stammdaten-gruppe" id={`stammdaten-${gruppenId(titel)}`} open={standardOffen}>
      <summary>
        <h3>{titel}</h3>
        <IAufklappen />
      </summary>
      <div className="zv-stammdaten-gruppe-kopf">
        <button className="zv-link-btn" onClick={() => setBearbeitenOffen(true)}>
          <IBearbeiten />
          Bearbeiten
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr)", rowGap: 10, columnGap: 12, fontSize: 14 }}>
        {felder.map((f) => (
          <div key={f.key} style={{ display: "contents" }}>
            <div style={{ color: "var(--zv-text-muted)" }}>{f.label}</div>
            <div style={{ whiteSpace: f.typ === "textarea" ? "pre-wrap" : undefined }}>
              {anzeigeWert(f, stammdaten)}
            </div>
          </div>
        ))}
      </div>

      {bearbeitenOffen && (
        <Modal titel={titel} onClose={() => setBearbeitenOffen(false)}>
          <form onSubmit={speichern}>
            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {fehler}
              </div>
            )}
            {felder.map((f) => (
              <div className="zv-field" key={f.key}>
                <label htmlFor={`sf-${f.key}`}>{f.label}</label>
                {f.typ === "textarea" ? (
                  <textarea id={`sf-${f.key}`} name={f.key} rows={3} defaultValue={stammdaten?.[f.key] ?? ""} />
                ) : f.typ === "datum" ? (
                  <Datumsfeld id={`sf-${f.key}`} name={f.key} defaultValue={(stammdaten?.[f.key] as string | null) ?? ""} />
                ) : f.typ === "benutzer" ? (
                  <select id={`sf-${f.key}`} name={f.key} defaultValue={stammdaten?.bezugsbetreuerId ?? ""}>
                    <option value="">Nicht zugeordnet</option>
                    {(benutzerListe ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`sf-${f.key}`}
                    name={f.key}
                    type="text"
                    defaultValue={(stammdaten?.[f.key] as string | null) ?? ""}
                  />
                )}
              </div>
            ))}
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}
    </details>
  );
}

function KontakteAbschnitt({
  klientId,
  kontakte,
  onGeaendert,
}: {
  klientId: string;
  kontakte: KlientKontaktDto[];
  onGeaendert: () => void;
}) {
  const [formularOffen, setFormularOffen] = useState(false);
  const [bearbeitenKontakt, setBearbeitenKontakt] = useState<KlientKontaktDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function hinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientKontaktHinzufuegen(klientId, {
        beziehung: String(form.get("beziehung") ?? "") || undefined,
        name: String(form.get("name") ?? ""),
        adresse: String(form.get("adresse") ?? "") || undefined,
        email: String(form.get("email") ?? "") || undefined,
        telefon: String(form.get("telefon") ?? "") || undefined,
      });
      setFormularOffen(false);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kontakt konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function aktualisieren(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeitenKontakt) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientKontaktAktualisieren(klientId, bearbeitenKontakt.id, {
        beziehung: String(form.get("beziehung") ?? ""),
        name: String(form.get("name") ?? ""),
        adresse: String(form.get("adresse") ?? ""),
        email: String(form.get("email") ?? ""),
        telefon: String(form.get("telefon") ?? ""),
      });
      setBearbeitenKontakt(null);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kontakt konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function loeschen(kontaktId: string) {
    setFehler(null);
    try {
      await api.klientKontaktLoeschen(klientId, kontaktId);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kontakt konnte nicht gelöscht werden.");
    }
  }

  return (
    <div className="zv-card zv-card-weit">
      <div className="zv-seiten-kopf" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Kontakte</h3>
        <button className="zv-btn" onClick={() => setFormularOffen(true)}>
          <INeu />
          Kontakt hinzufügen
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {kontakte.length === 0 ? (
        <Leerzustand icon={ILeerKontakte}>Noch keine Kontakte erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.2fr 1.4fr 1.8fr 1.4fr 1.4fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Beziehung</span>
            <span>Name</span>
            <span>Adresse</span>
            <span>Kontakt</span>
            <span></span>
          </div>
          {kontakte.map((k) => (
            <div key={k.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{k.beziehung || "–"}</span>
              <span className="zv-liste-zelle" data-label="Name">
                <strong>{k.name}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Adresse">
                {k.adresse || "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Kontakt">
                {k.telefon || "–"}
                {k.email && <span className="zv-sub-inline">{k.email}</span>}
              </span>
              <span className="zv-liste-zelle-aktionen">
                <button className="zv-link-btn" onClick={() => setBearbeitenKontakt(k)}>
                  <IBearbeiten />
                  Bearbeiten
                </button>
                <button className="zv-link-btn" onClick={() => loeschen(k.id)}>
                  <ILoeschen />
                  Löschen
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {formularOffen && (
        <Modal titel="Kontakt hinzufügen" onClose={() => setFormularOffen(false)}>
          <form onSubmit={hinzufuegen}>
            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {fehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="kontakt-beziehung">Beziehung/Rolle</label>
              <input id="kontakt-beziehung" name="beziehung" placeholder="z. B. Mutter, Anwalt, Pflegefamilie" />
            </div>
            <div className="zv-field">
              <label htmlFor="kontakt-name">Name</label>
              <input id="kontakt-name" name="name" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="kontakt-adresse">Adresse</label>
              <input id="kontakt-adresse" name="adresse" />
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="kontakt-telefon">Telefon</label>
                <input id="kontakt-telefon" name="telefon" />
              </div>
              <div className="zv-field">
                <label htmlFor="kontakt-email">E-Mail</label>
                <input id="kontakt-email" name="email" type="email" />
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Hinzufügen"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeitenKontakt && (
        <Modal titel="Kontakt bearbeiten" onClose={() => setBearbeitenKontakt(null)}>
          <form onSubmit={aktualisieren}>
            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {fehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="kb-beziehung">Beziehung/Rolle</label>
              <input id="kb-beziehung" name="beziehung" defaultValue={bearbeitenKontakt.beziehung ?? ""} />
            </div>
            <div className="zv-field">
              <label htmlFor="kb-name">Name</label>
              <input id="kb-name" name="name" required autoFocus defaultValue={bearbeitenKontakt.name} />
            </div>
            <div className="zv-field">
              <label htmlFor="kb-adresse">Adresse</label>
              <input id="kb-adresse" name="adresse" defaultValue={bearbeitenKontakt.adresse ?? ""} />
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="kb-telefon">Telefon</label>
                <input id="kb-telefon" name="telefon" defaultValue={bearbeitenKontakt.telefon ?? ""} />
              </div>
              <div className="zv-field">
                <label htmlFor="kb-email">E-Mail</label>
                <input id="kb-email" name="email" type="email" defaultValue={bearbeitenKontakt.email ?? ""} />
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function KostenuebernahmenTab({ klientId }: { klientId: string }) {
  const [liste, setListe] = useState<KostenuebernahmeDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [beendenId, setBeendenId] = useState<string | null>(null);

  function laden() {
    api.kostenuebernahmenListe(klientId).then(setListe).catch((err) => setFehler(err.message));
  }
  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const bis = String(form.get("bis") ?? "");
    try {
      await api.kostenuebernahmeAnlegen({
        klientId,
        amt: String(form.get("amt")),
        von: String(form.get("von")),
        bis: bis || undefined,
      });
      setFormularOffen(false);
      formElement.reset();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zeitraum konnte nicht angelegt werden.");
    }
  }

  async function beenden(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.kostenuebernahmeBeenden(id, String(form.get("bis")));
      setBeendenId(null);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zeitraum konnte nicht beendet werden.");
    }
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Kostenübernahme-Zeiträume</h3>
        <button
          className="zv-btn"
          onClick={() => setFormularOffen((v) => !v)}
        >
          {formularOffen ? <IAbbrechen /> : <INeu />}
          {formularOffen ? "Abbrechen" : "Neuer Zeitraum"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label htmlFor="ku-amt">Amt</label>
              <input id="ku-amt" name="amt" required />
            </div>
            <Zeitraumfeld
              von={{ id: "ku-von", name: "von", label: "Von", required: true }}
              bis={{ id: "ku-bis", name: "bis", label: "Bis (optional)" }}
            />
          </div>
          <button className="zv-btn" type="submit">
            <ISpeichern />
            Anlegen
          </button>
        </form>
      )}

      {liste.length === 0 ? (
        <Leerzustand icon={ILeerKostenuebernahmen}>Noch keine Kostenübernahme erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.6fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Amt</span>
            <span>Von</span>
            <span>Bis</span>
            <span></span>
          </div>
          {liste.map((k) => (
            <div key={k.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{k.amt}</span>
              <span className="zv-liste-zelle" data-label="Von">
                <strong>{formatDatum(k.von)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Bis">
                {k.bis ? (
                  <strong>{formatDatum(k.bis)}</strong>
                ) : (
                  <span className="zv-pill zv-pill-offen">
                    <ISOffen />
                    Offen
                  </span>
                )}
              </span>
              <span className={`zv-liste-zelle-aktionen${k.bis !== null ? " zv-liste-zelle-aktionen-leer" : ""}`}>
                {k.bis === null &&
                  (beendenId === k.id ? (
                    <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => beenden(e, k.id)}>
                      <Datumsfeld name="bis" required aria-label="Kostenübernahme endet am" groesse="kompakt" schnellwahl="heute" />
                      <button className="zv-link-btn" type="submit">
                        <ISpeichern />
                        Speichern
                      </button>
                    </form>
                  ) : (
                    <button className="zv-link-btn" onClick={() => setBeendenId(k.id)}>
                      <IBeenden />
                      Beenden
                    </button>
                  ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RechnungenTab({ klientId }: { klientId: string }) {
  const [liste, setListe] = useState<RechnungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [offenesDokument, setOffenesDokument] = useState<{ id: string; url: string } | null>(null);
  const [ablehnenRechnung, setAblehnenRechnung] = useState<RechnungDto | null>(null);

  function laden() {
    api.rechnungenListe(klientId).then(setListe).catch((err) => setFehler(err.message));
  }
  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const betragCent = Math.round(Number(String(form.get("betrag")).replace(",", ".")) * 100);
    const datei = form.get("dokument") as File | null;

    setWirdGespeichert(true);
    try {
      let dokumentBase64: string | undefined;
      let dokumentDateiname: string | undefined;
      let dokumentMimeType: string | undefined;
      if (datei && datei.size > 0) {
        dokumentBase64 = await dateiZuBase64(datei);
        dokumentDateiname = datei.name;
        dokumentMimeType = datei.type || "application/octet-stream";
      }
      await api.rechnungAnlegen({
        klientId,
        betragCent,
        beschreibung: String(form.get("beschreibung")),
        dokumentBase64,
        dokumentDateiname,
        dokumentMimeType,
      });
      setFormularOffen(false);
      formElement.reset();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Rechnung konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function statusAendern(r: RechnungDto, status: RechnungStatus, grund?: string) {
    try {
      await api.rechnungStatusAendern(r.id, status, grund);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Status konnte nicht geändert werden.");
    }
  }

  async function dokumentAnzeigen(id: string) {
    if (offenesDokument?.id === id) {
      setOffenesDokument(null);
      return;
    }
    try {
      const url = await api.rechnungDokumentUrl(id);
      setOffenesDokument({ id, url });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Dokument konnte nicht geladen werden.");
    }
  }

  // Jedes geoeffnete Dokument ist eine eigene Blob-URL (api/client.ts,
  // blobUrl()) -- ohne ausdrueckliches revokeObjectURL haelt der Browser es
  // im Speicher, auch nachdem es geschlossen oder durch ein anderes ersetzt
  // wurde. Der Cleanup einer useEffect-Instanz laeuft automatisch vor der
  // naechsten Zuweisung UND beim Unmount -- deckt "wechseln", "schliessen"
  // und "Seite verlassen" mit derselben Zeile ab (gleiches Muster wie
  // Kassenbuch.tsx bei den Unterschriften).
  useEffect(() => {
    if (!offenesDokument) return;
    const url = offenesDokument.url;
    return () => URL.revokeObjectURL(url);
  }, [offenesDokument]);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Rechnungen</h3>
        <button
          className="zv-btn"
          onClick={() => setFormularOffen((v) => !v)}
        >
          {formularOffen ? <IAbbrechen /> : <INeu />}
          {formularOffen ? "Abbrechen" : "Neue Rechnung"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label>Betrag (€)</label>
              <input name="betrag" type="text" inputMode="decimal" placeholder="150,00" required />
            </div>
            <div className="zv-field">
              <label>Beschreibung</label>
              <input name="beschreibung" required />
            </div>
          </div>
          <div className="zv-field">
            <label>Dokument (optional)</label>
            <input name="dokument" type="file" accept="application/pdf,image/*" />
          </div>
          <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
            <ISpeichern />
            {wirdGespeichert ? "Speichert…" : "Rechnung anlegen"}
          </button>
        </form>
      )}

      {liste.length === 0 ? (
        <Leerzustand icon={ILeerRechnungen}>Noch keine Rechnungen erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.4fr 1.8fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Beschreibung</span>
            <span>Datum</span>
            <span>Betrag</span>
            <span>Status</span>
            <span></span>
          </div>
          {liste.map((r) => (
            <div key={r.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{r.beschreibung}</span>
              <span className="zv-liste-zelle" data-label="Datum">
                <strong>{formatDatum(r.erstelltAm.slice(0, 10))}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Betrag">
                <strong className="zv-mono">{formatBetrag(r.betragCent)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <span
                  className={`zv-pill ${
                    r.status === "abgelehnt" ? "zv-pill-danger" : r.status === "ausgezahlt" ? "zv-pill-ok" : r.status === "genehmigt" ? "zv-pill-info" : "zv-pill-offen"
                  }`}
                >
                  {RECHNUNG_STATUS_LABEL[r.status]}
                </span>
                {r.status === "abgelehnt" && r.statusGrund && <span className="zv-sub-inline">{r.statusGrund}</span>}
              </span>
              <span className="zv-liste-zelle-aktionen">
                {r.hatDokument && (
                  <button className="zv-link-btn" onClick={() => dokumentAnzeigen(r.id)}>
                    <IDokument />
                    Dokument
                  </button>
                )}
                {r.status === "beantragt" && (
                  <>
                    <button className="zv-link-btn" onClick={() => statusAendern(r, "genehmigt")}>
                      <IGenehmigen />
                      Genehmigen
                    </button>
                    <button className="zv-link-btn" onClick={() => setAblehnenRechnung(r)}>
                      <IAblehnen />
                      Ablehnen
                    </button>
                  </>
                )}
                {r.status === "genehmigt" && (
                  <button className="zv-link-btn" onClick={() => statusAendern(r, "ausgezahlt")}>
                    <IAuszahlen />
                    Auszahlen
                  </button>
                )}
              </span>
              {offenesDokument?.id === r.id && (
                <div style={{ gridColumn: "1 / -1", marginTop: "var(--zv-space-2)" }}>
                  <a href={offenesDokument.url} target="_blank" rel="noreferrer">
                    Dokument in neuem Tab öffnen
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ablehnenRechnung && (
        <GrundAbfrage
          titel="Rechnung ablehnen"
          label="Grund für die Ablehnung"
          bestaetigenText="Ablehnen"
          onAbbrechen={() => setAblehnenRechnung(null)}
          onBestaetigen={(grund) => {
            statusAendern(ablehnenRechnung, "abgelehnt", grund);
            setAblehnenRechnung(null);
          }}
        />
      )}
    </div>
  );
}

function KlientKassenbuchTab({ klientId }: { klientId: string }) {
  const [buchungen, setBuchungen] = useState<KassenbuchungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  // Vormonat als Vorgabe: ein Monatsabschluss wird nach Monatsende gemacht.
  const [abschlussMonat, setAbschlussMonat] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [abschlussLaeuft, setAbschlussLaeuft] = useState(false);

  async function monatsabschlussHerunterladen() {
    setAbschlussLaeuft(true);
    setFehler(null);
    try {
      await api.kassenbuchMonatsabschlussHerunterladen(klientId, abschlussMonat);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Monatsabschluss konnte nicht erstellt werden.");
    } finally {
      setAbschlussLaeuft(false);
    }
  }

  useEffect(() => {
    api.kassenbuchungenListe({ klientId }).then(setBuchungen).catch((err) => setFehler(err.message));
  }, [klientId]);

  return (
    <div>
      <div className="zv-werkzeugzeile">
        <label htmlFor="kb-abschluss-monat" id="kb-abschluss-monat-label">
          Monatsabschluss für
        </label>
        {/* Zukuenftige Monate gesperrt (es gibt noch nichts abzuschliessen),
            der laufende erlaubt: ein vorlaeufiger Abschluss zur Monatsmitte
            wird fuer Amtsnachfragen gebraucht. */}
        <Monatsfeld
          id="kb-abschluss-monat"
          aria-labelledby="kb-abschluss-monat-label"
          value={abschlussMonat}
          max={heuteBerlin().slice(0, 7)}
          onChange={setAbschlussMonat}
        />
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={monatsabschlussHerunterladen} disabled={abschlussLaeuft || !abschlussMonat}>
          <IHerunterladen />
          {abschlussLaeuft ? "Wird erstellt …" : "Als PDF"}
        </button>
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {buchungen.length === 0 ? (
        <Leerzustand icon={ILeerKassenbuch}>Keine Kassenbuch-Einträge für diese Klient:in.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1fr 1.2fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Zweck</span>
            <span>Datum</span>
            <span>Betrag</span>
            <span>Typ</span>
            <span>Status</span>
          </div>
          {buchungen.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{b.verwendungszweck}</span>
              <span className="zv-liste-zelle" data-label="Datum">
                <strong>{formatDatum(b.datum)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Betrag">
                <strong
                  className="zv-mono"
                  style={{ color: b.betragCent < 0 ? "var(--zv-status-danger)" : "var(--zv-status-ok)" }}
                >
                  {formatBetrag(b.betragCent)}
                </strong>
              </span>
              <span className="zv-liste-zelle" data-label="Typ">
                {b.typBezeichnung}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                {b.storniert ? (
                  <span className="zv-pill zv-pill-vergeben">
                    <ISStorniert />
                    Storniert
                  </span>
                ) : (
                  <span className="zv-pill zv-pill-ok">
                    <ISErledigt />
                    Aktiv
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagesberichteTab({
  klientId,
  markiert = null,
  startMitFormular = false,
  onFormularGenutzt,
}: {
  klientId: string;
  markiert?: string | null;
  startMitFormular?: boolean;
  onFormularGenutzt?: () => void;
}) {
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [tagVorschlaege, setTagVorschlaege] = useState<TagDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  // "Tagesbericht schreiben" im Kopf der Akte oeffnet direkt das Formular --
  // sonst waere der primaere Knopf nur ein Tabwechsel und ein Klick zu wenig.
  const [formularOffen, setFormularOffen] = useState(startMitFormular);
  useEffect(() => {
    if (startMitFormular) onFormularGenutzt?.();
  }, [startMitFormular, onFormularGenutzt]);

  function laden() {
    api.tagesberichteListe({ klientId }).then(setBerichte).catch((err) => setFehler(err.message));
    api.tagsListe().then(setTagVorschlaege).catch(() => {});
  }

  useEffect(laden, [klientId]);

  async function tagEntfernen(berichtId: string, tagId: string) {
    try {
      await api.tagesberichtTagEntfernen(berichtId, tagId);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Tag konnte nicht entfernt werden.");
    }
  }

  async function tagHinzufuegen(berichtId: string, name: string) {
    if (!name.trim()) return;
    try {
      await api.tagesberichtTagHinzufuegen(berichtId, name.trim());
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Tag konnte nicht hinzugefügt werden.");
    }
  }

  async function dokumentHinzufuegen(berichtId: string, base64: string, dateiname: string, mimeType: string) {
    try {
      await api.tagesberichtDokumentHinzufuegen(berichtId, { base64, dateiname, mimeType });
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Dokument konnte nicht hinzugefügt werden.");
    }
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Tagesberichte</h3>
        <button className="zv-btn" onClick={() => setFormularOffen(true)}>
          <INeu />
          Neuer Tagesbericht
        </button>
      </div>

      {formularOffen && (
        <NeuerTagesberichtFenster
          klientId={klientId}
          onClose={() => setFormularOffen(false)}
          onAngelegt={() => {
            setFormularOffen(false);
            laden();
          }}
        />
      )}

      <TagVorschlaegeDatalist tags={tagVorschlaege} />

      {berichte.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>Noch keine Tagesberichte für diese Klient:in erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.9fr 2.6fr 1.5fr 1.5fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Datum</span>
            <span>Bericht</span>
            <span>Tags</span>
            <span>Dokumente</span>
          </div>
          {berichte.map((b) => (
            <TagesberichtZeile
              key={b.id}
              bericht={b}
              zeigeKlient={false}
              markiert={b.id === markiert}
              onTagEntfernen={(tagId) => tagEntfernen(b.id, tagId)}
              onTagHinzufuegen={(name) => tagHinzufuegen(b.id, name)}
              onDokumentHinzufuegen={(base64, dateiname, mimeType) => dokumentHinzufuegen(b.id, base64, dateiname, mimeType)}
              onGeaendert={laden}
            />
          ))}
        </div>
      )}
    </div>
  );
}
