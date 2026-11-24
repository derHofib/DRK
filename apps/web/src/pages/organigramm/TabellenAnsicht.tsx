import { useMemo, useState } from "react";
import type { OrgUnitDto, PositionDto } from "@zimmerakte/shared";
import { POSITION_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import { IFehler, IHerunterladen, ILeerOrganigramm } from "../../components/icons";
import { besetztMitText, positionsStatus } from "./baum";

/**
 * Ein Feld fuer den CSV-Export. Semikolon statt Komma als Trennzeichen
 * (siehe erzeugeCsv()) heisst: ein Wert, der selbst ein Semikolon oder
 * Anführungszeichen enthaelt, muss in Anführungszeichen stehen, enthaltene
 * Anführungszeichen werden verdoppelt -- Standard-CSV-Escaping (RFC 4180).
 */
function csvFeld(wert: string): string {
  if (/[;"\n]/.test(wert)) return `"${wert.replace(/"/g, '""')}"`;
  return wert;
}

/**
 * Semikolon statt Komma: ein deutsches Excel erwartet per Locale das
 * Komma als Dezimaltrennzeichen und wuerde eine komma-getrennte CSV-Datei
 * sonst als eine einzige Spalte einlesen. Dieselben sechs Spalten wie die
 * Tabellenansicht (dieselbe besetztMitText()-Funktion), damit CSV und
 * UI nie auseinanderlaufen.
 */
function erzeugeCsv(
  positionen: PositionDto[],
  orgUnitNamen: Map<string, string>,
  accountTypNamen: Map<string, string>
): string {
  const kopf = ["Titel", "Einheit", "Typ", "Account-Typ", "Status", "Besetzt mit"];
  const zeilen = positionen.map((p) => [
    p.titel,
    orgUnitNamen.get(p.orgUnitId) ?? "?",
    POSITION_TYP_LABEL[p.typ],
    accountTypNamen.get(p.accountTypId) ?? "?",
    positionsStatus(p).label,
    besetztMitText(p),
  ]);
  return [kopf, ...zeilen].map((zeile) => zeile.map(csvFeld).join(";")).join("\r\n");
}

/**
 * Klassischer Blob+<a download>-Mechanismus direkt im Browser -- anders als
 * api.organigrammExportPdf() braucht der CSV-Export keinen Server-
 * Roundtrip, die Daten sind ueber laden() schon vollstaendig im State.
 */
function csvHerunterladen(inhalt: string, dateiname: string) {
  const blob = new Blob([inhalt], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Tabellenansicht/Export -- letzter UI-Teilschritt aus Schritt 7 (Baum →
 * Seitenpanel → Umhängen → Account-Typ-Verwaltung → Anzeigen als… →
 * Tabellenansicht/Export). Ein echtes <table>-Element (.zv-table) statt des
 * .zv-karten-liste-Grid-Patterns der anderen Ansichten hier in dieser Datei:
 * export-taugliche tabellarische Daten (CSV/PDF) spiegeln sich in einer
 * echten Tabelle natuerlicher als in einem Karten-Grid.
 */
export function TabellenAnsicht({
  orgUnits,
  positionen,
  accountTypNamen,
  orgUnitNamen,
}: {
  orgUnits: OrgUnitDto[];
  positionen: PositionDto[];
  accountTypNamen: Map<string, string>;
  orgUnitNamen: Map<string, string>;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdExportiert, setWirdExportiert] = useState(false);

  const sortiert = useMemo(
    () => [...positionen].sort((a, b) => a.titel.localeCompare(b.titel, "de")),
    [positionen]
  );

  function csvExportieren() {
    setFehler(null);
    const inhalt = `﻿${erzeugeCsv(sortiert, orgUnitNamen, accountTypNamen)}`;
    csvHerunterladen(inhalt, "organigramm.csv");
  }

  async function pdfExportieren() {
    setFehler(null);
    setWirdExportiert(true);
    try {
      await api.organigrammExportPdf();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "PDF konnte nicht erzeugt werden.");
    } finally {
      setWirdExportiert(false);
    }
  }

  return (
    <div>
      <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
        <button className="zv-btn zv-btn-still" type="button" onClick={csvExportieren} disabled={sortiert.length === 0}>
          <IHerunterladen />
          CSV exportieren
        </button>
        <button
          className="zv-btn zv-btn-still"
          type="button"
          onClick={pdfExportieren}
          disabled={wirdExportiert}
        >
          <IHerunterladen />
          {wirdExportiert ? "Erzeugt…" : "PDF exportieren"}
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {sortiert.length === 0 ? (
        <Leerzustand icon={ILeerOrganigramm}>
          {orgUnits.length === 0 ? "Noch keine Organisationsstruktur angelegt." : "Noch keine Positionen angelegt."}
        </Leerzustand>
      ) : (
        <table className="zv-table">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Einheit</th>
              <th>Typ</th>
              <th>Account-Typ</th>
              <th>Status</th>
              <th>Besetzt mit</th>
            </tr>
          </thead>
          <tbody>
            {sortiert.map((p) => {
              const status = positionsStatus(p);
              return (
                <tr key={p.id}>
                  <td>{p.titel}</td>
                  <td>{orgUnitNamen.get(p.orgUnitId) ?? "?"}</td>
                  <td>{POSITION_TYP_LABEL[p.typ]}</td>
                  <td>{accountTypNamen.get(p.accountTypId) ?? "?"}</td>
                  <td>
                    <span className={`zv-pill ${status.klasse}`}>{status.label}</span>
                  </td>
                  <td>{besetztMitText(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
