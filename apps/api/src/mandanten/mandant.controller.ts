import { Controller, Get } from "@nestjs/common";
import { Authenticated } from "../common/authenticated.decorator";
import { MandantService } from "./mandant.service";

@Controller("mandant")
@Authenticated()
export class MandantController {
  constructor(private readonly mandant: MandantService) {}

  @Get("me")
  async me() {
    return this.mandant.findEigenenMandanten();
  }
}
