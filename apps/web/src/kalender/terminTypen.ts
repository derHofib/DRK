import { useEffect, useState } from "react";
import type { TerminTypDto } from "@zimmerakte/shared";
import { api } from "../api/client";

/**
 * Typliste des Traegers (migrations/0085), einmal je Sitzung geladen und von
 * Kalender, Termin-Dialog und "Typen & Listen" geteilt. Wer die Liste
 * aendert, ruft neuLaden() -- dann sehen alle offenen Ansichten die neue
 * Farbe sofort, ohne Seitenwechsel.
 *
 * Fehler (z. B. Klient:innen: die Route ist nur fuer Mitarbeitende) ergeben
 * eine leere Liste: Klient:innen waehlen keinen Typ, und der Kalender kennt
 * die Typen ohnehin auch aus den Terminen selbst.
 */
let stand: TerminTypDto[] | null = null;
let laufend: Promise<void> | null = null;
const abonnenten = new Set<(t: TerminTypDto[]) => void>();

function holen(): Promise<void> {
  laufend ??= api
    .terminTypen()
    .catch(() => [] as TerminTypDto[])
    .then((t) => {
      stand = t;
      for (const a of abonnenten) a(t);
    })
    .finally(() => {
      laufend = null;
    });
  return laufend;
}

export function terminTypenNeuLaden(): Promise<void> {
  return holen();
}

/** Nach einer Abmeldung darf die Liste des alten Traegers nicht stehen bleiben. */
export function terminTypenVergessen(): void {
  stand = null;
}

export function useTerminTypen(): TerminTypDto[] {
  const [typen, setTypen] = useState<TerminTypDto[]>(stand ?? []);
  useEffect(() => {
    abonnenten.add(setTypen);
    if (stand === null) void holen();
    else setTypen(stand);
    return () => {
      abonnenten.delete(setTypen);
    };
  }, []);
  return typen;
}
