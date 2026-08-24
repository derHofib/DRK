import { Body, Controller, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated } from "../common/authenticated.decorator";
import { BelegungService } from "./belegung.service";

const einziehenSchema = z.object({
  zimmerId: z.string().uuid(),
  klientId: z.string().uuid(),
  einzug: z.string().date(),
});

const ausziehenSchema = z.object({
  auszug: z.string().date(),
});

@Controller("belegungen")
@Authenticated()
export class BelegungController {
  constructor(private readonly belegungen: BelegungService) {}

  @Post()
  async einziehen(@Body() body: unknown) {
    return this.belegungen.einziehen(einziehenSchema.parse(body));
  }

  @Patch(":id")
  async ausziehen(@Param("id") id: string, @Body() body: unknown) {
    const { auszug } = ausziehenSchema.parse(body);
    return this.belegungen.ausziehen(id, auszug);
  }
}
