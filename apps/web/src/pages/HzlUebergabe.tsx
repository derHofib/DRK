import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { KassenbuchungTypDto, WochenuebersichtEintragDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { IAuszahlen, IFehler, ISErledigt, ISOffen, IUnterschrift } from "../components/icons";
import { SignaturePad } from "../components/SignaturePad";
import { formatBetrag, lokalesDatum } from "../format";

/**
 * Was der Uebergabemodus zum (Wieder-)Start braucht. Liegt in sessionStorage,
 * damit ein Neuladen mitten in der Uebergabe NICHT zurueck in die App fuehrt --
 * sonst waere die Sperre mit F5 aufgehoben. Enthaelt nur IDs und Woche, keine
 * Namen oder Betraege (die kommen frisch vom Server) und keine Unterschrift.
 */
export interface UebergabeStart {
  jahr: number;
  woche: number;
  standortId: string | null;
  klientIds: string[];
}

const SCHLUESSEL = "zv-hzl-uebergabe";

export function uebergabeLesen(): UebergabeStart | null {
  try {
    const roh = sessionStorage.getItem(SCHLUESSEL);
    return roh ? (JSON.parse(roh) as UebergabeStart) : null;
  } catch {
    return null;
  }
}

export function uebergabeMerken(start: UebergabeStart | null) {
  try {
    if (start) sessionStorage.setItem(SCHLUESSEL, JSON.stringify(start));
    else sessionStorage.removeItem(SCHLUESSEL);
  } catch {
    // Ohne sessionStorage laeuft der Modus trotzdem, nur ohne Neuladen-Schutz.
  }
}

type Schritt = "vorbereiten" | "unterschreiben" | "bestaetigen" | "kontrolle" | "uebersicht";
type Ergebnis = "gebucht" | "uebersprungen";

function euroZuCent(text: string): number | null {
  const zahl = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(zahl) || zahl <= 0) return null;
  return Math.round(zahl * 100);
}

/** "Anna Maria" + "Beispiel" -> "Anna M." -- mehr Name soll die Klient:in-Seite nie zeigen. */
function kurzname(e: WochenuebersichtEintragDto): string {
  return `${e.vorname} ${e.nachname.trim().charAt(0).toUpperCase()}.`;
}

/**
 * Vollbild-Uebergabe fuer die HZL-Auszahlung. Die App-Navigation wird nicht
 * ausgeblendet, sondern gar nicht erst gerendert (App.tsx ersetzt die Shell):
 * so gibt es auf dem Geraet, das der Klient:in in die Hand gegeben wird,
 * nichts zum Antippen ausserhalb dieser Ansicht.
 *
 * Ehrlich eingegrenzt: das ist eine Bedienhilfe, keine Sicherheitsgrenze.
 * Wer das Geraet in der Hand hat, kann den Browser beenden. Verbindlich bleibt
 * die Serverseite (Buchung nur mit Unterschrift und Recht, Passwortpruefung
 * mit Audit-Eintrag). Fuer eine echte Sperre braucht es Geführten Zugriff /
 * Kiosk-Modus des Betriebssystems.
 */
