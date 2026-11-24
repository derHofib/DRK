import { ApiFehler, api } from "../../api/client";
import { LINK_UNGUELTIG, PasswortFestlegen } from "../../components/PasswortFestlegen";

/**
 * Einladungslink einloesen: laeuft wie die Reset-Seite unabhaengig vom
 * Login-Zustand (siehe App.tsx). Das Passwort waehlt nur die Person selbst,
 * die den Link oeffnet.
 */
export function KlientEinladung({ token, onFertig }: { token: string; onFertig: () => void }) {
  return (
    <PasswortFestlegen
      texte={{
        untertitel: "Passwort festlegen",
        einleitung: "Willkommen. Wähle ein Passwort für deinen Zugang. Es braucht mindestens 8 Zeichen.",
        wiederholungLabel: "Passwort noch einmal",
        abweichung: "Die beiden Passwörter sind nicht gleich.",
        zuKurz: "Das Passwort braucht mindestens 8 Zeichen.",
        erledigtUntertitel: "Passwort festgelegt",
        erledigtText:
          "Dein Passwort ist gespeichert. Du kannst dich jetzt anmelden. Die Träger-Kennung steht in deiner Einladung oder du fragst deine Betreuung.",
      }}
      einloesen={(passwort) => api.klientEinladungEinloesen(token, passwort)}
      // 401 = Link unbekannt, abgelaufen oder schon benutzt (der Server unterscheidet das bewusst nicht).
      fehlerText={(err) =>
        err instanceof ApiFehler && err.status === 401 ? LINK_UNGUELTIG : err instanceof Error ? err.message : LINK_UNGUELTIG
      }
      onFertig={onFertig}
    />
  );
}
