import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KlientController } from "./klient.controller";
import { KlientService } from "./klient.service";

@Module({
  imports: [AuthModule],
  controllers: [KlientController],
  providers: [KlientService],
})
export class KlientModule {}
