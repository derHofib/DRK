import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MandantController } from "./mandant.controller";
import { MandantService } from "./mandant.service";

@Module({
  imports: [AuthModule],
  controllers: [MandantController],
  providers: [MandantService],
})
export class MandantModule {}
