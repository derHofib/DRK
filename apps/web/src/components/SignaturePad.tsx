import { useRef } from "react";

/**
 * Unterschriften-Canvas fuer Auszahlungsbestätigungen. Meldet nach jedem
 * Strich das aktuelle Bild als PNG-Data-URL zurück, und null, sobald es
 * geleert wird -- der Aufrufer entscheidet, ob "leer" bedeutet, dass noch
 * nicht unterschrieben werden darf.
 */
export function SignaturePad({
  onChange,
  gross = false,
}: {
  onChange: (dataUrl: string | null) => void;
  /** Uebergabemodus: volle Breite, Tablet-Groesse (siehe .zv-signature-canvas-gross). */
  gross?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zeichnetRef = useRef(false);
  const hatStricheRef = useRef(false);

  function position(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // Die Leinwand ist per CSS skalierbar; ohne Umrechnung auf die
    // Pixelgroesse des Canvas landet der Strich neben dem Stift.
    return {
      x: ((e.clientX - rect.left) * e.currentTarget.width) / rect.width,
      y: ((e.clientY - rect.top) * e.currentTarget.height) / rect.height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    zeichnetRef.current = true;
    const { x, y } = position(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function zeichnen(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!zeichnetRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = position(e);
    ctx.lineWidth = gross ? 4 : 2;
    ctx.lineCap = "round";
    // Stiftfarbe aus dem Token: die Leinwand bleibt in beiden Themes weiss,
    // die Tinte deshalb auch (siehe .zv-signature-canvas).
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--zv-signature-ink").trim() || "#1a1a1a";
    ctx.lineTo(x, y);
    ctx.stroke();
    hatStricheRef.current = true;
  }

  function ende() {
    if (!zeichnetRef.current) return;
    zeichnetRef.current = false;
    if (hatStricheRef.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  }

  function leeren() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hatStricheRef.current = false;
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={gross ? 900 : 340}
        height={gross ? 360 : 140}
        className={`zv-signature-canvas${gross ? " zv-signature-canvas-gross" : ""}`}
        aria-label="Unterschriftsfeld"
        onPointerDown={start}
        onPointerMove={zeichnen}
        onPointerUp={ende}
        onPointerLeave={ende}
      />
      <button type="button" className={`zv-link-btn${gross ? " zv-signature-leeren" : ""}`} onClick={leeren}>
        Unterschrift löschen
      </button>
    </div>
  );
}
