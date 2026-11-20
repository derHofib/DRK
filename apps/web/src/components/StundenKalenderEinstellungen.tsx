import { useEffect, useState } from "react";
import type { KalenderStundenEinstellungenDto, StundenVormerkungDto } from "@zimmerakte/shared";
import { formatMinutenAlsStunden } from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatTerminZeit } from "../format";
import { IFehler, IInfo, ISpeichern } from "./icons";

/**
 * Stunden aus dem Kalender (migrations/0080), Konto-Bereich "Kalender &
 * Stunden". Serverseitig gespeichert, nicht im Geraet wie "Darstellung": die
 * Voreinstellung soll auf Handy und Rechner gleich sein.
 *
 * Ein Haken zeigt immer den WIRKSAMEN Wert. Wer ihn nie angefasst hat, folgt
 * dem Traeger (gespeichert als null, nicht als Kopie) -- aendert die Leitung
 * spaeter die Voreinstellung, gilt das dann auch fuer diese Person.
 */
export function KalenderStundenKonto({
  einstellungen,
  onGeaendert,
}: {
  einstellungen: KalenderStundenEinstellungenDto;
  onGeaendert: (e: KalenderStundenEinstellungenDto) => void;
}) {
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern(neu: { vorauswahl: boolean | null; vorauswahlZusage: boolean | null }) {
    setSpeichert(true);
    setFehler(null);
    try {
      onGeaendert(await api.stundenKalenderEinstellungenSpeichern(neu));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSpeichert(false);
    }
  }

  const eigene = { vorauswahl: einstellungen.eigeneVorauswahl, vorauswahlZusage: einstellungen.eigeneVorauswahlZusage };
  const folgtTraeger = eigene.vorauswahl === null && eigene.vorauswahlZusage === null;
  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Termine als Betreuungszeit</h3>
      <p className="zv-sub">Gilt für dich, auf allen Geräten. Du kannst den Haken bei jedem Termin einzeln ändern.</p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {!einstellungen.funktionAn && (
        <div className="zv-hinweis zv-hinweis-info">
          <IInfo />
          <span>Dein Träger hat ausgeschaltet, dass Termine als Betreuungszeit gebucht werden. Die Voreinstellung wirkt erst, wenn er es wieder einschaltet.</span>
        </div>
      )}
      <label className="zv-checkbox-zeile">
        <input
          type="checkbox"
          checked={einstellungen.vorauswahl}
          disabled={speichert}
          onChange={(e) => void speichern({ ...eigene, vorauswahl: e.target.checked })}
        />
        Bei neuen Terminen mit Klient:in vorab anhaken
      </label>
      <label className="zv-checkbox-zeile" style={{ marginTop: "var(--zv-space-2)" }}>
        <input
          type="checkbox"
          checked={einstellungen.vorauswahlZusage}
          disabled={speichert}
          onChange={(e) => void speichern({ ...eigene, vorauswahlZusage: e.target.checked })}
        />
        Beim Zusagen zu fremden Terminen vorab anhaken
      </label>
      <p className="zv-sub" style={{ marginTop: "var(--zv-space-3)" }}>
        {folgtTraeger ? (
          "Entspricht der Voreinstellung deines Trägers."
        ) : (
          <>
            Eigene Wahl.{" "}
            <button type="button" className="zv-link-btn" disabled={speichert} onClick={() => void speichern({ vorauswahl: null, vorauswahlZusage: null })}>
              Wie beim Träger
            </button>
          </>
        )}
      </p>
      <div className="zv-hinweis zv-hinweis-info" style={{ marginTop: "var(--zv-space-3)", marginBottom: 0 }}>
        <IInfo />
        <span>
          Gebucht wird erst nach dem Ende eines Termins. Wird ein Termin danach geändert oder abgesagt, wird die Buchung
          automatisch storniert und, falls nötig, neu gebucht.
        </span>
      </div>
    </section>
  );
}

