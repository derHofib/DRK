import { FormEvent, useState } from "react";
import type { AbwesenheitArt, AbwesenheitDto, BenutzerListEintragDto } from "@zimmerakte/shared";
import { ABWESENHEIT_ART_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { IFehler, IStornieren } from "../components/icons";
import { formatDatum } from "../format";
import { personFarbStil } from "../personFarbe";
import { ABWESENHEIT_ARTEN, ABWESENHEIT_LABEL, abwesenheitArt } from "./eintraege";
import { Zeitraumfeld } from "../components/Datumsfeld";

/** Dreieck in der Farbe einer Art -- dieselbe Form wie die Statusecke der Tageszelle, damit die Legende sie erklaert. */
/** klasse: Farbklasse aus kalenderArten().klasse oder zv-art-<abwesenheit>. */
export function ArtDreieck({ klasse }: { klasse: string }) {
  return <span className={`zv-art-dreieck ${klasse}`} aria-hidden="true" />;
}

export function zeitraumText(a: { von: string; bis: string }): string {
  return a.von === a.bis ? formatDatum(a.von) : `${formatDatum(a.von)} – ${formatDatum(a.bis)}`;
}

/**
 * Abwesenheiten im sichtbaren Zeitraum (Woche/Monat) als Zeile ueber dem
 * Kalender. Bewusst eine eigene Zeile statt Balken im Zeitraster: eine
 * Abwesenheit hat keine Uhrzeit, und so bleibt sie auch auf dem Handy, wo
 * das Zeitraster ausgeblendet ist, an derselben Stelle sichtbar.
 */
export function AbwesenheitsZeile({
  abwesenheiten,
  farbIndizes,
  onOeffnen,
}: {
  abwesenheiten: AbwesenheitDto[];
  farbIndizes: Map<string, number>;
  onOeffnen: (a: AbwesenheitDto) => void;
}) {
  if (abwesenheiten.length === 0) return null;
  return (
    <section className="zv-kal-abwesend" aria-label="Abwesenheiten in diesem Zeitraum">
      <span className="zv-kal-abwesend-titel">Abwesend</span>
      <ul>
        {abwesenheiten.map((a) => {
          const fi = farbIndizes.get(a.benutzer.id);
          const art = abwesenheitArt(a);
          return (
            <li key={a.id}>
              <button type="button" className="zv-kal-abwesend-chip" onClick={() => onOeffnen(a)}>
                {fi !== undefined ? (
                  <span className="zv-person-punkt zv-person-farbe" style={personFarbStil(fi)} aria-hidden="true" />
                ) : (
                  <span className="zv-person-punkt zv-kal-vorschau-punkt" aria-hidden="true" />
                )}
                <strong>{a.benutzer.name}</strong>
                <span className={`zv-art-marke zv-art-${art}`}>{ABWESENHEIT_LABEL[art]}</span>
                <span className="zv-kal-abwesend-zeit">{zeitraumText(a)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AbwesenheitDetail({ abwesenheit, onClose, onStorniert }: { abwesenheit: AbwesenheitDto; onClose: () => void; onStorniert: () => void }) {
  const [frage, setFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const art = abwesenheitArt(abwesenheit);

  async function stornieren() {
    setLaeuft(true);
    setFehler(null);
    try {
      await api.abwesenheitStornieren(abwesenheit.id);
      onStorniert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Abwesenheit konnte nicht storniert werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel={`${abwesenheit.benutzer.name}: ${ABWESENHEIT_LABEL[art]}`} onClose={onClose}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      <dl className="zv-datenliste">
        <dt>Wann</dt>
        <dd>{zeitraumText(abwesenheit)}</dd>
        <dt>Art</dt>
        <dd>
          <span className={`zv-art-marke zv-art-${art}`}>{ABWESENHEIT_LABEL[art]}</span>
          {abwesenheit.art === null && <span className="zv-sub-inline"> · Den Grund sieht nur die Leitung.</span>}
        </dd>
        {abwesenheit.notiz && (
          <>
            <dt>Notiz</dt>
            <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{abwesenheit.notiz}</dd>
          </>
        )}
      </dl>
      {abwesenheit.stornierbar && (
        <div className="zv-aktionszeile" style={{ marginTop: "var(--zv-space-4)" }}>
          {frage ? (
            <>
              <button type="button" className="zv-btn zv-btn-gefahr" disabled={laeuft} onClick={() => void stornieren()}>
                Ja, stornieren
              </button>
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setFrage(false)}>
                Abbrechen
              </button>
            </>
          ) : (
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => setFrage(true)}>
              <IStornieren />
              Abwesenheit stornieren
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Eintragen-Dialog. "Fuer wen" gibt es nur mit dem Recht
 * abwesenheiten.verwalten -- ohne traegt man fuer sich selbst ein. Die
 * Pruefung selbst passiert in der API; hier wird nur nicht angeboten, was
 * ohnehin abgelehnt wuerde.
 */
export function AbwesenheitEintragen({
  standardDatum,
  verwalten,
  mitarbeitende,
  ichId,
  onClose,
  onAngelegt,
}: {
  standardDatum: string;
  verwalten: boolean;
  mitarbeitende: BenutzerListEintragDto[];
  ichId: string | null;
  onClose: () => void;
  onAngelegt: (a: AbwesenheitDto) => void;
}) {
  const [fuer, setFuer] = useState(ichId ?? "");
  const [art, setArt] = useState<AbwesenheitArt>("urlaub");
  const [von, setVon] = useState(standardDatum);
  const [bis, setBis] = useState(standardDatum);
  const [notiz, setNotiz] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const aktive = mitarbeitende.filter((m) => m.aktiv).sort((a, b) => a.name.localeCompare(b.name, "de"));

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFehler(null);
    if (bis < von) return setFehler("Der letzte Tag darf nicht vor dem ersten Tag liegen.");
    setLaeuft(true);
    try {
      onAngelegt(
        await api.abwesenheitAnlegen({
          ...(verwalten && fuer && fuer !== ichId ? { benutzerId: fuer } : {}),
          art,
          von,
          bis,
          notiz: notiz.trim() || null,
        })
      );
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Abwesenheit konnte nicht eingetragen werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Abwesenheit eintragen" onClose={onClose}>
      <form onSubmit={absenden}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler" role="alert">
            <IFehler />
            {fehler}
          </div>
        )}
        <p className="zv-sub">Dass und wann jemand fehlt, sieht das ganze Team. Den Grund sehen nur die Person selbst und die Leitung.</p>
        {verwalten && aktive.length > 0 && (
          <div className="zv-field">
            <label htmlFor="abw-fuer">Für wen</label>
            <select id="abw-fuer" value={fuer} onChange={(e) => setFuer(e.target.value)} required>
              {aktive.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === ichId ? " (ich)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <fieldset className="zv-field zv-art-wahl">
          <legend>Art</legend>
          <div className="zv-art-wahl-optionen">
            {ABWESENHEIT_ARTEN.map((a) => (
              <label key={a} className={`zv-art-wahl-option${art === a ? " aktiv" : ""}`}>
                <input type="radio" name="abw-art" value={a} checked={art === a} onChange={() => setArt(a)} />
                <ArtDreieck klasse={`zv-art-${a}`} />
                {ABWESENHEIT_ART_LABEL[a]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="zv-field-row">
          <Zeitraumfeld
            von={{ id: "abw-von", label: "Erster Tag", required: true }}
            bis={{ id: "abw-bis", label: "Letzter Tag", required: true }}
            wertVon={von}
            wertBis={bis}
            onChange={(v, b) => {
              setVon(v);
              // Wie vorher: ein Ende vor dem Anfang wird zum Anfang.
              setBis(!b || (v && b < v) ? v : b);
            }}
          />
        </div>
        <div className="zv-field">
          <label htmlFor="abw-notiz">Notiz (optional, keine Diagnose)</label>
          <input id="abw-notiz" value={notiz} onChange={(e) => setNotiz(e.target.value)} maxLength={500} placeholder="z. B. „AU liegt vor“" />
        </div>
        <div className="zv-aktionszeile">
          <button type="submit" className="zv-btn" disabled={laeuft}>
            {laeuft ? "Wird eingetragen…" : "Eintragen"}
          </button>
          <button type="button" className="zv-btn zv-btn-sekundaer" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  );
}
