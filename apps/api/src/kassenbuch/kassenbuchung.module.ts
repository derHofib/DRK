import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KassenbuchungController } from "./kassenbuchung.controller";
import { KassenbuchungService } from "./kassenbuchung.service";
import { KassenbuchungTypController } from "./kassenbuchung-typ.controller";
import { KassenbuchungTypService } from "./kassenbuchung-typ.service";

@Module({
  imports: [AuthModule],
  controllers: [KassenbuchungController, KassenbuchungTypController],
  providers: [KassenbuchungService, KassenbuchungTypService],
})
export class KassenbuchungModule {}
