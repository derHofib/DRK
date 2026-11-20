import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  alleBausteine,
  istEingabe,
  PDF_FELDSTIL_LABEL,
  PDF_LEERE_FELDER_LABEL,
  PDF_PLATZHALTER,
  PDF_SCHRIFT_LABEL,
  PDF_UEBERSCHRIFTEN_LABEL,
  PDF_VORLAGE_LABEL,
  pdfGestaltungVorgabe,
  type FormularDefinition,
  type FormularDetailDto,
  type FormularVerwaltungDto,
  type PdfExportDto,
  type PdfFeldstil,
  type PdfGestaltung,
  type PdfLeereFelder,
  type PdfLogoPosition,
  type PdfSchrift,
  type PdfUeberschriften,
  type PdfVorlage,
  type PdfZielgruppe,
  type ProtokollKurzDto,
  type TraegerDateiDto,
} from "@zimmerakte/shared";
import { api, type PdfExportSpeichernEingabe } from "../../api/client";
import { Modal } from "../../components/Modal";
import {
  IArchivieren,
  IBearbeiten,
  IDokument,
  IEntarchivieren,
  IFehler,
  IInfo,
  IKopieren,
  INeu,
  ISpeichern,
  IZurueck,
  IErfolg,
} from "../../components/icons";
import { formatDatum } from "../../format";
import { aufbauVersionen } from "./FormularAufbau";

/**
 * Reiter „PDF-Exporte“ eines Formulars (Konzept /mnt/project-files/formular-pdf,
 * Fassung 2). Jeder Export hat sein EIGENES Design -- kein traegerweites
 * Briefpapier. Geteilt werden nur Daten (Logos, Traegerangaben, Standort)
 * ueber Platzhalter. Gespeichert wird jede Aenderung als neue Version; schon
 * erzeugte PDFs verweisen auf ihre Version und bleiben so reproduzierbar.
 */

function feldAnzahl(g: PdfGestaltung, definition: FormularDefinition): string {
  const eingaben = alleBausteine(definition).filter((b) => istEingabe(b) || b.typ === "anzeige" || b.typ === "berechnung");
  if (g.felder === "alle") return `alle ${eingaben.length} Felder`;
  return `${g.felder.length} von ${eingaben.length} Feldern`;
}

export function FormularPdfExporte({ d }: { d: FormularDetailDto }) {
  const [liste, setListe] = useState<PdfExportDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [bearbeiten, setBearbeiten] = useState<string | null>(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const versionen = useMemo(() => aufbauVersionen(d), [d]);
  const definition = versionen[0]?.definition ?? { bausteine: [] };

  async function laden() {
    try {
      setListe(await api.pdfExporte(d.id));
    } catch (e) {
      setFehler((e as Error).message);
    }
  }

  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  async function aktion(fn: () => Promise<unknown>) {
    setFehler(null);
    try {
      await fn();
      await laden();
    } catch (e) {
      setFehler((e as Error).message);
    }
  }

  const gewaehlt = liste?.find((e) => e.id === bearbeiten);
  if (gewaehlt) {
    return (
      <PdfExportEditor
        key={gewaehlt.id}
        formular={d}
        definition={definition}
        exp={gewaehlt}
        onZurueck={() => {
          setBearbeiten(null);
          void laden();
        }}
        onGespeichert={(neu) => setListe((l) => (l ?? []).map((x) => (x.id === neu.id ? neu : x)))}
      />
    );
  }

  const aktive = (liste ?? []).filter((e) => !e.stillgelegt);
  const stillgelegte = (liste ?? []).filter((e) => e.stillgelegt);

  return (
    <div className="zv-pe">
      <div className="zv-pe-kopf">
        <p className="zv-sub">
          Jeder PDF-Export dieses Formulars hat sein eigenes Design: Kopf, Logo, Schrift, Farben, Felder. Andere Formulare
          sind davon nicht betroffen. In der Klientenakte wählt man beim Exportieren eines Protokolls, welcher Export es sein soll.
        </p>
        <button type="button" className="zv-btn" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neuer PDF-Export
        </button>
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <div className="zv-pe-raster">
        {aktive.map((e) => (
          <ExportKarte key={e.id} e={e} definition={definition} onGestalten={() => setBearbeiten(e.id)}>
            <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => setBearbeiten(e.id)}>
              <IBearbeiten />
              Gestalten
            </button>
            <button
              type="button"
              className="zv-btn zv-btn-sekundaer zv-btn-klein"
              onClick={() => aktion(() => api.pdfExportAnlegen(d.id, { name: `${e.name} (Kopie)`, kopieVon: e.id }))}
            >
              <IKopieren />
              Duplizieren
            </button>
            {!e.istStandard && (
              <>
                <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={() => aktion(() => api.pdfExportAlsStandard(e.id))}>
                  Als Standard
                </button>
                <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={() => aktion(() => api.pdfExportStilllegen(e.id, true))}>
                  <IArchivieren />
                  Stilllegen
                </button>
              </>
            )}
          </ExportKarte>
        ))}
        <aside className="zv-fo-karte zv-pe-angaben">
          <h3>Gemeinsame Angaben</h3>
          <p className="zv-sub">
            Nur Daten, kein Design: Logos und Trägerangaben pflegen Sie unter Einstellungen › Angaben für Dokumente,
            Anschrift und Telefon eines Hauses im Standort-Steckbrief. Jeder Export entscheidet selbst, ob und wo sie erscheinen.
          </p>
        </aside>
      </div>
      {stillgelegte.length > 0 && (
        <>
          <h3 className="zv-pe-zwischen">Stillgelegt</h3>
          <p className="zv-sub">Werden beim Exportieren nicht mehr angeboten. Schon erzeugte PDFs bleiben nachvollziehbar.</p>
          <div className="zv-pe-raster">
            {stillgelegte.map((e) => (
              <ExportKarte key={e.id} e={e} definition={definition} onGestalten={() => setBearbeiten(e.id)}>
                <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => aktion(() => api.pdfExportStilllegen(e.id, false))}>
                  <IEntarchivieren />
                  Wieder anbieten
                </button>
              </ExportKarte>
            ))}
          </div>
        </>
      )}
      {neuOffen && (
        <NeuerExport
          formular={d}
          exporte={liste ?? []}
          onClose={() => setNeuOffen(false)}
          onAngelegt={async (neu) => {
            setNeuOffen(false);
            await laden();
            setBearbeiten(neu.id);
          }}
        />
      )}
    </div>
  );
}

