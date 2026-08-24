import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BelegungController } from "./belegung.controller";
import { BelegungService } from "./belegung.service";

@Module({
  imports: [AuthModule],
  controllers: [BelegungController],
  providers: [BelegungService],
})
export class BelegungModule {}
