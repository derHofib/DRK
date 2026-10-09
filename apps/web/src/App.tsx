import { useEffect, useState } from "react";
import { aufSitzungAbgelaufen, getToken } from "./api/client";
import { Login } from "./pages/Login";
import { PasswortZuruecksetzen } from "./pages/PasswortZuruecksetzen";
import { Shell } from "./pages/Shell";

export function App() {
  const [angemeldet, setAngemeldet] = useState(() => Boolean(getToken()));
  // Live-Rueckmeldung: ein abgelaufener Token soll sofort zur Login-Seite
  // zurueckschalten (statt der bisherigen Inline-Fehlermeldung mitten in
  // der laufenden Seite), mit einer kurzen Erklaerung statt stillschweigend.
  const [sitzungAbgelaufen, setSitzungAbgelaufen] = useState(false);

  useEffect(() => {
    aufSitzungAbgelaufen(() => {
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

  return angemeldet ? (
    <Shell onLoggedOut={() => setAngemeldet(false)} />
  ) : (
    <Login
      onLoggedIn={() => {
        setSitzungAbgelaufen(false);
        setAngemeldet(true);
      }}
      sitzungAbgelaufen={sitzungAbgelaufen}
    />
  );
}