function ExportKarte({
  e,
  definition,
  onGestalten,
  children,
}: {
  e: PdfExportDto;
  definition: FormularDefinition;
  onGestalten: () => void;
  children: ReactNode;
}) {
  const g = e.gestaltung;
  return (
    <article className="zv-fo-karte zv-pe-karte">
      <button type="button" className="zv-pe-blatt" onClick={onGestalten} aria-label={`${e.name} gestalten`}>
        <ExportSkizze g={g} />
      </button>
      <h3>{e.name}</h3>
      <div className="zv-pe-pills">
        <span className={e.zielgruppe === "extern" ? "zv-pill zv-pill-frist" : "zv-pill"}>{e.zielgruppe}</span>
        {e.istStandard && <span className="zv-pill zv-pill-ok">Standard</span>}
        <span className="zv-pill">Version {e.versionNummer}</span>
      </div>
      <ul className="zv-pe-fakten">
        <li>
          {g.vorlage === "brief" ? "Brief nach DIN 5008" : "Akte, kompakter Kopf"}, {feldAnzahl(g, definition)}
        </li>
        <li>
          Schrift {PDF_SCHRIFT_LABEL[g.schrift].name}, {PDF_FELDSTIL_LABEL[g.feldstil].name}
        </li>
        <li>{e.anzahlErzeugt > 0 ? `${e.anzahlErzeugt}-mal erzeugt, zuletzt ${formatDatum(e.zuletztErzeugtAm!.slice(0, 10))}` : "noch nie erzeugt"}</li>
        {e.kopiertAus && <li>kopiert aus „{e.kopiertAus}“</li>}
      </ul>
      <div className="zv-aktionen-reihe">{children}</div>
    </article>
  );
}

/**
 * Schematische Seite statt gerendertem PDF: eine Liste mit mehreren
 * Exporten soll nicht fuer jede Karte ein PDF vom Server holen. Die Skizze
 * folgt den echten Einstellungen (Logo-Position, Infospalte, Anschriftfeld).
 */
function ExportSkizze({ g }: { g: PdfGestaltung }) {
  const brief = g.vorlage === "brief";
  return (
    <span className={`zv-pe-skizze zv-pe-skizze-${brief ? "brief" : "akte"}`} aria-hidden="true">
      <span className={`zv-pe-skizze-logo zv-pe-skizze-logo-${g.logoPosition}`} />
      {brief && g.anschriftfeld && <span className="zv-pe-skizze-anschrift" />}
      {brief && g.infospalte.trim() && <span className="zv-pe-skizze-info" />}
      <span className="zv-pe-skizze-titel" />
      {Array.from({ length: brief ? 6 : 9 }, (_, i) => (
        <span key={i} className="zv-pe-skizze-zeile" />
      ))}
      <span className="zv-pe-skizze-fuss" />
    </span>
  );
}

