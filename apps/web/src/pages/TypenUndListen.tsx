import { useState } from "react";
import type { EinstellungenRechteDto } from "@zimmerakte/shared";
import { LEISTUNGSARTEN, LEISTUNGSART_LABEL } from "@zimmerakte/shared";
import { ISperre } from "../components/icons";
import { ABWESENHEIT_ARTEN, ABWESENHEIT_LABEL } from "../kalender/eintraege";
import { ArtDreieck } from "../kalender/Abwesenheiten";
import { KassenbuchTypen } from "./KassenbuchTypen";
import { TerminTypen } from "./TerminTypen";

type Liste = "termintypen" | "abwesenheit" | "buchungstypen" | "leistungsarten";

interface ListenEintrag {
  wert: Liste;
  label: string;
  gruppe: string;
  /** Fest = an der Liste haengt Logik oder Datenschutz; nur Ansicht. */
  fest?: boolean;
}

/**
 * "Typen & Listen" (Wunsch Dennis, 21.11.2026: "das ganze bitte nur auf
 * einer Seite sauber organisiert"): alle Auswahllisten des Traegers an einem
 * Ort, links nach Bereich gruppiert. Neue Listen kommen hier dazu statt als
 * eigener Menuepunkt.
 *
 * Jede aenderbare Liste erscheint nur mit ihrem Recht -- verbindlich prueft
 * der jeweilige Service. Die festen Listen stehen da, damit man nicht
 * vergeblich nach ihnen sucht, und sagen, warum sie fest sind.
 */
export function TypenUndListen({ rechte }: { rechte: EinstellungenRechteDto | null }) {
  const listen: ListenEintrag[] = [
    ...(rechte?.termintypen ? [{ wert: "termintypen" as const, label: "Termintypen", gruppe: "Kalender" }] : []),
    { wert: "abwesenheit", label: "Abwesenheitsgründe", gruppe: "Kalender", fest: true },
    ...(rechte?.kassenbuch ? [{ wert: "buchungstypen" as const, label: "Buchungstypen", gruppe: "Geld" }] : []),
    { wert: "leistungsarten", label: "Leistungsarten", gruppe: "Stunden", fest: true },
  ];
  const [gewaehlt, setGewaehlt] = useState<Liste | null>(null);
  const aktiv = listen.find((l) => l.wert === gewaehlt) ?? listen.find((l) => !l.fest) ?? listen[0];
  const gruppen = [...new Set(listen.map((l) => l.gruppe))];

  return (
    <div className="zv-typen-seite">
      <nav className="zv-typen-nav" aria-label="Listen">
        {gruppen.map((g) => (
          <div key={g} className="zv-typen-nav-gruppe">
            <span className="zv-typen-nav-titel">{g}</span>
            {listen
              .filter((l) => l.gruppe === g)
              .map((l) => (
                <button
                  key={l.wert}
                  type="button"
                  className={`zv-typen-nav-punkt${l.wert === aktiv.wert ? " aktiv" : ""}`}
                  aria-current={l.wert === aktiv.wert ? "page" : undefined}
                  onClick={() => setGewaehlt(l.wert)}
                >
                  {l.label}
                  {l.fest && (
                    <span className="zv-typen-fest" title="Fest: nur Ansicht">
                      <ISperre />
                      fest
                    </span>
                  )}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <section className="zv-typen-inhalt" aria-label={aktiv.label}>
        {aktiv.wert === "termintypen" && <TerminTypen />}
        {aktiv.wert === "buchungstypen" && (
          <>
            <h3 className="zv-typen-titel">Buchungstypen</h3>
            <KassenbuchTypen />
          </>
        )}
        {aktiv.wert === "abwesenheit" && (
          <FesteListe
            titel="Abwesenheitsgründe"
            warum="„krank“ ist ein Gesundheitsdatum: den Grund sieht nur die Person selbst und wer das Recht dazu hat. Frei angelegte Gründe bräuchten dieselbe Schutzregel, deshalb ist diese Liste vorerst fest."
            eintraege={ABWESENHEIT_ARTEN.map((a) => ({ schluessel: a, label: ABWESENHEIT_LABEL[a], marke: <ArtDreieck klasse={`zv-art-${a}`} /> }))}
          />
        )}
        {aktiv.wert === "leistungsarten" && (
          <FesteListe
            titel="Leistungsarten"
            warum="Leistungsarten stehen auf den Leistungsnachweisen für das Amt. Neue Arten sollten erst mit der Abrechnung abgestimmt werden, deshalb ist diese Liste vorerst fest."
            eintraege={LEISTUNGSARTEN.map((l) => ({ schluessel: l, label: LEISTUNGSART_LABEL[l] }))}
          />
        )}
      </section>
    </div>
  );
}

function FesteListe({
  titel,
  warum,
  eintraege,
}: {
  titel: string;
  warum: string;
  eintraege: { schluessel: string; label: string; marke?: React.ReactNode }[];
}) {
  return (
    <>
      <h3 className="zv-typen-titel">{titel}</h3>
      <p className="zv-sub zv-typen-text">{warum}</p>
      <ul className="zv-typen-feste-liste">
        {eintraege.map((e) => (
          <li key={e.schluessel}>
            {e.marke}
            {e.label}
          </li>
        ))}
      </ul>
    </>
  );
}
