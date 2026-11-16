import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { HilfeplanController } from "./hilfeplan.controller";
import { HilfeplanService } from "./hilfeplan.service";

@Module({
  imports: [AuthModule],
  controllers: [HilfeplanController],
  providers: [HilfeplanService],
})
export class HilfeplanModule {}
