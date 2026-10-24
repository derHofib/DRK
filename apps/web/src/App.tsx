import { useEffect, useState } from "react";
import { aufSitzungAbgelaufen, clearToken, getToken, istKlientToken } from "./api/client";
import { ChatEreignisProvider } from "./components/chat/ereignisse";
import { Login } from "./pages/Login";
import { PasswortZuruecksetzen } from "./pages/PasswortZuruecksetzen";
import { HzlUebergabe, UebergabeStart, uebergabeLesen, uebergabeMerken } from "./pages/HzlUebergabe";
import { zuletztLoeschen } from "./components/Befehlspalette";
import { Shell } from "./pages/Shell";
import { KlientEinladung } from "./pages/klient/KlientEinladung";
import { KlientEmailAendern } from "./pages/klient/KlientEmailAendern";
import { KlientShell } from "./pages/klient/KlientShell";

/** Query-Parameter, die einen Link-Einstieg kennzeichnen; nach dem Einloesen werden sie aus der URL entfernt. */
const LINK_PARAMETER = ["reset", "klient-einladung", "klient-email"];

function parameterEntfernen() {
  const url = new URL(window.location.href);
  for (const p of LINK_PARAMETER) url.searchParams.delete(p);
  window.history.replaceState({}, "", url.toString());
}

export function App() {
  const [angemeldet, setAngemeldet] = useState(() => Boolean(getToken()));
  // Live-Rueckmeldung: ein abgelaufener Token soll sofort zur Login-Seite
  // zurueckschalten (statt der bisherigen Inline-Fehlermeldung mitten in
  // der laufenden Seite), mit einer kurzen Erklaerung statt stillschweigend.
  const [sitzungAbgelaufen, setSitzungAbgelaufen] = useState(false);
  // Link-Einstiege lesen ihren Token einmal beim Start; danach steht er nur noch im State.
  const [klientEinladung, setKlientEinladung] = useState(() => new URLSearchParams(window.location.search).get("klient-einladung"));
  const [klientEmail, setKlientEmail] = useState(() => new URLSearchParams(window.location.search).get("klient-email"));
  const [startAlsKlient, setStartAlsKlient] = useState(false);
  // Uebergabemodus ERSETZT die Shell (statt sie zu verdecken): die Navigation
  // ist dann nicht im DOM. Der Zustand steht in sessionStorage, damit Neuladen
  // nicht aus dem Modus herausfuehrt.
  const [uebergabe, setUebergabe] = useState<UebergabeStart | null>(() => uebergabeLesen());

  useEffect(() => {
    aufSitzungAbgelaufen((warKlient) => {
      // Klient:innen sollen nach einer abgelaufenen Sitzung wieder in ihrer Anmeldung landen, nicht in der der Mitarbeitenden.
      setStartAlsKlient(warKlient);
      uebergabeMerken(null);
      zuletztLoeschen();
      setUebergabe(null);
      setSitzungAbgelaufen(true);
      setAngemeldet(false);
    });
  }, []);

  // Kein Router im Einsatz (siehe apps/web/nginx.conf) -- ein Reset-Link
  // traegt seinen Token deshalb als schlichter Query-Parameter. Greift
  // unabhaengig vom Login-Zustand: wer hier landet, ist per Definition
  // ausgesperrt.
  const resetToken = new URLSearchParams(window.location.search).get("reset");
  if (resetToken) {
    return <PasswortZuruecksetzen token={resetToken} />;
  }

  // Nach dem Einloesen geht es zur Klient-Anmeldung. Eine noch gespeicherte
  // (fremde) Sitzung wird dafuer beendet, sonst bliebe der Login unsichtbar.
  function zurKlientAnmeldung() {
    parameterEntfernen();
    clearToken();
    setAngemeldet(false);
    setKlientEinladung(null);
    setKlientEmail(null);
    setStartAlsKlient(true);
  }

  if (klientEinladung) return <KlientEinladung token={klientEinladung} onFertig={zurKlientAnmeldung} />;
  if (klientEmail) return <KlientEmailAendern token={klientEmail} onFertig={zurKlientAnmeldung} />;

  if (!angemeldet) {
    return (
      <Login
        onLoggedIn={() => {
          setSitzungAbgelaufen(false);
          setAngemeldet(true);
        }}
        sitzungAbgelaufen={sitzungAbgelaufen}
        startAlsKlient={startAlsKlient}
      />
    );
  }

  // Die Shell der Mitarbeitenden wuerde mit einem Klient-Token nur 401 ernten
  // und die Sitzung selbst beenden -- die Wahl hier faellt deshalb am Token.
  return (
    <ChatEreignisProvider>
      {!istKlientToken() && uebergabe ? (
        <HzlUebergabe start={uebergabe} onBeendet={() => setUebergabe(null)} />
      ) : istKlientToken() ? (
        <KlientShell
          onLoggedOut={() => {
            // Wer sich als Klient:in abmeldet, will sich meist wieder so anmelden.
            setStartAlsKlient(true);
            setAngemeldet(false);
          }}
        />
      ) : (
        <Shell
          onUebergabeStarten={(start) => {
            uebergabeMerken(start);
            setUebergabe(start);
          }}
          onLoggedOut={() => {
            uebergabeMerken(null);
            setUebergabe(null);
            setStartAlsKlient(false);
            setAngemeldet(false);
          }}
        />
      )}
    </ChatEreignisProvider>
  );
}
