import { FormEvent, useEffect, useState } from "react";
import type { AufgabeDto, AufgabePrioritaet, BenutzerListEintragDto } from "@zimmerakte/shared";
import { api, tokenBenutzerId, tokenRolle } from "../api/client";
import { AufgabeZeile } from "../components/AufgabeZeile";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IFehler, ILeerAufgaben, INeu, ISpeichern } from "../components/icons";

/**
 * Sonntag der laufenden Woche (ISO-Woche startet Montag) -- alles bis
 * einschliesslich diesem Datum faellt unter "diese Woche", alles danach
 * unter "später". Die Vorgabe nennt nur vier Gruppen (überfällig/heute/
 * diese Woche/ohne Termin) -- "später" kommt bewusst dazu, damit eine
 * Aufgabe mit fernem Fälligkeitsdatum nicht kommentarlos verschwindet.
 */
function endeDieserWoche(): string {
  const heute = new Date();
  const wochentag = heute.getDay(); // 0 = Sonntag .. 6 = Samstag
  const tageBisSonntag = wochentag === 0 ? 0 : 7 - wochentag;
  const ende = new Date(heute);
  ende.setDate(heute.getDate() + tageBisSonntag);
  return ende.toISOString().slice(0, 10);
}

function gruppiere(aufgaben: AufgabeDto[]) {
  const heuteStr = new Date().toISOString().slice(0, 10);
  const wochenEnde = endeDieserWoche();
  const gruppen: Record<"ueberfaellig" | "heute" | "dieseWoche" | "spaeter" | "ohneTermin", AufgabeDto[]> = {
    ueberfaellig: [],
    heute: [],
    dieseWoche: [],
    spaeter: [],
    ohneTermin: [],
  };
  for (const a of aufgaben) {
    if (!a.faelligAm) gruppen.ohneTermin.push(a);
    else if (a.faelligAm < heuteStr) gruppen.ueberfaellig.push(a);
    else if (a.faelligAm === heuteStr) gruppen.heute.push(a);
    else if (a.faelligAm <= wochenEnde) gruppen.dieseWoche.push(a);
    else gruppen.spaeter.push(a);
  }
  return gruppen;
}

const GRUPPEN_LABEL = {
  ueberfaellig: "Überfällig",
  heute: "Heute",
  dieseWoche: "Diese Woche",
  spaeter: "Später",
  ohneTermin: "Ohne Termin",
} as const;

export function Aufgaben() {
  const benutzerId = tokenBenutzerId();
  const rolle = tokenRolle();

  const [aufgaben, setAufgaben] = useState<AufgabeDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  function laden() {
    // nurEigene deckt beide in der Vorgabe genannten Faelle ab (zugewiesene
    // UND eigene persoenliche Aufgaben) -- und zusaetzlich den Randfall
    // "Zimmer-Aufgabe von mir angelegt, an jemand anderen zugewiesen":
    // bewusst mit eingeschlossen, damit der Ueberblick auch selbst
    // angestossene Arbeit zeigt, nicht nur das, was an einem selbst haengt.
    api.aufgabenListe({ nurEigene: true, offen: true }).then(setAufgaben).catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    laden();
    api.benutzerListe().then(setBenutzerListe).catch(() => {});
  }, []);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      const faelligAm = String(form.get("faelligAm") ?? "");
      const zugewiesenAn = String(form.get("zugewiesenAn") ?? "");
      await api.aufgabeAnlegen({
        titel: String(form.get("titel") ?? "").trim(),
        beschreibung: String(form.get("beschreibung") ?? "").trim() || undefined,
        prioritaet: form.get("prioritaet") as AufgabePrioritaet,
        faelligAm: faelligAm || undefined,
        zugewiesenAn: zugewiesenAn || undefined,
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Aufgabe konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function erledigen(id: string) {
    try {
      await api.aufgabeErledigen(id);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Aufgabe konnte nicht erledigt werden.");
    }
  }

  async function zuweisenAendern(id: string, zugewiesenAn: string | null) {
    try {
      await api.aufgabeAktualisieren(id, { zugewiesenAn });
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zuweisung konnte nicht geändert werden.");
    }
  }

  async function loeschen(id: string) {
    try {
      await api.aufgabeLoeschen(id);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Aufgabe konnte nicht gelöscht werden.");
    }
  }

  const gruppen = gruppiere(aufgaben);
  const reihenfolge = ["ueberfaellig", "heute", "dieseWoche", "spaeter", "ohneTermin"] as const;

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Aufgaben</h2>
        <button
          className="zv-btn"
          onClick={() => {
            setFormFehler(null);
            setFormularOffen(true);
          }}
        >
          <INeu />
          Neue Aufgabe
        </button>
      </div>

      {aufgaben.length === 0 && !fehler && (
        <Leerzustand icon={ILeerAufgaben}>Keine offenen Aufgaben -- weder zugewiesen noch persönlich angelegt.</Leerzustand>
      )}

      {reihenfolge.map((schluessel) => {
        const liste = gruppen[schluessel];
        if (liste.length === 0) return null;
        return (
          <div key={schluessel} style={{ marginBottom: 24 }}>
            <h3 className="zv-etagen-kopf">
              {GRUPPEN_LABEL[schluessel]} ({liste.length})
            </h3>
            <div className="zv-karten-liste">
              {liste.map((a) => (
                <AufgabeZeile
                  key={a.id}
                  aufgabe={a}
                  benutzerListe={benutzerListe}
                  aktuelleBenutzerId={benutzerId}
                  aktuelleRolle={rolle}
                  zeigeZimmer
                  onErledigen={() => erledigen(a.id)}
                  onZuweisenAendern={(zid) => zuweisenAendern(a.id, zid)}
                  onLoeschen={() => loeschen(a.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {formularOffen && (
        <Modal titel="Neue Aufgabe" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="aufgabe-titel">Titel</label>
              <input id="aufgabe-titel" name="titel" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="aufgabe-beschreibung">Beschreibung (optional)</label>
              <textarea id="aufgabe-beschreibung" name="beschreibung" rows={3} />
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="aufgabe-prioritaet">Priorität</label>
                <select id="aufgabe-prioritaet" name="prioritaet" defaultValue="normal">
                  <option value="niedrig">Niedrig</option>
                  <option value="normal">Normal</option>
                  <option value="hoch">Hoch</option>
                </select>
              </div>
              <div className="zv-field">
                <label htmlFor="aufgabe-faelligkeit">Fälligkeit (optional)</label>
                <input id="aufgabe-faelligkeit" name="faelligAm" type="date" />
              </div>
            </div>
            <div className="zv-field">
              <label htmlFor="aufgabe-zuweisen">Zuweisen an (optional)</label>
              <select id="aufgabe-zuweisen" name="zugewiesenAn" defaultValue="">
                <option value="">Niemand -- nur für mich</option>
                {benutzerListe.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.id === benutzerId ? " (ich)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
