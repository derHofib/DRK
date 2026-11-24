import type { InputHTMLAttributes } from "react";
import { ISichtbar, IVerborgen } from "./icons";

/**
 * Passwortfeld mit Augen-Knopf zum Anzeigen. Stand vorher viermal wortgleich
 * in Login, Passwort-Reset, Klient-Einladung und E-Mail-Änderung; eine
 * Korrektur (z. B. am aria-label) musste an allen vier Stellen landen.
 *
 * Die Sichtbarkeit kommt von außen: auf den Seiten mit Wiederholungsfeld
 * schaltet derselbe Knopf beide Felder um.
 */
export function PasswortEingabe({
  sichtbar,
  onSichtbarWechseln,
  ...eingabe
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { sichtbar: boolean; onSichtbarWechseln: () => void }) {
  return (
    <div style={{ position: "relative" }}>
      <input {...eingabe} type={sichtbar ? "text" : "password"} style={{ paddingRight: 44 }} />
      {/* Rein ikonisch, deshalb zwingend mit aria-label. */}
      <button
        type="button"
        className="zv-icon-btn"
        style={{ position: "absolute", right: 3, top: 3 }}
        onClick={onSichtbarWechseln}
        aria-label={sichtbar ? "Passwort verbergen" : "Passwort anzeigen"}
        title={sichtbar ? "Passwort verbergen" : "Passwort anzeigen"}
      >
        {sichtbar ? <IVerborgen /> : <ISichtbar />}
      </button>
    </div>
  );
}
