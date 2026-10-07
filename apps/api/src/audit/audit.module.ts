import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [AuditController],
  providers: [AuditService],
  // AuditService.protokollieren() wird von anderen Fachmodulen aufgerufen
  // (organigramm/, delegation/), die dafuer AuditModule importieren.
  exports: [AuditService],
})
export class AuditModule {}
