import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { AktenZugriffController } from "./akten-zugriff.controller";
import { AktenZugriffService } from "./akten-zugriff.service";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [AuditController, AktenZugriffController],
  providers: [AuditService, AktenZugriffService],
  // AuditService.protokollieren() wird von anderen Fachmodulen aufgerufen
  // (organigramm/, delegation/), die dafuer AuditModule importieren.
  exports: [AuditService],
})
export class AuditModule {}