export function HzlUebergabe({ start, onBeendet }: { start: UebergabeStart; onBeendet: () => void }) {
  const [laden, setLaden] = useState(true);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [keineBerechtigung, setKeineBerechtigung] = useState(false);
  const [eintraege, setEintraege] = useState<WochenuebersichtEintragDto[]>([]);
  const [hzlTyp, setHzlTyp] = useState<KassenbuchungTypDto | null>(null);
  const [ergebnisse, setErgebnisse] = useState<Record<string, Ergebnis>>({});
  const [aktuellerId, setAktuellerId] = useState<string | null>(null);
  const [schritt, setSchritt] = useState<Schritt>("vorbereiten");
  const [betragText, setBetragText] = useState("");
  const [unterschrift, setUnterschrift] = useState<string | null>(null);
  const [padSchluessel, setPadSchluessel] = useState(0);
  const [passwort, setPasswort] = useState("");
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [nachBestaetigung, setNachBestaetigung] = useState<"kontrolle" | "vorbereiten">("kontrolle");
  const ueberschriftRef = useRef<HTMLHeadingElement>(null);

  const laden_ = useCallback(async () => {
    setLaden(true);
    setLadeFehler(null);
    try {
      const [darf, typen, uebersicht] = await Promise.all([
        api.kassenbuchDarfBuchen(),
        api.kassenbuchungTypenListe(),
        api.wochenuebersicht(start.jahr, start.woche, start.standortId ?? undefined),
      ]);
      if (!darf.darf) {
        setKeineBerechtigung(true);
        return;
      }
      setHzlTyp(typen.find((t) => t.istHzl && t.aktiv) ?? null);
      const gewaehlt = uebersicht.filter((e) => start.klientIds.includes(e.klientId));
      setEintraege(gewaehlt);
      // Beim Wiederaufnehmen nach Neuladen sind schon Gebuchte "bezahlt".
      setErgebnisse((alt) => {
        const neu = { ...alt };
        for (const e of gewaehlt) if (e.bezahlt) neu[e.klientId] = "gebucht";
        return neu;
      });
    } catch (err) {
      setLadeFehler(err instanceof Error ? err.message : "Die Daten konnten nicht geladen werden.");
    } finally {
      setLaden(false);
    }
  }, [start]);

  useEffect(() => {
    void laden_();
  }, [laden_]);

  // Zurueck-Taste: jeder Schritt zurueck landet wieder im selben Zustand,
  // statt die Seite (und damit die Uebergabe) zu verlassen.
  useEffect(() => {
    history.pushState({ uebergabe: true }, "");
    const zurueck = () => history.pushState({ uebergabe: true }, "");
    window.addEventListener("popstate", zurueck);
    return () => window.removeEventListener("popstate", zurueck);
  }, []);

  useEffect(() => {
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener("online", an);
    window.addEventListener("offline", aus);
    return () => {
      window.removeEventListener("online", an);
      window.removeEventListener("offline", aus);
    };
  }, []);

  const offen = eintraege.filter((e) => !ergebnisse[e.klientId]);
  const aktuell = eintraege.find((e) => e.klientId === aktuellerId) ?? null;

  // Naechste offene Person vorlegen, sobald keine gewaehlt ist (Start, nach
  // Buchen, nach Ueberspringen). "Uebersprungene" bleiben offen und tauchen
  // am Ende in der Uebersicht auf.
  useEffect(() => {
    if (laden || keineBerechtigung || ladeFehler) return;
    if (aktuellerId && !ergebnisse[aktuellerId]) return;
    const naechste = eintraege.find((e) => !ergebnisse[e.klientId]);
    if (naechste) {
      setAktuellerId(naechste.klientId);
      setBetragText(naechste.letzterHzlBetragCent !== null ? (naechste.letzterHzlBetragCent / 100).toFixed(2).replace(".", ",") : "");
      setSchritt("vorbereiten");
    } else {
      setAktuellerId(null);
      setSchritt("uebersicht");
    }
  }, [laden, keineBerechtigung, ladeFehler, eintraege, ergebnisse, aktuellerId]);

  useEffect(() => {
    ueberschriftRef.current?.focus();
  }, [schritt, aktuellerId]);

  const betragCent = euroZuCent(betragText);

  function zurNaechstenOffenen(nachKlientId: string) {
    const reihenfolge = eintraege.filter((e) => !ergebnisse[e.klientId] && e.klientId !== nachKlientId);
    const spaeter = reihenfolge.find((e) => eintraege.indexOf(e) > eintraege.findIndex((x) => x.klientId === nachKlientId));
    const ziel = spaeter ?? reihenfolge[0];
    if (!ziel) {
      setAktuellerId(null);
      setSchritt("uebersicht");
      return;
    }
    setAktuellerId(ziel.klientId);
    setBetragText(ziel.letzterHzlBetragCent !== null ? (ziel.letzterHzlBetragCent / 100).toFixed(2).replace(".", ",") : "");
    setSchritt("vorbereiten");
  }

  function ueberspringen() {
    if (!aktuell) return;
    setErgebnisse((alt) => ({ ...alt, [aktuell.klientId]: "uebersprungen" }));
    zurNaechstenOffenen(aktuell.klientId);
  }

  function beenden() {
    uebergabeMerken(null);
    try {
      sessionStorage.setItem("zv-nach-uebergabe-tab", "hzl");
    } catch {
      // Dann landet die Person eben auf dem Dashboard.
    }
    onBeendet();
  }

  function uebergeben() {
    if (betragCent === null) {
      setMeldung("Bitte einen Betrag größer als 0 eingeben.");
      return;
    }
    setMeldung(null);
    setUnterschrift(null);
    setPadSchluessel((k) => k + 1);
    setSchritt("unterschreiben");
  }

  function bestaetigungAnfordern(danach: "kontrolle" | "vorbereiten") {
    setNachBestaetigung(danach);
    setPasswort("");
    setMeldung(null);
    setSchritt("bestaetigen");
  }

  async function bestaetigen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLaeuft(true);
    setMeldung(null);
    try {
      await api.hzlUebergabeEntsperren(passwort);
      setPasswort("");
      if (nachBestaetigung === "vorbereiten") {
        setUnterschrift(null);
        setSchritt("vorbereiten");
      } else {
        setSchritt("kontrolle");
      }
    } catch (err) {
      setMeldung(err instanceof Error ? err.message : "Die Bestätigung ist fehlgeschlagen.");
    } finally {
      setLaeuft(false);
    }
  }

  async function buchen() {
    if (!aktuell || !hzlTyp || betragCent === null || !unterschrift) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      await api.kassenbuchungAnlegen({
        klientId: aktuell.klientId,
        datum: lokalesDatum(new Date()),
        betragCent: -betragCent,
        verwendungszweck: `HZL KW ${start.woche}`,
        typId: hzlTyp.id,
        isoJahr: start.jahr,
        isoWoche: start.woche,
        unterschriftBase64: unterschrift,
      });
      setUnterschrift(null);
      setErgebnisse((alt) => ({ ...alt, [aktuell.klientId]: "gebucht" }));
      // Der Effekt oben legt die naechste offene Person vor.
    } catch (err) {
      setMeldung(err instanceof Error ? err.message : "Die Buchung konnte nicht gespeichert werden.");
    } finally {
      setLaeuft(false);
    }
  }

  const gebucht = eintraege.filter((e) => ergebnisse[e.klientId] === "gebucht").length;
  const fortschritt = `${gebucht} von ${eintraege.length}`;

  let inhalt;
  if (laden) {
    inhalt = <p className="zv-uebergabe-status" role="status">Lädt…</p>;
  } else if (keineBerechtigung) {
    inhalt = (
      <div className="zv-uebergabe-block" role="alert">
        <h1 ref={ueberschriftRef} tabIndex={-1}>Keine Berechtigung</h1>
        <p>Mit diesem Konto dürfen keine Kassenbuchungen erfasst werden. Die Übergabe wurde nicht gestartet.</p>
        <button type="button" className="zv-btn zv-uebergabe-knopf" onClick={beenden}>Zurück zur App</button>
      </div>
    );
  } else if (ladeFehler) {
    inhalt = (
      <div className="zv-uebergabe-block" role="alert">
        <h1 ref={ueberschriftRef} tabIndex={-1}><IFehler /> Daten nicht verfügbar</h1>
        <p>{ladeFehler}</p>
        <div className="zv-uebergabe-aktionen">
          <button type="button" className="zv-btn zv-uebergabe-knopf" onClick={() => void laden_()}>Erneut versuchen</button>
          <button type="button" className="zv-btn zv-btn-still zv-uebergabe-knopf" onClick={beenden}>Zurück zur App</button>
        </div>
      </div>
    );
  } else if (schritt === "uebersicht") {
    inhalt = (
      <div className="zv-uebergabe-block">
        <h1 ref={ueberschriftRef} tabIndex={-1}>Übersicht KW {start.woche}</h1>
        {eintraege.length === 0 ? (
          <p>Für diese Auswahl gibt es nichts auszuzahlen.</p>
        ) : (
          <ul className="zv-uebergabe-liste">
            {eintraege.map((e) => (
              <li key={e.klientId}>
                <span>{e.klientName}</span>
                {ergebnisse[e.klientId] === "gebucht" ? (
                  <span className="zv-pill zv-pill-ok"><ISErledigt /> Gebucht</span>
                ) : (
                  <span className="zv-pill zv-pill-offen"><ISOffen /> Übersprungen</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="zv-uebergabe-aktionen">
          {eintraege.some((e) => ergebnisse[e.klientId] === "uebersprungen") && (
            <button
              type="button"
              className="zv-btn zv-btn-sekundaer zv-uebergabe-knopf"
              onClick={() => {
                setErgebnisse((alt) => {
                  const neu = { ...alt };
                  for (const k of Object.keys(neu)) if (neu[k] === "uebersprungen") delete neu[k];
                  return neu;
                });
                setAktuellerId(null);
              }}
            >
              Übersprungene jetzt bearbeiten
            </button>
          )}
          <button type="button" className="zv-btn zv-uebergabe-knopf" onClick={beenden}>Fertig</button>
        </div>
      </div>
    );
  } else if (!aktuell) {
    inhalt = <p className="zv-uebergabe-status" role="status">Lädt…</p>;
  } else if (schritt === "vorbereiten") {
    inhalt = (
      <div className="zv-uebergabe-block">
        <p className="zv-uebergabe-kicker">Vorbereitung durch Mitarbeitende · {fortschritt} erledigt</p>
        <h1 ref={ueberschriftRef} tabIndex={-1}>{aktuell.klientName}</h1>
        <p>
          Aktueller Barbetrag: <span className="zv-mono">{formatBetrag(aktuell.saldoCent)}</span>
        </p>
        <label className="zv-uebergabe-feld">
          Auszuzahlender Betrag (€)
          <input
            className="zv-mono"
            inputMode="decimal"
            value={betragText}
            onChange={(e) => setBetragText(e.target.value)}
            aria-invalid={betragText !== "" && betragCent === null}
          />
        </label>
        {betragCent !== null && betragCent > aktuell.saldoCent && (
          <p className="zv-uebergabe-hinweis" role="status">
            Der Betrag übersteigt den Barbetrag; der Saldo würde negativ.
          </p>
        )}
        {meldung && <p className="zv-fehlertext" role="alert">{meldung}</p>}
        <div className="zv-uebergabe-aktionen">
          <button type="button" className="zv-btn zv-uebergabe-knopf" onClick={uebergeben}>
            <IAuszahlen /> Gerät übergeben
          </button>
          <button type="button" className="zv-btn zv-btn-sekundaer zv-uebergabe-knopf" onClick={ueberspringen}>Überspringen</button>
          <button type="button" className="zv-btn zv-btn-still zv-uebergabe-knopf" onClick={beenden}>Modus beenden</button>
        </div>
      </div>
    );
  } else if (schritt === "unterschreiben") {
    inhalt = (
      <div className="zv-uebergabe-block zv-uebergabe-klient">
        <h1 ref={ueberschriftRef} tabIndex={-1}>{kurzname(aktuell)}</h1>
        <p className="zv-uebergabe-betrag zv-mono" aria-label={`Betrag ${formatBetrag(betragCent ?? 0)}`}>
          {formatBetrag(betragCent ?? 0)}
        </p>
        <p className="zv-uebergabe-kw">Kalenderwoche <span className="zv-mono">{start.woche}</span></p>
        <p className="zv-uebergabe-erklaerung">Ich habe den Betrag erhalten.</p>
        <SignaturePad key={padSchluessel} gross onChange={setUnterschrift} />
        <div className="zv-uebergabe-aktionen">
          <button
            type="button"
            className="zv-btn zv-uebergabe-knopf"
            disabled={!unterschrift}
            onClick={() => bestaetigungAnfordern("kontrolle")}
          >
            <IUnterschrift /> Unterschreiben
          </button>
          <button type="button" className="zv-btn zv-btn-still zv-uebergabe-knopf" onClick={() => bestaetigungAnfordern("vorbereiten")}>
            Abbrechen
          </button>
        </div>
      </div>
    );
  } else if (schritt === "bestaetigen") {
    inhalt = (
      <form className="zv-uebergabe-block" onSubmit={bestaetigen}>
        <h1 ref={ueberschriftRef} tabIndex={-1}>Mitarbeitende bestätigen</h1>
        <p>Bitte das Gerät zurückgeben lassen und mit dem eigenen Passwort bestätigen.</p>
        <label className="zv-uebergabe-feld">
          Passwort
          <input type="password" autoComplete="current-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} required />
        </label>
        {meldung && <p className="zv-fehlertext" role="alert">{meldung}</p>}
        <div className="zv-uebergabe-aktionen">
          <button type="submit" className="zv-btn zv-uebergabe-knopf" disabled={laeuft || passwort === ""}>
            {laeuft ? "Prüft…" : "Bestätigen"}
          </button>
        </div>
      </form>
    );
  } else {
    // kontrolle
    const neuerSaldo = aktuell.saldoCent - (betragCent ?? 0);
    inhalt = (
      <div className="zv-uebergabe-block">
        <p className="zv-uebergabe-kicker">Kontrolle durch Mitarbeitende</p>
        <h1 ref={ueberschriftRef} tabIndex={-1}>Buchung prüfen</h1>
        <dl className="zv-uebergabe-kontrolle">
          <dt>Klient:in</dt>
          <dd>{aktuell.klientName}</dd>
          <dt>Auszahlung KW {start.woche}</dt>
          <dd className="zv-mono">{formatBetrag(betragCent ?? 0)}</dd>
          <dt>Neuer Barbetrag</dt>
          <dd className="zv-mono">{formatBetrag(neuerSaldo)}</dd>
          <dt>Unterschrift</dt>
          <dd>{unterschrift ? <img className="zv-uebergabe-vorschau" src={unterschrift} alt="Erfasste Unterschrift" /> : "fehlt"}</dd>
        </dl>
        {!online && <p className="zv-fehlertext" role="alert">Offline – die Buchung kann erst mit Verbindung gespeichert werden.</p>}
        {meldung && <p className="zv-fehlertext" role="alert">{meldung}</p>}
        <div className="zv-uebergabe-aktionen">
          <button type="button" className="zv-btn zv-uebergabe-knopf" disabled={laeuft || !online || !unterschrift || !hzlTyp} onClick={() => void buchen()}>
            {laeuft ? "Bucht…" : "Buchen"}
          </button>
          <button type="button" className="zv-btn zv-btn-still zv-uebergabe-knopf" onClick={() => { setUnterschrift(null); setSchritt("vorbereiten"); }}>
            Verwerfen
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="zv-uebergabe" aria-label="Übergabemodus HZL">
      {!online && schritt !== "kontrolle" && <p className="zv-uebergabe-offline" role="status">Offline</p>}
      {inhalt}
    </main>
  );
}
