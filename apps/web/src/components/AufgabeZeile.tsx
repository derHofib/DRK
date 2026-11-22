import type { AufgabeDto, BenutzerListEintragDto } from "@zimmerakte/shared";
import { AUFGABE_PRIORITAET_LABEL } from "@zimmerakte/shared";
import { formatDatum, heuteBerlin } from "../format";
import { AktionsMenue } from "./AktionsMenue";
import { IGenehmigen, ILoeschen, IPrioritaetHoch, IPrioritaetNiedrig, IPrioritaetNormal } from "./icons";

// Exportiert, damit andere Stellen (z.B. Dashboard.tsx) dieselbe Zuordnung
// verwenden statt sie ein zweites Mal nachzubauen -- sonst laeuft eine
// Kopie irgendwann auseinander.
export const PRIORITAET_ICON = {
  hoch: IPrioritaetHoch,
  normal: IPrioritaetNormal,
  niedrig: IPrioritaetNiedrig,
} as const;

// Bewusst NICHT nur Farbe (WCAG 1.4.1): jede Prioritaet hat ein eigenes
// Icon (Signalstaerke) UND einen eigenen Pill-Farbton -- beides zusammen
// traegt die Information, nicht die Farbe allein.
export const PRIORITAET_PILL_KLASSE = {
  hoch: "zv-pill-danger",
  normal: "zv-pill",
  niedrig: "zv-pill-vergeben",
} as const;

export function faelligkeitsHinweis(faelligAm: string | null): { text: string; klasse: string } | null {
  if (!faelligAm) return null;
  // Berliner Tag, nicht UTC: sonst stimmt "ueberfaellig" zwischen 0 und
  // 1/2 Uhr nicht mit der roten Zahl auf der Zimmerkarte (Server) ueberein.
  const heute = heuteBerlin();
  if (faelligAm < heute) return { text: `überfällig seit ${formatDatum(faelligAm)}`, klasse: "zv-pill-danger" };
  if (faelligAm === heute) return { text: "heute fällig", klasse: "zv-pill-offen" };
  return { text: `fällig am ${formatDatum(faelligAm)}`, klasse: "zv-pill-vergeben" };
}

