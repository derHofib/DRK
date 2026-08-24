import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { StandortService } from "./standort.service";

const anlegenSchema = z.object({
  name: z.string().min(1),
  adresse: z.string().min(1),
});

@Controller("standorte")
@Authenticated()
export class StandortController {
  constructor(private readonly standorte: StandortService) {}

  @Get()
  async list() {
    return this.standorte.findeAlle();
  }

  @Post()
  async anlegen(@Body() body: unknown) {
    return this.standorte.anlegen(anlegenSchema.parse(body));
  }
}
