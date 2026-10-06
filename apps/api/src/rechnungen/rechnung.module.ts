import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RechteModule } from "../rechte/rechte.module";
import { RechnungController } from "./rechnung.controller";
import { RechnungService } from "./rechnung.service";

@Module({
  imports: [AuthModule, RechteModule],
  controllers: [RechnungController],
  providers: [RechnungService],
})
export class RechnungModule {}
