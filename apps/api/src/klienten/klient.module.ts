import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KlientController } from "./klient.controller";
import { KlientService } from "./klient.service";
import { KlientStammdatenService } from "./klient-stammdaten.service";

@Module({
  imports: [AuthModule],
  controllers: [KlientController],
  providers: [KlientService, KlientStammdatenService],
})
export class KlientModule {}
