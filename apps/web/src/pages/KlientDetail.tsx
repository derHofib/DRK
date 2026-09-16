import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type {
  BenutzerListEintragDto,
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
import { api, tokenRolle } from "../api/client";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IAbbrechen,
  IAblehnen,
  IArchivieren,
  IAuszahlen,
  IAuszug,
  IBearbeiten,
  IBeenden,
  IDokument,
  IEinziehen,
  IEntarchivieren,
  IFehler,
  IGenehmigen,
  IHerunterladen,
  IKassenbuch,
  IKostenuebernahme,
  ILeerKassenbuch,
  ILeerKontakte,
  ILeerKostenuebernahmen,
  ILeerRechnungen,
  ILeerTagesberichte,
  ILoeschen,
  INeu,
  IRechnung,
  ISErledigt,
  ISOffen,
  ISStorniert,
  ISpeichern,
  ITagesberichte,
  IUebersicht,
  IZurueck,
} from "../components/icons";
import { dateiZuBase64 } from "../datei";
import { formatBetrag, formatDatum } from "../format";
import { TagesberichtZeile, TagVorschlaegeDatalist } from "./Tagesberichte";

type Tab = "uebersicht" | "kostenuebernahmen" | "rechnungen" | "kassenbuch" | "tagesberichte";

const eingabeFeldStil = {
  padding: "6px 8px",
  borderRadius: "var(--zv-radius-s)",
  border: "1px solid var(--zv-border)",
  background: "var(--zv-bg)",
  color: "var(--zv-text)",
  fontSize: 14,
};

const ROLLEN_MIT_ANONYMISIERUNG = new Set(["bereichsleitung", "einrichtungsleitung"]);
// Gleiches Rollenpaar wie bei der Anonymisierung -- Archivieren ist eine
// traegerweite Statusaenderung, keine alltaegliche Betreuungsaktion.
const ROLLEN_MIT_ARCHIVIERUNG = new Set(["bereichsleitung", "einrichtungsleitung"]);

