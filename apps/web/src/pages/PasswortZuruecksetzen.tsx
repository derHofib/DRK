import { api } from "../api/client";
import { PasswortFestlegen } from "../components/PasswortFestlegen";

/**
 * Zweite Haelfte des "Leitung stoesst Reset an, sieht aber nur einen
 * Link"-Flusses: wer hier landet, ist per Definition ausgesperrt und daher
 * NICHT eingeloggt -- diese Seite laeuft unabhaengig vom normalen
 * Login/Shell-Zustand (siehe App.tsx). Das neue Passwort waehlt aus-
 * schliesslich die Person selbst, die den Link geoeffnet hat.
 */
export function PasswortZuruecksetzen({ token }: { token: string }) {
  return (
    <PasswortFestlegen
      texte={{
        untertitel: "Neues Passwort festlegen",
        wiederholungLabel: "Neues Passwort wiederholen",
        abweichung: "Die beiden Passwörter stimmen nicht überein.",
        erledigtUntertitel: "Neues Passwort gesetzt",
        erledigtText: "Dein Passwort wurde geändert. Du kannst dich jetzt damit anmelden.",
      }}
      einloesen={(passwort) => api.passwortResetEinloesen(token, passwort)}
      fehlerText={(err) => (err instanceof Error ? err.message : "Link ungültig oder abgelaufen.")}
      onFertig={zurAnmeldung}
    />
  );
}

// Entfernt den Token aus der URL, bevor es zur normalen Anmeldung geht --
// der Token ist ohnehin schon verbraucht, aber ein Lesezeichen auf diese
// URL soll trotzdem nicht dauerhaft ein (totes) Reset-Formular zeigen.
function zurAnmeldung() {
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  window.history.replaceState({}, "", url.toString());
  window.location.reload();
}