export function AufgabeZeile({
  aufgabe,
  benutzerListe,
  aktuelleBenutzerId,
  zeigeZimmer = false,
  onErledigen,
  onZuweisenAendern,
  onLoeschen,
}: {
  aufgabe: AufgabeDto;
  benutzerListe: BenutzerListEintragDto[];
  aktuelleBenutzerId: string | null;
  zeigeZimmer?: boolean;
  onErledigen: () => void;
  onZuweisenAendern: (benutzerId: string | null) => void;
  onLoeschen: () => void;
}) {
  const PrioritaetIcon = PRIORITAET_ICON[aufgabe.prioritaet];
  const faelligkeit = faelligkeitsHinweis(aufgabe.faelligAm);
  // Zuweisen ist die eine Ausnahme, die JEDE sichtbare Person darf (siehe
  // aufgabe.service.ts, Kommentar zu aktualisieren()) -- deshalb immer
  // anbieten. Erledigen/Loeschen dagegen nur nach dem Urteil des Servers
  // (darfBearbeiten), nicht nach einer clientseitigen Nachbildung: die
  // kannte das Koordinationsrecht der Leitung nicht.
  const darfSchreiben = aufgabe.darfBearbeiten;

  return (
    <div className="zv-info-karte" style={{ opacity: aufgabe.erledigtAm ? 0.6 : 1 }}>
      <span className="zv-liste-zelle-titel">
        {aufgabe.erledigtAm ? <s>{aufgabe.titel}</s> : aufgabe.titel}
        {aufgabe.beschreibung && <div className="zv-sub-inline">{aufgabe.beschreibung}</div>}
      </span>
      {zeigeZimmer && (
        <span className="zv-liste-zelle" data-label="Zimmer">
          {aufgabe.zimmerNummer ? `${aufgabe.standortName} · Zimmer ${aufgabe.zimmerNummer}` : "Persönlich"}
        </span>
      )}
      <span className="zv-liste-zelle" data-label="Priorität">
        <span className={`zv-pill ${PRIORITAET_PILL_KLASSE[aufgabe.prioritaet]}`}>
          <PrioritaetIcon />
          {AUFGABE_PRIORITAET_LABEL[aufgabe.prioritaet]}
        </span>
      </span>
      <span className="zv-liste-zelle" data-label="Fälligkeit">
        {faelligkeit ? (
          <span className={`zv-pill ${faelligkeit.klasse}`}>
            <span className="zv-pill-text">{faelligkeit.text}</span>
          </span>
        ) : (
          <span className="zv-sub-inline">ohne Termin</span>
        )}
      </span>
      <span className="zv-liste-zelle" data-label="Zugewiesen">
        {aufgabe.erledigtAm ? (
          <span className="zv-sub-inline">
            erledigt von {aufgabe.erledigtVonName} am {formatDatum(aufgabe.erledigtAm.slice(0, 10))}
          </span>
        ) : (
          <select
            value={aufgabe.zugewiesenAn ?? ""}
            aria-label={`Zuweisung für "${aufgabe.titel}"`}
            onChange={(e) => onZuweisenAendern(e.target.value || null)}
          >
            <option value="">Niemand</option>
            {benutzerListe.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.id === aktuelleBenutzerId ? " (ich)" : ""}
              </option>
            ))}
          </select>
        )}
      </span>
      <span className="zv-liste-zelle" data-label="Aktion">
        {!aufgabe.erledigtAm && darfSchreiben && (
          <button className="zv-link-btn" onClick={onErledigen}>
            <IGenehmigen />
            Erledigen
          </button>
        )}
        {darfSchreiben && (
          <button className="zv-link-btn" onClick={onLoeschen}>
            <ILoeschen />
            Löschen
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Schmale Fassung fuer das Zimmer-Panel (Rueckmeldung d5f8252d): dort ist
 * kein Platz fuer die fuenf Spalten von AufgabeZeile. Titel bekommt die
 * Breite, Faelligkeit und Zuweisung rutschen in eine Zeile darunter,
 * Erledigen bleibt als sichtbarer Knopf rechts (das ist die haeufigste
 * Handlung), Loeschen wandert ins Menue. Dieselben Rechte-Regeln wie oben:
 * Erledigen/Loeschen nach aufgabe.darfBearbeiten vom Server.
 */
export function AufgabeKompakt({
  aufgabe,
  benutzerListe,
  aktuelleBenutzerId,
  onErledigen,
  onZuweisenAendern,
  onLoeschen,
}: {
  aufgabe: AufgabeDto;
  benutzerListe: BenutzerListEintragDto[];
  aktuelleBenutzerId: string | null;
  onErledigen: () => void;
  onZuweisenAendern: (benutzerId: string | null) => void;
  onLoeschen: () => void;
}) {
  const PrioritaetIcon = PRIORITAET_ICON[aufgabe.prioritaet];
  const faelligkeit = faelligkeitsHinweis(aufgabe.faelligAm);
  const erledigt = Boolean(aufgabe.erledigtAm);

  return (
    <li className={`zv-aufgabe-kompakt${erledigt ? " zv-erledigt" : ""}`}>
      <span className={`zv-pill ${PRIORITAET_PILL_KLASSE[aufgabe.prioritaet]} zv-aufgabe-kompakt-prio`}>
        <PrioritaetIcon />
        {AUFGABE_PRIORITAET_LABEL[aufgabe.prioritaet]}
      </span>
      <div className="zv-aufgabe-kompakt-text">
        <div className="zv-aufgabe-kompakt-titel">{erledigt ? <s>{aufgabe.titel}</s> : aufgabe.titel}</div>
        {aufgabe.beschreibung && <div className="zv-aufgabe-kompakt-beschreibung">{aufgabe.beschreibung}</div>}
        <div className="zv-aufgabe-kompakt-meta">
          {erledigt ? (
            <span>
              erledigt von {aufgabe.erledigtVonName} am {formatDatum(aufgabe.erledigtAm!.slice(0, 10))}
            </span>
          ) : (
            <>
              {faelligkeit ? (
                <span className={`zv-pill ${faelligkeit.klasse}`}>
                  <span className="zv-pill-text">{faelligkeit.text}</span>
                </span>
              ) : (
                <span>ohne Termin</span>
              )}
              <select
                className="zv-aufgabe-kompakt-zuweisung"
                value={aufgabe.zugewiesenAn ?? ""}
                aria-label={`Zuweisung für "${aufgabe.titel}"`}
                onChange={(e) => onZuweisenAendern(e.target.value || null)}
              >
                <option value="">Niemand zugewiesen</option>
                {benutzerListe.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.id === aktuelleBenutzerId ? " (ich)" : ""}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
      {aufgabe.darfBearbeiten && (
        <div className="zv-aufgabe-kompakt-aktionen">
          {!erledigt && (
            <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={onErledigen}>
              <IGenehmigen />
              Erledigen
            </button>
          )}
          <AktionsMenue label={`Weitere Aktionen zu "${aufgabe.titel}"`}>
            <button type="button" role="menuitem" className="zv-menue-gefahr" onClick={onLoeschen}>
              <ILoeschen />
              Aufgabe löschen
            </button>
          </AktionsMenue>
        </div>
      )}
    </li>
  );
}