/** "Deine Vormerkungen": was noch gebucht wird und was nicht gebucht werden konnte. */
export function KalenderStundenVormerkungen() {
  const [liste, setListe] = useState<StundenVormerkungDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    api
      .stundenVormerkungen()
      .then(setListe)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Vormerkungen konnten nicht geladen werden."));
  }, []);

  const geplant = (liste ?? []).filter((v) => v.status === "geplant" && !v.grund);
  const offen = (liste ?? []).filter((v) => v.status === "nicht-gebucht" || v.grund);
  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Deine Vormerkungen</h3>
      <p className="zv-sub">Termine, deren Dauer nach dem Ende gebucht wird.</p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      {liste === null && !fehler && <p className="zv-sub">Wird geladen…</p>}
      {liste !== null && (
        <dl className="zv-datenliste">
          <dt>Vorgemerkt</dt>
          <dd>
            {geplant.length === 1 ? "1 Termin" : `${geplant.length} Termine`} ·{" "}
            {formatMinutenAlsStunden(geplant.reduce((s, v) => s + v.minuten * Math.max(1, v.klientNamen.length), 0))}
          </dd>
          {offen.map((v) => (
            <VormerkungZeile key={v.terminId} v={v} />
          ))}
        </dl>
      )}
    </section>
  );
}

function VormerkungZeile({ v }: { v: StundenVormerkungDto }) {
  return (
    <>
      <dt>{v.titel}</dt>
      <dd>
        {formatTerminZeit({ beginn: v.beginn, ende: v.ende, ganztaegig: false })}
        <br />
        <span className="zv-pill zv-pill-offen">{v.grund ?? "Nicht gebucht"}</span>
      </dd>
    </>
  );
}

/** Traeger-Bereich "Stunden": Funktion an/aus und Voreinstellung fuer Konten ohne eigene Wahl. */
export function KalenderStundenTraeger({
  einstellungen,
  onGeaendert,
}: {
  einstellungen: KalenderStundenEinstellungenDto;
  onGeaendert: (e: KalenderStundenEinstellungenDto) => void;
}) {
  const [erlaubt, setErlaubt] = useState(einstellungen.funktionAn);
  const [vorauswahl, setVorauswahl] = useState(einstellungen.traegerVorauswahl);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const geaendert = erlaubt !== einstellungen.funktionAn || vorauswahl !== einstellungen.traegerVorauswahl;

  async function speichern() {
    setSpeichert(true);
    setFehler(null);
    setGespeichert(false);
    try {
      onGeaendert(await api.stundenKalenderTraegerSpeichern({ erlaubt, vorauswahl }));
      setGespeichert(true);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Stunden aus dem Kalender</h3>
      <p className="zv-sub">
        Mitarbeitende können bei Terminen mit Klient:in einen Haken setzen. Nach dem Ende wird die Dauer als Betreuungszeit
        gebucht, jede Person nur für sich selbst.
      </p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}
      <label className="zv-checkbox-zeile">
        <input type="checkbox" checked={erlaubt} disabled={speichert} onChange={(e) => setErlaubt(e.target.checked)} />
        Termine dürfen als Betreuungszeit erfasst werden
      </label>
      <div className="zv-field" style={{ marginTop: "var(--zv-space-3)" }}>
        <label htmlFor="traeger-stunden-vorauswahl">Voreinstellung für Konten, die nichts gewählt haben</label>
        <select
          id="traeger-stunden-vorauswahl"
          value={vorauswahl ? "an" : "aus"}
          disabled={speichert || !erlaubt}
          onChange={(e) => setVorauswahl(e.target.value === "an")}
        >
          <option value="an">Angehakt</option>
          <option value="aus">Nicht angehakt</option>
        </select>
      </div>
      {!erlaubt && einstellungen.funktionAn && (
        <p className="zv-sub">Ausgeschaltet verschwindet der Haken. Vorhandene Vormerkungen werden dann nicht mehr gebucht; schon gebuchte Stunden bleiben.</p>
      )}
      <button type="button" className="zv-btn" disabled={speichert || !geaendert} onClick={() => void speichern()}>
        <ISpeichern />
        {speichert ? "Speichert…" : gespeichert && !geaendert ? "Gespeichert" : "Speichern"}
      </button>
    </section>
  );
}
