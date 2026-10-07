import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { DelegationController } from "./delegation.controller";
import { DelegationService } from "./delegation.service";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [DelegationController],
  providers: [DelegationService],
})
export class DelegationModule {}
