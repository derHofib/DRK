import { useCallback, useEffect, useState } from "react";
import type { SchichtuebergabeDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { UebergabeAnzeige } from "./UebergabeAnzeige";

/**
 * Dashboard: ungelesene Uebergaben, solange sie nicht bestaetigt sind. Ohne
 * Recht (403) oder bei Fehlern bleibt die Stelle leer -- das Dashboard soll
 * wegen einer Zusatzkarte nicht kaputt aussehen.
 */
export function UebergabeKarten() {
  const [offen, setOffen] = useState<SchichtuebergabeDto[]>([]);

  const laden = useCallback(() => {
    api.schichtuebergabenUngelesen().then(setOffen).catch(() => setOffen([]));
  }, []);
  useEffect(laden, [laden]);

  if (offen.length === 0) return null;
  return (
    <section aria-label="Ungelesene Schichtübergaben" style={{ marginBottom: 20 }}>
      {offen.map((u) => (
        <UebergabeAnzeige key={u.id} uebergabe={u} onAktualisieren={laden} />
      ))}
    </section>
  );
}
