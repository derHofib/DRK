import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantContextInterceptor } from "../common/tenant-context.interceptor";
import { MandantService } from "./mandant.service";

@Controller("mandant")
@UseGuards(AuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class MandantController {
  constructor(private readonly mandant: MandantService) {}

  @Get("me")
  async me() {
    return this.mandant.findEigenenMandanten();
  }
}
