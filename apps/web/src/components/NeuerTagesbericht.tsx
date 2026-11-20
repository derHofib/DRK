import { FormEvent, useState } from "react";
import type { KlientListEintragDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { dateiZuBase64 } from "../datei";
import { heuteBerlin } from "../format";
import { AngehefteteFormulare, useAngehefteteFormulare } from "./AngehefteteFormulare";
import { Modal } from "./Modal";
import { IFehler, IInfo, ISpeichern } from "./icons";
import { Datumsfeld } from "./Datumsfeld";

/**
 * Das eine Fenster "Neuer Tagesbericht" -- fuer die Seite Tagesberichte
 * (Klient:in waehlbar) und die Klientenakte (Klient:in fest). Vorher gab es
 * zwei Kopien, und genau dort ist die Rueckmeldung "Tagesbericht Formular"
 * entstanden: auf der Seite Tagesberichte sah man die alte Standardsicht.
 *
 * Reihenfolge bewusst "Klient:in zuerst": welches Formular dazugehoert und ob
 * es die Standardsicht ERSETZT, haengt am Standort der Klient:in. Ohne sie
 * zeigt das Fenster nur einen Hinweis -- nicht die alte Sicht, die nach der
 * Auswahl umspringen wuerde, waehrend man schon hineinschreibt.
 */
export function NeuerTagesberichtFenster({
  klienten,
  klientId: festeKlientId,
  startKlientId,
  onClose,
  onAngelegt,
}: {
  /** Auswahlliste; ohne sie ist die Klient:in fest (klientId). */
  klienten?: KlientListEintragDto[];
  klientId?: string;
  startKlientId?: string;
  onClose: () => void;
  onAngelegt: () => void;
}) {
  const [gewaehlt, setGewaehlt] = useState(festeKlientId ?? startKlientId ?? "");
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const angeheftet = useAngehefteteFormulare(gewaehlt || null, "tagesbericht");
  const heute = heuteBerlin();

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const tagsText = String(form.get("tags") ?? "");
    const datei = form.get("dokument") as File | null;
    const text = String(form.get("text") ?? "");
    setFehler(null);
    if (String(form.get("datum")) > heute) {
      setFehler("Ein Tagesbericht darf nicht in der Zukunft liegen.");
      return;
    }
    if (!angeheftet.ersetzt && !text.trim()) {
      setFehler("Bitte einen Bericht schreiben.");
      return;
    }
    const formularFehler = angeheftet.pruefen();
    if (formularFehler) {
      setFehler(formularFehler);
      return;
    }
    setWirdGespeichert(true);
    try {
      let dokumente: { base64: string; dateiname: string; mimeType: string }[] | undefined;
      if (datei && datei.size > 0) {
        dokumente = [{ base64: await dateiZuBase64(datei), dateiname: datei.name, mimeType: datei.type || "application/octet-stream" }];
      }
      await api.tagesberichtAnlegen({
        klientId: gewaehlt,
        datum: String(form.get("datum")),
        text,
        tagNamen: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        dokumente,
        protokolle: angeheftet.eingaben(),
      });
      onAngelegt();
    } catch (err) {
      angeheftet.serverFehler(err);
      setFehler(err instanceof Error ? err.message : "Tagesbericht konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  const bereit = Boolean(gewaehlt) && angeheftet.geladen;

  return (
    <Modal titel="Neuer Tagesbericht" onClose={onClose}>
      <form onSubmit={anlegen} className="zv-neuer-tagesbericht">
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-field-row">
          {klienten && (
            <div className="zv-field">
              <label htmlFor="ntb-klient">Für wen?</label>
              <select
                id="ntb-klient"
                key={klienten.length}
                name="klientId"
                required
                autoFocus={!gewaehlt}
                value={gewaehlt}
                onChange={(e) => {
                  setFehler(null);
                  setGewaehlt(e.target.value);
                }}
              >
                <option value="" disabled>
                  Klient:in wählen
                </option>
                {klienten.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.vorname} {k.nachname}
                    {k.aktuellesZimmer ? ` · ${k.aktuellesZimmer.standortName}, Zimmer ${k.aktuellesZimmer.nummer}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="zv-field">
            <label htmlFor="ntb-datum">Datum</label>
            <Datumsfeld id="ntb-datum" name="datum" required max={heute} defaultValue={heute} autoFocus={!klienten} schnellwahl="heute-gestern" />
          </div>
        </div>

        {!gewaehlt ? (
          <div className="zv-hinweis zv-hinweis-info" data-testid="ntb-hinweis">
            <IInfo />
            Wähle die Klient:in. Danach erscheint der Tagesbericht so, wie er für ihren Standort eingestellt ist.
          </div>
        ) : !bereit ? (
          <p className="zv-sub-inline" aria-live="polite">
            Tagesbericht wird vorbereitet …
          </p>
        ) : (
          <>
            {angeheftet.ersetzt ? (
              <>
                <AngehefteteFormulare z={angeheftet} />
                {/* Zugeklappt: die Bemerkung ist Zusatz, nicht der Bericht. */}
                <details className="zv-ntb-bemerkung">
                  <summary>
                    Bemerkung hinzufügen <span className="zv-sub-inline">(optional)</span>
                  </summary>
                  <div className="zv-field">
                    <label htmlFor="ntb-text" className="zv-sr-only">
                      Bemerkung
                    </label>
                    <textarea id="ntb-text" name="text" rows={3} />
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="zv-field">
                  <label htmlFor="ntb-text">Bericht</label>
                  <textarea id="ntb-text" name="text" required rows={5} />
                </div>
                <AngehefteteFormulare z={angeheftet} />
              </>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="ntb-tags">Tags (optional, durch Komma getrennt)</label>
                <input id="ntb-tags" name="tags" list="zv-tag-vorschlaege" placeholder="z. B. Beobachtung, Freizeit" />
              </div>
              <div className="zv-field">
                <label htmlFor="ntb-dokument">Dokument (optional)</label>
                <input id="ntb-dokument" name="dokument" type="file" accept="application/pdf,image/*" />
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              Tagesbericht speichern
            </button>
            {angeheftet.aktiv.length > 0 && (
              <p className="zv-sub-inline zv-ntb-zusammen">Tagesbericht und Formular werden zusammen gespeichert, oder gar nicht.</p>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}
