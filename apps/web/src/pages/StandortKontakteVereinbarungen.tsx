import { CSSProperties, FormEvent, useState } from "react";
import {
  STANDORT_KONTAKT_ROLLE_LABEL,
  STANDORT_VEREINBARUNG_ART_LABEL,
  STANDORT_VEREINBARUNG_STATUS_LABEL,
  type StandortKontaktDto,
  type StandortKontaktRolle,
  type StandortVereinbarungArt,
  type StandortVereinbarungDto,
  type StandortVereinbarungStatus,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { AktionsMenue } from "../components/AktionsMenue";
import { Datumsfeld } from "../components/Datumsfeld";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IAbbrechen,
  IBearbeiten,
  IDokument,
  IFehler,
  IInfo,
  INachrichtLoeschen,
  INeu,
  ISpeichern,
  IStornieren,
  ITelefonat,
} from "../components/icons";
import { formatBetrag, formatDatum } from "../format";

/**
 * Reiter "Kontakte vor Ort" und "Vereinbarungen" im Standort-Steckbrief
 * (Konzept standort-daten, Phase 2). Beide Listen nutzen die Karten-Liste
 * der Standortliste: am Rechner Spalten, am Handy gestapelte Karten mit
 * Label je Zelle -- ohne eigene zweite Fassung.
 */

export function telLink(nummer: string): string {
  return `tel:${nummer.replace(/[^\d+]/g, "")}`;
}

function fehlerText(err: unknown, ersatz: string): string {
  return err instanceof Error ? err.message : ersatz;
}

// --- Kontakte vor Ort ---------------------------------------------------------

