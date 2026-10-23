import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request, Response } from "express";
import type { ChatNachrichtEingabe } from "@zimmerakte/shared";
import { TeilnehmerAuthenticated } from "../common/authenticated.decorator";
import { erkenneBildTyp } from "../common/datei";
import { leseRohKoerper } from "../common/roh-koerper";
import { requireTenantContext } from "../common/tenant-context";
import { ChatEreignisService } from "./chat-ereignis.service";
import { ChatNachrichtService } from "./chat-nachricht.service";
import { ChatService } from "./chat.service";
import { bildQuerySchema, gruppeAnlegenSchema, kontaktSchema, nachrichtSchema, seiteQuerySchema, umbenennenSchema } from "./chat.schemas";

const MAX_BILD_BYTES = 8_000_000;
const ANHANG_CACHE_SEKUNDEN = 7 * 24 * 60 * 60;

// Ungueltige IDs sind "nicht gefunden" (wie im Kalender), nicht "Eingabefehler".
const id = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/**
 * Statische Pfade (kontakte, ungelesen, ereignisse, anhaenge/...) stehen VOR
 * den ":id"-Routen, sonst frisst ":id" sie.
 */
@Controller("chat")
@TeilnehmerAuthenticated()
export class ChatController {
  constructor(
    private readonly chats: ChatService,
    private readonly nachrichten: ChatNachrichtService,
    private readonly ereignisse: ChatEreignisService,
    private readonly jwt: JwtService
  ) {}

  @Get()
  async liste() {
    return this.chats.liste();
  }

  @Get("kontakte")
  async kontakte() {
    return this.chats.kontakte();
  }

  @Get("ungelesen")
  async ungelesen() {
    return this.chats.ungelesenGesamt();
  }

  // @Res() ohne passthrough: der Handler beendet die Antwort nicht selbst, der Dienst haelt sie offen.
  @Get("ereignisse")
  async stream(@Req() req: Request, @Res() res: Response) {
    const token = (req.headers.authorization ?? "").slice("Bearer ".length);
    const exp = (this.jwt.decode(token) as { exp?: number } | null)?.exp;
    await this.ereignisse.abonnieren(res, requireTenantContext(), exp ? exp * 1000 : null);
  }

  @Get("anhaenge/:id")
  async anhang(@Param("id", id()) anhangId: string, @Res() res: Response) {
    const a = await this.nachrichten.anhang(anhangId);
    res.setHeader("Content-Type", a.mimeType);
    // Inhalt ist unveraenderlich (eigene ID je Bild), aber privat: nie in geteilten Caches.
    res.setHeader("Cache-Control", `private, max-age=${ANHANG_CACHE_SEKUNDEN}`);
    // Begruendung wie beim Grundriss: nosniff, damit der Browser das Bild nie als etwas anderes behandelt.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(a.dateiname)}"`);
    res.setHeader("X-Datei-Hash", a.hash);
    res.send(a.inhalt);
  }

  @Delete("nachrichten/:id")
  async nachrichtLoeschen(@Param("id", id()) nachrichtId: string) {
    return this.nachrichten.loeschen(nachrichtId);
  }

  @Post("direkt")
  async direkt(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { chat, neu } = await this.chats.direktAnlegen(kontaktSchema.parse(body));
    res.status(neu ? HttpStatus.CREATED : HttpStatus.OK);
    return chat;
  }

  @Post("gruppe")
  async gruppe(@Body() body: unknown) {
    const { name, teilnehmer } = gruppeAnlegenSchema.parse(body);
    return this.chats.gruppeAnlegen(name, teilnehmer);
  }

  @Get(":id")
  async einzeln(@Param("id", id()) chatId: string) {
    return this.chats.einzeln(chatId);
  }

  @Patch(":id")
  async umbenennen(@Param("id", id()) chatId: string, @Body() body: unknown) {
    return this.chats.umbenennen(chatId, umbenennenSchema.parse(body).name);
  }

  @Post(":id/teilnehmer")
  @HttpCode(200)
  async teilnehmerHinzufuegen(@Param("id", id()) chatId: string, @Body() body: unknown) {
    return this.chats.teilnehmerHinzufuegen(chatId, kontaktSchema.parse(body));
  }

  @Delete(":id/teilnehmer/:teilnehmerId")
  async teilnehmerEntfernen(@Param("id", id()) chatId: string, @Param("teilnehmerId", id()) teilnehmerId: string) {
    return this.chats.teilnahmeBeenden(chatId, teilnehmerId);
  }

  @Get(":id/nachrichten")
  async seite(@Param("id", id()) chatId: string, @Query() query: unknown) {
    const { vor, limit } = seiteQuerySchema.parse(query);
    return this.nachrichten.seite(chatId, vor, limit);
  }

  @Post(":id/nachrichten")
  async senden(@Param("id", id()) chatId: string, @Body() body: unknown) {
    return this.nachrichten.senden(chatId, nachrichtSchema.parse(body) as ChatNachrichtEingabe);
  }

  // Roher Body statt JSON/Base64 (siehe common/roh-koerper.ts); Typ-Pruefung wie beim Grundriss.
  @Post(":id/bilder")
  async bild(@Param("id", id()) chatId: string, @Query() query: unknown, @Req() req: Request) {
    const { dateiname, text } = bildQuerySchema.parse(query);
    // Erst klaeren, ob der Chat sichtbar ist -- ein Nicht-Teilnehmer soll keine 8 MB einlesen lassen.
    await this.nachrichten.pruefeTeilnahme(chatId);
    const deklariert = (req.headers["content-type"] ?? "").split(";")[0].trim();
    const inhalt = await leseRohKoerper(req, MAX_BILD_BYTES);
    const erkannt = erkenneBildTyp(inhalt);
    if (!erkannt || erkannt !== deklariert) {
      throw new BadRequestException("Bitte ein Bild im Format JPG, PNG oder WebP senden.");
    }
    return this.nachrichten.bildSenden(chatId, { inhalt, mimeType: erkannt, dateiname: dateiname || "bild", text: text || null });
  }

  @Post(":id/gelesen")
  @HttpCode(200)
  async gelesen(@Param("id", id()) chatId: string) {
    return this.nachrichten.gelesen(chatId);
  }
}
