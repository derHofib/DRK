import { useState } from "react";
import { getToken } from "./api/client";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const [angemeldet, setAngemeldet] = useState(() => Boolean(getToken()));

  return angemeldet ? (
    <Dashboard onLoggedOut={() => setAngemeldet(false)} />
  ) : (
    <Login onLoggedIn={() => setAngemeldet(true)} />
  );
}
