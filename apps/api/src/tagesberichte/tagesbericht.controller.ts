import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { TagesberichtService } from "./tagesbericht.service";

const anlegenSchema = z.object({
  klientId: z.string().uuid(),
  datum: z.string().date(),
  text: z.string().min(1),
  tagNamen: z.array(z.string().min(1)).optional(),
});

const tagHinzufuegenSchema = z.object({
  name: z.string().min(1),
});

@Controller()
@Authenticated()
export class TagesberichtController {
  constructor(private readonly tagesberichte: TagesberichtService) {}

  @Get("tagesberichte")
  async list(@Query("klientId") klientId?: string) {
    return this.tagesberichte.findeAlle(klientId);
  }

  @Post("tagesberichte")
  async anlegen(@Body() body: unknown) {
    return this.tagesberichte.anlegen(anlegenSchema.parse(body));
  }

  @Post("tagesberichte/:id/tags")
  async tagHinzufuegen(@Param("id") id: string, @Body() body: unknown) {
    const { name } = tagHinzufuegenSchema.parse(body);
    return this.tagesberichte.tagHinzufuegen(id, name);
  }

  @Delete("tagesberichte/:id/tags/:tagId")
  async tagEntfernen(@Param("id") id: string, @Param("tagId") tagId: string) {
    await this.tagesberichte.tagEntfernen(id, tagId);
    return { ok: true };
  }

  @Get("tags")
  async tagsListe() {
    return this.tagesberichte.tagsListe();
  }
}
