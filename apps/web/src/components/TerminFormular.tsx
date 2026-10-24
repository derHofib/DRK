import { FormEvent, useState } from "react";
import type { ChatKontaktDto, TerminAnlegenEingabe, TerminDto } from "@zimmerakte/shared";
import { lokalesDatum, terminTag } from "../format";
import { IFehler, ISpeichern } from "./icons";
import { KontaktAuswahl, kontaktEingabe, kontaktSchluessel } from "./chat/KontaktAuswahl";

function uhrzeitVon(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  kontakte,
  mitBeschreibung = false,
  absendenLabel,
  wirdGesendet,
  fehler,
  onAbsenden,
}: {
  initial?: TerminDto;
  standardDatum?: string;
  /** Wenn gesetzt, kann der Termin gleich Teilnehmenden zugewiesen werden (nur beim Anlegen). */
  kontakte?: ChatKontaktDto[];
  mitBeschreibung?: boolean;
  absendenLabel: string;
  wirdGesendet: boolean;
  fehler: string | null;
  onAbsenden: (eingabe: TerminAnlegenEingabe) => void;
}) {
  const [titel, setTitel] = useState(initial?.titel ?? "");
  const [beschreibung, setBeschreibung] = useState(initial?.beschreibung ?? "");
  const [ort, setOrt] = useState(initial?.ort ?? "");
  const [ganztaegig, setGanztaegig] = useState(initial?.ganztaegig ?? false);
  const [datum, setDatum] = useState(initial ? terminTag(initial.beginn, initial.ganztaegig) : (standardDatum ?? lokalesDatum(new Date())));
  const [endDatum, setEndDatum] = useState(initial ? terminTag(initial.ende, initial.ganztaegig) : (standardDatum ?? lokalesDatum(new Date())));
  const [von, setVon] = useState(initial && !initial.ganztaegig ? uhrzeitVon(initial.beginn) : "09:00");
  const [bis, setBis] = useState(initial && !initial.ganztaegig ? uhrzeitVon(initial.ende) : "10:00");
  const [auswahl, setAuswahl] = useState<Map<string, ChatKontaktDto>>(new Map());
  const [eingabeFehler, setEingabeFehler] = useState<string | null>(null);

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
      ...(kontakte ? { teilnehmer: [...auswahl.values()].map(kontaktEingabe) } : {}),
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
      <label className="zv-checkbox-zeile" style={{ marginBottom: "var(--zv-space-3)" }}>
        <input type="checkbox" checked={ganztaegig} onChange={(e) => setGanztaegig(e.target.checked)} />
        Ganztägig
      </label>
      <div className="zv-field-row">
        <div className="zv-field">
          <label htmlFor="termin-datum">{ganztaegig ? "Erster Tag" : "Datum"}</label>
          <input
            id="termin-datum"
            type="date"
            value={datum}
            onChange={(e) => {
              setDatum(e.target.value);
              if (endDatum < e.target.value) setEndDatum(e.target.value);
            }}
            required
          />
        </div>
        {ganztaegig && (
          <div className="zv-field">
            <label htmlFor="termin-ende-datum">Letzter Tag</label>
            <input id="termin-ende-datum" type="date" value={endDatum} min={datum} onChange={(e) => setEndDatum(e.target.value)} required />
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
      <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGesendet || !titel.trim()}>
        <ISpeichern />
        {wirdGesendet ? "Speichert…" : absendenLabel}
      </button>
    </form>
  );
}
