import { FormEvent, useMemo, useState } from "react";
import type { ChatKontaktDto, KalenderStundenEinstellungenDto, Leistungsart, TerminAnlegenEingabe, TerminDto, TerminTypDto } from "@zimmerakte/shared";
import {
  LEISTUNGSARTEN,
  LEISTUNGSART_LABEL,
  formatMinutenAlsStunden,
  terminMinuten,
  terminStundenHindernis,
  terminStundenLeistungsart,
} from "@zimmerakte/shared";
import { lokalesDatum, terminTag } from "../format";
import { IFehler, IInfo, ISpeichern } from "./icons";
import { KontaktAuswahl, kontaktEingabe, kontaktSchluessel } from "./chat/KontaktAuswahl";
import { Datumsfeld, Zeitraumfeld } from "./Datumsfeld";
import { useTerminTypen } from "../kalender/terminTypen";

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
  /**
   * Wenn gesetzt, kann der Termin gleich Teilnehmenden zugewiesen werden (nur
   * beim Anlegen). Klient:innen und Mitarbeitende stehen in einer Liste;
   * `hatZugang === false` markiert Klient:innen, die die Einladung nicht sehen.
   */
  kontakte?: (ChatKontaktDto & { hatZugang?: boolean })[];
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
  const typen = useTerminTypen();
  // null = Standardtyp (der Server setzt ihn, migrations/0085); so braucht
  // ein neuer Termin die Typliste nicht abzuwarten.
  const [typId, setTypId] = useState<string | null>(initial?.typ.id ?? null);
  const [datum, setDatum] = useState(initial ? terminTag(initial.beginn, initial.ganztaegig) : (standardDatum ?? lokalesDatum(new Date())));
  const [endDatum, setEndDatum] = useState(initial ? terminTag(initial.ende, initial.ganztaegig) : (standardDatum ?? lokalesDatum(new Date())));
  const [von, setVon] = useState(initial && !initial.ganztaegig ? uhrzeitVon(initial.beginn) : (standardUhrzeit ?? "09:00"));
  const [bis, setBis] = useState(initial && !initial.ganztaegig ? uhrzeitVon(initial.ende) : standardUhrzeit ? eineStundeSpaeter(standardUhrzeit) : "10:00");
  const [auswahl, setAuswahl] = useState<Map<string, ChatKontaktDto & { hatZugang?: boolean }>>(new Map());
  const [eingabeFehler, setEingabeFehler] = useState<string | null>(null);
  const mitStunden = !!stunden && stunden.funktionAn && stunden.darfBuchen && (!initial || initial.stunden !== null);
  const [stundenGewuenscht, setStundenGewuenscht] = useState(initial ? (initial.stunden?.vorgemerkt ?? false) : (stunden?.vorauswahl ?? false));
  const [leistungsart, setLeistungsart] = useState<Leistungsart | "">(initial?.stundenLeistungsart ?? "");
  // Welcher Typ den Haken zuletzt vorbelegt hat -- nur fuer den Hinweis im Kasten.
  const [vorbelegtVon, setVorbelegtVon] = useState<string | null>(null);

  // Waehlbar sind aktive Typen; ein ausgeblendeter bleibt sichtbar, solange
  // dieser Termin ihn traegt (sonst verschwaende er beim Bearbeiten still).
  const waehlbar = typen.filter((t) => t.aktiv || t.id === initial?.typ.id);
  const gewaehlt = typId ? typen.find((t) => t.id === typId) : typen.find((t) => t.istStandard);

  /**
   * Der Typ belegt nur VOR: Haken und Leistung lassen sich danach frei
   * aendern. "voreinstellung" faellt auf die persoenliche Vorauswahl zurueck
   * (wie vor den Termintypen).
   */
  function typWaehlen(t: TerminTypDto) {
    setTypId(t.id);
    const haken = t.betreuungszeit === "vorbelegen" ? true : t.betreuungszeit === "nicht_vorbelegen" ? false : (stunden?.vorauswahl ?? false);
    setStundenGewuenscht(haken);
    setVorbelegtVon(t.betreuungszeit === "vorbelegen" ? t.bezeichnung : null);
    setLeistungsart(t.leistungsart ?? "");
  }

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
      ...(typId ? { typId } : {}),
      ...(kontakte ? { teilnehmer: [...auswahl.values()].map(kontaktEingabe) } : {}),
      ...(mitStunden ? { stundenErfassen: stundenAktiv, stundenLeistungsart: leistungsart || null } : {}),
    });
  }

  const anzeigeFehler = eingabeFehler ?? fehler;

  function umschalten(k: ChatKontaktDto) {
    setAuswahl((alt) => {
      const neu = new Map(alt);
      const s = kontaktSchluessel(k);
      if (neu.has(s)) neu.delete(s);
      else neu.set(s, k);
      return neu;
    });
  }

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
      {waehlbar.length > 1 && (
        <fieldset className="zv-field zv-art-wahl">
          <legend>Art</legend>
          <div className="zv-art-wahl-optionen">
            {waehlbar.map((t) => {
              const an = gewaehlt?.id === t.id;
              return (
                <label key={t.id} className={`zv-art-wahl-option${an ? " aktiv" : ""}`}>
                  <input type="radio" name="termin-typ" value={t.id} checked={an} onChange={() => typWaehlen(t)} />
                  <span className={`zv-person-punkt zv-art-farbe zv-typ-${t.farbe}`} aria-hidden="true" />
                  {t.bezeichnung}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
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
      {kontakte && <TeilnehmerAuswahl kontakte={kontakte} auswahl={auswahl} onToggle={umschalten} />}
      {mitStunden && (
        <StundenKasten
          aktiv={stundenAktiv}
          hindernis={stundenHindernis}
          onAktiv={setStundenGewuenscht}
          minuten={stundenHindernis ? 0 : terminMinuten(zeitraum.beginn as Date, zeitraum.ende as Date)}
          klientNamen={klientNamen}
          leistungsart={leistungsart}
          onLeistungsart={setLeistungsart}
          vorbelegtVon={vorbelegtVon}
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
 * Klient:innen und Mitarbeitende in EINER Liste, die Pille sagt, wer wer ist
 * (Wunsch Dennis, 21.11.2026: zwei getrennte Listen mit je eigener Suche
 * bedeuteten zweimal suchen, obwohl man meist nur einen Namen im Kopf hat).
 * Alphabetisch gemischt statt nach Art gruppiert -- gesucht wird nach dem
 * Namen, nicht nach der Rolle.
 *
 * Klient:innen stehen hier auch ohne Zugang (Konzept termine-klienten 2.1),
 * damit ein Termin mit ihnen als Betreuungszeit zaehlen kann. Wer keinen
 * Zugang hat, sieht die Einladung nicht selbst -- das sagen die zweite Pille
 * und der Hinweis, statt eine Benachrichtigung vorzutaeuschen, die es nicht gibt.
 */
function TeilnehmerAuswahl({
  kontakte,
  auswahl,
  onToggle,
}: {
  kontakte: (ChatKontaktDto & { hatZugang?: boolean })[];
  auswahl: Map<string, ChatKontaktDto & { hatZugang?: boolean }>;
  onToggle: (k: ChatKontaktDto) => void;
}) {
  const sortiert = useMemo(() => [...kontakte].sort((a, b) => a.name.localeCompare(b.name, "de-DE")), [kontakte]);
  const ohneZugangSchluessel = new Set(kontakte.filter((k) => k.hatZugang === false).map(kontaktSchluessel));
  const ohneZugang = [...auswahl.values()].filter((k) => k.art === "klient" && k.hatZugang === false).map((k) => k.name);
  return (
    <div className="zv-field">
      <span className="zv-feldtitel">Teilnehmende (optional)</span>
      <KontaktAuswahl
        idPraefix="termin"
        suchLabel="Klient:in oder Mitarbeiter:in suchen"
        kontakte={sortiert}
        ausgewaehlt={new Set(auswahl.keys())}
        onToggle={onToggle}
        zusatz={(k) => (
          <span className="zv-kontakt-pillen">
            {k.art === "klient" ? (
              <span className="zv-pill zv-pill-info">Klient:in</span>
            ) : (
              <span className="zv-pill zv-pill-vergeben">Mitarbeiter:in</span>
            )}
            {ohneZugangSchluessel.has(kontaktSchluessel(k)) && <span className="zv-pill zv-pill-frist">ohne Zugang</span>}
          </span>
        )}
      />
      {ohneZugang.length > 0 && (
        <div className="zv-hinweis zv-hinweis-info" role="status" style={{ marginTop: "var(--zv-space-2)" }}>
          <IInfo />
          <span>
            <strong>{namenListe(ohneZugang)}</strong> {ohneZugang.length === 1 ? "hat" : "haben"} keinen Zugang und{" "}
            {ohneZugang.length === 1 ? "sieht" : "sehen"} die Einladung nicht selbst. Gib den Termin bitte persönlich weiter, zum Beispiel
            mit der Kalenderdatei aus dem Termin.
          </span>
        </div>
      )}
    </div>
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
  vorbelegtVon,
}: {
  aktiv: boolean;
  hindernis: string | null;
  onAktiv: (v: boolean) => void;
  minuten: number;
  klientNamen: string[];
  leistungsart: Leistungsart | "";
  onLeistungsart: (v: Leistungsart | "") => void;
  /** Typ, dessen Einstellung den Haken gesetzt hat; null = keiner. */
  vorbelegtVon: string | null;
}) {
  const automatisch = LEISTUNGSART_LABEL[terminStundenLeistungsart(null, klientNamen.length)];
  return (
    <div className={`zv-stunden-kasten${hindernis ? " zv-stunden-kasten-gesperrt" : ""}`}>
      <label className="zv-checkbox-zeile">
        <input type="checkbox" checked={aktiv} disabled={!!hindernis} onChange={(e) => onAktiv(e.target.checked)} />
        Als Betreuungszeit erfassen
      </label>
      {vorbelegtVon && aktiv && !hindernis && (
        <p className="zv-stunden-kasten-text">Vorbelegt, weil der Typ „{vorbelegtVon}“ das so vorsieht. Du kannst den Haken entfernen.</p>
      )}
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
