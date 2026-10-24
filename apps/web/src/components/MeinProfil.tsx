import { FormEvent, useEffect, useState } from "react";
import { KONTAKTART_LABEL, type KontaktArt, type MitarbeiterProfilEigenDto, type ProfilSichtbarkeitDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { IFehler, IInfo, ISpeichern } from "./icons";

type Gruppe = keyof ProfilSichtbarkeitDto;

/**
 * Eigenes Profil pflegen und je Gruppe festlegen, wer es sehen darf.
 * Kolleg:innen sehen immer alles -- die Schalter betreffen nur Klient:innen.
 * Voreinstellung ist "nichts freigegeben" (siehe migrations/0058).
 */
export function MeinProfil() {
  const [profil, setProfil] = useState<MitarbeiterProfilEigenDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    api
      .profilEigenes()
      .then(setProfil)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Das Profil konnte nicht geladen werden."));
  }, []);

  if (!profil) return fehler ? <div className="zv-hinweis zv-hinweis-fehler"><IFehler />{fehler}</div> : <p className="zv-sub">Wird geladen…</p>;

  function aendern(teil: Partial<MitarbeiterProfilEigenDto>) {
    setGespeichert(false);
    setProfil((p) => (p ? { ...p, ...teil } : p));
  }

  // "Alle anderen" setzt "Bezugsbetreuung" voraus -- die Datenbank erzwingt das
  // ebenfalls, hier wird nur verhindert, dass man in diesen Fehler laeuft.
  function freigabe(gruppe: Gruppe, art: "zugeordnet" | "andere", an: boolean) {
    setProfil((p) => {
      if (!p) return p;
      const alt = p.sichtbarkeit[gruppe];
      const neu = { ...alt, [art]: an };
      if (art === "andere" && an) neu.zugeordnet = true;
      if (art === "zugeordnet" && !an) neu.andere = false;
      return { ...p, sichtbarkeit: { ...p.sichtbarkeit, [gruppe]: neu } };
    });
    setGespeichert(false);
  }

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profil) return;
    setFehler(null);
    setLaeuft(true);
    try {
      setProfil(await api.profilEigenesSpeichern(profil));
      setGespeichert(true);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das Profil konnte nicht gespeichert werden.");
    } finally {
      setLaeuft(false);
    }
  }

  const feld = (wert: string | null) => wert ?? "";
  const leerNull = (wert: string) => (wert.trim() === "" ? null : wert);

  function freigaben(gruppe: Gruppe) {
    const f = profil!.sichtbarkeit[gruppe];
    return (
      <div className="zv-profil-freigabe">
        <label className="zv-checkbox-zeile">
          <input type="checkbox" checked={f.zugeordnet} onChange={(e) => freigabe(gruppe, "zugeordnet", e.target.checked)} />
          Meine Klient:innen (Bezugsbetreuung)
        </label>
        <label className="zv-checkbox-zeile">
          <input type="checkbox" checked={f.andere} onChange={(e) => freigabe(gruppe, "andere", e.target.checked)} />
          Alle anderen, die mich sehen können
        </label>
      </div>
    );
  }

  return (
    <form className="zv-card zv-card-weit" onSubmit={speichern}>
      <h3 style={{ marginTop: 0 }}>Mein Profil</h3>
      <div className="zv-hinweis zv-hinweis-info">
        <IInfo />
        Kolleg:innen sehen alle diese Angaben. Klient:innen sehen nur, was du ausdrücklich freigibst — getrennt für deine
        Klient:innen (Bezugsbetreuung) und für alle anderen, die dich über Chat oder Standort ohnehin sehen können.
        Vorgabe: nichts ist freigegeben.
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-field">
        <label htmlFor="profil-telefon">Telefon (dienstlich)</label>
        <input id="profil-telefon" maxLength={40} value={feld(profil.telefon)} onChange={(e) => aendern({ telefon: leerNull(e.target.value) })} />
      </div>
      {freigaben("telefon")}

      <div className="zv-field-row">
        <div className="zv-field">
          <label htmlFor="profil-kontaktart">Am liebsten per</label>
          <select
            id="profil-kontaktart"
            value={profil.bevorzugteKontaktart ?? ""}
            onChange={(e) => aendern({ bevorzugteKontaktart: (e.target.value || null) as KontaktArt | null })}
          >
            <option value="">Keine Angabe</option>
            {(Object.keys(KONTAKTART_LABEL) as KontaktArt[]).map((k) => (
              <option key={k} value={k}>
                {KONTAKTART_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="zv-field">
          <label htmlFor="profil-erreichbar">Erreichbarkeit</label>
          <input
            id="profil-erreichbar"
            maxLength={200}
            placeholder="z. B. Mo–Fr 8–16 Uhr"
            value={feld(profil.erreichbarkeit)}
            onChange={(e) => aendern({ erreichbarkeit: leerNull(e.target.value) })}
          />
        </div>
      </div>
      {freigaben("kontakt")}

      <div className="zv-field">
        <label htmlFor="profil-email">Dienstliche E-Mail</label>
        <input
          id="profil-email"
          type="email"
          maxLength={200}
          value={feld(profil.emailDienstlich)}
          onChange={(e) => aendern({ emailDienstlich: leerNull(e.target.value) })}
        />
      </div>
      {freigaben("email")}

      <div className="zv-field">
        <label htmlFor="profil-ueber">Über mich</label>
        <textarea
          id="profil-ueber"
          rows={4}
          maxLength={1000}
          placeholder="Kurze Vorstellung, Sprachen, Hinweise …"
          value={feld(profil.ueberMich)}
          onChange={(e) => aendern({ ueberMich: leerNull(e.target.value) })}
        />
      </div>
      {freigaben("ueberMich")}

      <button className="zv-btn" type="submit" disabled={laeuft}>
        <ISpeichern />
        {laeuft ? "Speichert…" : gespeichert ? "Gespeichert" : "Speichern"}
      </button>
    </form>
  );
}
