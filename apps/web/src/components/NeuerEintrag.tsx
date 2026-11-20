import { FormEvent, useEffect, useState } from "react";
import {
  GESPRAECH_ART_LABEL,
  KLIENT_EINTRAG_ART_LABEL,
  type BenutzerListEintragDto,
  type GespraechArt,
  type KlientEintragAnlegenDto,
  type KlientEintragArt,
  type KlientEintragDto,
  type KlientKontaktDto,
  type TelefonatRichtung,
  type VerlaufRechteDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { IAbbrechen, IEntscheidung, IFehler, IGespraech, INotiz, ISpeichern, ITelefonat, type IconKomponente } from "./icons";

export const EINTRAG_ART_ICON: Record<KlientEintragArt, IconKomponente> = {
  notiz: INotiz,
  telefonat: ITelefonat,
  gespraech: IGespraech,
  entscheidung: IEntscheidung,
};

const ARTEN: KlientEintragArt[] = ["notiz", "telefonat", "gespraech", "entscheidung"];

/** "YYYY-MM-DDTHH:mm" in der Ortszeit des Geraets, wie <input type=datetime-local> es erwartet. */
function jetztLokal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const TEXT_LABEL: Record<KlientEintragArt, string> = {
  notiz: "Notiz",
  telefonat: "Worum ging es?",
  gespraech: "Inhalt",
  entscheidung: "Was wurde entschieden?",
};

/**
 * Fenster "Neuer Eintrag" (Konzept chronik, Abschnitt 5). Oben die Art,
 * darunter nur die Felder dieser Art -- was der Server je Art verlangt,
 * steht als CHECK in Migration 0078; hier wird es nur vorweggenommen, damit
 * niemand ein Formular abschickt, das sicher abgelehnt wird.
 *
 * "Nächster Schritt" legt auf Wunsch eine Aufgabe fuer die anlegende Person
 * an; die Aufgabe verweist auf den Eintrag, der Text wird nicht kopiert.
 */
export function NeuerEintragFenster({
  klientId,
  klientName,
  startArt = "notiz",
  kontakte,
  onSchliessen,
  onAngelegt,
}: {
  klientId: string;
  klientName: string;
  startArt?: KlientEintragArt;
  /** Vorschlaege fuer "Mit wem"; ohne Angabe aus der Akte geladen. */
  kontakte?: KlientKontaktDto[];
  onSchliessen: () => void;
  onAngelegt: (eintrag: KlientEintragDto) => void;
}) {
  const [art, setArt] = useState<KlientEintragArt>(startArt);
  const [rechte, setRechte] = useState<VerlaufRechteDto | null>(null);
  const [mitarbeitende, setMitarbeitende] = useState<BenutzerListEintragDto[]>([]);
  const [ichId, setIchId] = useState<string | null>(null);
  const [kontaktListe, setKontaktListe] = useState<KlientKontaktDto[]>(kontakte ?? []);

  const [zeitpunkt, setZeitpunkt] = useState(jetztLokal);
  const [text, setText] = useState("");
  const [gegenueber, setGegenueber] = useState("");
  const [richtung, setRichtung] = useState<TelefonatRichtung>("eingehend");
  const [dauer, setDauer] = useState("");
  const [gespraechArt, setGespraechArt] = useState<GespraechArt>("team");
  const [teilnehmendeIds, setTeilnehmendeIds] = useState<string[]>([]);
  const [ergebnis, setErgebnis] = useState("");
  const [entschiedenVonId, setEntschiedenVonId] = useState("");
  const [wiedervorlageAm, setWiedervorlageAm] = useState("");
  const [naechsterSchritt, setNaechsterSchritt] = useState("");
  const [alsAufgabe, setAlsAufgabe] = useState(false);
  const [aufgabeFaelligAm, setAufgabeFaelligAm] = useState("");

  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    api.verlaufRechte().then(setRechte).catch(() => setRechte(null));
    api.benutzerListe().then((l) => setMitarbeitende(l.filter((b) => b.aktiv))).catch(() => setMitarbeitende([]));
    api
      .benutzerIch()
      .then((ich) => {
        setIchId(ich.id);
        setEntschiedenVonId((alt) => alt || ich.id);
      })
      .catch(() => setIchId(null));
    if (!kontakte) api.klient(klientId).then((k) => setKontaktListe(k.kontakte)).catch(() => setKontaktListe([]));
  }, [klientId, kontakte]);

  const darfEntscheidung = rechte?.entscheidungenAnlegen ?? false;
  const sichtbareArten = ARTEN.filter((a) => a !== "entscheidung" || darfEntscheidung);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFehler(null);
    const payload: KlientEintragAnlegenDto = {
      art,
      zeitpunkt: new Date(zeitpunkt).toISOString(),
      text: text.trim(),
    };
    if (art === "telefonat") {
      payload.gegenueber = gegenueber.trim() || undefined;
      payload.richtung = richtung;
      if (dauer) payload.dauerMinuten = Number(dauer);
    }
    if (art === "gespraech") {
      payload.gespraechArt = gespraechArt;
      payload.teilnehmendeIds = teilnehmendeIds;
      payload.gegenueber = gegenueber.trim() || undefined;
      payload.ergebnis = ergebnis.trim() || undefined;
    }
    if (art === "entscheidung") {
      payload.entschiedenVonId = entschiedenVonId || ichId || undefined;
      payload.ergebnis = ergebnis.trim() || undefined;
      payload.wiedervorlageAm = wiedervorlageAm || undefined;
    }
    if (art !== "notiz" && naechsterSchritt.trim()) {
      payload.naechsterSchritt = naechsterSchritt.trim();
      if (alsAufgabe) payload.aufgabeFaelligAm = aufgabeFaelligAm;
    }
    setWirdGespeichert(true);
    try {
      const eintrag = await api.klientEintragAnlegen(klientId, payload);
      onAngelegt(eintrag);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  const vorschlaege = Array.from(
    new Set([...kontaktListe.map((k) => (k.beziehung ? `${k.name} (${k.beziehung})` : k.name)), "Jugendamt", "Schule"])
  );

  return (
    <Modal titel={`Neuer Eintrag · ${klientName}`} onClose={onSchliessen}>
      <form onSubmit={speichern} className="zv-eintrag-formular">
        <div className="zv-eintrag-arten" role="radiogroup" aria-label="Art des Eintrags">
          {sichtbareArten.map((a) => {
            const Icon = EINTRAG_ART_ICON[a];
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={art === a}
                className={`zv-eintrag-art zv-verlauf-${a}${art === a ? " active" : ""}`}
                onClick={() => setArt(a)}
              >
                <Icon />
                {KLIENT_EINTRAG_ART_LABEL[a]}
              </button>
            );
          })}
        </div>

        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}

        {art === "telefonat" && (
          <>
            <div className="zv-field">
              <label htmlFor="eintrag-gegenueber">Mit wem</label>
              <input
                id="eintrag-gegenueber"
                list="eintrag-gegenueber-vorschlaege"
                value={gegenueber}
                maxLength={300}
                onChange={(e) => setGegenueber(e.target.value)}
                placeholder="z. B. Jugendamt, Sorgeberechtigte"
              />
              <datalist id="eintrag-gegenueber-vorschlaege">
                {vorschlaege.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
            <div className="zv-field">
              <span className="zv-field-label" id="eintrag-richtung">
                Richtung
              </span>
              <div className="zv-segmented" role="radiogroup" aria-labelledby="eintrag-richtung">
                {(["eingehend", "ausgehend"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={richtung === r}
                    className={richtung === r ? "active" : ""}
                    onClick={() => setRichtung(r)}
                  >
                    {r === "eingehend" ? "Eingehend" : "Ausgehend"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {art === "gespraech" && (
          <>
            <div className="zv-field">
              <label htmlFor="eintrag-gespraech-art">Art des Gesprächs</label>
              <select
                id="eintrag-gespraech-art"
                value={gespraechArt}
                onChange={(e) => setGespraechArt(e.target.value as GespraechArt)}
              >
                {(Object.keys(GESPRAECH_ART_LABEL) as GespraechArt[]).map((g) => (
                  <option key={g} value={g}>
                    {GESPRAECH_ART_LABEL[g]}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="eintrag-teilnehmende">Teilnehmende Mitarbeitende</label>
              <select
                id="eintrag-teilnehmende"
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) setTeilnehmendeIds((alt) => (alt.includes(id) ? alt : [...alt, id]));
                }}
              >
                <option value="">Person hinzufügen …</option>
                {mitarbeitende
                  .filter((m) => !teilnehmendeIds.includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              {teilnehmendeIds.length > 0 && (
                <ul className="zv-eintrag-teilnehmende">
                  {teilnehmendeIds.map((id) => (
                    <li key={id}>
                      {mitarbeitende.find((m) => m.id === id)?.name ?? "Unbekannt"}
                      <button
                        type="button"
                        className="zv-icon-btn"
                        aria-label={`${mitarbeitende.find((m) => m.id === id)?.name ?? "Person"} entfernen`}
                        onClick={() => setTeilnehmendeIds((alt) => alt.filter((x) => x !== id))}
                      >
                        <IAbbrechen />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="zv-field">
              <label htmlFor="eintrag-weitere">Weitere Teilnehmende (optional)</label>
              <input
                id="eintrag-weitere"
                value={gegenueber}
                maxLength={300}
                onChange={(e) => setGegenueber(e.target.value)}
                placeholder="z. B. Mutter, Lehrkraft"
              />
            </div>
          </>
        )}

        {art === "entscheidung" && (
          <div className="zv-field">
            <label htmlFor="eintrag-entschieden-von">Wer hat entschieden</label>
            <select
              id="eintrag-entschieden-von"
              value={entschiedenVonId}
              required
              onChange={(e) => setEntschiedenVonId(e.target.value)}
            >
              {mitarbeitende.length === 0 && ichId && <option value={ichId}>Ich</option>}
              {mitarbeitende.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="eintrag-zeitpunkt">Wann</label>
            <input
              id="eintrag-zeitpunkt"
              type="datetime-local"
              required
              value={zeitpunkt}
              onChange={(e) => setZeitpunkt(e.target.value)}
            />
          </div>
          {art === "telefonat" && (
            <div className="zv-field">
              <label htmlFor="eintrag-dauer">Dauer in Minuten (optional)</label>
              <input
                id="eintrag-dauer"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={dauer}
                onChange={(e) => setDauer(e.target.value)}
              />
            </div>
          )}
          {art === "entscheidung" && (
            <div className="zv-field">
              <label htmlFor="eintrag-wiedervorlage">Wiedervorlage am (optional)</label>
              <input
                id="eintrag-wiedervorlage"
                type="date"
                value={wiedervorlageAm}
                onChange={(e) => setWiedervorlageAm(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="zv-field">
          <label htmlFor="eintrag-text">{TEXT_LABEL[art]}</label>
          <textarea
            id="eintrag-text"
            rows={art === "notiz" ? 5 : 4}
            required
            maxLength={20000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {(art === "gespraech" || art === "entscheidung") && (
          <div className="zv-field">
            <label htmlFor="eintrag-ergebnis">{art === "gespraech" ? "Ergebnis (optional)" : "Begründung (optional)"}</label>
            <textarea
              id="eintrag-ergebnis"
              rows={3}
              maxLength={5000}
              value={ergebnis}
              onChange={(e) => setErgebnis(e.target.value)}
            />
          </div>
        )}

        {art !== "notiz" && (
          <div className="zv-field">
            <label htmlFor="eintrag-naechster-schritt">Nächster Schritt (optional)</label>
            <input
              id="eintrag-naechster-schritt"
              value={naechsterSchritt}
              maxLength={300}
              onChange={(e) => setNaechsterSchritt(e.target.value)}
              placeholder="z. B. Rückruf beim Jugendamt"
            />
          </div>
        )}
        {art !== "notiz" && naechsterSchritt.trim() && (
          <div className="zv-eintrag-aufgabe">
            <label className="zv-checkbox-zeile">
              <input type="checkbox" checked={alsAufgabe} onChange={(e) => setAlsAufgabe(e.target.checked)} />
              Als Aufgabe für mich anlegen
            </label>
            {alsAufgabe && (
              <div className="zv-field">
                <label htmlFor="eintrag-aufgabe-faellig">Fällig am (optional)</label>
                <input
                  id="eintrag-aufgabe-faellig"
                  type="date"
                  value={aufgabeFaelligAm}
                  onChange={(e) => setAufgabeFaelligAm(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert || !text.trim()}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : `${KLIENT_EINTRAG_ART_LABEL[art]} speichern`}
        </button>
      </form>
    </Modal>
  );
}
