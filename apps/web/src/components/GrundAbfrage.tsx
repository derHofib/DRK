import { FormEvent, useState } from "react";
import { Modal } from "./Modal";
import { IBestaetigen } from "./icons";

/**
 * Ersetzt window.prompt() fuer eine kurze Begruendung (Ablehnung,
 * Storno-Antrag). window.prompt() wird in installierten PWAs -- vor allem
 * unter iOS im Standalone-Modus -- haeufig unterdrueckt oder ganz ignoriert
 * und folgt ausserdem nicht den Design-Tokens (siehe CLAUDE.md, Regel 7).
 * Ueberall dort, wo bisher prompt() stand (Zimmer.tsx, Kassenbuch.tsx,
 * KlientDetail.tsx), steht seitdem dieses Modal.
 */
export function GrundAbfrage({
  titel,
  label,
  bestaetigenText = "Bestätigen",
  onBestaetigen,
  onAbbrechen,
}: {
  titel: string;
  label: string;
  bestaetigenText?: string;
  onBestaetigen: (grund: string) => void;
  onAbbrechen: () => void;
}) {
  const [grund, setGrund] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const bereinigt = grund.trim();
    if (!bereinigt) return;
    onBestaetigen(bereinigt);
  }

  return (
    <Modal titel={titel} onClose={onAbbrechen}>
      <form onSubmit={submit}>
        <div className="zv-field">
          <label htmlFor="grund-abfrage-eingabe">{label}</label>
          <textarea
            id="grund-abfrage-eingabe"
            value={grund}
            onChange={(e) => setGrund(e.target.value)}
            rows={3}
            autoFocus
            required
          />
        </div>
        <button className="zv-btn zv-btn-block" type="submit">
          <IBestaetigen />
          {bestaetigenText}
        </button>
      </form>
    </Modal>
  );
}
