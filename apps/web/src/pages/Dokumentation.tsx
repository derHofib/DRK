import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ProtokollKurzDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Filterleiste, trifftSuche } from "../components/Listenfilter";
import { Leerzustand } from "../components/Leerzustand";
import { IFehler, ILeerTagesberichte } from "../components/icons";
import { formatDatum } from "../format";
import { ProtokollDetail } from "./klient/ProtokolleTab";
import { Tagesberichte } from "./Tagesberichte";

type Teil = "tagesberichte" | "protokolle";
const TEIL_SCHLUESSEL = "zv-dokumentation-teil";

function teilLesen(): Teil {
  try {
    return sessionStorage.getItem(TEIL_SCHLUESSEL) === "protokolle" ? "protokolle" : "tagesberichte";
  } catch {
    return "tagesberichte";
  }
}

/**
 * Menuepunkt "Dokumentation" (vorher "Tagesberichte", Konzept chronik,
 * Abschnitt 9): Tagesberichte und Protokolle aller Klient:innen an einer
 * Stelle. Beides ist "Stand nach festem Schema"; was ohne Formular
 * passiert (Telefonat, Notiz, Entscheidung), steht im Verlauf der Akte.
 */
export function Dokumentation({ startKlientId }: { startKlientId?: string }) {
  // Ein Sprung "Tagesbericht für … schreiben" landet immer bei den Tagesberichten.
  const [teil, setTeilRoh] = useState<Teil>(() => (startKlientId ? "tagesberichte" : teilLesen()));
  function setTeil(t: Teil) {
    setTeilRoh(t);
    try {
      sessionStorage.setItem(TEIL_SCHLUESSEL, t);
    } catch {
      // ohne Speicher: beim naechsten Mal wieder Tagesberichte
    }
  }

  return (
    <div>
      <div className="zv-seiten-kopf">
        <h2>Dokumentation</h2>
      </div>
      <div className="zv-segmented zv-akte-umschalter" role="radiogroup" aria-label="Art der Dokumentation">
        {(
          [
            ["tagesberichte", "Tagesberichte"],
            ["protokolle", "Protokolle"],
          ] as [Teil, string][]
        ).map(([w, label]) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={teil === w}
            className={teil === w ? "active" : ""}
            onClick={() => setTeil(w)}
          >
            {label}
          </button>
        ))}
      </div>
      {teil === "tagesberichte" ? <Tagesberichte startKlientId={startKlientId} eingebettet /> : <AlleProtokolle />}
    </div>
  );
}

function AlleProtokolle() {
  const [liste, setListe] = useState<ProtokollKurzDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [offen, setOffen] = useState<string | null>(null);

  function laden() {
    api
      .protokolle()
      .then(setListe)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Protokolle konnten nicht geladen werden."));
  }
  useEffect(laden, []);

  const sichtbar = useMemo(
    () => (liste ?? []).filter((p) => trifftSuche(suche, [p.formularName, p.klientName, p.autorName])),
    [liste, suche]
  );

  if (offen) {
    return (
      <ProtokollDetail
        id={offen}
        onZurueck={() => {
          setOffen(null);
          laden();
        }}
      />
    );
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <Filterleiste
        ariaLabel="Protokolle filtern"
        suche={{ wert: suche, onChange: setSuche, placeholder: "Formular, Klient:in, Person …", ariaLabel: "Protokolle durchsuchen" }}
        aktiv={suche !== ""}
        onZuruecksetzen={() => setSuche("")}
      />
      {liste === null ? null : sichtbar.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>
          {liste.length === 0
            ? "Noch keine Protokolle. Protokolle werden in der Akte einer Klient:in unter Dokumentation angelegt."
            : "Keine Protokolle für diese Suche."}
        </Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.9fr 1.8fr 1.6fr 1.3fr 1fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Datum</span>
            <span>Formular</span>
            <span>Klient:in</span>
            <span>Ausgefüllt von</span>
            <span>Stand</span>
          </div>
          {sichtbar.map((p) => (
            <div
              key={p.id}
              className="zv-info-karte zv-info-karte-klickbar"
              role="button"
              tabIndex={0}
              onClick={() => setOffen(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOffen(p.id);
                }
              }}
            >
              <span className="zv-liste-zelle" data-label="Datum">
                {formatDatum(p.bezugsdatum)}
              </span>
              <span className="zv-liste-zelle-titel">{p.formularName}</span>
              <span className="zv-liste-zelle" data-label="Klient:in">
                {p.klientName}
              </span>
              <span className="zv-liste-zelle" data-label="Ausgefüllt von">
                {p.autorName ?? "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Stand">
                {!p.abgeschlossen ? (
                  <span className="zv-pill zv-pill-frist">Entwurf</span>
                ) : p.anzahlAenderungen > 0 ? (
                  <span className="zv-pill">korrigiert</span>
                ) : (
                  <span className="zv-pill zv-pill-ok">abgeschlossen</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
