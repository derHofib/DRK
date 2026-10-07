import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { AuditModule } from "../audit/audit.module";
import { OrganigrammController } from "./organigramm.controller";
import { OrganigrammService } from "./organigramm.service";

@Module({
  imports: [AuthModule, RechteModule, AuditModule],
  controllers: [OrganigrammController],
  providers: [OrganigrammService],
})
export class OrganigrammModule {}
