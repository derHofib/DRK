import { CSSProperties, FormEvent, useState } from "react";
import type { KlientKontaktDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import { Modal } from "../../components/Modal";
import { IBearbeiten, IFehler, ILeerKontakte, ILoeschen, INeu, ISpeichern } from "../../components/icons";

export function KontakteAbschnitt({
  klientId,
  kontakte,
  onGeaendert,
}: {
  klientId: string;
  kontakte: KlientKontaktDto[];
  onGeaendert: () => void;
}) {
  const [formularOffen, setFormularOffen] = useState(false);
  const [bearbeitenKontakt, setBearbeitenKontakt] = useState<KlientKontaktDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function hinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientKontaktHinzufuegen(klientId, {
        beziehung: String(form.get("beziehung") ?? "") || undefined,
        name: String(form.get("name") ?? ""),
        adresse: String(form.get("adresse") ?? "") || undefined,
        email: String(form.get("email") ?? "") || undefined,
        telefon: String(form.get("telefon") ?? "") || undefined,
      });
      setFormularOffen(false);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kontakt konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function aktualisieren(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeitenKontakt) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientKontaktAktualisieren(klientId, bearbeitenKontakt.id, {
        beziehung: String(form.get("beziehung") ?? ""),
        name: String(form.get("name") ?? ""),
        adresse: String(form.get("adresse") ?? ""),
        email: String(form.get("email") ?? ""),
        telefon: String(form.get("telefon") ?? ""),
      });
      setBearbeitenKontakt(null);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kontakt konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function loeschen(kontaktId: string) {
    setFehler(null);
    try {
      await api.klientKontaktLoeschen(klientId, kontaktId);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kontakt konnte nicht gelöscht werden.");
    }
  }

  return (
    <div className="zv-card zv-card-weit">
      <div className="zv-seiten-kopf" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Kontakte</h3>
        <button className="zv-btn" onClick={() => setFormularOffen(true)}>
          <INeu />
          Kontakt hinzufügen
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {kontakte.length === 0 ? (
        <Leerzustand icon={ILeerKontakte}>Noch keine Kontakte erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.2fr 1.4fr 1.8fr 1.4fr 1.4fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Beziehung</span>
            <span>Name</span>
            <span>Adresse</span>
            <span>Kontakt</span>
            <span></span>
          </div>
          {kontakte.map((k) => (
            <div key={k.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{k.beziehung || "–"}</span>
              <span className="zv-liste-zelle" data-label="Name">
                <strong>{k.name}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Adresse">
                {k.adresse || "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Kontakt">
                {k.telefon || "–"}
                {k.email && <span className="zv-sub-inline">{k.email}</span>}
              </span>
              <span className="zv-liste-zelle-aktionen">
                <button className="zv-link-btn" onClick={() => setBearbeitenKontakt(k)}>
                  <IBearbeiten />
                  Bearbeiten
                </button>
                <button className="zv-link-btn" onClick={() => loeschen(k.id)}>
                  <ILoeschen />
                  Löschen
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {formularOffen && (
        <Modal titel="Kontakt hinzufügen" onClose={() => setFormularOffen(false)}>
          <form onSubmit={hinzufuegen}>
            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {fehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="kontakt-beziehung">Beziehung/Rolle</label>
              <input id="kontakt-beziehung" name="beziehung" placeholder="z. B. Mutter, Anwalt, Pflegefamilie" />
            </div>
            <div className="zv-field">
              <label htmlFor="kontakt-name">Name</label>
              <input id="kontakt-name" name="name" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="kontakt-adresse">Adresse</label>
              <input id="kontakt-adresse" name="adresse" />
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="kontakt-telefon">Telefon</label>
                <input id="kontakt-telefon" name="telefon" />
              </div>
              <div className="zv-field">
                <label htmlFor="kontakt-email">E-Mail</label>
                <input id="kontakt-email" name="email" type="email" />
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Hinzufügen"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeitenKontakt && (
        <Modal titel="Kontakt bearbeiten" onClose={() => setBearbeitenKontakt(null)}>
          <form onSubmit={aktualisieren}>
            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {fehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="kb-beziehung">Beziehung/Rolle</label>
              <input id="kb-beziehung" name="beziehung" defaultValue={bearbeitenKontakt.beziehung ?? ""} />
            </div>
            <div className="zv-field">
              <label htmlFor="kb-name">Name</label>
              <input id="kb-name" name="name" required autoFocus defaultValue={bearbeitenKontakt.name} />
            </div>
            <div className="zv-field">
              <label htmlFor="kb-adresse">Adresse</label>
              <input id="kb-adresse" name="adresse" defaultValue={bearbeitenKontakt.adresse ?? ""} />
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="kb-telefon">Telefon</label>
                <input id="kb-telefon" name="telefon" defaultValue={bearbeitenKontakt.telefon ?? ""} />
              </div>
              <div className="zv-field">
                <label htmlFor="kb-email">E-Mail</label>
                <input id="kb-email" name="email" type="email" defaultValue={bearbeitenKontakt.email ?? ""} />
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
