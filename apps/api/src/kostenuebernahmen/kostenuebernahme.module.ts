import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KostenuebernahmeController } from "./kostenuebernahme.controller";
import { KostenuebernahmeService } from "./kostenuebernahme.service";

@Module({
  imports: [AuthModule],
  controllers: [KostenuebernahmeController],
  providers: [KostenuebernahmeService],
})
export class KostenuebernahmeModule {}
