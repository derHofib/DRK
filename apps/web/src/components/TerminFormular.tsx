import { FormEvent, useState } from "react";
import type { ChatKontaktDto, KalenderStundenEinstellungenDto, Leistungsart, TerminAnlegenEingabe, TerminArt, TerminDto } from "@zimmerakte/shared";
import {
  LEISTUNGSARTEN,
  LEISTUNGSART_LABEL,
  TERMIN_ART_LABEL,
  formatMinutenAlsStunden,
  terminMinuten,
  terminStundenHindernis,
  terminStundenLeistungsart,
} from "@zimmerakte/shared";
import { lokalesDatum, terminTag } from "../format";
import { IFehler, ISpeichern } from "./icons";
import { KontaktAuswahl, kontaktEingabe, kontaktSchluessel } from "./chat/KontaktAuswahl";
import { Datumsfeld, Zeitraumfeld } from "./Datumsfeld";

function uhrzeitVon(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "23:00" endet um 23:59 statt am Folgetag: das Formular kennt fuer Termine mit Uhrzeit nur einen Tag. */
function eineStundeSpaeter(uhrzeit: string): string {
  const [h, m] = uhrzeit.split(":").map(Number);
  return h >= 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Gemeinsames Formular fuer "Termin im Chat teilen" und den Kalender. Das
 * Wire-Format haengt an `ganztaegig` (reine Daten vs. UTC-Zeitpunkte, siehe
 * TerminDto): die Umrechnung aus lokalen Eingaben passiert nur hier, damit
 * kein Aufrufer Zeitzonen von Hand rechnet.
 */
export function TerminFormular({
  initial,
  standardDatum,
  standardUhrzeit,
  kontakte,
  mitBeschreibung = false,
  absendenLabel,
  wirdGesendet,
  fehler,
  onAbsenden,
  stunden,
}: {
  initial?: TerminDto;
  standardDatum?: string;
  /** Beginn "HH:MM" fuer neue Termine (Klick in eine Stunde der Wochenansicht); Ende eine Stunde spaeter. */
  standardUhrzeit?: string;
  /** Wenn gesetzt, kann der Termin gleich Teilnehmenden zugewiesen werden (nur beim Anlegen). */
  kontakte?: ChatKontaktDto[];
  mitBeschreibung?: boolean;
  absendenLabel: string;
  wirdGesendet: boolean;
  fehler: string | null;
  onAbsenden: (eingabe: TerminAnlegenEingabe) => void;
  /**
   * Kasten "Als Betreuungszeit erfassen" (migrations/0080). Ohne Angabe (Chat)
   * gibt es ihn nicht: dort wird schnell geteilt, nicht dokumentiert.
   */
  stunden?: KalenderStundenEinstellungenDto | null;
}) {
  const [titel, setTitel] = useState(initial?.titel ?? "");
  const [beschreibung, setBeschreibung] = useState(initial?.beschreibung ?? "");
  const [ort, setOrt] = useState(initial?.ort ?? "");
  const [ganztaegig, setGanztaegig] = useState(initial?.ganztaegig ?? false);
  const [art, setArt] = useState<TerminArt>(initial?.art ?? "termin");
  const [datum, setDatum] = useState(initial ? terminTag(initial.beginn, initial.ganztaegig) : (standardDatum ?? lokalesDatum(new Date())));
  const [endDatum, setEndDatum] = useState(initial ? terminTag(initial.ende, initial.ganztaegig) : (standardDatum ?? lokalesDatum(new Date())));
  const [von, setVon] = useState(initial && !initial.ganztaegig ? uhrzeitVon(initial.beginn) : (standardUhrzeit ?? "09:00"));
  const [bis, setBis] = useState(initial && !initial.ganztaegig ? uhrzeitVon(initial.ende) : standardUhrzeit ? eineStundeSpaeter(standardUhrzeit) : "10:00");
  const [auswahl, setAuswahl] = useState<Map<string, ChatKontaktDto>>(new Map());
  const [eingabeFehler, setEingabeFehler] = useState<string | null>(null);
  const mitStunden = !!stunden && stunden.funktionAn && stunden.darfBuchen && (!initial || initial.stunden !== null);
  const [stundenGewuenscht, setStundenGewuenscht] = useState(initial ? (initial.stunden?.vorgemerkt ?? false) : (stunden?.vorauswahl ?? false));
  const [leistungsart, setLeistungsart] = useState<Leistungsart | "">(initial?.stundenLeistungsart ?? "");

  // Klient:innen fuer den Kasten: beim Anlegen die Auswahl, beim Bearbeiten
  // die eingetragenen (Teilnehmende aendert das Bearbeiten-Formular nicht).
  const klientNamen = kontakte
    ? [...auswahl.values()].filter((k) => k.art === "klient").map((k) => k.name)
    : (initial?.teilnehmer ?? []).filter((t) => t.art === "klient" && t.antwort !== "abgelehnt").map((t) => t.name);
  const zeitraum = ganztaegig ? { beginn: datum, ende: endDatum } : { beginn: new Date(`${datum}T${von}`), ende: new Date(`${datum}T${bis}`) };
  const stundenHindernis = terminStundenHindernis({ ganztaegig, ...zeitraum, klientAnzahl: klientNamen.length });
  const stundenAktiv = mitStunden && stundenGewuenscht && !stundenHindernis;

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEingabeFehler(null);
    let beginn: string;
    let ende: string;
    if (ganztaegig) {
      if (endDatum < datum) return setEingabeFehler("Der letzte Tag darf nicht vor dem ersten Tag liegen.");
      beginn = datum;
      ende = endDatum;
    } else {
      const b = new Date(`${datum}T${von}`);
      const en = new Date(`${datum}T${bis}`);
      if (Number.isNaN(b.getTime()) || Number.isNaN(en.getTime())) return setEingabeFehler("Bitte Datum und Uhrzeiten angeben.");
      if (en < b) return setEingabeFehler("Das Ende darf nicht vor dem Beginn liegen.");
      beginn = b.toISOString();
      ende = en.toISOString();
    }
    onAbsenden({
      titel: titel.trim(),
      beschreibung: mitBeschreibung ? beschreibung.trim() || null : undefined,
      ort: ort.trim() || null,
      beginn,
      ende,
      ganztaegig,
      art,
      ...(kontakte ? { teilnehmer: [...auswahl.values()].map(kontaktEingabe) } : {}),
      ...(mitStunden ? { stundenErfassen: stundenAktiv, stundenLeistungsart: leistungsart || null } : {}),
    });
  }

  const anzeigeFehler = eingabeFehler ?? fehler;

  return (
    <form onSubmit={absenden} noValidate={false}>
      {anzeigeFehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {anzeigeFehler}
        </div>
      )}
      <div className="zv-field">
        <label htmlFor="termin-titel">Titel</label>
        <input id="termin-titel" value={titel} onChange={(e) => setTitel(e.target.value)} required maxLength={200} autoFocus />
      </div>
      <div className="zv-field">
        <label htmlFor="termin-art">Art</label>
        <select id="termin-art" value={art} onChange={(e) => setArt(e.target.value as TerminArt)}>
          {(Object.keys(TERMIN_ART_LABEL) as TerminArt[]).map((a) => (
            <option key={a} value={a}>
              {TERMIN_ART_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <label className="zv-checkbox-zeile" style={{ marginBottom: "var(--zv-space-3)" }}>
        <input type="checkbox" checked={ganztaegig} onChange={(e) => setGanztaegig(e.target.checked)} />
        Ganztägig
      </label>
      <div className="zv-field-row">
        {ganztaegig ? (
          <Zeitraumfeld
            von={{ id: "termin-datum", label: "Erster Tag", required: true }}
            bis={{ id: "termin-ende-datum", label: "Letzter Tag", required: true }}
            wertVon={datum}
            wertBis={endDatum}
            onChange={(v, b) => {
              setDatum(v);
              // Wie vorher: ein Ende vor dem Anfang wird zum Anfang.
              setEndDatum(!b || (v && b < v) ? v : b);
            }}
          />
        ) : (
          <div className="zv-field">
            <label htmlFor="termin-datum">Datum</label>
            <Datumsfeld
              id="termin-datum"
              value={datum}
              onChange={(v) => {
                setDatum(v);
                if (endDatum < v) setEndDatum(v);
              }}
              required
              schnellwahl="faelligkeit"
            />
          </div>
        )}
      </div>
      {!ganztaegig && (
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="termin-von">Von</label>
            <input id="termin-von" type="time" value={von} onChange={(e) => setVon(e.target.value)} required />
          </div>
          <div className="zv-field">
            <label htmlFor="termin-bis">Bis</label>
            <input id="termin-bis" type="time" value={bis} onChange={(e) => setBis(e.target.value)} required />
          </div>
        </div>
      )}
      <div className="zv-field">
        <label htmlFor="termin-ort">Ort (optional)</label>
        <input id="termin-ort" value={ort} onChange={(e) => setOrt(e.target.value)} maxLength={300} />
      </div>
      {mitBeschreibung && (
        <div className="zv-field">
          <label htmlFor="termin-beschreibung">Beschreibung (optional)</label>
          <textarea id="termin-beschreibung" rows={3} value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} maxLength={5000} />
        </div>
      )}
      {kontakte && (
        <div className="zv-field">
          <span className="zv-feldtitel">Teilnehmende (optional)</span>
          <KontaktAuswahl
            idPraefix="termin"
            kontakte={kontakte}
            ausgewaehlt={new Set(auswahl.keys())}
            onToggle={(k) =>
              setAuswahl((alt) => {
                const neu = new Map(alt);
                const s = kontaktSchluessel(k);
                if (neu.has(s)) neu.delete(s);
                else neu.set(s, k);
                return neu;
              })
            }
          />
        </div>
      )}
      {mitStunden && (
        <StundenKasten
          aktiv={stundenAktiv}
          hindernis={stundenHindernis}
          onAktiv={setStundenGewuenscht}
          minuten={stundenHindernis ? 0 : terminMinuten(zeitraum.beginn as Date, zeitraum.ende as Date)}
          klientNamen={klientNamen}
          leistungsart={leistungsart}
          onLeistungsart={setLeistungsart}
        />
      )}
      <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGesendet || !titel.trim()}>
        <ISpeichern />
        {wirdGesendet ? "Speichert…" : absendenLabel}
      </button>
    </form>
  );
}

/**
 * Gesperrt mit Grund statt ausgeblendet (Konzept 3.6): wer den Haken sucht,
 * soll sehen, warum er gerade nicht geht -- etwa weil noch keine Klient:in
 * eingetragen ist.
 */
function StundenKasten({
  aktiv,
  hindernis,
  onAktiv,
  minuten,
  klientNamen,
  leistungsart,
  onLeistungsart,
}: {
  aktiv: boolean;
  hindernis: string | null;
  onAktiv: (v: boolean) => void;
  minuten: number;
  klientNamen: string[];
  leistungsart: Leistungsart | "";
  onLeistungsart: (v: Leistungsart | "") => void;
}) {
  const automatisch = LEISTUNGSART_LABEL[terminStundenLeistungsart(null, klientNamen.length)];
  return (
    <div className={`zv-stunden-kasten${hindernis ? " zv-stunden-kasten-gesperrt" : ""}`}>
      <label className="zv-checkbox-zeile">
        <input type="checkbox" checked={aktiv} disabled={!!hindernis} onChange={(e) => onAktiv(e.target.checked)} />
        Als Betreuungszeit erfassen
      </label>
      {hindernis ? (
        <p className="zv-stunden-kasten-text">{hindernis}</p>
      ) : aktiv ? (
        <>
          <p className="zv-stunden-kasten-text">
            <strong>{formatMinutenAlsStunden(minuten)}</strong> für <strong>{namenListe(klientNamen)}</strong>
            {klientNamen.length > 1 && " (je)"} in den Stunden, sobald der Termin vorbei ist. Ändert sich der Termin danach, wird automatisch
            storniert und neu gebucht.
          </p>
          <div className="zv-field">
            <label htmlFor="termin-leistung">Leistung</label>
            <select id="termin-leistung" value={leistungsart} onChange={(e) => onLeistungsart(e.target.value as Leistungsart | "")}>
              <option value="">Automatisch ({automatisch})</option>
              {LEISTUNGSARTEN.map((l) => (
                <option key={l} value={l}>
                  {LEISTUNGSART_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p className="zv-stunden-kasten-text">Die Dauer wird nicht in die Stunden übernommen.</p>
      )}
    </div>
  );
}

function namenListe(namen: string[]): string {
  if (namen.length <= 1) return namen[0] ?? "";
  return `${namen.slice(0, -1).join(", ")} und ${namen[namen.length - 1]}`;
}
