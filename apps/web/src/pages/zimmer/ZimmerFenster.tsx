import { FormEvent, useState } from "react";
import type {
  BelegungsverlaufEintragDto,
  KlientListEintragDto,
  StandortDto,
  ZimmerBewohnerDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { api } from "../../api/client";
import { heuteBerlin } from "../../format";
import { Modal } from "../../components/Modal";
import { Datumsfeld, Zeitraumfeld } from "../../components/Datumsfeld";
import { IAbbrechen, IAuszug, IEinziehen, IFehler, ISpeichern, IWarteliste } from "../../components/icons";

/**
 * Die Formular-Fenster der Zimmerseite. Standen vorher alle in Zimmer.tsx,
 * jedes mit eigenem Fehler-Zustand und eigener Absende-Funktion im selben
 * 1.400-Zeilen-Baustein. Jedes Fenster hält seinen Fehler und den
 * Speicher-Zustand jetzt selbst; die Seite sagt nur, welches Zimmer gemeint
 * ist und was nach dem Speichern neu geladen wird. Fehler werden beim
 * Öffnen zurückgesetzt -- das tat die Seite vorher von Hand, jetzt ergibt
 * es sich daraus, dass ein geschlossenes Fenster nicht mehr existiert.
 */

/** Sentinel-Wert im Standort-Select fuer "einen neuen Standort anlegen". */
export const NEUER_STANDORT = "__neu__";

function FensterFehler({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="zv-hinweis zv-hinweis-fehler">
      <IFehler />
      {text}
    </div>
  );
}

function fehlerText(err: unknown, ersatz: string) {
  return err instanceof Error ? err.message : ersatz;
}

/**
 * Eigene Wohnanschrift einer Wohnung (Einzelwohnen, Migration 0079): dort
 * ist der Standort das Buero, die Klient:innen wohnen verstreut. Jede
 * Wohnung bleibt ein Zimmer, damit Belegung, Plaetze und Raumplan
 * unveraendert funktionieren -- nur die Anschrift kommt dazu.
 */
function ZimmerAnschriftFeld({ id, vorgabe }: { id: string; vorgabe?: string | null }) {
  return (
    <div className="zv-field">
      <label htmlFor={id}>Eigene Wohnanschrift (optional)</label>
      <input id={id} name="anschrift" defaultValue={vorgabe ?? ""} placeholder="Straße Nr., PLZ Ort" aria-describedby={`${id}-hinweis`} />
      <p id={`${id}-hinweis`} className="zv-sub">
        Nur wenn die Wohnung nicht unter der Anschrift des Standorts liegt, etwa im Einzelwohnen.
      </p>
    </div>
  );
}

export function ZimmerAnlegenFenster({
  standorte,
  standortIds,
  einStandort,
  eingebettet,
  standortAuswahl,
  onStandortAuswahl,
  onSchliessen,
  onAngelegt,
}: {
  standorte: StandortDto[];
  standortIds?: string[];
  einStandort?: string;
  eingebettet: boolean;
  /** Bleibt in der Seite, damit die letzte Wahl beim nächsten Öffnen wieder steht. */
  standortAuswahl: string;
  onStandortAuswahl: (id: string) => void;
  onSchliessen: () => void;
  onAngelegt: () => void;
}) {
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function zimmerAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const nummer = String(form.get("nummer") ?? "").trim();
    const etage = String(form.get("etage") ?? "").trim();
    const kapazitaet = Number(form.get("kapazitaet") ?? 1);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      let zielStandortId = standortAuswahl;
      if (zielStandortId === NEUER_STANDORT) {
        const name = String(form.get("standortName") ?? "").trim();
        const neuerStandort = await api.standortAnlegen({
          name,
          strasse: String(form.get("standortStrasse") ?? "").trim(),
          plz: String(form.get("standortPlz") ?? "").trim() || null,
          ort: String(form.get("standortOrt") ?? "").trim() || null,
        });
        zielStandortId = neuerStandort.id;
      }
      const anschrift = String(form.get("anschrift") ?? "").trim();
      await api.zimmerAnlegen({
        standortId: zielStandortId,
        nummer,
        etage: etage || undefined,
        kapazitaet,
        anschrift: anschrift || null,
      });
      onAngelegt();
    } catch (err) {
      setFormFehler(fehlerText(err, "Zimmer konnte nicht angelegt werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel="Neues Zimmer" onClose={onSchliessen}>
      <form onSubmit={zimmerAnlegen}>
        <FensterFehler text={formFehler} />

        {!einStandort && (
          <>
            <div className="zv-field">
              <label htmlFor="zimmer-standort">Standort</label>
              <select id="zimmer-standort" value={standortAuswahl} onChange={(e) => onStandortAuswahl(e.target.value)}>
                {standorte
                  .filter((s) => s.aktiv && (!standortIds || standortIds.includes(s.id)))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                {!eingebettet && <option value={NEUER_STANDORT}>+ Neuen Standort anlegen…</option>}
              </select>
            </div>

            {standortAuswahl === NEUER_STANDORT && (
              <>
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-name">Name des Standorts</label>
                  <input id="zimmer-standort-name" name="standortName" placeholder="z. B. Wohnheim Nordstraße" required autoFocus />
                </div>
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-strasse">Straße und Hausnummer</label>
                  <input id="zimmer-standort-strasse" name="standortStrasse" autoComplete="street-address" required />
                </div>
                <div className="zv-field-row">
                  <div className="zv-field">
                    <label htmlFor="zimmer-standort-plz">PLZ</label>
                    <input id="zimmer-standort-plz" name="standortPlz" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required />
                  </div>
                  <div className="zv-field">
                    <label htmlFor="zimmer-standort-ort">Ort</label>
                    <input id="zimmer-standort-ort" name="standortOrt" required />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="zimmer-nummer">Zimmernummer</label>
            <input
              id="zimmer-nummer"
              name="nummer"
              placeholder="z. B. 101"
              required
              autoFocus={standortAuswahl !== NEUER_STANDORT}
            />
          </div>
          <div className="zv-field">
            <label htmlFor="zimmer-etage">Etage</label>
            <input id="zimmer-etage" name="etage" list="zv-etagen-vorschlaege" placeholder="z. B. EG" defaultValue="EG" />
          </div>
        </div>

        <div className="zv-field">
          <label htmlFor="zimmer-kapazitaet">Kapazität (Bewohner:innen)</label>
          <input id="zimmer-kapazitaet" name="kapazitaet" type="number" min={1} max={12} defaultValue={1} />
        </div>

        <ZimmerAnschriftFeld id="zimmer-anschrift" />

        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : "Zimmer anlegen"}
        </button>
      </form>
    </Modal>
  );
}

export function ZimmerBearbeitenFenster({
  zimmer,
  onSchliessen,
  onGespeichert,
}: {
  zimmer: ZimmerListEintragDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [bearbeitenFehler, setBearbeitenFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function zimmerBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setBearbeitenFehler(null);
    setWirdGespeichert(true);
    try {
      const etage = String(form.get("etage") ?? "").trim();
      await api.zimmerAktualisieren(zimmer.id, {
        nummer: String(form.get("nummer") ?? "").trim(),
        etage: etage || undefined,
        anschrift: String(form.get("anschrift") ?? "").trim() || null,
      });
      onGespeichert();
    } catch (err) {
      setBearbeitenFehler(fehlerText(err, "Zimmer konnte nicht gespeichert werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel="Zimmer bearbeiten" onClose={onSchliessen}>
      <form onSubmit={zimmerBearbeiten}>
        <FensterFehler text={bearbeitenFehler} />
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="zimmer-bearbeiten-nummer">Zimmernummer</label>
            <input id="zimmer-bearbeiten-nummer" name="nummer" defaultValue={zimmer.nummer} required autoFocus />
          </div>
          <div className="zv-field">
            <label htmlFor="zimmer-bearbeiten-etage">Etage</label>
            <input id="zimmer-bearbeiten-etage" name="etage" list="zv-etagen-vorschlaege" defaultValue={zimmer.etage} />
          </div>
        </div>
        <ZimmerAnschriftFeld id="zimmer-bearbeiten-anschrift" vorgabe={zimmer.anschrift} />
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

export function KlientZuweisenFenster({
  zimmer,
  wartelistenKlient,
  klienten,
  onSchliessen,
  onGespeichert,
}: {
  zimmer: ZimmerListEintragDto;
  /** Gesetzt, wenn von der Warteliste aus geöffnet: dann ist der Klient schon festgelegt. */
  wartelistenKlient: { id: string; name: string } | null;
  klienten: KlientListEintragDto[];
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [zuweisungFehler, setZuweisungFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function klientZuweisen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setZuweisungFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungEinziehen({
        zimmerId: zimmer.id,
        klientId: wartelistenKlient?.id ?? String(form.get("klientId")),
        einzug: String(form.get("einzug")),
      });
      onGespeichert();
    } catch (err) {
      setZuweisungFehler(fehlerText(err, "Klient:in konnte nicht zugewiesen werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  const ohneZimmer = klienten.filter((k) => k.aktuellesZimmer === null);

  return (
    <Modal titel={`Klient zuweisen — Zimmer ${zimmer.nummer}`} onClose={onSchliessen}>
      <form onSubmit={klientZuweisen}>
        <FensterFehler text={zuweisungFehler} />
        {wartelistenKlient ? (
          <div className="zv-field">
            <label>Klient:in</label>
            <p className="zv-sub" style={{ margin: 0 }}>
              {wartelistenKlient.name} (von der Warteliste)
            </p>
          </div>
        ) : (
          <div className="zv-field">
            <label htmlFor="zuweisung-klient">Klient:in</label>
            <select id="zuweisung-klient" name="klientId" required autoFocus defaultValue="">
              <option value="" disabled>
                Bitte wählen
              </option>
              {ohneZimmer.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.vorname} {k.nachname}
                </option>
              ))}
            </select>
            {ohneZimmer.length === 0 && <span className="zv-sub-inline">Alle Klient:innen haben bereits ein Zimmer.</span>}
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="zuweisung-einzug">Einzugsdatum</label>
          <Datumsfeld id="zuweisung-einzug" name="einzug" required defaultValue={heuteBerlin()} schnellwahl="heute" />
        </div>
        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
          <IEinziehen />
          {wirdGespeichert ? "Speichert…" : "Einziehen"}
        </button>
      </form>
    </Modal>
  );
}

export function WartelisteFenster({
  zimmer,
  klienten,
  onSchliessen,
  onGespeichert,
}: {
  zimmer: ZimmerListEintragDto;
  klienten: KlientListEintragDto[];
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [wartelisteFehler, setWartelisteFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function wartelisteHinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setWartelisteFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerWartelisteHinzufuegen(zimmer.id, String(form.get("klientId")));
      onGespeichert();
    } catch (err) {
      setWartelisteFehler(fehlerText(err, "Klient:in konnte nicht auf die Warteliste gesetzt werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={`Zur Warteliste — Zimmer ${zimmer.nummer}`} onClose={onSchliessen}>
      <form onSubmit={wartelisteHinzufuegen}>
        <FensterFehler text={wartelisteFehler} />
        <div className="zv-field">
          <label htmlFor="warteliste-klient">Klient:in</label>
          <select id="warteliste-klient" name="klientId" required autoFocus defaultValue="">
            <option value="" disabled>
              Bitte wählen
            </option>
            {klienten
              .filter((k) => k.aktuellesZimmer?.id !== zimmer.id && !zimmer.warteliste.some((w) => w.klientId === k.id))
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {k.vorname} {k.nachname}
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
  );
}

export function AuszugFenster({
  zimmer,
  bewohner,
  onSchliessen,
  onGespeichert,
}: {
  zimmer: ZimmerListEintragDto;
  bewohner: ZimmerBewohnerDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [auszugFehler, setAuszugFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function auszugEintragen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAuszugFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungAusziehen(bewohner.belegungId, String(form.get("auszug")));
      onGespeichert();
    } catch (err) {
      setAuszugFehler(fehlerText(err, "Auszug konnte nicht eingetragen werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={`Auszug eintragen — Zimmer ${zimmer.nummer}`} onClose={onSchliessen}>
      <form onSubmit={auszugEintragen}>
        <FensterFehler text={auszugFehler} />
        <p className="zv-sub" style={{ margin: "0 0 12px" }}>
          {bewohner.name} zieht aus diesem Zimmer aus.
        </p>
        <div className="zv-field">
          <label htmlFor="auszug-datum">Auszugsdatum</label>
          <Datumsfeld id="auszug-datum" name="auszug" required autoFocus defaultValue={heuteBerlin()} schnellwahl="heute" />
        </div>
        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
          <IAuszug />
          {wirdGespeichert ? "Speichert…" : "Auszug speichern"}
        </button>
      </form>
    </Modal>
  );
}

export function BelegungBearbeitenFenster({
  belegung,
  onSchliessen,
  onGespeichert,
}: {
  belegung: BelegungsverlaufEintragDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [belegungBearbeitenFehler, setBelegungBearbeitenFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function belegungBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBelegungBearbeitenFehler(null);
    setWirdGespeichert(true);
    try {
      const auszug = String(form.get("auszug"));
      await api.belegungBearbeiten(belegung.id, {
        einzug: String(form.get("einzug")),
        auszug: auszug === "" ? null : auszug,
      });
      onGespeichert();
    } catch (err) {
      setBelegungBearbeitenFehler(fehlerText(err, "Belegung konnte nicht geändert werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={`Belegung bearbeiten — ${belegung.name}`} onClose={onSchliessen}>
      <form onSubmit={belegungBearbeiten}>
        <FensterFehler text={belegungBearbeitenFehler} />
        <p className="zv-sub" style={{ margin: "0 0 12px" }}>
          Nutzen, wenn sich ein Einzug oder Auszug verzögert oder sich geändert hat.
        </p>
        <div className="zv-field-row">
          <Zeitraumfeld
            von={{ id: "belegung-bearbeiten-einzug", name: "einzug", label: "Einzugsdatum", required: true }}
            bis={{ id: "belegung-bearbeiten-auszug", name: "auszug", label: "Auszugsdatum (optional)" }}
            defaultVon={belegung.einzug}
            defaultBis={belegung.auszug ?? ""}
            autoFocus
          />
        </div>
        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : "Speichern"}
        </button>
      </form>
    </Modal>
  );
}

export function KapazitaetFenster({
  zimmer,
  onSchliessen,
  onGespeichert,
}: {
  zimmer: ZimmerListEintragDto;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [kapazitaetFehler, setKapazitaetFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function kapazitaetAendern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const neueKapazitaet = Number(form.get("neueKapazitaet"));
    setKapazitaetFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerKapazitaetAendern(zimmer.id, neueKapazitaet);
      onGespeichert();
    } catch (err) {
      setKapazitaetFehler(fehlerText(err, "Kapazitätsänderung konnte nicht beantragt werden."));
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={`Kapazität ändern — Zimmer ${zimmer.nummer}`} onClose={onSchliessen}>
      <form onSubmit={kapazitaetAendern}>
        <FensterFehler text={kapazitaetFehler} />
        <p className="zv-sub" style={{ marginTop: 0 }}>
          Aktuelle Kapazität: {zimmer.kapazitaet}. Die Änderung wirkt erst, wenn die jeweils andere Leitungsrolle sie
          bestätigt hat.
        </p>
        <div className="zv-field">
          <label htmlFor="kapazitaet-neu">Neue Kapazität</label>
          <input
            id="kapazitaet-neu"
            name="neueKapazitaet"
            type="number"
            min={1}
            max={12}
            required
            autoFocus
            defaultValue={zimmer.kapazitaet}
          />
        </div>
        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : "Änderung beantragen"}
        </button>
      </form>
    </Modal>
  );
}
