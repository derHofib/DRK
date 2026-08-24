import { useEffect, useState } from "react";
import type { MandantDto } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";
import { Zimmer } from "./Zimmer";
import { Klienten } from "./Klienten";
import { Uebersicht } from "./Uebersicht";

type Tab = "uebersicht" | "zimmer" | "klienten";

export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [mandant, setMandant] = useState<MandantDto | null>(null);
  const [tab, setTab] = useState<Tab>("zimmer");

  useEffect(() => {
    api.eigenerMandant().then(setMandant).catch(() => {});
  }, []);

  function logout() {
    clearToken();
    onLoggedOut();
  }

  return (
    <div>
      <div className="zv-topbar">
        <div>
          <strong>Zimmerakte</strong>{" "}
          {mandant && (
            <span>
              {mandant.name} · {mandant.slug}
            </span>
          )}
        </div>
        <button className="zv-btn" style={{ width: "auto", padding: "6px 14px" }} onClick={logout}>
          Abmelden
        </button>
      </div>

      <div className="zv-tabbar">
        <button className={tab === "zimmer" ? "active" : ""} onClick={() => setTab("zimmer")}>
          Zimmer
        </button>
        <button className={tab === "klienten" ? "active" : ""} onClick={() => setTab("klienten")}>
          Klienten
        </button>
        <button className={tab === "uebersicht" ? "active" : ""} onClick={() => setTab("uebersicht")}>
          Mitarbeitende
        </button>
      </div>

      <div className="zv-content">
        {tab === "zimmer" && <Zimmer />}
        {tab === "klienten" && <Klienten />}
        {tab === "uebersicht" && <Uebersicht />}
      </div>
    </div>
  );
}
