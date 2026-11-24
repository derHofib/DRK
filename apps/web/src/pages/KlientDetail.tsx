import { useCallback, useEffect, useMemo, useState } from "react";
import type { KlientEintragArt, VerlaufRechteDto, KlientDetailDto, TagesberichtDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { AktionsMenue } from "../components/AktionsMenue";
import { KlientZugang } from "../components/KlientZugang";
import { Modal } from "../components/Modal";
import { NeuerEintragFenster } from "../components/NeuerEintrag";
import { Reiterleiste, reiterPanelProps, type ReiterEintrag } from "../components/Reiterleiste";
import {
  IArchivieren,
  IEntarchivieren,
  IFehler,
  IHerunterladen,
  ILoeschen,
  INeu,
  ITagesberichte,
  IZurueck,
} from "../components/icons";
import { formatDatum } from "../format";
import { HilfeplanTab } from "./klient/HilfeplanTab";
import { ProtokolleTab } from "./klient/ProtokolleTab";
import { ProtokollSprungKontext, type ProtokollSprung } from "../components/ProtokollSprung";
import { VerlaufTab } from "./klient/VerlaufTab";
import { UeberblickTab, alterIn } from "./klient-detail/UeberblickTab";
import { TagesberichteTab } from "./klient-detail/TagesberichteTab";
import { KlientKassenbuchTab } from "./klient-detail/KlientKassenbuchTab";
import { KostenuebernahmenTab } from "./klient-detail/KostenuebernahmenTab";
import { RechnungenTab } from "./klient-detail/RechnungenTab";
import { StammdatenTab } from "./klient-detail/StammdatenTab";
import { KontakteAbschnitt } from "./klient-detail/KontakteAbschnitt";

type Tab = "ueberblick" | "verlauf" | "dokumentation" | "hilfeplan" | "finanzen" | "akte";
type DokuTeil = "tagesberichte" | "protokolle";
export type FinanzTeil = "kassenbuch" | "kostenuebernahmen" | "rechnungen";
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
