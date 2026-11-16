import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KostenuebernahmeController } from "./kostenuebernahme.controller";
import { KostenuebernahmeErinnerungService } from "./kostenuebernahme-erinnerung.service";
import { KostenuebernahmeService } from "./kostenuebernahme.service";

@Module({
  imports: [AuthModule],
  controllers: [KostenuebernahmeController],
  providers: [KostenuebernahmeService, KostenuebernahmeErinnerungService],
})
export class KostenuebernahmeModule {}
