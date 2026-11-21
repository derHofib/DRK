import { CSSProperties, FormEvent, useState, type DragEvent } from "react";
import type { Leistungsart, TerminTypBetreuungszeit, TerminTypDto, TerminTypFarbe } from "@zimmerakte/shared";
import {
  LEISTUNGSARTEN,
  LEISTUNGSART_LABEL,
  TERMIN_TYP_BETREUUNGSZEITEN,
  TERMIN_TYP_BETREUUNGSZEIT_LABEL,
  TERMIN_TYP_FARBEN,
  TERMIN_TYP_FARBE_LABEL,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import {
  IAktivieren,
  IBearbeiten,
  IDeaktivieren,
  IFehler,
  ILoeschen,
  INeu,
  ISpeichern,
  IVerschiebenHoch,
  IVerschiebenRunter,
  IZiehen,
} from "../components/icons";
import { terminTypenNeuLaden, useTerminTypen } from "../kalender/terminTypen";

const BETREUUNGSZEIT_TEXT: Record<TerminTypBetreuungszeit, string> = {
  vorbelegen: "Im Termin ist der Haken „Als Betreuungszeit erfassen“ schon gesetzt. Gebucht wird nur, wenn eine Klient:in dabei ist.",
  voreinstellung: "Jede Person entscheidet nach ihrer eigenen Voreinstellung, wie bisher.",
  nicht_vorbelegen: "Kein Haken vorbelegt, z. B. für Teamsitzungen. Setzen lässt er sich trotzdem.",
};

const BETREUUNGSZEIT_KURZ: Record<TerminTypBetreuungszeit, string> = {
  vorbelegen: "vorbelegt",
  voreinstellung: "wie Voreinstellung",
  nicht_vorbelegen: "nicht vorbelegt",
};

/**
 * Termintypen des Traegers (migrations/0085). Reihenfolge per Ziehen oder
 * mit den Pfeilen (Tastatur, Handy) -- so stehen die Typen auch im
 * Termin-Dialog und im Kalender-Filter.
 *
 * Ausblenden statt Loeschen: bestehende Termine behalten Name und Farbe.
 * Loeschen bietet die Seite trotzdem an; ob ein Typ schon in Terminen
 * steckt, weiss verbindlich nur die Datenbank (auch Termine, die die Leitung
 * nicht sehen darf), und die Antwort sagt dann, dass Ausblenden der Weg ist.
 */
export function TerminTypen() {
  const typen = useTerminTypen();
  const [fehler, setFehler] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TerminTypDto | "neu" | null>(null);
  const [gezogen, setGezogen] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<string[] | null>(null);

  const reihenfolge = vorschau ? vorschau.map((id) => typen.find((t) => t.id === id)!).filter(Boolean) : typen;

  async function speichereReihenfolge(ids: string[]) {
    setFehler(null);
    try {
      await api.terminTypenReihenfolge(ids);
      await terminTypenNeuLaden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Reihenfolge konnte nicht gespeichert werden.");
    } finally {
      setVorschau(null);
    }
  }

  function verschieben(id: string, richtung: -1 | 1) {
    const ids = typen.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + richtung;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setVorschau(ids);
    void speichereReihenfolge(ids);
  }

  function ziehenUeber(e: DragEvent, zielId: string) {
    if (!gezogen) return;
    e.preventDefault();
    if (gezogen === zielId) return;
    const ids = [...(vorschau ?? typen.map((t) => t.id))];
    const von = ids.indexOf(gezogen);
    const nach = ids.indexOf(zielId);
    ids.splice(von, 1);
    ids.splice(nach, 0, gezogen);
    setVorschau(ids);
  }

  async function aktivSchalten(t: TerminTypDto) {
    setFehler(null);
    try {
      await api.terminTypAendern(t.id, { aktiv: !t.aktiv });
      await terminTypenNeuLaden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termintyp konnte nicht geändert werden.");
    }
  }

  return (
    <div>
      <div className="zv-typen-kopf">
        <div>
          <h3 className="zv-typen-titel">Termintypen</h3>
          <p className="zv-sub zv-typen-text">
            Was im Termin-Dialog unter „Art“ steht. Die Farbe erscheint im Kalender, im Filter und in der Legende. Die Reihenfolge gilt überall.
          </p>
        </div>
        <button type="button" className="zv-btn" onClick={() => setDialog("neu")}>
          <INeu />
          Neuer Termintyp
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste zv-typen-liste" style={{ "--zv-liste-spalten": "28px 2fr 1.4fr 1.2fr 1fr auto" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span></span>
          <span>Bezeichnung</span>
          <span>Betreuungszeit</span>
          <span>Leistung</span>
          <span>Status</span>
          <span></span>
        </div>
        {reihenfolge.map((t, i) => (
          <div
            key={t.id}
            className={`zv-info-karte${t.aktiv ? "" : " zv-typen-aus"}${gezogen === t.id ? " zv-typen-gezogen" : ""}`}
            draggable
            onDragStart={(e) => {
              setGezogen(t.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => ziehenUeber(e, t.id)}
            onDragEnd={() => {
              setGezogen(null);
              if (vorschau) void speichereReihenfolge(vorschau);
            }}
          >
            <span className="zv-typen-griff" aria-hidden="true" title="Ziehen, um die Reihenfolge zu ändern">
              <IZiehen />
            </span>
            <span className="zv-liste-zelle-titel">
              <span className={`zv-person-punkt zv-art-farbe zv-typ-${t.farbe}`} aria-hidden="true" />
              {t.bezeichnung}
              {t.istStandard && <span className="zv-sub-inline">Standard</span>}
            </span>
            <span className="zv-liste-zelle" data-label="Betreuungszeit">
              {BETREUUNGSZEIT_KURZ[t.betreuungszeit]}
            </span>
            <span className="zv-liste-zelle" data-label="Leistung">
              {t.leistungsart ? LEISTUNGSART_LABEL[t.leistungsart] : "automatisch"}
            </span>
            <span className="zv-liste-zelle" data-label="Status">
              <span className={`zv-pill ${t.aktiv ? "zv-pill-zugeordnet" : "zv-pill-neutral"}`}>{t.aktiv ? "Aktiv" : "Ausgeblendet"}</span>
            </span>
            <span className="zv-liste-zelle-aktionen">
              <button type="button" className="zv-link-btn" onClick={() => setDialog(t)}>
                <IBearbeiten />
                Bearbeiten
              </button>
              <button type="button" className="zv-icon-btn" aria-label={`${t.bezeichnung} nach oben`} disabled={i === 0} onClick={() => verschieben(t.id, -1)}>
                <IVerschiebenHoch />
              </button>
              <button
                type="button"
                className="zv-icon-btn"
                aria-label={`${t.bezeichnung} nach unten`}
                disabled={i === reihenfolge.length - 1}
                onClick={() => verschieben(t.id, 1)}
              >
                <IVerschiebenRunter />
              </button>
            </span>
          </div>
        ))}
      </div>

      {dialog && (
        <TypDialog
          typ={dialog === "neu" ? null : dialog}
          onClose={() => setDialog(null)}
          onAktivSchalten={(t) => {
            setDialog(null);
            void aktivSchalten(t);
          }}
        />
      )}
    </div>
  );
}

function TypDialog({ typ, onClose, onAktivSchalten }: { typ: TerminTypDto | null; onClose: () => void; onAktivSchalten: (t: TerminTypDto) => void }) {
  const [bezeichnung, setBezeichnung] = useState(typ?.bezeichnung ?? "");
  const [farbe, setFarbe] = useState<TerminTypFarbe>(typ?.farbe ?? "blau");
  const [betreuungszeit, setBetreuungszeit] = useState<TerminTypBetreuungszeit>(typ?.betreuungszeit ?? "voreinstellung");
  const [leistungsart, setLeistungsart] = useState<Leistungsart | "">(typ?.leistungsart ?? "");
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    setWirdGespeichert(true);
    const eingabe = { bezeichnung: bezeichnung.trim(), farbe, betreuungszeit, leistungsart: leistungsart || null };
    try {
      if (typ) await api.terminTypAendern(typ.id, eingabe);
      else await api.terminTypAnlegen(eingabe);
      await terminTypenNeuLaden();
      onClose();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termintyp konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function loeschen() {
    if (!typ) return;
    setFehler(null);
    try {
      await api.terminTypLoeschen(typ.id);
      await terminTypenNeuLaden();
      onClose();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Termintyp konnte nicht gelöscht werden.");
    }
  }

  return (
    <Modal titel={typ ? `Termintyp „${typ.bezeichnung}“` : "Neuer Termintyp"} onClose={onClose}>
      <form onSubmit={speichern}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler" role="alert">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="typ-bezeichnung">Bezeichnung</label>
          <input
            id="typ-bezeichnung"
            value={bezeichnung}
            onChange={(e) => setBezeichnung(e.target.value)}
            placeholder="z. B. Hausbesuch"
            maxLength={60}
            required
            autoFocus
          />
        </div>

        <fieldset className="zv-field zv-art-wahl">
          <legend>Farbe im Kalender</legend>
          <div className="zv-art-wahl-optionen">
            {TERMIN_TYP_FARBEN.map((f) => (
              <label key={f} className={`zv-art-wahl-option${farbe === f ? " aktiv" : ""}`}>
                <input type="radio" name="typ-farbe" value={f} checked={farbe === f} onChange={() => setFarbe(f)} />
                <span className={`zv-person-punkt zv-art-farbe zv-typ-${f}`} aria-hidden="true" />
                {TERMIN_TYP_FARBE_LABEL[f]}
              </label>
            ))}
          </div>
          <p className="zv-feld-hilfe">Rot, Gelb, Hellblau und Lila gehören krank, Urlaub, frei und Fortbildung, damit man eine Abwesenheit nie mit einem Termin verwechselt.</p>
        </fieldset>

        <fieldset className="zv-field zv-typen-wahl">
          <legend>Als Betreuungszeit erfassen</legend>
          {TERMIN_TYP_BETREUUNGSZEITEN.map((b) => (
            <label key={b} className={`zv-typen-wahl-option${betreuungszeit === b ? " aktiv" : ""}`}>
              <input type="radio" name="typ-betreuungszeit" value={b} checked={betreuungszeit === b} onChange={() => setBetreuungszeit(b)} />
              <span>
                <strong>{TERMIN_TYP_BETREUUNGSZEIT_LABEL[b]}</strong>
                <span>{BETREUUNGSZEIT_TEXT[b]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="zv-field">
          <label htmlFor="typ-leistung">Leistung, wenn gebucht wird</label>
          <select id="typ-leistung" value={leistungsart} onChange={(e) => setLeistungsart(e.target.value as Leistungsart | "")}>
            <option value="">Automatisch (eine Klient:in = Einzelbetreuung, mehrere = Gruppenangebot)</option>
            {LEISTUNGSARTEN.map((l) => (
              <option key={l} value={l}>
                {LEISTUNGSART_LABEL[l]}
              </option>
            ))}
          </select>
          <p className="zv-feld-hilfe">Gilt für neue Termine dieses Typs. Bestehende Termine behalten ihre Leistung.</p>
        </div>

        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert || !bezeichnung.trim()}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : typ ? "Speichern" : "Termintyp anlegen"}
        </button>

        {typ && !typ.istStandard && (
          <div className="zv-typen-dialog-fuss">
            <button type="button" className="zv-link-btn" onClick={() => onAktivSchalten(typ)}>
              {typ.aktiv ? <IDeaktivieren /> : <IAktivieren />}
              {typ.aktiv ? "Ausblenden" : "Wieder einblenden"}
            </button>
            <button type="button" className="zv-link-btn zv-link-btn-gefahr" onClick={() => void loeschen()}>
              <ILoeschen />
              Löschen
            </button>
          </div>
        )}
        {typ?.istStandard && (
          <p className="zv-feld-hilfe">
            „{typ.bezeichnung}“ ist der Standardtyp: Termine ohne gewählte Art landen hier, auch die von Klient:innen. Er lässt sich umbenennen und umfärben, aber nicht ausblenden.
          </p>
        )}
        {typ && !typ.istStandard && (
          <p className="zv-feld-hilfe">Ausgeblendet steht der Typ nicht mehr zur Auswahl. Termine, die ihn schon haben, behalten ihn. Löschen geht nur, solange kein Termin ihn trägt.</p>
        )}
      </form>
    </Modal>
  );
}
