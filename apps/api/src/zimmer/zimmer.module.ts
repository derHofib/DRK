import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ZimmerController } from "./zimmer.controller";
import { ZimmerService } from "./zimmer.service";

@Module({
  imports: [AuthModule],
  controllers: [ZimmerController],
  providers: [ZimmerService],
})
export class ZimmerModule {}
