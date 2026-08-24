import { Controller, Get } from "@nestjs/common";
import { Authenticated } from "../common/authenticated.decorator";
import { BenutzerService } from "./benutzer.service";

@Controller("benutzer")
@Authenticated()
export class BenutzerController {
  constructor(private readonly benutzer: BenutzerService) {}

  @Get()
  async list() {
    return this.benutzer.findeAlleImEigenenMandanten();
  }
}
