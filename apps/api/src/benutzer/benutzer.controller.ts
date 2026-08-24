import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantContextInterceptor } from "../common/tenant-context.interceptor";
import { BenutzerService } from "./benutzer.service";

@Controller("benutzer")
@UseGuards(AuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class BenutzerController {
  constructor(private readonly benutzer: BenutzerService) {}

  @Get()
  async list() {
    return this.benutzer.findeAlleImEigenenMandanten();
  }
}