function NeuerExport({
  formular,
  exporte,
  onClose,
  onAngelegt,
}: {
  formular: FormularDetailDto;
  exporte: PdfExportDto[];
  onClose: () => void;
  onAngelegt: (e: PdfExportDto) => void;
}) {
  const [art, setArt] = useState<"brief" | "akte" | "kopie">("brief");
  const [name, setName] = useState("Bericht an das Amt");
  const [formulare, setFormulare] = useState<FormularVerwaltungDto[]>([]);
  const [quelleFormular, setQuelleFormular] = useState(formular.id);
  const [quellExporte, setQuellExporte] = useState<PdfExportDto[]>(exporte);
  const [quelle, setQuelle] = useState(exporte[0]?.id ?? "");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    api.formulare().then(setFormulare).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (quelleFormular === formular.id) {
      setQuellExporte(exporte);
      setQuelle(exporte[0]?.id ?? "");
      return;
    }
    api
      .pdfExporte(quelleFormular)
      .then((l) => {
        setQuellExporte(l);
        setQuelle(l[0]?.id ?? "");
      })
      .catch((e: Error) => setFehler(e.message));
  }, [quelleFormular, formular.id, exporte]);

  async function anlegen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const neu = await api.pdfExportAnlegen(formular.id, art === "kopie" ? { name, kopieVon: quelle } : { name, vorlage: art });
      onAngelegt(neu);
    } catch (e) {
      setFehler((e as Error).message);
      setLaeuft(false);
    }
  }

  const optionen: { wert: typeof art; titel: string; text: string }[] = [
    { wert: "brief", titel: "Brief beginnen", text: "Mit Anschriftfeld, Infospalte und Unterschrift nach DIN 5008. Für Ämter und Kostenträger." },
    { wert: "akte", titel: "Akte beginnen", text: "Kompakter Kopf, alle Felder. Für die Ablage." },
    { wert: "kopie", titel: "Kopie eines Exports", text: "Auch aus einem anderen Formular, z. B. den Amtsbrief vom „Hilfeplangespräch“. Danach unabhängig." },
  ];

  return (
    <Modal titel="Neuer PDF-Export" onClose={onClose}>
      <div className="zv-pe-neu">
        {optionen.map((o) => (
          <label key={o.wert} className={`zv-pe-wahl${art === o.wert ? " active" : ""}`}>
            <input type="radio" name="zv-pe-neu" checked={art === o.wert} onChange={() => setArt(o.wert)} />
            <span>
              <strong>{o.titel}</strong>
              <span className="zv-sub">{o.text}</span>
            </span>
          </label>
        ))}
        {art === "kopie" && (
          <div className="zv-pe-zwei">
            <div className="zv-field">
              <label htmlFor="pe-quelle-formular">Aus Formular</label>
              <select id="pe-quelle-formular" value={quelleFormular} onChange={(e) => setQuelleFormular(e.target.value)}>
                <option value={formular.id}>{formular.name} (dieses)</option>
                {formulare
                  .filter((f) => f.id !== formular.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="pe-quelle">Export</label>
              <select id="pe-quelle" value={quelle} onChange={(e) => setQuelle(e.target.value)}>
                {quellExporte.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.zielgruppe})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="pe-name">Name des Exports</label>
          <input id="pe-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-protokoll-leiste">
          <button type="button" className="zv-btn zv-btn-still" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="zv-btn" disabled={laeuft || !name.trim() || (art === "kopie" && !quelle)} onClick={anlegen}>
            <INeu />
            Anlegen und gestalten
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

type VorschauDaten = "beispiel" | "echt";

function PdfExportEditor({
  formular,
  definition,
  exp,
  onZurueck,
  onGespeichert,
}: {
  formular: FormularDetailDto;
  definition: FormularDefinition;
  exp: PdfExportDto;
  onZurueck: () => void;
  onGespeichert: (e: PdfExportDto) => void;
}) {
  const ausgang = useMemo<PdfExportSpeichernEingabe>(
    () => ({ name: exp.name, zielgruppe: exp.zielgruppe, logoId: exp.logoId, gestaltung: exp.gestaltung }),
    [exp]
  );
  const [stand, setStand] = useState<PdfExportSpeichernEingabe>(ausgang);
  const [version, setVersion] = useState(exp.versionNummer);
  const [gespeichert, setGespeichert] = useState(ausgang);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [logos, setLogos] = useState<TraegerDateiDto[]>([]);
  const [daten, setDaten] = useState<VorschauDaten>("beispiel");
  const [protokolle, setProtokolle] = useState<ProtokollKurzDto[]>([]);
  const [protokollId, setProtokollId] = useState("");
  const [empfaenger, setEmpfaenger] = useState("Bezirksamt Beispiel\nTeilhabefachdienst\nMusterstraße 1\n10000 Berlin");
  const [vorschauUrl, setVorschauUrl] = useState<string | null>(null);
  const [vorschauFehler, setVorschauFehler] = useState<string | null>(null);
  const [vorschauLaeuft, setVorschauLaeuft] = useState(false);
  const urlRef = useRef<string | null>(null);

  const g = stand.gestaltung;
  const geaendert = JSON.stringify(stand) !== JSON.stringify(gespeichert);
  const setG = (teil: Partial<PdfGestaltung>) => {
    setErfolg(null);
    setStand((s) => ({ ...s, gestaltung: { ...s.gestaltung, ...teil } }));
  };

  useEffect(() => {
    api.traegerDateien().then(setLogos).catch(() => undefined);
    api
      .protokolle()
      .then((l) => setProtokolle(l.filter((p) => p.formularId === formular.id && p.abgeschlossen)))
      .catch(() => undefined);
  }, [formular.id]);

  // Vorschau: dieselbe Rendermaschine wie der echte Export, verzoegert, damit
  // nicht jeder Tastendruck ein PDF anfordert. Die ungespeicherte Gestaltung
  // geht mit -- gespeichert wird erst mit "Als Version speichern".
  useEffect(() => {
    const t = window.setTimeout(async () => {
      setVorschauLaeuft(true);
      try {
        const blob = await api.pdfExportVorschau(formular.id, {
          ...stand,
          protokollId: daten === "echt" && protokollId ? protokollId : null,
          empfaenger: g.vorlage === "brief" && g.anschriftfeld ? empfaenger : null,
        });
        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setVorschauUrl(url);
        setVorschauFehler(null);
      } catch (e) {
        setVorschauFehler((e as Error).message);
      } finally {
        setVorschauLaeuft(false);
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [formular.id, stand, daten, protokollId, empfaenger, g.vorlage, g.anschriftfeld]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function speichern() {
    setSpeichert(true);
    setFehler(null);
    try {
      const neu = await api.pdfExportSpeichern(exp.id, stand);
      const neuStand = { name: neu.name, zielgruppe: neu.zielgruppe, logoId: neu.logoId, gestaltung: neu.gestaltung };
      setStand(neuStand);
      setGespeichert(neuStand);
      setVersion(neu.versionNummer);
      onGespeichert(neu);
      setErfolg(`Als Version ${neu.versionNummer} gespeichert. Ab jetzt erzeugte PDFs sehen so aus.`);
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setSpeichert(false);
    }
  }

  const felder = alleBausteine(definition).filter((b) => istEingabe(b) || b.typ === "anzeige" || b.typ === "berechnung");
  const brief = g.vorlage === "brief";
  const internFelder = felder.filter((b) => "intern" in b && b.intern);

  return (
    <div className="zv-pe-editor">
      <div className="zv-pe-editor-kopf">
        <div>
          <button type="button" className="zv-link-btn" onClick={onZurueck}>
            <IZurueck />
            {formular.name} › PDF-Exporte
          </button>
          <div className="zv-pe-pills">
            <span className={stand.zielgruppe === "extern" ? "zv-pill zv-pill-frist" : "zv-pill"}>{stand.zielgruppe}</span>
            <span className="zv-pill zv-pill-ok">Version {version}{exp.anzahlErzeugt > 0 ? " · in Benutzung" : ""}</span>
            <span className="zv-sub-inline">gilt nur für das Formular {formular.name}</span>
            {geaendert && <span className="zv-pill zv-pill-frist">ungespeicherte Änderungen</span>}
          </div>
        </div>
        <div className="zv-aktionen-reihe">
          <button type="button" className="zv-btn zv-btn-still" disabled={!geaendert} onClick={() => setStand(gespeichert)}>
            Verwerfen
          </button>
          <button type="button" className="zv-btn" disabled={!geaendert || speichert || !stand.name.trim()} onClick={speichern}>
            <ISpeichern />
            {speichert ? "Speichert…" : `Als Version ${version + 1} speichern`}
          </button>
        </div>
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && !geaendert && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}
      <p className="zv-formular-schmal-hinweis zv-hinweis zv-hinweis-info">
        <IInfo />
        Das Gestalten braucht einen größeren Bildschirm. Bitte am Rechner bearbeiten.
      </p>

      <div className="zv-pe-spalten">
        <div className="zv-fo-karte zv-pe-einstellungen">
          <Abschnitt titel="Name und Zielgruppe" zusammenfassung={stand.zielgruppe} offen>
            <div className="zv-field">
              <label htmlFor="pe-e-name">Name</label>
              <input id="pe-e-name" value={stand.name} maxLength={120} onChange={(e) => (setErfolg(null), setStand({ ...stand, name: e.target.value }))} />
            </div>
            <Segment<PdfZielgruppe>
              label="Zielgruppe"
              wert={stand.zielgruppe}
              optionen={[
                ["intern", "intern"],
                ["extern", "extern"],
              ]}
              onWahl={(z) => (setErfolg(null), setStand({ ...stand, zielgruppe: z }))}
            />
            <span className="zv-sub-inline">
              {stand.zielgruppe === "extern"
                ? `Extern: Felder „nur intern“ fehlen immer${internFelder.length ? ` (${internFelder.map((b) => b.beschriftung).join(", ")})` : ""}. Erzeugen darf nur, wer „PDF für Externe“ hat.`
                : "Intern: für die Ablage, alle ausgewählten Felder."}
            </span>
          </Abschnitt>

          <Abschnitt titel="Grundform" zusammenfassung={brief ? "Brief DIN 5008" : "Akte"}>
            <div className="zv-field">
              <label htmlFor="pe-vorlage">Aufbau der Seite</label>
              <select
                id="pe-vorlage"
                value={g.vorlage}
                onChange={(e) => {
                  const v = e.target.value as PdfVorlage;
                  // Wechsel der Grundform: Kopf und Texte der neuen Vorgabe,
                  // Feldauswahl, Schrift und Farbe bleiben.
                  const vorgabe = pdfGestaltungVorgabe(v);
                  setG({ ...vorgabe, felder: g.felder, farbe: g.farbe, feldstil: g.feldstil, ueberschriften: g.ueberschriften, jaNein: g.jaNein });
                }}
              >
                {(Object.keys(PDF_VORLAGE_LABEL) as PdfVorlage[]).map((v) => (
                  <option key={v} value={v}>
                    {PDF_VORLAGE_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
          </Abschnitt>

          <Abschnitt titel="Felder" zusammenfassung={feldAnzahl(g, definition)}>
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={g.felder === "alle"} onChange={(e) => setG({ felder: e.target.checked ? "alle" : felder.map((b) => b.schluessel) })} />
              Alle Felder, auch künftig hinzukommende
            </label>
            {g.felder !== "alle" && (
              <div className="zv-pe-felder">
                {felder.map((b) => {
                  const auswahl = g.felder as string[];
                  const intern = "intern" in b && !!b.intern;
                  return (
                    <label key={b.schluessel} className="zv-checkbox-zeile">
                      <input
                        type="checkbox"
                        checked={auswahl.includes(b.schluessel)}
                        onChange={(e) =>
                          setG({ felder: e.target.checked ? [...auswahl, b.schluessel] : auswahl.filter((x) => x !== b.schluessel) })
                        }
                      />
                      <span>
                        {b.beschriftung || b.schluessel}
                        {intern && <span className="zv-pill"> nur intern</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Abschnitt>

          <Abschnitt titel={brief ? "Betreff, Anrede, Gruß" : "Überschrift"} zusammenfassung="mit Platzhaltern">
            <TextFeld id="pe-titel" label={brief ? "Betreff" : "Überschrift"} wert={g.titel} onAendern={(titel) => setG({ titel })} />
            <TextFeld id="pe-untertitel" label="Zeile darunter" wert={g.unterTitel} onAendern={(unterTitel) => setG({ unterTitel })} />
            {brief && (
              <>
                <TextFeld id="pe-anrede" label="Anrede" wert={g.anrede} onAendern={(anrede) => setG({ anrede })} />
                <TextFeld id="pe-einleitung" label="Einleitung" wert={g.einleitung} mehrzeilig onAendern={(einleitung) => setG({ einleitung })} />
                <TextFeld id="pe-gruss" label="Gruß" wert={g.gruss} onAendern={(gruss) => setG({ gruss })} />
                <Segment<PdfGestaltung["unterschrift"]>
                  label="Unterschrift"
                  wert={g.unterschrift}
                  optionen={[
                    ["name", "Name"],
                    ["linie", "Linie"],
                    ["keine", "keine"],
                  ]}
                  onWahl={(unterschrift) => setG({ unterschrift })}
                />
              </>
            )}
          </Abschnitt>

          <Abschnitt titel="Kopf und Logo" zusammenfassung={stand.logoId ? `Logo ${g.logoPosition}, ${g.logoHoehe} mm` : "ohne Logo"}>
            <div className="zv-field">
              <label htmlFor="pe-logo">Logo</label>
              <select id="pe-logo" value={stand.logoId ?? ""} onChange={(e) => (setErfolg(null), setStand({ ...stand, logoId: e.target.value || null }))}>
                <option value="">ohne Logo</option>
                {logos.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {logos.length === 0 && <span className="zv-sub-inline">Logos laden Sie unter Einstellungen › Angaben für Dokumente hoch.</span>}
            </div>
            <Segment<PdfLogoPosition>
              label="Position"
              wert={g.logoPosition}
              optionen={[
                ["links", "links"],
                ["mitte", "Mitte"],
                ["rechts", "rechts"],
              ]}
              onWahl={(logoPosition) => setG({ logoPosition })}
            />
            <ZahlFeld id="pe-logo-hoehe" label="Höhe (mm)" wert={g.logoHoehe} min={5} max={30} schritt={1} onAendern={(logoHoehe) => setG({ logoHoehe })} />
            <TextFeld id="pe-neben-logo" label="Text neben dem Logo" wert={g.textNebenLogo} mehrzeilig onAendern={(textNebenLogo) => setG({ textNebenLogo })} />
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={g.trennstrich} onChange={(e) => setG({ trennstrich: e.target.checked })} />
              Trennstrich zwischen Logo und Text
            </label>
            {!brief && <TextFeld id="pe-rechts" label="Block rechts oben" wert={g.textRechts} mehrzeilig onAendern={(textRechts) => setG({ textRechts })} />}
          </Abschnitt>

          {brief && (
            <>
              <Abschnitt titel="Anschriftfeld" zusammenfassung={g.anschriftfeld ? "an" : "aus"}>
                <label className="zv-checkbox-zeile">
                  <input type="checkbox" checked={g.anschriftfeld} onChange={(e) => setG({ anschriftfeld: e.target.checked })} />
                  Anschriftfeld (Empfänger wird beim Exportieren eingetragen)
                </label>
                <TextFeld id="pe-ruecksende" label="Rücksendezeile darüber" wert={g.ruecksendezeile} onAendern={(ruecksendezeile) => setG({ ruecksendezeile })} />
                <TextFeld id="pe-datum" label="Datumszeile" wert={g.datumszeile} onAendern={(datumszeile) => setG({ datumszeile })} />
              </Abschnitt>
              <Abschnitt titel="Infospalte" zusammenfassung={g.infospalte.trim() ? "an" : "aus"}>
                <TextFeld
                  id="pe-info"
                  label="Spalte rechts auf der ersten Seite"
                  hinweis="Leere Zeile = Absatz, **Text** = fett. Zeilen mit leerem Platzhalter entfallen."
                  wert={g.infospalte}
                  mehrzeilig
                  zeilen={12}
                  onAendern={(infospalte) => setG({ infospalte })}
                />
              </Abschnitt>
            </>
          )}

          <Abschnitt titel="Fußzeile und Folgeseiten" zusammenfassung={`Logo ${g.folgeseitenLogoHoehe ? `${g.folgeseitenLogoHoehe} mm` : "aus"}`}>
            <TextFeld id="pe-fuss-l" label="Fußzeile links" wert={g.fusszeileLinks} mehrzeilig onAendern={(fusszeileLinks) => setG({ fusszeileLinks })} />
            <TextFeld id="pe-fuss-r" label="Fußzeile rechts" wert={g.fusszeileRechts} onAendern={(fusszeileRechts) => setG({ fusszeileRechts })} />
            <ZahlFeld id="pe-folge-logo" label="Logo auf Folgeseiten (mm, 0 = aus)" wert={g.folgeseitenLogoHoehe} min={0} max={20} schritt={1} onAendern={(folgeseitenLogoHoehe) => setG({ folgeseitenLogoHoehe })} />
          </Abschnitt>

          <Abschnitt titel="Schrift und Farbe" zusammenfassung={`${PDF_SCHRIFT_LABEL[g.schrift].name} · ${g.farbe ?? "Trägerfarbe"}`}>
            <div className="zv-field">
              <label htmlFor="pe-schrift">Schrift</label>
              <select id="pe-schrift" value={g.schrift} onChange={(e) => setG({ schrift: e.target.value as PdfSchrift })}>
                {(Object.keys(PDF_SCHRIFT_LABEL) as PdfSchrift[]).map((s) => (
                  <option key={s} value={s}>
                    {PDF_SCHRIFT_LABEL[s].name} ({PDF_SCHRIFT_LABEL[s].hinweis})
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-pe-drei">
              <ZahlFeld id="pe-g-text" label="Text (pt)" wert={g.groesseText} min={7} max={16} schritt={0.5} onAendern={(groesseText) => setG({ groesseText })} />
              <ZahlFeld id="pe-g-ueb" label="Überschrift" wert={g.groesseUeberschrift} min={7} max={28} schritt={0.5} onAendern={(groesseUeberschrift) => setG({ groesseUeberschrift })} />
              <ZahlFeld id="pe-g-fuss" label="Fußzeile" wert={g.groesseFuss} min={6} max={12} schritt={0.5} onAendern={(groesseFuss) => setG({ groesseFuss })} />
            </div>
            <div className="zv-field">
              <span className="zv-pe-label">Farbe für Linien und Überschriften</span>
              <label className="zv-checkbox-zeile">
                <input type="checkbox" checked={g.farbe === null} onChange={(e) => setG({ farbe: e.target.checked ? null : "#e60005" })} />
                Trägerfarbe verwenden
              </label>
              {g.farbe !== null && (
                <input type="color" aria-label="Eigene Farbe" value={g.farbe} onChange={(e) => setG({ farbe: e.target.value })} className="zv-pe-farbe" />
              )}
              <span className="zv-sub-inline">Linien in genau dieser Farbe. Überschriften werden so weit abgedunkelt, dass sie auf Papier lesbar bleiben, auch bei Gelb.</span>
            </div>
          </Abschnitt>

          <Abschnitt titel="Darstellung der Felder" zusammenfassung={PDF_FELDSTIL_LABEL[g.feldstil].name}>
            <div className="zv-field">
              <label htmlFor="pe-feldstil">Feldstil</label>
              <select id="pe-feldstil" value={g.feldstil} onChange={(e) => setG({ feldstil: e.target.value as PdfFeldstil })}>
                {(Object.keys(PDF_FELDSTIL_LABEL) as PdfFeldstil[]).map((s) => (
                  <option key={s} value={s}>
                    {PDF_FELDSTIL_LABEL[s].name}
                  </option>
                ))}
              </select>
              <span className="zv-sub-inline">{PDF_FELDSTIL_LABEL[g.feldstil].hinweis}</span>
            </div>
            <div className="zv-field">
              <label htmlFor="pe-leer">Leere Felder</label>
              <select id="pe-leer" value={g.leereFelder} onChange={(e) => setG({ leereFelder: e.target.value as PdfLeereFelder })}>
                {(Object.keys(PDF_LEERE_FELDER_LABEL) as PdfLeereFelder[]).map((s) => (
                  <option key={s} value={s}>
                    {PDF_LEERE_FELDER_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="pe-ueb">Abschnittsüberschriften</label>
              <select id="pe-ueb" value={g.ueberschriften} onChange={(e) => setG({ ueberschriften: e.target.value as PdfUeberschriften })}>
                {(Object.keys(PDF_UEBERSCHRIFTEN_LABEL) as PdfUeberschriften[]).map((s) => (
                  <option key={s} value={s}>
                    {PDF_UEBERSCHRIFTEN_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <Segment<PdfGestaltung["jaNein"]>
              label="Ja/Nein-Felder"
              wert={g.jaNein}
              optionen={[
                ["wort", "als Wort"],
                ["kreuz", "als Kästchen"],
              ]}
              onWahl={(jaNein) => setG({ jaNein })}
            />
          </Abschnitt>
        </div>

        <div className="zv-pe-vorschau">
          <div className="zv-pe-vorschau-leiste">
            <div className="zv-segmented" role="group" aria-label="Daten der Vorschau">
              <button type="button" className={daten === "beispiel" ? "active" : ""} onClick={() => setDaten("beispiel")}>
                Beispieldaten
              </button>
              <button type="button" className={daten === "echt" ? "active" : ""} disabled={protokolle.length === 0} onClick={() => setDaten("echt")}>
                Echtes Protokoll
              </button>
            </div>
            {daten === "echt" && (
              <select aria-label="Protokoll" value={protokollId} onChange={(e) => setProtokollId(e.target.value)}>
                <option value="">Protokoll wählen …</option>
                {protokolle.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.klientName} · {formatDatum(p.bezugsdatum)}
                  </option>
                ))}
              </select>
            )}
            {vorschauLaeuft && <span className="zv-sub-inline">aktualisiert …</span>}
          </div>
          {brief && g.anschriftfeld && (
            <TextFeld id="pe-empf" label="Empfänger für die Vorschau" wert={empfaenger} mehrzeilig zeilen={3} onAendern={setEmpfaenger} />
          )}
          {vorschauFehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {vorschauFehler}
            </div>
          )}
          <div className="zv-pe-papier">
            {vorschauUrl ? (
              <iframe title="Vorschau des PDF" src={`${vorschauUrl}#toolbar=0&navpanes=0&view=FitH`} />
            ) : (
              <span className="zv-sub">Vorschau wird erzeugt …</span>
            )}
          </div>
          <p className="zv-sub-inline">
            Gleiche Erzeugung wie beim echten Export. {daten === "beispiel" ? "Beispieldaten statt echter Personen." : "Nichts wird gespeichert oder protokolliert."}
          </p>
        </div>

        <Platzhalter felder={felder.map((b) => ({ schluessel: b.schluessel, label: b.beschriftung }))} formularName={formular.name} />
      </div>
    </div>
  );
}

function Abschnitt({ titel, zusammenfassung, offen = false, children }: { titel: string; zusammenfassung: string; offen?: boolean; children: ReactNode }) {
  return (
    <details className="zv-pe-abschnitt" open={offen}>
      <summary>
        <span>{titel}</span>
        <span className="zv-sub-inline">{zusammenfassung}</span>
      </summary>
      <div className="zv-pe-abschnitt-inhalt">{children}</div>
    </details>
  );
}

function Segment<T extends string>({ label, wert, optionen, onWahl }: { label: string; wert: T; optionen: [T, string][]; onWahl: (w: T) => void }) {
  return (
    <div className="zv-field">
      <span className="zv-pe-label">{label}</span>
      <div className="zv-segmented" role="group" aria-label={label}>
        {optionen.map(([w, l]) => (
          <button key={w} type="button" className={w === wert ? "active" : ""} aria-pressed={w === wert} onClick={() => onWahl(w)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextFeld({
  id,
  label,
  wert,
  onAendern,
  mehrzeilig = false,
  zeilen = 3,
  hinweis,
}: {
  id: string;
  label: string;
  wert: string;
  onAendern: (w: string) => void;
  mehrzeilig?: boolean;
  zeilen?: number;
  hinweis?: string;
}) {
  return (
    <div className="zv-field">
      <label htmlFor={id}>{label}</label>
      {mehrzeilig ? (
        <textarea id={id} className="zv-pe-mono" rows={zeilen} value={wert} onChange={(e) => onAendern(e.target.value)} />
      ) : (
        <input id={id} className="zv-pe-mono" value={wert} onChange={(e) => onAendern(e.target.value)} />
      )}
      {hinweis && <span className="zv-sub-inline">{hinweis}</span>}
    </div>
  );
}

function ZahlFeld({
  id,
  label,
  wert,
  min,
  max,
  schritt,
  onAendern,
}: {
  id: string;
  label: string;
  wert: number;
  min: number;
  max: number;
  schritt: number;
  onAendern: (w: number) => void;
}) {
  return (
    <div className="zv-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={schritt}
        value={wert}
        onChange={(e) => {
          const n = Number(e.target.value);
          // Ausserhalb der Grenzen nimmt der Server nicht an; hier gleich begrenzen.
          if (Number.isFinite(n)) onAendern(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function Platzhalter({ felder, formularName }: { felder: { schluessel: string; label: string }[]; formularName: string }) {
  const [kopiert, setKopiert] = useState<string | null>(null);
  const gruppen = useMemo(() => {
    const m = new Map<string, { schluessel: string; beispiel: string }[]>();
    for (const p of PDF_PLATZHALTER) m.set(p.gruppe, [...(m.get(p.gruppe) ?? []), p]);
    m.set(`${formularName} (Felder)`, felder.map((f) => ({ schluessel: `feld.${f.schluessel}`, beispiel: f.label })));
    return [...m.entries()];
  }, [felder, formularName]);
  return (
    <aside className="zv-fo-karte zv-pe-platzhalter">
      <h3>Platzhalter</h3>
      <p className="zv-sub">Werden beim Erzeugen gefüllt. Fehlt ein Wert, entfällt die Zeile. Antippen kopiert.</p>
      {gruppen.map(([gruppe, liste]) => (
        <div key={gruppe}>
          <div className="zv-gruppenlabel">{gruppe}</div>
          <ul>
            {liste.map((p) => (
              <li key={p.schluessel}>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`{${p.schluessel}}`).catch(() => undefined);
                    setKopiert(p.schluessel);
                  }}
                >
                  <code>{`{${p.schluessel}}`}</code>
                </button>
                <span className="zv-sub-inline">{kopiert === p.schluessel ? "kopiert" : p.beispiel}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="zv-sub">
        <IDokument /> {"{seite}"} und {"{seiten}"} nur in der Fußzeile.
      </p>
    </aside>
  );
}
