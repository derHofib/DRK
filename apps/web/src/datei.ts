export function dateiZuBase64(datei: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(datei);
  });
}

/**
 * Verkleinert ein Bild auf hoechstens `maxKante` Pixel Kantenlaenge, bevor es
 * hochgeladen wird. Ein Grundriss mit Karten darueber braucht keine 30
 * Megapixel, und Plaene werden oft in riesiger Aufloesung exportiert (gemessen:
 * 35640 x 25200 px bei 2,9 MB), die kein Browser mehr anzeigt. Gleiches Format
 * wie das Original, damit Linienplaene als PNG scharf bleiben. Kann der
 * Browser das Bild nicht dekodieren (zu gross), geht die Originaldatei
 * unveraendert weiter -- dann entscheidet der Server mit einer klaren Meldung.
 */
export async function bildVerkleinern(datei: File, maxKante = 4000): Promise<File> {
  try {
    const bild = await createImageBitmap(datei);
    const faktor = Math.min(1, maxKante / Math.max(bild.width, bild.height));
    if (faktor === 1) {
      bild.close();
      return datei;
    }
    const leinwand = document.createElement("canvas");
    leinwand.width = Math.round(bild.width * faktor);
    leinwand.height = Math.round(bild.height * faktor);
    leinwand.getContext("2d")?.drawImage(bild, 0, 0, leinwand.width, leinwand.height);
    bild.close();
    const blob = await new Promise<Blob | null>((ok) => leinwand.toBlob(ok, datei.type, 0.9));
    return blob && blob.type === datei.type ? new File([blob], datei.name, { type: datei.type }) : datei;
  } catch {
    return datei;
  }
}
