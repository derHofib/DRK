import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { AnwaerterDto, AnwaerterStatus, HzlRhythmus, KlientListEintragDto } from "@zimmerakte/shared";
import { ANWAERTER_STATUS_LABEL, HZL_RHYTHMUS_LABEL } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { formatDatum } from "../format";
import type { KlientenAnsicht } from "../navigation";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { Seitenpanel } from "../components/Seitenpanel";
import {
  IAblehnen,
  IAnwaerter,
  IArchivieren,
  IBearbeiten,
  IFehler,
  IGenehmigen,
  IKlienten,
  ILeerAnwaerter,
  ILeerArchiv,
  ILeerKlienten,
  ILoeschen,
  INeu,
  ISpeichern,
} from "../components/icons";
import { KlientDetail } from "./KlientDetail";

const ROLLEN_MIT_ENTSCHEIDUNG = new Set(["bereichsleitung", "einrichtungsleitung"]);

export function Klienten({
  ansicht,
  onAnsichtChange,
}: {
  ansicht: KlientenAnsicht;
  onAnsichtChange: (ansicht: KlientenAnsicht) => void;
}) {
  // Der Zustand liegt in Shell.tsx (fuer den Sidebar-Unterpunkt
  // "Anwärter", siehe dort) -- hier nur noch ein Alias, damit der Rest
  // dieser Datei unveraendert bleibt.
  const setAnsicht = onAnsichtChange;
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [ausgewaehlterKlientId, setAusgewaehlterKlientId] = useState<string | null>(null);

  const [anwaerterStatus, setAnwaerterStatus] = useState<AnwaerterStatus>("offen");
  const [anwaerter, setAnwaerter] = useState<AnwaerterDto[]>([]);
  const [anwaerterFormularOffen, setAnwaerterFormularOffen] = useState(false);
  const [anwaerterBearbeitenEintrag, setAnwaerterBearbeitenEintrag] = useState<AnwaerterDto | null>(null);
  const [anwaerterAnnehmenEintrag, setAnwaerterAnnehmenEintrag] = useState<AnwaerterDto | null>(null);
  const [anwaerterAblehnenEintrag, setAnwaerterAblehnenEintrag] = useState<AnwaerterDto | null>(null);
  const [anwaerterFormFehler, setAnwaerterFormFehler] = useState<string | null>(null);

  const darfEntscheiden = ROLLEN_MIT_ENTSCHEIDUNG.has(tokenRolle() ?? "");

  function laden() {
    api
      .klientenListe(ansicht === "archiv")
      .then(setKlienten)
      .catch((err) => setFehler(err.message));
  }

  function ladeAnwaerter() {
    api
      .anwaerterListe(anwaerterStatus)
      .then(setAnwaerter)
      .catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    if (ansicht === "anwaerter") ladeAnwaerter();
    else laden();
  }, [ansicht, anwaerterStatus]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Formularelement vorab merken -- React setzt e.currentTarget nach dem
    // Event-Dispatch auf null zurueck, ein Zugriff nach einem await schlaegt
    // sonst fehl (siehe facebook/react#20544).
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFormFehler(null);
    try {
      await api.klientAnlegen({
        vorname: String(form.get("vorname")),
        nachname: String(form.get("nachname")),
        geburtsdatum: String(form.get("geburtsdatum")),
        aktenzeichen: String(form.get("aktenzeichen")),
        amt: String(form.get("amt")),
        hzlRhythmus: form.get("hzlRhythmus") as HzlRhythmus,
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Klient konnte nicht angelegt werden.");
    }
  }

  async function anwaerterAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAnwaerterFormFehler(null);
    try {
      await api.anwaerterAnlegen({
        vorname: String(form.get("vorname")),
        nachname: String(form.get("nachname")),
        geburtsdatum: String(form.get("geburtsdatum")) || undefined,
        telefon: String(form.get("telefon")) || undefined,
        email: String(form.get("email")) || undefined,
        anfragendeStelle: String(form.get("anfragendeStelle")) || undefined,
        notiz: String(form.get("notiz")) || undefined,
      });
      setAnwaerterFormularOffen(false);
      ladeAnwaerter();
    } catch (err) {
      setAnwaerterFormFehler(err instanceof Error ? err.message : "Anfrage konnte nicht angelegt werden.");
    }
  }

  async function anwaerterBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!anwaerterBearbeitenEintrag) return;
    const form = new FormData(e.currentTarget);
    setAnwaerterFormFehler(null);
    try {
      await api.anwaerterAktualisieren(anwaerterBearbeitenEintrag.id, {
        vorname: String(form.get("vorname")),
        nachname: String(form.get("nachname")),
        geburtsdatum: String(form.get("geburtsdatum")) || undefined,
        telefon: String(form.get("telefon")) || undefined,
        email: String(form.get("email")) || undefined,
        anfragendeStelle: String(form.get("anfragendeStelle")) || undefined,
        notiz: String(form.get("notiz")) || undefined,
      });
      setAnwaerterBearbeitenEintrag(null);
      ladeAnwaerter();
    } catch (err) {
      setAnwaerterFormFehler(err instanceof Error ? err.message : "Anfrage konnte nicht geändert werden.");
    }
  }

  async function anwaerterLoeschen(id: string) {
    try {
      await api.anwaerterLoeschen(id);
      ladeAnwaerter();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Anfrage konnte nicht gelöscht werden.");
    }
  }

  async function anwaerterAnnehmen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!anwaerterAnnehmenEintrag) return;
    const form = new FormData(e.currentTarget);
    setAnwaerterFormFehler(null);
    try {
      const klient = await api.anwaerterAnnehmen(anwaerterAnnehmenEintrag.id, {
        aktenzeichen: String(form.get("aktenzeichen")),
        amt: String(form.get("amt")),
        hzlRhythmus: form.get("hzlRhythmus") as HzlRhythmus,
      });
      setAnwaerterAnnehmenEintrag(null);
      setAnsicht("aktiv");
      setAusgewaehlterKlientId(klient.id);
    } catch (err) {
      setAnwaerterFormFehler(err instanceof Error ? err.message : "Anfrage konnte nicht angenommen werden.");
    }
  }

  async function anwaerterAblehnen(grund: string) {
    if (!anwaerterAblehnenEintrag) return;
    try {
      await api.anwaerterAblehnen(anwaerterAblehnenEintrag.id, grund);
      setAnwaerterAblehnenEintrag(null);
      ladeAnwaerter();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Anfrage konnte nicht abgelehnt werden.");
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

      <div className="zv-seiten-kopf">
        <h2>Klienten</h2>
        {ansicht === "aktiv" && (
          <button
            className="zv-btn"
            onClick={() => {
              setFormFehler(null);
              setFormularOffen(true);
            }}
          >
            <INeu />
            Neuer Klient
          </button>
        )}
        {ansicht === "anwaerter" && anwaerterStatus === "offen" && (
          <button
            className="zv-btn"
            onClick={() => {
              setAnwaerterFormFehler(null);
              setAnwaerterFormularOffen(true);
            }}
          >
            <INeu />
            Neue Anfrage
          </button>
        )}
      </div>

      <div className="zv-segmented" role="radiogroup" aria-label="Ansicht" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "aktiv"}
          className={ansicht === "aktiv" ? "active" : ""}
          onClick={() => setAnsicht("aktiv")}
        >
          <IKlienten />
          Aktiv
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "archiv"}
          className={ansicht === "archiv" ? "active" : ""}
          onClick={() => setAnsicht("archiv")}
        >
          <IArchivieren />
          Archiv
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "anwaerter"}
          className={ansicht === "anwaerter" ? "active" : ""}
          onClick={() => setAnsicht("anwaerter")}
        >
          <IAnwaerter />
          Anwärter
        </button>
      </div>

      {formularOffen && (
        <Modal titel="Neuer Klient" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Vorname</label>
                <input name="vorname" required autoFocus />
              </div>
              <div className="zv-field">
                <label>Nachname</label>
                <input name="nachname" required />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Geburtsdatum</label>
                <input name="geburtsdatum" type="date" required />
              </div>
              <div className="zv-field">
                <label>Aktenzeichen</label>
                <input name="aktenzeichen" required />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Amtszuordnung</label>
                <input name="amt" required />
              </div>
              <div className="zv-field">
                <label>HZL-Rhythmus</label>
                <select name="hzlRhythmus" defaultValue="monatlich">
                  <option value="monatlich">Monatlich</option>
                  <option value="woechentlich">Wöchentlich</option>
                </select>
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      {ansicht !== "anwaerter" ? (
        <>
          {klienten.length === 0 ? (
            ansicht === "archiv" ? (
              <Leerzustand icon={ILeerArchiv}>Keine archivierten Klienten.</Leerzustand>
            ) : (
              <Leerzustand icon={ILeerKlienten}>Keine Klienten erfasst.</Leerzustand>
            )
          ) : (
            <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1fr 1.3fr" } as CSSProperties}>
              <div className="zv-liste-kopf">
                <span>Name</span>
                <span>Aktenzeichen</span>
                <span>Amt</span>
                <span>HZL</span>
                <span>{ansicht === "archiv" ? "Archiviert am" : "Zimmer"}</span>
              </div>
              {klienten.map((k) => (
                <div
                  key={k.id}
                  className={`zv-info-karte zv-info-karte-klickbar${ausgewaehlterKlientId === k.id ? " zv-info-karte-aktiv" : ""}`}
                  onClick={() => setAusgewaehlterKlientId(k.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAusgewaehlterKlientId(k.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="zv-liste-zelle-titel">
                    {k.vorname} {k.nachname}
                  </span>
                  <span className="zv-liste-zelle" data-label="Aktenzeichen">
                    <strong className="zv-mono">{k.aktenzeichen}</strong>
                  </span>
                  <span className="zv-liste-zelle" data-label="Amt">
                    <strong>{k.amt}</strong>
                  </span>
                  <span className="zv-liste-zelle" data-label="HZL">
                    <strong>{HZL_RHYTHMUS_LABEL[k.hzlRhythmus]}</strong>
                  </span>
                  {ansicht === "archiv" ? (
                    <span className="zv-liste-zelle" data-label="Archiviert am">
                      <span className="zv-pill zv-pill-neutral">
                        {k.archiviertAm ? formatDatum(k.archiviertAm.slice(0, 10)) : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="zv-liste-zelle" data-label="Zimmer">
                      {k.aktuellesZimmer ? (
                        <span className="zv-pill zv-pill-vergeben">
                          {k.aktuellesZimmer.nummer} · {k.aktuellesZimmer.standortName}
                        </span>
                      ) : (
                        <span className="zv-sub-inline">Kein Zimmer</span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <Seitenpanel offen={ausgewaehlterKlientId !== null} onSchliessen={() => setAusgewaehlterKlientId(null)}>
            {ausgewaehlterKlientId && (
              <KlientDetail klientId={ausgewaehlterKlientId} onZurueck={() => setAusgewaehlterKlientId(null)} />
            )}
          </Seitenpanel>
        </>
      ) : (
        <>
          <div className="zv-segmented" role="radiogroup" aria-label="Status" style={{ marginBottom: 16 }}>
            {(["offen", "angenommen", "abgelehnt"] as const).map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={anwaerterStatus === status}
                className={anwaerterStatus === status ? "active" : ""}
                onClick={() => setAnwaerterStatus(status)}
              >
                {ANWAERTER_STATUS_LABEL[status]}
              </button>
            ))}
          </div>

          {anwaerter.length === 0 ? (
            <Leerzustand icon={ILeerAnwaerter}>
              {anwaerterStatus === "offen"
                ? "Keine offenen Anfragen."
                : anwaerterStatus === "angenommen"
                  ? "Keine angenommenen Anfragen."
                  : "Keine abgelehnten Anfragen."}
            </Leerzustand>
          ) : (
            <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.8fr 1.4fr 1.4fr 1.6fr" } as CSSProperties}>
              <div className="zv-liste-kopf">
                <span>Name</span>
                <span>Kontakt</span>
                <span>Anfragende Stelle</span>
                <span>
                  {anwaerterStatus === "abgelehnt" ? "Grund" : anwaerterStatus === "angenommen" ? "Angenommen am" : "Aktion"}
                </span>
              </div>
              {anwaerter.map((a) => (
                <div key={a.id} className="zv-info-karte">
                  <span className="zv-liste-zelle-titel">
                    {a.vorname} {a.nachname}
                    {a.geburtsdatum && (
                      <div className="zv-sub-inline">geb. {formatDatum(a.geburtsdatum)}</div>
                    )}
                  </span>
                  <span className="zv-liste-zelle" data-label="Kontakt">
                    {a.telefon && <div>{a.telefon}</div>}
                    {a.email && <div>{a.email}</div>}
                    {!a.telefon && !a.email && <span className="zv-sub-inline">–</span>}
                  </span>
                  <span className="zv-liste-zelle" data-label="Anfragende Stelle">
                    {a.anfragendeStelle || <span className="zv-sub-inline">–</span>}
                  </span>
                  {anwaerterStatus === "abgelehnt" ? (
                    <span className="zv-liste-zelle" data-label="Grund">
                      {a.ablehnungGrund}
                    </span>
                  ) : anwaerterStatus === "angenommen" ? (
                    <span className="zv-liste-zelle" data-label="Angenommen am">
                      {a.entschiedenAm && formatDatum(a.entschiedenAm.slice(0, 10))}
                      {a.klientId && (
                        <div>
                          <button className="zv-link-btn" onClick={() => setAusgewaehlterKlientId(a.klientId)}>
                            <IKlienten />
                            Akte öffnen
                          </button>
                        </div>
                      )}
                    </span>
                  ) : (
                    <span className="zv-liste-zelle-aktionen" data-label="Aktion">
                      <button
                        className="zv-link-btn"
                        onClick={() => {
                          setAnwaerterFormFehler(null);
                          setAnwaerterBearbeitenEintrag(a);
                        }}
                      >
                        <IBearbeiten />
                        Bearbeiten
                      </button>
                      <button className="zv-link-btn" onClick={() => anwaerterLoeschen(a.id)}>
                        <ILoeschen />
                        Löschen
                      </button>
                      {darfEntscheiden && (
                        <>
                          <button
                            className="zv-link-btn"
                            onClick={() => {
                              setAnwaerterFormFehler(null);
                              setAnwaerterAnnehmenEintrag(a);
                            }}
                          >
                            <IGenehmigen />
                            Annehmen
                          </button>
                          <button className="zv-link-btn" onClick={() => setAnwaerterAblehnenEintrag(a)}>
                            <IAblehnen />
                            Ablehnen
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <Seitenpanel offen={ausgewaehlterKlientId !== null} onSchliessen={() => setAusgewaehlterKlientId(null)}>
            {ausgewaehlterKlientId && (
              <KlientDetail klientId={ausgewaehlterKlientId} onZurueck={() => setAusgewaehlterKlientId(null)} />
            )}
          </Seitenpanel>
        </>
      )}

      {anwaerterFormularOffen && (
        <Modal titel="Neue Anfrage" onClose={() => setAnwaerterFormularOffen(false)}>
          <form onSubmit={anwaerterAnlegen}>
            {anwaerterFormFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {anwaerterFormFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Vorname</label>
                <input name="vorname" required autoFocus />
              </div>
              <div className="zv-field">
                <label>Nachname</label>
                <input name="nachname" required />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Geburtsdatum</label>
                <input name="geburtsdatum" type="date" />
              </div>
              <div className="zv-field">
                <label>Anfragende Stelle</label>
                <input name="anfragendeStelle" placeholder="Jugendamt, Familie, …" />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Telefon</label>
                <input name="telefon" type="tel" />
              </div>
              <div className="zv-field">
                <label>E-Mail</label>
                <input name="email" type="email" />
              </div>
            </div>
            <div className="zv-field">
              <label>Notiz</label>
              <textarea name="notiz" rows={3} />
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      {anwaerterBearbeitenEintrag && (
        <Modal titel="Anfrage bearbeiten" onClose={() => setAnwaerterBearbeitenEintrag(null)}>
          <form onSubmit={anwaerterBearbeiten}>
            {anwaerterFormFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {anwaerterFormFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Vorname</label>
                <input name="vorname" required autoFocus defaultValue={anwaerterBearbeitenEintrag.vorname} />
              </div>
              <div className="zv-field">
                <label>Nachname</label>
                <input name="nachname" required defaultValue={anwaerterBearbeitenEintrag.nachname} />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Geburtsdatum</label>
                <input name="geburtsdatum" type="date" defaultValue={anwaerterBearbeitenEintrag.geburtsdatum ?? ""} />
              </div>
              <div className="zv-field">
                <label>Anfragende Stelle</label>
                <input name="anfragendeStelle" defaultValue={anwaerterBearbeitenEintrag.anfragendeStelle ?? ""} />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Telefon</label>
                <input name="telefon" type="tel" defaultValue={anwaerterBearbeitenEintrag.telefon ?? ""} />
              </div>
              <div className="zv-field">
                <label>E-Mail</label>
                <input name="email" type="email" defaultValue={anwaerterBearbeitenEintrag.email ?? ""} />
              </div>
            </div>
            <div className="zv-field">
              <label>Notiz</label>
              <textarea name="notiz" rows={3} defaultValue={anwaerterBearbeitenEintrag.notiz ?? ""} />
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Speichern
            </button>
          </form>
        </Modal>
      )}

      {anwaerterAnnehmenEintrag && (
        <Modal
          titel={`Anfrage annehmen — ${anwaerterAnnehmenEintrag.vorname} ${anwaerterAnnehmenEintrag.nachname}`}
          onClose={() => setAnwaerterAnnehmenEintrag(null)}
        >
          <form onSubmit={anwaerterAnnehmen}>
            {anwaerterFormFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {anwaerterFormFehler}
              </div>
            )}
            <p className="zv-sub" style={{ margin: "0 0 12px" }}>
              Legt einen vollständigen Klienten an und übernimmt Vorname, Nachname und Geburtsdatum aus der Anfrage.
            </p>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Aktenzeichen</label>
                <input name="aktenzeichen" required autoFocus />
              </div>
              <div className="zv-field">
                <label>Amtszuordnung</label>
                <input name="amt" required />
              </div>
            </div>
            <div className="zv-field">
              <label>HZL-Rhythmus</label>
              <select name="hzlRhythmus" defaultValue="monatlich">
                <option value="monatlich">Monatlich</option>
                <option value="woechentlich">Wöchentlich</option>
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <IGenehmigen />
              Annehmen
            </button>
          </form>
        </Modal>
      )}

      {anwaerterAblehnenEintrag && (
        <GrundAbfrage
          titel={`Anfrage ablehnen — ${anwaerterAblehnenEintrag.vorname} ${anwaerterAblehnenEintrag.nachname}`}
          label="Grund der Ablehnung"
          bestaetigenText="Ablehnen"
          onBestaetigen={anwaerterAblehnen}
          onAbbrechen={() => setAnwaerterAblehnenEintrag(null)}
        />
      )}
    </div>
  );
}
