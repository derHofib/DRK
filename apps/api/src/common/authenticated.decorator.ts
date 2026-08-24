import { applyDecorators, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantContextInterceptor } from "./tenant-context.interceptor";

/** Bündelt die beiden Decorators, die jeder Endpunkt außer /auth/login braucht. */
export function Authenticated() {
  return applyDecorators(UseGuards(AuthGuard), UseInterceptors(TenantContextInterceptor));
}
