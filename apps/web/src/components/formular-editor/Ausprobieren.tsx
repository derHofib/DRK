import { useMemo, useState } from "react";
import {
  alleBausteine,
  istEingabe,
  pruefeWerte,
  type FeldWert,
  type FeldWerte,
  type FormularDefinition,
} from "@zimmerakte/shared";
import { ProtokollEingabe } from "../ProtokollFormular";
import { IBestaetigen } from "../icons";
import { BEISPIEL } from "./baum";

/** Wie beim Ausfuellen, mit erfundener Beispiel-Klient:in. Nichts davon wird gespeichert. */
export function Ausprobieren({ definition }: { definition: FormularDefinition }) {
  const start = useMemo(() => {
    const w: FeldWerte = {};
    for (const b of alleBausteine(definition)) {
      if (istEingabe(b) && b.vorausfuellen) {
        const v = BEISPIEL[b.vorausfuellen.quelle];
        w[b.schluessel] = b.typ === "zahl" ? Number(v) || null : v;
      }
    }
    return w;
  }, [definition]);
  const [werte, setWerte] = useState<FeldWerte>(start);
  const [fehler, setFehler] = useState<Record<string, string>>({});
  const [geprueft, setGeprueft] = useState(false);
  const anzeige = useMemo(() => {
    const a: Record<string, string> = {};
    for (const b of alleBausteine(definition)) if (b.typ === "anzeige") a[b.schluessel] = BEISPIEL[b.quelle];
    return a;
  }, [definition]);

  function pruefen() {
    const f = pruefeWerte(definition, werte, { heute: BEISPIEL["zeit.heute"] });
    setFehler(Object.fromEntries(f.map((x) => [x.schluessel, x.meldung])));
    setGeprueft(true);
  }

  return (
    <div className="zv-fe-probe">
      <p className="zv-hinweis zv-hinweis-info">Probelauf mit der erfundenen Klient:in „Erika Beispiel“. Es wird nichts gespeichert.</p>
      <ProtokollEingabe
        definition={definition}
        werte={werte}
        anzeige={anzeige}
        personen={{}}
        auswahlPersonen={[
          { id: "00000000-0000-4000-8000-000000000001", name: "Max Muster" },
          { id: "00000000-0000-4000-8000-000000000002", name: "Mia Probe" },
        ]}
        fehler={fehler}
        idPraefix="probe-"
        onAendern={(s: string, w: FeldWert | null) => {
          setWerte((alt) => ({ ...alt, [s]: w }));
          setGeprueft(false);
        }}
      />
      <div className="zv-protokoll-leiste">
        {geprueft && Object.keys(fehler).length === 0 && (
          <span className="zv-protokoll-status">
            <IBestaetigen size={14} /> So ließe sich das Protokoll abschließen.
          </span>
        )}
        <button
          type="button"
          className="zv-btn zv-btn-still zv-btn-klein"
          onClick={() => {
            setWerte(start);
            setFehler({});
            setGeprueft(false);
          }}
        >
          Zurücksetzen
        </button>
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={pruefen}>
          Abschließen prüfen
        </button>
      </div>
    </div>
  );
}
