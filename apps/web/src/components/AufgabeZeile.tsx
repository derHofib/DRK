import type { AufgabeDto, BenutzerListEintragDto, BenutzerRolle } from "@zimmerakte/shared";
import { AUFGABE_PRIORITAET_LABEL } from "@zimmerakte/shared";
import { formatDatum } from "../format";
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

/**
 * Reiner Anzeige-Hinweis, welche Knoepfe angeboten werden -- der Server
 * (aufgabe.service.ts, darfSchreiben()) entscheidet verbindlich. Gleiches
 * Prinzip wie tokenRolle()/darfKapazitaetEntscheiden() in Zimmer.tsx.
 */
function darfBearbeiten(aufgabe: AufgabeDto, benutzerId: string | null, rolle: BenutzerRolle | null): boolean {
  if (!benutzerId) return false;
  if (rolle === "bereichsleitung" || rolle === "einrichtungsleitung") return true;
  return aufgabe.erstelltVon === benutzerId || aufgabe.zugewiesenAn === benutzerId;
}

export function faelligkeitsHinweis(faelligAm: string | null): { text: string; klasse: string } | null {
  if (!faelligAm) return null;
  const heute = new Date().toISOString().slice(0, 10);
  if (faelligAm < heute) return { text: `überfällig seit ${formatDatum(faelligAm)}`, klasse: "zv-pill-danger" };
  if (faelligAm === heute) return { text: "heute fällig", klasse: "zv-pill-offen" };
  return { text: `fällig am ${formatDatum(faelligAm)}`, klasse: "zv-pill-vergeben" };
}

export function AufgabeZeile({
  aufgabe,
  benutzerListe,
  aktuelleBenutzerId,
  aktuelleRolle,
  zeigeZimmer = false,
  onErledigen,
  onZuweisenAendern,
  onLoeschen,
}: {
  aufgabe: AufgabeDto;
  benutzerListe: BenutzerListEintragDto[];
  aktuelleBenutzerId: string | null;
  aktuelleRolle: BenutzerRolle | null;
  zeigeZimmer?: boolean;
  onErledigen: () => void;
  onZuweisenAendern: (benutzerId: string | null) => void;
  onLoeschen: () => void;
}) {
  const PrioritaetIcon = PRIORITAET_ICON[aufgabe.prioritaet];
  const faelligkeit = faelligkeitsHinweis(aufgabe.faelligAm);
  // Zuweisen ist die eine Ausnahme, die JEDE sichtbare Person darf (siehe
  // aufgabe.service.ts, Kommentar zu aktualisieren()) -- deshalb hier
  // unabhaengig von darfBearbeiten() immer anbieten, nicht nur wenn
  // darfSchreiben() serverseitig zutreffen wuerde.
  const darfSchreiben = darfBearbeiten(aufgabe, aktuelleBenutzerId, aktuelleRolle);

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
