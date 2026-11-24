import { FormEvent, ReactNode, useState } from "react";
import { IBestaetigen, IErfolg, IFehler } from "./icons";
import { MarkenZeichen } from "./MarkenZeichen";
import { PasswortEingabe } from "./PasswortEingabe";

export const LINK_UNGUELTIG =
  "Der Link ist ungültig oder abgelaufen. Bitte fordere bei deiner Betreuung einen neuen Link an.";

/** Rahmen der Seiten, die ohne Anmeldung über einen Link geöffnet werden. */
export function LinkKarte({ untertitel, children }: { untertitel: string; children: ReactNode }) {
  return (
    <>
      <h1>
        <MarkenZeichen iconGroesse={26} />
      </h1>
      <p className="zv-sub">{untertitel}</p>
      {children}
    </>
  );
}

export function FehlerHinweis({ text }: { text: string }) {
  return (
    <div className="zv-hinweis zv-hinweis-fehler" role="alert">
      <IFehler />
      {text}
    </div>
  );
}

/** Erfolgsanzeige nach dem Einlösen eines Links, mit Knopf zurück zur Anmeldung. */
export function LinkErledigt({ untertitel, text, onWeiter }: { untertitel: string; text: string; onWeiter: () => void }) {
  return (
    <div className="zv-shell">
      <div className="zv-card">
        <LinkKarte untertitel={untertitel}>
          <div className="zv-hinweis zv-hinweis-erfolg">
            <IErfolg />
            {text}
          </div>
          <button className="zv-btn zv-btn-block" style={{ marginTop: 14 }} onClick={onWeiter}>
            Zur Anmeldung
          </button>
        </LinkKarte>
      </div>
    </div>
  );
}

/**
 * Passwort über einen Link festlegen (Passwort-Reset und Klient-Einladung).
 * Beide Seiten waren bis auf Texte und den API-Aufruf gleich; was sich
 * unterscheidet, kommt als Eigenschaft herein. Die Mindestlänge prüft der
 * Server ohnehin -- hier nur, damit die Meldung vor dem Absenden kommt.
 */
export function PasswortFestlegen({
  texte,
  einloesen,
  fehlerText,
  onFertig,
}: {
  texte: {
    untertitel: string;
    einleitung?: string;
    wiederholungLabel: string;
    abweichung: string;
    /** Ohne Angabe nur die Prüfung durch minLength im Browser. */
    zuKurz?: string;
    erledigtUntertitel: string;
    erledigtText: string;
  };
  einloesen: (passwort: string) => Promise<unknown>;
  fehlerText: (err: unknown) => string;
  onFertig: () => void;
}) {
  const [neuesPasswort, setNeuesPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [sichtbar, setSichtbar] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);
  const [erledigt, setErledigt] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (texte.zuKurz && neuesPasswort.length < 8) {
      setFehler(texte.zuKurz);
      return;
    }
    if (neuesPasswort !== wiederholung) {
      setFehler(texte.abweichung);
      return;
    }
    setLadt(true);
    try {
      await einloesen(neuesPasswort);
      setErledigt(true);
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLadt(false);
    }
  }

  if (erledigt) {
    return <LinkErledigt untertitel={texte.erledigtUntertitel} text={texte.erledigtText} onWeiter={onFertig} />;
  }

  return (
    <div className="zv-shell">
      <form className="zv-card" onSubmit={submit}>
        <LinkKarte untertitel={texte.untertitel}>
          {texte.einleitung && <p style={{ marginTop: 0 }}>{texte.einleitung}</p>}

          {fehler && <FehlerHinweis text={fehler} />}

          <div className="zv-field">
            <label htmlFor="neuesPasswort">Neues Passwort</label>
            <PasswortEingabe
              id="neuesPasswort"
              sichtbar={sichtbar}
              onSichtbarWechseln={() => setSichtbar((s) => !s)}
              value={neuesPasswort}
              onChange={(e) => setNeuesPasswort(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              autoFocus
              required
            />
          </div>

          <div className="zv-field">
            <label htmlFor="wiederholung">{texte.wiederholungLabel}</label>
            <input
              id="wiederholung"
              type={sichtbar ? "text" : "password"}
              value={wiederholung}
              onChange={(e) => setWiederholung(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <button className="zv-btn zv-btn-block" type="submit" disabled={ladt}>
            <IBestaetigen />
            {ladt ? "Speichert…" : "Passwort festlegen"}
          </button>
        </LinkKarte>
      </form>
    </div>
  );
}
