import { CSSProperties, useEffect, useState } from "react";
import type { TagDto, TagesberichtDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import { NeuerTagesberichtFenster } from "../../components/NeuerTagesbericht";
import { IFehler, ILeerTagesberichte, INeu } from "../../components/icons";
import { TagesberichtZeile, TagVorschlaegeDatalist } from "../Tagesberichte";

export function TagesberichteTab({
  klientId,
  markiert = null,
  startMitFormular = false,
  onFormularGenutzt,
}: {
  klientId: string;
  markiert?: string | null;
  startMitFormular?: boolean;
  onFormularGenutzt?: () => void;
}) {
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [tagVorschlaege, setTagVorschlaege] = useState<TagDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  // "Tagesbericht schreiben" im Kopf der Akte oeffnet direkt das Formular --
  // sonst waere der primaere Knopf nur ein Tabwechsel und ein Klick zu wenig.
  const [formularOffen, setFormularOffen] = useState(startMitFormular);
  useEffect(() => {
    if (startMitFormular) onFormularGenutzt?.();
  }, [startMitFormular, onFormularGenutzt]);

  function laden() {
    api.tagesberichteListe({ klientId }).then(setBerichte).catch((err) => setFehler(err.message));
    api.tagsListe().then(setTagVorschlaege).catch(() => {});
  }

  useEffect(laden, [klientId]);

  async function tagEntfernen(berichtId: string, tagId: string) {
    try {
      await api.tagesberichtTagEntfernen(berichtId, tagId);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Tag konnte nicht entfernt werden.");
    }
  }

  async function tagHinzufuegen(berichtId: string, name: string) {
    if (!name.trim()) return;
    try {
      await api.tagesberichtTagHinzufuegen(berichtId, name.trim());
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Tag konnte nicht hinzugefügt werden.");
    }
  }

  async function dokumentHinzufuegen(berichtId: string, base64: string, dateiname: string, mimeType: string) {
    try {
      await api.tagesberichtDokumentHinzufuegen(berichtId, { base64, dateiname, mimeType });
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Dokument konnte nicht hinzugefügt werden.");
    }
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Tagesberichte</h3>
        <button className="zv-btn" onClick={() => setFormularOffen(true)}>
          <INeu />
          Neuer Tagesbericht
        </button>
      </div>

      {formularOffen && (
        <NeuerTagesberichtFenster
          klientId={klientId}
          onClose={() => setFormularOffen(false)}
          onAngelegt={() => {
            setFormularOffen(false);
            laden();
          }}
        />
      )}

      <TagVorschlaegeDatalist tags={tagVorschlaege} />

      {berichte.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>Noch keine Tagesberichte für diese Klient:in erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.9fr 2.6fr 1.5fr 1.5fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Datum</span>
            <span>Bericht</span>
            <span>Tags</span>
            <span>Dokumente</span>
          </div>
          {berichte.map((b) => (
            <TagesberichtZeile
              key={b.id}
              bericht={b}
              zeigeKlient={false}
              markiert={b.id === markiert}
              onTagEntfernen={(tagId) => tagEntfernen(b.id, tagId)}
              onTagHinzufuegen={(name) => tagHinzufuegen(b.id, name)}
              onDokumentHinzufuegen={(base64, dateiname, mimeType) => dokumentHinzufuegen(b.id, base64, dateiname, mimeType)}
              onGeaendert={laden}
            />
          ))}
        </div>
      )}
    </div>
  );
}
