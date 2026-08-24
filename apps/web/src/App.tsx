import { useState } from "react";
import { getToken } from "./api/client";
import { Login } from "./pages/Login";
import { Shell } from "./pages/Shell";

export function App() {
  const [angemeldet, setAngemeldet] = useState(() => Boolean(getToken()));

  return angemeldet ? (
    <Shell onLoggedOut={() => setAngemeldet(false)} />
  ) : (
    <Login onLoggedIn={() => setAngemeldet(true)} />
  );
}