export function KlientDetail({ klientId, onZurueck }: { klientId: string; onZurueck: () => void }) {
  const [klient, setKlient] = useState<KlientDetailDto | null>(null);
  const [tab, setTab] = useState<Tab>("uebersicht");
  const [fehler, setFehler] = useState<string | null>(null);
  const [anonymisierenOffen, setAnonymisierenOffen] = useState(false);
  const [wirdAnonymisiert, setWirdAnonymisiert] = useState(false);
  const [archivierenOffen, setArchivierenOffen] = useState(false);
  const [entarchivierenOffen, setEntarchivierenOffen] = useState(false);
  const [wirdArchiviert, setWirdArchiviert] = useState(false);

  // Nur ein Anzeige-Hinweis, der den Knopf ausblendet -- der Server prueft
  // dieselbe Rolle nochmal in KlientService.anonymisieren() (siehe tokenRolle()).
  const darfAnonymisieren = ROLLEN_MIT_ANONYMISIERUNG.has(tokenRolle() ?? "");
  const darfArchivieren = ROLLEN_MIT_ARCHIVIERUNG.has(tokenRolle() ?? "");

  function laden() {
    api.klient(klientId).then(setKlient).catch((err) => setFehler(err.message));
  }

  useEffect(laden, [klientId]);

  async function anonymisieren() {
    setFehler(null);
    setWirdAnonymisiert(true);
    try {
      await api.klientAnonymisieren(klientId);
      setAnonymisierenOffen(false);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Klient konnte nicht anonymisiert werden.");
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
      setFehler(err instanceof Error ? err.message : "Klient konnte nicht archiviert werden.");
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
      setFehler(err instanceof Error ? err.message : "Klient konnte nicht entarchiviert werden.");
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

  return (
    <div>
      <button className="zv-link-btn" onClick={onZurueck} style={{ marginBottom: 14 }}>
        <IZurueck />
        Zurück zur Liste
      </button>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {klient && (
        <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>
                {klient.vorname} {klient.nachname}
              </h2>
              <p className="zv-sub" style={{ margin: 0 }}>
                Aktenzeichen {klient.aktenzeichen} · {klient.amt}
                {klient.geburtsdatum && <> · geb. {klient.geburtsdatum}</>} · HZL{" "}
                {HZL_RHYTHMUS_LABEL[klient.hzlRhythmus]}
              </p>
            </div>
            {klient.anonymisiertAm ? (
              <span className="zv-pill zv-pill-vergeben">
                <ILoeschen />
                Anonymisiert am {formatDatum(klient.anonymisiertAm.slice(0, 10))}
              </span>
            ) : (
              darfAnonymisieren && (
                <button className="zv-link-btn" onClick={() => setAnonymisierenOffen(true)}>
                  <ILoeschen />
                  Klient anonymisieren
                </button>
              )
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--zv-border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {klient.archiviertAm ? (
                <span className="zv-pill zv-pill-neutral">
                  <IArchivieren />
                  Archiviert am {formatDatum(klient.archiviertAm.slice(0, 10))}
                  {klient.archiviertVonName ? ` · ${klient.archiviertVonName}` : ""}
                </span>
              ) : (
                darfArchivieren && (
                  <button className="zv-link-btn" onClick={() => setArchivierenOffen(true)}>
                    <IArchivieren />
                    Klient archivieren
                  </button>
                )
              )}
              {klient.archiviertAm && darfArchivieren && (
                <button className="zv-link-btn" onClick={() => setEntarchivierenOffen(true)}>
                  <IEntarchivieren />
                  Entarchivieren
                </button>
              )}
            </div>
            {klient.archivPdfs.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {klient.archivPdfs.map((pdf) => (
                  <button key={pdf.id} className="zv-link-btn" onClick={() => archivPdfHerunterladen(pdf.id)}>
                    <IHerunterladen />
                    Aktenauszug {formatDatum(pdf.erstelltAm.slice(0, 10))}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {anonymisierenOffen && (
        <Modal titel="Klient anonymisieren" onClose={() => setAnonymisierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Name und Geburtsdatum dieses Klienten werden dauerhaft überschrieben (Recht auf Löschung, Art. 17
            DSGVO). Aktenzeichen, Amt sowie Kassenbuch- und Rechnungshistorie bleiben als Belege erhalten. Diese
            Aktion kann nicht rückgängig gemacht werden.
          </p>
          <button className="zv-btn zv-btn-gefahr zv-btn-block" onClick={anonymisieren} disabled={wirdAnonymisiert}>
            <ILoeschen />
            {wirdAnonymisiert ? "Wird anonymisiert…" : "Klient jetzt anonymisieren"}
          </button>
        </Modal>
      )}

      {archivierenOffen && (
        <Modal titel="Klient archivieren" onClose={() => setArchivierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Es wird ein vollständiger PDF-Aktenauszug erzeugt (Stammdaten, Kontakte, Unterbringungshistorie,
            Kassenbuch, Kostenübernahmen, Rechnungen, Tagesberichte samt Anhängen) und dauerhaft gespeichert. Der
            Klient wird anschließend eingefroren -- keine neuen Tagesberichte, Buchungen, Rechnungen oder
            Änderungen mehr möglich -- und aus der Klientenliste ausgeblendet. Das lässt sich jederzeit wieder
            aufheben.
          </p>
          <button className="zv-btn zv-btn-block" onClick={archivieren} disabled={wirdArchiviert}>
            <IArchivieren />
            {wirdArchiviert ? "Wird archiviert…" : "Klient jetzt archivieren"}
          </button>
        </Modal>
      )}

      {entarchivierenOffen && (
        <Modal titel="Klient entarchivieren" onClose={() => setEntarchivierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Der Klient ist danach wieder normal bearbeitbar und erscheint wieder in der aktiven Klientenliste. Die
            bereits erzeugten Aktenauszüge bleiben unverändert erhalten.
          </p>
          <button className="zv-btn zv-btn-block" onClick={entarchivieren} disabled={wirdArchiviert}>
            <IEntarchivieren />
            {wirdArchiviert ? "Wird entarchiviert…" : "Klient jetzt entarchivieren"}
          </button>
        </Modal>
      )}

      <div className="zv-tabbar" style={{ padding: 0, marginBottom: 20 }}>
        <button className={tab === "uebersicht" ? "active" : ""} onClick={() => setTab("uebersicht")}>
          <IUebersicht />
          Übersicht
        </button>
        <button className={tab === "kostenuebernahmen" ? "active" : ""} onClick={() => setTab("kostenuebernahmen")}>
          <IKostenuebernahme />
          Kostenübernahmen
        </button>
        <button className={tab === "rechnungen" ? "active" : ""} onClick={() => setTab("rechnungen")}>
          <IRechnung />
          Rechnungen
        </button>
        <button className={tab === "kassenbuch" ? "active" : ""} onClick={() => setTab("kassenbuch")}>
          <IKassenbuch />
          Kassenbuch
        </button>
        <button className={tab === "tagesberichte" ? "active" : ""} onClick={() => setTab("tagesberichte")}>
          <ITagesberichte />
          Tagesberichte
        </button>
      </div>

      {klient?.archiviertAm && (
        <div className="zv-hinweis zv-hinweis-info" style={{ marginBottom: 16 }}>
          <IArchivieren />
          Dieser Klient ist archiviert und schreibgeschützt -- neue Einträge sind erst nach dem Entarchivieren
          wieder möglich.
        </div>
      )}

      {/* fieldset[disabled] deaktiviert automatisch JEDEN verschachtelten
          Button/Input/Select/Textarea in allen fuenf Tabs -- inklusive der
          Knoepfe, die ein Bearbeiten-Modal erst OEFFNEN -- ohne dass jede
          einzelne Schreibaktion separat verdrahtet werden muesste. Reine
          Lese-Links (z.B. "Dokument oeffnen") sind davon bewusst nicht
          betroffen, <a> ist kein "listed" Formularelement. Serverseitig
          durchgesetzt ueber klientIstArchiviert() -- dies hier ist nur die
          UI-Spiegelung davon. */}
      <fieldset
        disabled={!!klient?.archiviertAm}
        style={{ border: 0, padding: 0, margin: 0, minInlineSize: "auto" }}
      >
        {tab === "uebersicht" && klient && <UebersichtTab klient={klient} onGeaendert={laden} />}
        {tab === "kostenuebernahmen" && <KostenuebernahmenTab klientId={klientId} />}
        {tab === "rechnungen" && <RechnungenTab klientId={klientId} />}
        {tab === "kassenbuch" && <KlientKassenbuchTab klientId={klientId} />}
        {tab === "tagesberichte" && <TagesberichteTab klientId={klientId} />}
      </fieldset>
    </div>
  );
}

function UebersichtTab({ klient, onGeaendert }: { klient: KlientDetailDto; onGeaendert: () => void }) {
  const [aktuelleKostenuebernahme, setAktuelleKostenuebernahme] = useState<KostenuebernahmeDto | null | undefined>(
    undefined
  );
  const [freieZimmer, setFreieZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [zuweisungOffen, setZuweisungOffen] = useState(false);
  const [auszugOffen, setAuszugOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    api.kostenuebernahmenListe(klient.id).then((liste) => {
      setAktuelleKostenuebernahme(liste.find((k) => k.bis === null) ?? null);
    });
  }, [klient.id]);

  useEffect(() => {
    if (klient.aktuellesZimmer) return;
    api.zimmerListe().then((liste) => setFreieZimmer(liste.filter((z) => z.bewohner.length < z.kapazitaet)));
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

  return (
    <div>
    <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 12, fontSize: 14 }}>
        <div style={{ color: "var(--zv-text-muted)" }}>Zimmer</div>
        <div>
          {klient.aktuellesZimmer ? (
            <>
              {klient.aktuellesZimmer.nummer} · {klient.aktuellesZimmer.standortName}{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setAuszugOffen(true);
                }}
              >
                <IAuszug />
                Auszug eintragen
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
              <input
                id="klient-einzug"
                name="einzug"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
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
              <input
                id="klient-auszug"
                name="auszug"
                type="date"
                required
                autoFocus
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IAuszug />
              {wirdGespeichert ? "Speichert…" : "Auszug speichern"}
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

    <KontakteAbschnitt klientId={klient.id} kontakte={klient.kontakte} onGeaendert={onGeaendert} />
    </div>
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

function StammdatenAbschnitt({
  klientId,
  titel,
  felder,
  stammdaten,
  benutzerListe,
  onGeaendert,
}: {
  klientId: string;
  titel: string;
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
    <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
      <div className="zv-seiten-kopf" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{titel}</h3>
        <button className="zv-link-btn" onClick={() => setBearbeitenOffen(true)}>
          <IBearbeiten />
          Bearbeiten
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", rowGap: 10, fontSize: 14 }}>
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
                  <input
                    id={`sf-${f.key}`}
                    name={f.key}
                    type="date"
                    defaultValue={(stammdaten?.[f.key] as string | null) ?? ""}
                  />
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
    </div>
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
              <label>Amt</label>
              <input name="amt" required />
            </div>
            <div className="zv-field">
              <label>Von</label>
              <input name="von" type="date" required />
            </div>
            <div className="zv-field">
              <label>Bis (optional)</label>
              <input name="bis" type="date" />
            </div>
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
                      <input name="bis" type="date" required style={eingabeFeldStil} />
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

  useEffect(() => {
    api.kassenbuchungenListe(klientId).then(setBuchungen).catch((err) => setFehler(err.message));
  }, [klientId]);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {buchungen.length === 0 ? (
        <Leerzustand icon={ILeerKassenbuch}>Keine Kassenbuch-Einträge für diesen Klienten.</Leerzustand>
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

function TagesberichteTab({ klientId }: { klientId: string }) {
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [tagVorschlaege, setTagVorschlaege] = useState<TagDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);

  function laden() {
    api.tagesberichteListe(klientId).then(setBerichte).catch((err) => setFehler(err.message));
    api.tagsListe().then(setTagVorschlaege).catch(() => {});
  }

  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const tagsText = String(form.get("tags") ?? "");
    const datei = form.get("dokument") as File | null;
    setFormFehler(null);
    try {
      let dokumente: { base64: string; dateiname: string; mimeType: string }[] | undefined;
      if (datei && datei.size > 0) {
        dokumente = [
          { base64: await dateiZuBase64(datei), dateiname: datei.name, mimeType: datei.type || "application/octet-stream" },
        ];
      }
      await api.tagesberichtAnlegen({
        klientId,
        datum: String(form.get("datum")),
        text: String(form.get("text")),
        tagNamen: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        dokumente,
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Tagesbericht konnte nicht angelegt werden.");
    }
  }

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

  const heute = new Date().toISOString().slice(0, 10);

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
        <button
          className="zv-btn"
          onClick={() => {
            setFormFehler(null);
            setFormularOffen(true);
          }}
        >
          <INeu />
          Neuer Tagesbericht
        </button>
      </div>

      {formularOffen && (
        <Modal titel="Neuer Tagesbericht" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label>Datum</label>
              <input name="datum" type="date" required autoFocus defaultValue={heute} />
            </div>
            <div className="zv-field">
              <label>Bericht</label>
              <textarea name="text" required rows={5} />
            </div>
            <div className="zv-field">
              <label>Tags (optional, durch Komma getrennt)</label>
              <input name="tags" placeholder="z. B. Beobachtung, Freizeit" />
            </div>
            <div className="zv-field">
              <label>Dokument (optional)</label>
              <input name="dokument" type="file" accept="application/pdf,image/*" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      <TagVorschlaegeDatalist tags={tagVorschlaege} />

      {berichte.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>Noch keine Tagesberichte für diesen Klienten erfasst.</Leerzustand>
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
              onTagEntfernen={(tagId) => tagEntfernen(b.id, tagId)}
              onTagHinzufuegen={(name) => tagHinzufuegen(b.id, name)}
              onDokumentHinzufuegen={(base64, dateiname, mimeType) => dokumentHinzufuegen(b.id, base64, dateiname, mimeType)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
