import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GeraeteController } from "./geraete.controller";
import { GeraeteService } from "./geraete.service";

@Module({
  imports: [AuthModule],
  controllers: [GeraeteController],
  providers: [GeraeteService],
})
export class GeraeteModule {}