export function KontakteVorOrt({
  standortId,
  kontakte,
  darfBearbeiten,
  onGeaendert,
}: {
  standortId: string;
  kontakte: StandortKontaktDto[];
  darfBearbeiten: boolean;
  onGeaendert: () => void;
}) {
  // undefined = zu, null = neuer Kontakt
  const [bearbeitet, setBearbeitet] = useState<StandortKontaktDto | null | undefined>(undefined);
  const [loeschen, setLoeschen] = useState<StandortKontaktDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function loeschenBestaetigt() {
    if (!loeschen) return;
    try {
      await api.standortKontaktLoeschen(standortId, loeschen.id);
      setLoeschen(null);
      onGeaendert();
    } catch (err) {
      setFehler(fehlerText(err, "Kontakt konnte nicht gelöscht werden."));
    }
  }

  return (
    <div className="zv-steckbrief-anhang">
      <div className="zv-seiten-kopf zv-steckbrief-anhang-kopf">
        <p className="zv-sub">Wen man hier anruft, wenn etwas am Haus ist: Hausverwaltung, Hausmeister, Notdienste, Praxis, Apotheke.</p>
        {darfBearbeiten && (
          <button className="zv-btn" onClick={() => setBearbeitet(null)}>
            <INeu />
            Neuer Kontakt
          </button>
        )}
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {kontakte.length === 0 ? (
        <Leerzustand icon={ITelefonat}>Noch keine Kontakte vor Ort eingetragen.</Leerzustand>
      ) : (
        <div
          className="zv-karten-liste zv-steckbrief-kontakte"
          style={{ "--zv-liste-spalten": "minmax(0, 2.2fr) minmax(0, 1.3fr) minmax(0, 1.6fr) minmax(0, 2fr) 36px" } as CSSProperties}
        >
          <div className="zv-liste-kopf">
            <span>Kontakt</span>
            <span>Telefon</span>
            <span>E-Mail</span>
            <span>Hinweis</span>
            <span></span>
          </div>
          {kontakte.map((k) => (
            <div key={k.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">
                <span className="zv-steckbrief-kontakt-rolle">{STANDORT_KONTAKT_ROLLE_LABEL[k.rolle]}</span>
                {k.name}
              </span>
              <span className="zv-liste-zelle" data-label="Telefon">
                {k.telefon ? <a href={telLink(k.telefon)}>{k.telefon}</a> : "–"}
              </span>
              <span className="zv-liste-zelle" data-label="E-Mail">
                {k.email ? <a href={`mailto:${k.email}`}>{k.email}</a> : "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Hinweis">
                {k.hinweis ?? "–"}
              </span>
              <span className="zv-liste-zelle-aktionen">
                {darfBearbeiten && (
                  <AktionsMenue label={`Aktionen zu ${k.name}`}>
                    <button type="button" role="menuitem" onClick={() => setBearbeitet(k)}>
                      <IBearbeiten />
                      Bearbeiten
                    </button>
                    <button type="button" role="menuitem" className="zv-menue-gefahr" onClick={() => setLoeschen(k)}>
                      <INachrichtLoeschen />
                      Löschen …
                    </button>
                  </AktionsMenue>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {bearbeitet !== undefined && (
        <KontaktFormular
          standortId={standortId}
          kontakt={bearbeitet}
          onSchliessen={() => setBearbeitet(undefined)}
          onGespeichert={() => {
            setBearbeitet(undefined);
            onGeaendert();
          }}
        />
      )}

      {loeschen && (
        <Modal titel="Kontakt löschen" onClose={() => setLoeschen(null)}>
          <p style={{ marginTop: 0 }}>
            „{loeschen.name}“ ({STANDORT_KONTAKT_ROLLE_LABEL[loeschen.rolle]}) wird aus dem Steckbrief entfernt. Im Protokoll bleibt nachvollziehbar, was
            hier stand.
          </p>
          <button className="zv-btn zv-btn-block zv-btn-gefahr" onClick={loeschenBestaetigt}>
            <INachrichtLoeschen />
            Jetzt löschen
          </button>
        </Modal>
      )}
    </div>
  );
}

function KontaktFormular({
  standortId,
  kontakt,
  onSchliessen,
  onGespeichert,
}: {
  standortId: string;
  kontakt: StandortKontaktDto | null;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const wert = (k: string) => String(form.get(k) ?? "").trim();
    const eingabe = {
      rolle: wert("rolle") as StandortKontaktRolle,
      name: wert("name"),
      telefon: wert("telefon") || null,
      email: wert("email") || null,
      hinweis: wert("hinweis") || null,
    };
    setFehler(null);
    setWirdGespeichert(true);
    try {
      if (kontakt) await api.standortKontaktAendern(standortId, kontakt.id, eingabe);
      else await api.standortKontaktAnlegen(standortId, eingabe);
      onGespeichert();
    } catch (err) {
      setFehler(fehlerText(err, "Kontakt konnte nicht gespeichert werden."));
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={kontakt ? "Kontakt bearbeiten" : "Neuer Kontakt vor Ort"} onClose={onSchliessen}>
      <form onSubmit={speichern}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="kontakt-rolle">Rolle</label>
          <select id="kontakt-rolle" name="rolle" defaultValue={kontakt?.rolle ?? "hausmeister"} required>
            {Object.entries(STANDORT_KONTAKT_ROLLE_LABEL).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="zv-field">
          <label htmlFor="kontakt-name">Name</label>
          <input id="kontakt-name" name="name" defaultValue={kontakt?.name ?? ""} placeholder="z. B. Hausverwaltung Kramer GmbH" required autoFocus />
        </div>
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="kontakt-telefon">Telefon</label>
            <input id="kontakt-telefon" name="telefon" type="tel" defaultValue={kontakt?.telefon ?? ""} />
          </div>
          <div className="zv-field">
            <label htmlFor="kontakt-email">E-Mail</label>
            <input id="kontakt-email" name="email" type="email" defaultValue={kontakt?.email ?? ""} />
          </div>
        </div>
        <div className="zv-field">
          <label htmlFor="kontakt-hinweis">Hinweis</label>
          <input id="kontakt-hinweis" name="hinweis" defaultValue={kontakt?.hinweis ?? ""} placeholder="z. B. nur werktags, Kundennummer 4711-A" />
        </div>
        <p className="zv-sub">Dienstliche Kontakte. Den Steckbrief sehen alle, die den Standort sehen.</p>
        <div className="zv-vorschau-zeile">
          <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
            <ISpeichern />
            {wirdGespeichert ? "Speichert…" : "Speichern"}
          </button>
          <button className="zv-btn zv-btn-still" type="button" onClick={onSchliessen}>
            <IAbbrechen />
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Vereinbarungen ------------------------------------------------------------

const STATUS_PILL: Record<StandortVereinbarungStatus, string> = {
  gueltig: "zv-pill-zugeordnet",
  endet_bald: "zv-pill-frist",
  verlaengert: "zv-pill-info",
  kuenftig: "zv-pill-info",
  abgelaufen: "zv-pill-neutral",
  storniert: "zv-pill-neutral",
};

function statusText(v: StandortVereinbarungDto): string {
  if (v.status === "endet_bald" && v.endetInTagen !== null) {
    return v.endetInTagen === 0 ? "Endet heute" : `Endet in ${v.endetInTagen} ${v.endetInTagen === 1 ? "Tag" : "Tagen"}`;
  }
  return STANDORT_VEREINBARUNG_STATUS_LABEL[v.status];
}

function laufzeit(v: StandortVereinbarungDto): string {
  return v.gueltigBis ? `${formatDatum(v.gueltigVon)} – ${formatDatum(v.gueltigBis)}` : `seit ${formatDatum(v.gueltigVon)}, unbefristet`;
}

export function Vereinbarungen({
  standortId,
  vereinbarungen,
  onGeaendert,
}: {
  standortId: string;
  vereinbarungen: StandortVereinbarungDto[];
  onGeaendert: () => void;
}) {
  const [neu, setNeu] = useState(false);
  const [aendern, setAendern] = useState<StandortVereinbarungDto | null>(null);
  const [storno, setStorno] = useState<StandortVereinbarungDto | null>(null);
  const [alteZeigen, setAlteZeigen] = useState(false);

  // Abgelaufene und stornierte bleiben Nachweis, stehen aber nicht im Weg.
  const aktuell = vereinbarungen.filter((v) => v.status !== "abgelaufen" && v.status !== "storniert");
  const frueher = vereinbarungen.filter((v) => v.status === "abgelaufen" || v.status === "storniert");
  const sichtbar = alteZeigen ? [...aktuell, ...frueher] : aktuell;

  return (
    <div className="zv-steckbrief-anhang">
      <div className="zv-seiten-kopf zv-steckbrief-anhang-kopf">
        <p className="zv-sub">
          Leistungs- und Vergütungsvereinbarungen, Betriebserlaubnis. Nur für Konten mit dem Recht „Vereinbarungen“ sichtbar.
        </p>
        <button className="zv-btn" onClick={() => setNeu(true)}>
          <INeu />
          Neue Vereinbarung
        </button>
      </div>

      {sichtbar.length === 0 ? (
        <Leerzustand icon={IDokument}>
          {frueher.length > 0 ? "Keine gültige oder künftige Vereinbarung." : "Noch keine Vereinbarung erfasst."}
        </Leerzustand>
      ) : (
        <div
          className="zv-karten-liste zv-steckbrief-vereinbarungen"
          style={{ "--zv-liste-spalten": "minmax(0, 2.4fr) minmax(0, 1.8fr) minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1.3fr) 36px" } as CSSProperties}
        >
          <div className="zv-liste-kopf">
            <span>Vereinbarung</span>
            <span>Laufzeit</span>
            <span>Plätze</span>
            <span>Vergütung</span>
            <span>Status</span>
            <span></span>
          </div>
          {sichtbar.map((v) => (
            <div key={v.id} className={`zv-info-karte${v.status === "storniert" ? " zv-vereinbarung-storniert" : ""}`}>
              <span className="zv-liste-zelle-titel">
                <span className="zv-steckbrief-kontakt-rolle">{STANDORT_VEREINBARUNG_ART_LABEL[v.art]}</span>
                {v.partner}
                {(v.kennung || v.bemerkung || v.stornoGrund) && (
                  <span className="zv-steckbrief-vereinbarung-meta">
                    {[v.kennung, v.bemerkung, v.stornoGrund ? `Storniert: ${v.stornoGrund}` : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              <span className="zv-liste-zelle" data-label="Laufzeit">
                {laufzeit(v)}
              </span>
              <span className="zv-liste-zelle" data-label="Plätze">
                {v.plaetze ?? "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Vergütung">
                {v.verguetungTagCent !== null ? `${formatBetrag(v.verguetungTagCent)} / Tag` : "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <span className={`zv-pill ${STATUS_PILL[v.status]}`}>{statusText(v)}</span>
              </span>
              <span className="zv-liste-zelle-aktionen">
                {v.status !== "storniert" && (
                  <AktionsMenue label={`Aktionen zu ${STANDORT_VEREINBARUNG_ART_LABEL[v.art]} ${v.partner}`}>
                    <button type="button" role="menuitem" onClick={() => setAendern(v)}>
                      <IBearbeiten />
                      Laufzeit und Kennung …
                    </button>
                    <button type="button" role="menuitem" className="zv-menue-gefahr" onClick={() => setStorno(v)}>
                      <IStornieren />
                      Stornieren …
                    </button>
                  </AktionsMenue>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {frueher.length > 0 && (
        <button type="button" className="zv-link-btn zv-steckbrief-fruehere" onClick={() => setAlteZeigen((x) => !x)}>
          {alteZeigen ? "Abgelaufene und stornierte ausblenden" : `${frueher.length} abgelaufene oder stornierte anzeigen`}
        </button>
      )}

      <p className="zv-sub zv-standorte-fuss">
        <IInfo />
        Partner, Plätze und Vergütung lassen sich nicht überschreiben: bei einem Fehler stornieren und neu erfassen. So bleibt jeder Satz nachweisbar.
      </p>

      {neu && (
        <VereinbarungAnlegen
          standortId={standortId}
          onSchliessen={() => setNeu(false)}
          onGespeichert={() => {
            setNeu(false);
            onGeaendert();
          }}
        />
      )}
      {aendern && (
        <VereinbarungAendern
          standortId={standortId}
          vereinbarung={aendern}
          onSchliessen={() => setAendern(null)}
          onGespeichert={() => {
            setAendern(null);
            onGeaendert();
          }}
        />
      )}
      {storno && (
        <VereinbarungStornieren
          standortId={standortId}
          vereinbarung={storno}
          onSchliessen={() => setStorno(null)}
          onGespeichert={() => {
            setStorno(null);
            onGeaendert();
          }}
        />
      )}
    </div>
  );
}

/** "142,50" -> 14250; leer -> null; Unsinn -> NaN (Formular zeigt Fehler). */
function centAusEingabe(text: string): number | null {
  const t = text.trim().replace(/\s|€/g, "");
  if (t === "") return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t.replace(",", ".")) * 100);
}

function Formularfuss({ wirdGespeichert, onSchliessen, label = "Speichern" }: { wirdGespeichert: boolean; onSchliessen: () => void; label?: string }) {
  return (
    <div className="zv-vorschau-zeile">
      <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
        <ISpeichern />
        {wirdGespeichert ? "Speichert…" : label}
      </button>
      <button className="zv-btn zv-btn-still" type="button" onClick={onSchliessen}>
        <IAbbrechen />
        Abbrechen
      </button>
    </div>
  );
}

function VereinbarungAnlegen({ standortId, onSchliessen, onGespeichert }: { standortId: string; onSchliessen: () => void; onGespeichert: () => void }) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const wert = (k: string) => String(form.get(k) ?? "").trim();
    const verguetung = centAusEingabe(wert("verguetung"));
    if (Number.isNaN(verguetung)) {
      setFehler("Vergütung bitte als Betrag in Euro, z. B. 142,50.");
      return;
    }
    const plaetze = wert("plaetze");
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.standortVereinbarungAnlegen(standortId, {
        art: wert("art") as StandortVereinbarungArt,
        partner: wert("partner"),
        kennung: wert("kennung") || null,
        gueltigVon: wert("gueltigVon"),
        gueltigBis: wert("gueltigBis") || null,
        plaetze: plaetze ? Number(plaetze) : null,
        verguetungTagCent: verguetung,
        bemerkung: wert("bemerkung") || null,
      });
      onGespeichert();
    } catch (err) {
      setFehler(fehlerText(err, "Vereinbarung konnte nicht gespeichert werden."));
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel="Neue Vereinbarung" onClose={onSchliessen}>
      <form onSubmit={speichern}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="vereinbarung-art">Art</label>
          <select id="vereinbarung-art" name="art" defaultValue="leistungsvereinbarung" required>
            {Object.entries(STANDORT_VEREINBARUNG_ART_LABEL).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="zv-field">
          <label htmlFor="vereinbarung-partner">Partner</label>
          <input id="vereinbarung-partner" name="partner" placeholder="Kostenträger bzw. Behörde, z. B. Bezirk Musterland" required autoFocus />
        </div>
        <div className="zv-field">
          <label htmlFor="vereinbarung-kennung">Aktenzeichen / Kennung</label>
          <input id="vereinbarung-kennung" name="kennung" />
        </div>
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="vereinbarung-von">Gültig von</label>
            <Datumsfeld id="vereinbarung-von" name="gueltigVon" required />
          </div>
          <div className="zv-field">
            <label htmlFor="vereinbarung-bis">Gültig bis</label>
            <Datumsfeld id="vereinbarung-bis" name="gueltigBis" />
          </div>
        </div>
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="vereinbarung-plaetze">Genehmigte Plätze</label>
            <input id="vereinbarung-plaetze" name="plaetze" type="number" min={1} step={1} inputMode="numeric" />
          </div>
          <div className="zv-field">
            <label htmlFor="vereinbarung-verguetung">Vergütung je Tag (€)</label>
            <input id="vereinbarung-verguetung" name="verguetung" inputMode="decimal" placeholder="z. B. 142,50" />
          </div>
        </div>
        <div className="zv-field">
          <label htmlFor="vereinbarung-bemerkung">Bemerkung</label>
          <input id="vereinbarung-bemerkung" name="bemerkung" />
        </div>
        <p className="zv-sub">Ohne Enddatum gilt die Vereinbarung unbefristet. 90, 60 und 30 Tage vor dem Ende bekommt die Leitung des Standorts eine Aufgabe.</p>
        <Formularfuss wirdGespeichert={wirdGespeichert} onSchliessen={onSchliessen} />
      </form>
    </Modal>
  );
}

function VereinbarungAendern({
  standortId,
  vereinbarung: v,
  onSchliessen,
  onGespeichert,
}: {
  standortId: string;
  vereinbarung: StandortVereinbarungDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const wert = (k: string) => String(form.get(k) ?? "").trim();
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.standortVereinbarungAendern(standortId, v.id, {
        gueltigBis: wert("gueltigBis") || null,
        kennung: wert("kennung") || null,
        bemerkung: wert("bemerkung") || null,
      });
      onGespeichert();
    } catch (err) {
      setFehler(fehlerText(err, "Vereinbarung konnte nicht gespeichert werden."));
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={`${STANDORT_VEREINBARUNG_ART_LABEL[v.art]} ändern`} onClose={onSchliessen}>
      <form onSubmit={speichern}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <p style={{ marginTop: 0 }}>
          {v.partner}, gültig ab {formatDatum(v.gueltigVon)}
        </p>
        <div className="zv-field">
          <label htmlFor="vereinbarung-bis-aendern">Gültig bis</label>
          <Datumsfeld id="vereinbarung-bis-aendern" name="gueltigBis" defaultValue={v.gueltigBis ?? ""} />
        </div>
        <div className="zv-field">
          <label htmlFor="vereinbarung-kennung-aendern">Aktenzeichen / Kennung</label>
          <input id="vereinbarung-kennung-aendern" name="kennung" defaultValue={v.kennung ?? ""} />
        </div>
        <div className="zv-field">
          <label htmlFor="vereinbarung-bemerkung-aendern">Bemerkung</label>
          <input id="vereinbarung-bemerkung-aendern" name="bemerkung" defaultValue={v.bemerkung ?? ""} />
        </div>
        <p className="zv-sub">Partner, Plätze und Vergütung sind fest. Bei einem Fehler darin bitte stornieren und neu erfassen.</p>
        <Formularfuss wirdGespeichert={wirdGespeichert} onSchliessen={onSchliessen} />
      </form>
    </Modal>
  );
}

function VereinbarungStornieren({
  standortId,
  vereinbarung: v,
  onSchliessen,
  onGespeichert,
}: {
  standortId: string;
  vereinbarung: StandortVereinbarungDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const grund = String(new FormData(e.currentTarget).get("grund") ?? "").trim();
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.standortVereinbarungStornieren(standortId, v.id, grund);
      onGespeichert();
    } catch (err) {
      setFehler(fehlerText(err, "Vereinbarung konnte nicht storniert werden."));
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel="Vereinbarung stornieren" onClose={onSchliessen}>
      <form onSubmit={speichern}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <p style={{ marginTop: 0 }}>
          {STANDORT_VEREINBARUNG_ART_LABEL[v.art]} mit {v.partner} ({laufzeit(v)}). Ein Storno ist endgültig; die Zeile bleibt als Nachweis sichtbar.
        </p>
        <div className="zv-field">
          <label htmlFor="vereinbarung-storno-grund">Grund</label>
          <input id="vereinbarung-storno-grund" name="grund" minLength={3} required autoFocus placeholder="z. B. Vergütung falsch erfasst" />
        </div>
        <div className="zv-vorschau-zeile">
          <button className="zv-btn zv-btn-gefahr" type="submit" disabled={wirdGespeichert}>
            <IStornieren />
            {wirdGespeichert ? "Storniert…" : "Endgültig stornieren"}
          </button>
          <button className="zv-btn zv-btn-still" type="button" onClick={onSchliessen}>
            <IAbbrechen />
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  );
}
