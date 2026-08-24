import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KassenbuchungController } from "./kassenbuchung.controller";
import { KassenbuchungService } from "./kassenbuchung.service";

@Module({
  imports: [AuthModule],
  controllers: [KassenbuchungController],
  providers: [KassenbuchungService],
})
export class KassenbuchungModule {}
