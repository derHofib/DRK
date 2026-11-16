import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { RechteModule } from "../rechte/rechte.module";
import { RueckmeldungController } from "./rueckmeldung.controller";
import { RueckmeldungServiceController } from "./rueckmeldung-service.controller";
import { RueckmeldungLoeschfristService } from "./rueckmeldung-loeschfrist.service";
import { RueckmeldungService } from "./rueckmeldung.service";
import { ServiceTokenGuard } from "./service-token.guard";

@Module({
  imports: [AuthModule, AuditModule, RechteModule],
  controllers: [RueckmeldungController, RueckmeldungServiceController],
  providers: [RueckmeldungService, RueckmeldungLoeschfristService, ServiceTokenGuard],
})
export class RueckmeldungModule {}
