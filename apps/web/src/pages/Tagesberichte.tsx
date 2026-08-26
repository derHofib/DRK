import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { KlientListEintragDto, TagDto, TagesberichtDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IAbbrechen, IFehler, ILeerTagesberichte, INeu, ISpeichern, ITag } from "../components/icons";

/**
 * Zeile eines Tagesberichts -- wird sowohl vom allgemeinen Menuepunkt hier
 * (zeigeKlient=true, Klient als Titel-Spalte) als auch vom Tab in der
 * Klientenakte (zeigeKlient=false, Datum als Titel-Spalte, kein
 * Klient-Feld noetig) verwendet. Tags lassen sich direkt in der Zeile
 * entfernen und ueber ein kleines Eingabefeld nachtraeglich hinzufuegen --
 * "kann kein muss, kann auch nachtraeglich hinzugefuegt werden".
 */
export function TagesberichtZeile({
  bericht,
  zeigeKlient,
  onTagEntfernen,
  onTagHinzufuegen,
}: {
  bericht: TagesberichtDto;
  zeigeKlient: boolean;
  onTagEntfernen: (tagId: string) => void;
  onTagHinzufuegen: (name: string) => void;
}) {
  const [neuerTag, setNeuerTag] = useState("");

  return (
    <div className="zv-info-karte">
      <span className="zv-liste-zelle-titel">{zeigeKlient ? bericht.klientName : bericht.datum}</span>
      {zeigeKlient && (
        <span className="zv-liste-zelle" data-label="Datum">
          <strong>{bericht.datum}</strong>
        </span>
      )}
      <span className="zv-liste-zelle" data-label="Bericht">
        {bericht.text}
        {bericht.autorName && <div className="zv-sub-inline">Verfasst von {bericht.autorName}</div>}
      </span>
      <span className="zv-liste-zelle" data-label="Tags">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {bericht.tags.map((t) => (
            <span key={t.id} className="zv-pill zv-pill-info">
              <ITag />
              {t.name}
              <button
                type="button"
                aria-label={`Tag ${t.name} entfernen`}
                onClick={() => onTagEntfernen(t.id)}
                style={{
                  display: "inline-flex",
                  background: "none",
                  border: "none",
                  padding: 0,
                  marginLeft: 2,
                  cursor: "pointer",
                  color: "inherit",
                }}
              >
                <IAbbrechen style={{ width: 12, height: 12 }} />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onTagHinzufuegen(neuerTag);
              setNeuerTag("");
            }}
            style={{ display: "inline-flex" }}
          >
            <input
              value={neuerTag}
              onChange={(e) => setNeuerTag(e.target.value)}
              list="zv-tag-vorschlaege"
              placeholder="+ Tag"
              aria-label="Tag hinzufügen"
              style={{
                width: 90,
                fontSize: "var(--zv-text-xs)",
                padding: "2px 6px",
                border: "1px solid var(--zv-border)",
                borderRadius: "var(--zv-radius-s)",
                background: "var(--zv-bg)",
                color: "var(--zv-text)",
              }}
            />
          </form>
        </div>
      </span>
    </div>
  );
}

export function TagVorschlaegeDatalist({ tags }: { tags: TagDto[] }) {
  return (
    <datalist id="zv-tag-vorschlaege">
      {tags.map((t) => (
        <option key={t.id} value={t.name} />
      ))}
    </datalist>
  );
}

export function Tagesberichte() {
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [tagVorschlaege, setTagVorschlaege] = useState<TagDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);

  function laden() {
    api.tagesberichteListe().then(setBerichte).catch((err) => setFehler(err.message));
    api.tagsListe().then(setTagVorschlaege).catch(() => {});
  }

  useEffect(() => {
    laden();
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
  }, []);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const tagsText = String(form.get("tags") ?? "");
    setFormFehler(null);
    try {
      await api.tagesberichtAnlegen({
        klientId: String(form.get("klientId")),
        datum: String(form.get("datum")),
        text: String(form.get("text")),
        tagNamen: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Tagesbericht konnte nicht angelegt werden.");
    }
  }

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

  const heute = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Tagesberichte</h2>
        <button
          className="zv-btn"
          onClick={() => {
            setFormFehler(null);
            setFormularOffen(true);
          }}
        >
          <INeu />
          Neuer Bericht
        </button>
      </div>

      {formularOffen && (
        <Modal titel="Neuer Tagesbericht" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Klient</label>
                <select name="klientId" required autoFocus defaultValue="">
                  <option value="" disabled>
                    Bitte wählen
                  </option>
                  {klienten.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.vorname} {k.nachname}
                    </option>
                  ))}
                </select>
              </div>
              <div className="zv-field">
                <label>Datum</label>
                <input name="datum" type="date" required defaultValue={heute} />
              </div>
            </div>
            <div className="zv-field">
              <label>Bericht</label>
              <textarea name="text" required rows={5} />
            </div>
            <div className="zv-field">
              <label>Tags (optional, durch Komma getrennt)</label>
              <input name="tags" placeholder="z. B. Beobachtung, Freizeit" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      <TagVorschlaegeDatalist tags={tagVorschlaege} />

      {berichte.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>Noch keine Tagesberichte erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.3fr 1fr 3fr 1.8fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Klient</span>
            <span>Datum</span>
            <span>Bericht</span>
            <span>Tags</span>
          </div>
          {berichte.map((b) => (
            <TagesberichtZeile
              key={b.id}
              bericht={b}
              zeigeKlient
              onTagEntfernen={(tagId) => tagEntfernen(b.id, tagId)}
              onTagHinzufuegen={(name) => tagHinzufuegen(b.id, name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
