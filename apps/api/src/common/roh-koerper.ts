import { PayloadTooLargeException } from "@nestjs/common";
import type { Request } from "express";

/**
 * Liest den Request-Body als rohe Bytes bis zu einer Obergrenze. Fuer
 * Bild-Uploads: der globale JSON-Parser (Standardlimit 100 kB) greift nur bei
 * application/json, ein Grundriss-Foto waere als Base64-JSON zu gross und
 * ~33 % groesser als noetig. Die Obergrenze gilt waehrend des Lesens -- ein
 * zu grosser Upload wird abgebrochen, bevor er den Speicher fuellt, nicht
 * erst danach geprueft.
 */
export function leseRohKoerper(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const angekuendigt = Number(req.headers["content-length"] ?? 0);
    if (angekuendigt > maxBytes) {
      reject(new PayloadTooLargeException(`Die Datei ist zu groß (maximal ${Math.floor(maxBytes / 1_000_000)} MB).`));
      return;
    }
    const teile: Buffer[] = [];
    let gesamt = 0;
    req.on("data", (teil: Buffer) => {
      gesamt += teil.length;
      if (gesamt > maxBytes) {
        reject(new PayloadTooLargeException(`Die Datei ist zu groß (maximal ${Math.floor(maxBytes / 1_000_000)} MB).`));
        req.destroy();
        return;
      }
      teile.push(teil);
    });
    req.on("end", () => resolve(Buffer.concat(teile)));
    req.on("error", reject);
  });
}
