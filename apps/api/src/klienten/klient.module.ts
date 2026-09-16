import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KlientController } from "./klient.controller";
import { KlientService } from "./klient.service";
import { KlientStammdatenService } from "./klient-stammdaten.service";
import { KlientArchivService } from "./klient-archiv.service";

@Module({
  imports: [AuthModule],
  controllers: [KlientController],
  providers: [KlientService, KlientStammdatenService, KlientArchivService],
})
export class KlientModule {}
