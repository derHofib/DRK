import { useEffect, useMemo, useState } from "react";
import {
  alleBausteine,
  pruefeWerte,
  type AngeheftetesProtokollEingabe,
  type Anheftpunkt,
  type FeldWert,
  type FeldWerte,
  type FormularAngebotDto,
} from "@zimmerakte/shared";
import { api, ApiFehler } from "../api/client";
import { heuteBerlin } from "../format";
import { ProtokollEingabe, type PersonAuswahl } from "./ProtokollFormular";
import { IAbbrechen, INeu } from "./icons";

/**
 * Formulare, die an einen Ablauf angeheftet sind (zuerst: Tagesbericht
 * anlegen). Welche angeboten werden, entscheidet der Server anhand des
 * Standorts der Klient:in -- hier wird nur angezeigt und gesammelt. Gespeichert
 * wird zusammen mit dem Ablauf in EINER Transaktion (tagesbericht.service),
 * damit es nie einen Tagesbericht ohne sein Pflichtprotokoll gibt.
 */
export function useAngehefteteFormulare(klientId: string | null, anheftpunkt: Anheftpunkt) {
  const [angebote, setAngebote] = useState<FormularAngebotDto[]>([]);
  const [dazugenommen, setDazugenommen] = useState<string[]>([]);
  const [werte, setWerte] = useState<Record<string, FeldWerte>>({});
  const [fehler, setFehler] = useState<Record<string, Record<string, string>>>({});
  const [personen, setPersonen] = useState<PersonAuswahl[]>([]);

  useEffect(() => {
    setAngebote([]);
    setDazugenommen([]);
    setWerte({});
    setFehler({});
    if (!klientId) return;
    let aktuell = true;
    api
      .formularAngebot(klientId, anheftpunkt)
      .then((l) => {
        if (!aktuell) return;
        setAngebote(l);
        setWerte(Object.fromEntries(l.map((a) => [a.id, { ...a.werte }])));
      })
      // Ohne Recht zum Ausfuellen oder bei einem Fehler: der Ablauf selbst geht weiter wie bisher.
      .catch(() => aktuell && setAngebote([]));
    return () => {
      aktuell = false;
    };
  }, [klientId, anheftpunkt]);

  const brauchtPersonen = useMemo(() => angebote.some((a) => alleBausteine(a.definition).some((b) => b.typ === "mitarbeitende")), [angebote]);
  useEffect(() => {
    if (!brauchtPersonen) return;
    api
      .benutzerListe()
      .then((l) => setPersonen(l.filter((b) => b.aktiv).map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name, "de"))))
      .catch(() => setPersonen([]));
  }, [brauchtPersonen]);

  const aktiv = angebote.filter((a) => a.modus === "automatisch" || dazugenommen.includes(a.id));

  return {
    angebote,
    aktiv,
    werte,
    fehler,
    personen,
    dazunehmen: (id: string) => setDazugenommen((d) => [...d, id]),
    weglassen: (id: string) => {
      setDazugenommen((d) => d.filter((x) => x !== id));
      setFehler((f) => ({ ...f, [id]: {} }));
    },
    aendern: (formularId: string, schluessel: string, wert: FeldWert | null) => {
      setWerte((w) => ({ ...w, [formularId]: { ...w[formularId], [schluessel]: wert } }));
      setFehler((f) => (f[formularId]?.[schluessel] ? { ...f, [formularId]: { ...f[formularId], [schluessel]: "" } } : f));
    },
    /** Prueft im Browser mit demselben Auswerter wie der Server; null = alles in Ordnung. */
    pruefen: (): string | null => {
      const neu: Record<string, Record<string, string>> = {};
      let erster: string | null = null;
      for (const a of aktiv) {
        const f = pruefeWerte(a.definition, werte[a.id] ?? {}, { heute: heuteBerlin() });
        neu[a.id] = Object.fromEntries(f.map((x) => [x.schluessel, x.meldung]));
        if (f.length && !erster) erster = `${a.name}: bitte die markierten Felder prüfen.`;
      }
      setFehler(neu);
      return erster;
    },
    eingaben: (): AngeheftetesProtokollEingabe[] => aktiv.map((a) => ({ formularId: a.id, werte: werte[a.id] ?? {} })),
    /** Feldfehler des Servers dem richtigen Formular zuordnen. */
    serverFehler: (err: unknown) => {
      if (err instanceof ApiFehler && err.zusatz.formularId && err.fehler) {
        const id = err.zusatz.formularId;
        setFehler((f) => ({ ...f, [id]: Object.fromEntries(err.fehler!.map((x) => [x.schluessel, x.meldung])) }));
      }
    },
  };
}

export type AngehefteteFormulareZustand = ReturnType<typeof useAngehefteteFormulare>;

export function AngehefteteFormulare({ z }: { z: AngehefteteFormulareZustand }) {
  const zumDazunehmen = z.angebote.filter((a) => a.modus === "dazunehmen" && !z.aktiv.includes(a));
  if (z.angebote.length === 0) return null;
  return (
    <div className="zv-angeheftet">
      {z.aktiv.map((a) => (
        <fieldset key={a.id} className="zv-angeheftet-formular">
          <legend>
            {a.name}
            {a.pflicht && <span className="zv-pill zv-pill-frist zv-protokoll-pill">Pflicht</span>}
          </legend>
          {a.modus === "dazunehmen" && (
            <button type="button" className="zv-icon-btn zv-angeheftet-weg" aria-label={`${a.name} wieder weglassen`} title="Weglassen" onClick={() => z.weglassen(a.id)}>
              <IAbbrechen size={16} />
            </button>
          )}
          {a.beschreibung && <p className="zv-protokoll-hilfe">{a.beschreibung}</p>}
          <ProtokollEingabe
            definition={a.definition}
            werte={z.werte[a.id] ?? {}}
            anzeige={a.anzeige}
            personen={{}}
            auswahlPersonen={z.personen}
            fehler={Object.fromEntries(Object.entries(z.fehler[a.id] ?? {}).filter(([, m]) => m))}
            idPraefix={`${a.id}-`}
            onAendern={(s, w) => z.aendern(a.id, s, w)}
          />
        </fieldset>
      ))}
      {zumDazunehmen.length > 0 && (
        <div className="zv-angeheftet-dazu">
          {zumDazunehmen.map((a) => (
            <button key={a.id} type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => z.dazunehmen(a.id)}>
              <INeu size={14} />
              {a.name} dazunehmen
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
